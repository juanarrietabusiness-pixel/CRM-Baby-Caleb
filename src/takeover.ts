// Cuando una persona del equipo toma una conversación, el bot se calla.
//
// Hay tres puertas por las que una persona contesta, y las tres tienen que
// terminar en el MISMO sitio:
//
//   · el panel (/admin/conversations → "Enviar"),
//   · el teléfono del negocio, en el canal de WhatsApp por QR,
//   · Telegram, respondiendo sobre el aviso que le llegó al dueño.
//
// Antes cada una decidía por su cuenta cuánto se callaba el bot, y la del
// teléfono ni siquiera existía: el contenedor tiraba los mensajes propios
// (`key.fromMe`) y el bot seguía contestando encima de la persona. En Baby
// Caleb eso terminó con la dueña y el bot respondiéndole a la misma clienta a
// la vez — y con la dueña escribiendo en "Instrucciones personalizadas" que el
// bot se pausara, lo que reemplazó el prompt entero por esa sola línea.

import type { Env } from "./env";
import { Db } from "./db/client";
import { ConversationsRepo } from "./db/conversations";
import { MessagesRepo } from "./db/messages";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
// El bot solo atiende chats uno a uno: ni grupos, ni estados, ni canales.
import { esChatDeUnaPersona } from "./channels/whatsappQr";

/** Lo de siempre: una hora. Es lo que hacía el panel antes de ser configurable. */
export const TAKEOVER_DEFAULT_MIN = 60;
/** Piso y techo: menos de 5 minutos no alcanza a nadie, más de 7 días es olvido. */
const TAKEOVER_MIN_MIN = 5;
const TAKEOVER_MAX_MIN = 7 * 24 * 60;

/** Convierte el ajuste guardado en milisegundos, siempre dentro del rango. */
export function takeoverMsFrom(raw: string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  const min = Number.isFinite(n) && n > 0 ? n : TAKEOVER_DEFAULT_MIN;
  return Math.min(TAKEOVER_MAX_MIN, Math.max(TAKEOVER_MIN_MIN, min)) * 60_000;
}

/** Cuánto se calla el bot cuando entra una persona, según el panel. */
export async function takeoverMs(env: Env): Promise<number> {
  try {
    const raw = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.takeoverMinutes);
    return takeoverMsFrom(raw);
  } catch {
    return takeoverMsFrom(null);
  }
}

/** Por dónde está atendiendo la persona. Decide si lo nuevo se le reenvía a Telegram. */
export type Via = "panel" | "telefono" | "telegram";

/**
 * Calla el bot en esta conversación. Cada respuesta de la persona REINICIA el
 * plazo: mientras siga conversando con la clienta, el bot no vuelve a entrar.
 *
 * `via` queda en `conversations.metadata`: si la dueña atiende desde Telegram,
 * lo que escriba la clienta mientras tanto se le reenvía allá — si atiende
 * desde el teléfono, ya lo está viendo, y reenviárselo sería duplicarlo.
 */
export async function pausarPorHumano(env: Env, conversationId: string, via?: Via): Promise<number> {
  const hasta = Date.now() + (await takeoverMs(env));
  const db = new Db(env.DB);
  await new ConversationsRepo(db).setPausedUntil(conversationId, hasta);
  if (via) {
    await db.run("UPDATE conversations SET metadata = ? WHERE id = ?", [
      JSON.stringify({ atiende: via, desde: Date.now() }),
      conversationId,
    ]);
  }
  return hasta;
}

/** Por dónde atiende la persona esta conversación, si lo sabemos. */
export function viaDeAtencion(metadata: string | null | undefined): Via | null {
  if (!metadata) return null;
  try {
    const v = (JSON.parse(metadata) as { atiende?: string }).atiende;
    return v === "panel" || v === "telefono" || v === "telegram" ? v : null;
  } catch {
    return null;
  }
}

/** Lo que se anota cuando la dueña devuelve sin escribir nada. */
export const NOTA_DE_DEVOLUCION = "(El dueño habló con el cliente y resolvió la consulta.)";

/**
 * Devuelve la conversación al bot: quita la pausa, deja una nota para que el
 * bot retome con contexto, y cierra los tickets abiertos de esa conversación.
 *
 * Lo usan el panel y Telegram. Cerrar los tickets es la mitad que faltaba:
 * devolver al bot es decir "esto ya lo atendí", y un ticket que queda abierto
 * deja la conversación para siempre en el filtro "Atención".
 */
export async function devolverAlBot(
  env: Env,
  conversationId: string,
  opts: { nota?: string; quien: string },
): Promise<{ ticketsCerrados: number }> {
  const db = new Db(env.DB);
  const convs = new ConversationsRepo(db);
  await convs.setPausedUntil(conversationId, null);
  await new MessagesRepo(db).append(conversationId, "owner", opts.nota?.trim() || NOTA_DE_DEVOLUCION);
  const r = await db.run(
    `UPDATE tickets SET status = 'resolved', resolved_at = ?, resolved_by = ?
      WHERE conversation_id = ? AND status != 'resolved'`,
    [Date.now(), `devuelto al bot (${opts.quien})`, conversationId],
  );
  await db.run("UPDATE conversations SET open_ticket_id = NULL, metadata = NULL WHERE id = ?", [conversationId]);
  return { ticketsCerrados: r.meta?.changes ?? 0 };
}

