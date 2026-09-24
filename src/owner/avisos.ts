// Los avisos que le llegan al dueño por Telegram.
//
// Antes eran un texto suelto —"🚨 Nuevo ticket … Ver: <link>"— que obligaba a
// abrir el panel para hacer cualquier cosa. Ahora cada aviso sobre una
// conversación dice QUIÉN es, trae los botones de lo que se suele hacer
// (devolver al bot, pausar, registrar la venta) y se puede contestar: tocando
// "Responder" sobre el aviso, lo que escriba el dueño le llega a la clienta.

import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { chatDelDueno, protegerConsolaUnaVez } from "./dueno";
import { enviar, enviarFoto, type Teclado } from "./telegram";
import { bytesDeMedia } from "../media/almacen";
import { anotarAviso, crearAccion, nombreDe } from "./acciones";
import { EXTENSIONES } from "./extensiones";

export interface Aviso {
  /** La primera línea: "🚨 Ticket · pago", "🛍 Nueva interesada"… */
  titulo: string;
  cuerpo: string;
  conversationId?: string | null;
  ticketId?: string | null;
  /**
   * Qué botones lleva: todos (por defecto), solo "Devolver al bot" (lo que la
   * clienta escribe mientras la dueña la atiende desde Telegram), o ninguno
   * (la alerta de salud del bot, la prueba del panel).
   */
  conBotones?: boolean | "devolver";
  /**
   * La imagen que mandó la clienta (su URL, de cualquier canal). Se le manda al
   * dueño antes del aviso: un comprobante de pago que el bot no puede revisar
   * tiene que poder verlo alguien sin abrir el panel.
   */
  foto?: string | null;
}

/**
 * Manda el aviso al Telegram del dueño. Devuelve false si no hay a quién
 * mandárselo (no vinculado) o si Telegram lo rechazó — y en ese caso el motivo
 * ya quedó en los logs.
 */
export async function avisarAlDueno(env: Env, aviso: Aviso): Promise<boolean> {
  // Un aviso nunca rompe la atención: si algo falla aquí (Telegram caído, una
  // tabla que el esquema todavía no creó), se anota y la conversación sigue.
  try {
    return await armarYEnviar(env, aviso);
  } catch (e) {
    console.error("[avisarAlDueno] no se pudo avisar al dueño:", e);
    return false;
  }
}

async function armarYEnviar(env: Env, aviso: Aviso): Promise<boolean> {
  const chatId = await chatDelDueno(env);
  if (!chatId || !env.TELEGRAM_BOT_TOKEN) return false;
  // Antes del primer botón: sin la firma, la consola lo rechazaría.
  await protegerConsolaUnaVez(env);

  const lineas = [aviso.titulo];
  const teclado: Teclado = [];
  const convId = aviso.conversationId ?? null;

  if (convId) {
    const conv = await new ConversationsRepo(new Db(env.DB)).getById(convId);
    if (conv) lineas.push(`👤 ${nombreDe(conv)}`);
  }
  lineas.push("", aviso.cuerpo);

  if (convId) {
    lineas.push("", "↩️ Responda a este mensaje y su texto le llega a la clienta.");
  }
  if (convId && aviso.conBotones === "devolver") {
    teclado.push([{ texto: "▶️ Devolver al bot", data: await crearAccion(env, "devolver", { conversationId: convId }) }]);
  } else if (convId && aviso.conBotones !== false) {
    const ctx = { env, chatId, actor: `telegram:${chatId}` };
    teclado.push([
      { texto: "▶️ Devolver al bot", data: await crearAccion(env, "devolver", { conversationId: convId }) },
      { texto: "⏸ Pausar bot", data: await crearAccion(env, "pausar", { conversationId: convId }) },
    ]);
    const extra = (
      await Promise.all(EXTENSIONES.map((e) => e.botonesDeAviso?.(ctx, convId) ?? Promise.resolve([])))
    ).flat();
    if (extra.length) teclado.push(extra);
  }
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  if (base.startsWith("https://") && aviso.conBotones !== "devolver") {
    const url = convId
      ? `${base}/admin/conversations?c=${encodeURIComponent(convId)}`
      : `${base}/admin/tickets`;
    teclado.push([{ texto: "💬 Abrir en el panel", url }]);
  }

  // La foto: la que trae el aviso, o si no, la última que mandó el cliente en
  // esta conversación y que la dueña todavía no vio aquí. Antes solo llegaba
  // con `escalar_media` encendido (Baby Caleb); en los demás, el aviso de
  // "quiere una persona" o de un comprobante llegaba sin la imagen, y había
  // que abrir el panel para verla.
  const foto =
    aviso.foto ?? (convId && aviso.conBotones !== false ? await ultimaFotoDelCliente(env, convId) : null);
  if (foto && !(await fotoYaMandada(env, convId, foto))) {
    try {
      const media = await bytesDeMedia(env, foto);
      const fotoId = media ? await enviarFoto(env, chatId, media.bytes, media.mime, "📎 Lo que mandó la clienta") : null;
      // "Responder" sobre la foto también le llega a la clienta.
      if (fotoId !== null) {
        await anotarAviso(env, chatId, fotoId, convId, aviso.ticketId ?? null);
        await anotarFotoMandada(env, convId, foto);
      }
    } catch (e) {
      console.error("[avisarAlDueno] no se pudo mandar la foto:", e);
    }
  }

  const messageId = await enviar(env, chatId, lineas.join("\n"), teclado);
  if (messageId === null) return false;
  await anotarAviso(env, chatId, messageId, convId, aviso.ticketId ?? null);
  return true;
}

/** Cuánto hacia atrás se busca la foto de la clienta: lo de hoy, no lo de la semana pasada. */
const VENTANA_DE_FOTO_MS = 24 * 60 * 60 * 1000;

/** La última imagen que mandó el cliente en esta conversación, si es reciente. */
export async function ultimaFotoDelCliente(env: Env, conversationId: string): Promise<string | null> {
  const fila = await env.DB.prepare(
    `SELECT content FROM messages
      WHERE conversation_id = ? AND role = 'user' AND content LIKE '%[IMAGE_URL: %' AND created_at > ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(conversationId, Date.now() - VENTANA_DE_FOTO_MS)
    .first<{ content: string }>();
  return fila?.content.match(/\[IMAGE_URL: (.+?)\]/)?.[1] ?? null;
}

/**
 * La misma foto no le llega dos veces: un comprobante que ya se mandó con el
 * aviso de "archivo recibido" no se repite en el de "quiere una persona".
 * Se recuerda por conversación y por URL (tabla owner_fotos).
 */
async function fotoYaMandada(env: Env, conversationId: string | null, url: string): Promise<boolean> {
  if (!conversationId) return false;
  const fila = await env.DB.prepare("SELECT 1 AS si FROM owner_fotos WHERE conversation_id = ? AND url = ?")
    .bind(conversationId, url)
    .first<{ si: number }>();
  return !!fila;
}

async function anotarFotoMandada(env: Env, conversationId: string | null, url: string): Promise<void> {
  if (!conversationId) return;
  await env.DB.prepare("INSERT OR IGNORE INTO owner_fotos (conversation_id, url, enviada_en) VALUES (?, ?, ?)")
    .bind(conversationId, url, Date.now())
    .run();
}