// ── WhatsApp por QR: la persona contestó desde el teléfono ─────────────────

/** Lo que el puente manda en `POST /webhooks/whatsapp-qr/propio`. */
export interface RespuestaDelTelefono {
  /** El chat, tal como lo nombra WhatsApp. Puede venir como PN o como LID. */
  jids: string[];
  texto: string | null;
  tipo: string | null;
  enviadoEn: number;
}

export type ResultadoDelTelefono =
  | { accion: "pausada"; conversationId: string; hasta: number }
  | { accion: "ignorada"; motivo: string };

/**
 * Cuánto se mira hacia atrás para reconocer un eco del propio bot. El eco
 * llega en el mismo instante en que el bot envía; el margen es para los
 * reloj de dos máquinas distintas, no para ecos de verdad lentos.
 */
const VENTANA_ECO_MS = 15 * 60_000;

/**
 * ¿Este texto es algo que el bot (o alguien desde el panel) acaba de mandar?
 *
 * El contenedor ya descarta sus propios envíos por id, antes de reenviar nada.
 * Esto es la red de abajo: si el contenedor se reinició entre un envío y su
 * eco, perdió la lista de ids. Por eso es estricta: igual al mensaje entero, o
 * un trozo largo de uno. Un "Sí" de la dueña no puede confundirse con el "Sí,
 * tenemos talla M" del bot — eso dejaría sin pausar justo lo que importa.
 */
export function esEcoDelBot(texto: string, recientes: { content: string }[]): boolean {
  const t = texto.trim();
  if (!t) return false;
  return recientes.some((m) => {
    const c = m.content.trim();
    return c === t || (t.length >= 25 && c.includes(t));
  });
}

/**
 * La dueña contestó desde el teléfono del negocio: se anota su mensaje en la
 * conversación —para que el panel muestre la conversación entera, no solo la
 * mitad del bot— y se calla el bot ahí.
 *
 * WhatsApp está migrando a identificadores LID, y el mismo chat puede llegar
 * con el número (`507…@s.whatsapp.net`) en un mensaje y con el LID en otro. El
 * puente manda los dos cuando los conoce; aquí se usa el que ya tenga
 * conversación. Si ninguno la tiene —la dueña le escribió primero a alguien—,
 * se abre con el LID, que es como llegan hoy los mensajes de las clientas: así
 * cuando esa persona conteste, el bot la encuentra pausada y no se mete.
 */
export async function registrarRespuestaDelTelefono(
  env: Env,
  r: RespuestaDelTelefono,
): Promise<ResultadoDelTelefono> {
  const jids = [...new Set(r.jids.map((j) => (j ?? "").trim()).filter(esChatDeUnaPersona))];
  if (jids.length === 0) return { accion: "ignorada", motivo: "no es un chat uno a uno" };

  const db = new Db(env.DB);
  const convs = new ConversationsRepo(db);

  let conversationId: string | null = null;
  for (const jid of jids) {
    const c = await convs.getById(`whatsapp-qr:${jid}`);
    if (c) {
      conversationId = c.id;
      break;
    }
  }

  const texto = (r.texto ?? "").trim();

  if (conversationId && texto) {
    const recientes = await db.all<{ content: string }>(
      `SELECT content FROM messages
        WHERE conversation_id = ? AND role IN ('assistant', 'owner') AND created_at > ?`,
      [conversationId, Date.now() - VENTANA_ECO_MS],
    );
    if (esEcoDelBot(texto, recientes)) return { accion: "ignorada", motivo: "eco del bot" };
  }

  if (!conversationId) {
    const preferido = jids.find((j) => j.endsWith("@lid")) ?? jids[0];
    conversationId = (await convs.getOrCreate("whatsapp-qr", preferido)).id;
  }

  const cuando = Number.isFinite(r.enviadoEn) && r.enviadoEn > 0 ? r.enviadoEn : Date.now();
  await new MessagesRepo(db).append(
    conversationId,
    "owner",
    texto || `(${describirTipo(r.tipo)} enviado desde el teléfono)`,
    { createdAt: cuando },
  );
  await convs.touchLastMessage(conversationId, cuando);
  const hasta = await pausarPorHumano(env, conversationId, "telefono");
  return { accion: "pausada", conversationId, hasta };
}

function describirTipo(tipo: string | null): string {
  switch (tipo) {
    case "imageMessage":
      return "imagen";
    case "audioMessage":
      return "audio";
    case "videoMessage":
      return "video";
    case "documentMessage":
    case "documentWithCaptionMessage":
      return "documento";
    case "stickerMessage":
      return "sticker";
    case "locationMessage":
      return "ubicación";
    case "contactMessage":
      return "contacto";
    default:
      return "mensaje";
  }
}
