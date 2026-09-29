/**
 * Seguimiento a las clientas que dejaron de contestar.
 *
 * La regla (29-sep-2026, la agencia con la dueña), y dónde se cambia:
 *
 *   · Solo a las INTERESADAS: las que preguntaron por un producto, un precio,
 *     una talla o un envío (el bot tuvo que consultar el catálogo, cotizar un
 *     envío o anotarla como interesada). Un «hola» suelto no cuenta.
 *   · Pasos: 5 horas, 3 días y 7 días sin respuesta, cada uno contado desde el
 *     anterior. Si contesta, el ciclo empieza de nuevo; al terminar, se para.
 *   · Quien YA COMPRÓ no recibe seguimiento comercial: descansa 15 días y ese
 *     día le llega el de recompra; si no contesta, siguen los recordatorios
 *     (3 y 7 días). Qué cuenta como compra: src/followup/compras.ts.
 *   · Si la última en escribir fue una persona del equipo, el bot no se mete:
 *     la dueña decide. (Antes el seguimiento salía 5 h después de que ella
 *     cerraba una venta a mano, y era de donde salían los mensajes a quien ya
 *     había comprado.)
 *   · Nunca a quien dijo que no le interesa, ni a una conversación en pausa o
 *     con ticket abierto. Siempre de usted, en horario.
 *
 * Tiempos, horario, textos y el interruptor son AJUSTES (src/followup/ajustes.ts):
 * los cambia la dueña desde Telegram. No viven en la base de conocimiento —
 * este cron no la lee, y por eso la orden «ya no le des seguimiento a nadie»
 * del 28-sep, guardada como documento, nunca frenó nada.
 *
 * La tabla `seguimientos` es el claim: un paso de un ciclo sale una sola vez
 * aunque dos corridas se crucen. Ciclo de una interesada = la hora de su último
 * mensaje (pasos 0, 1, 2…). Ciclo de una compra = la hora de la compra (pasos
 * 10, 11, 12…).
 *
 * La ventana de 24 h: WhatsApp oficial, Messenger e Instagram no dejan escribir
 * primero pasadas 24 h del último mensaje de la clienta (hace falta una
 * plantilla aprobada). En esos canales solo sale lo que cabe en la ventana; lo
 * demás sale por WhatsApp por QR y Telegram.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { resolveAgentConfig } from "../settings-loader";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";
import { cargarAjustes, POR_DEFECTO, type AjustesSeguimiento } from "./ajustes";
import { anotarCompraDicha } from "./compras";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** El primer paso de la secuencia de quien compró. Los de interesadas son 0, 1, 2… */
export const PASO_RECOMPRA = 10;

/** Si el de recompra no pudo salir su día (fin de semana, cron caído), vale hasta una semana después. */
const VIGENCIA_RECOMPRA = 7 * DIA;

/** Canales con la ventana de 24 h de Meta/WhatsApp. */
const CON_VENTANA = new Set(["whatsapp", "messenger", "instagram", "twilio", "manychat"]);
const VENTANA_MS = 23 * HORA; // margen antes de que cierre

/** Un grupo o una difusión de WhatsApp no es una clienta. */
const NO_ES_PERSONA = /@(broadcast|g\.us|newsletter)$/;

/** "Buen día" o "Buenas tardes", según la hora del negocio. */
function saludo(hora: number): string {
  return hora < 12 ? "Buen día" : "Buenas tardes";
}

/** El texto de un paso, con el saludo de la hora. */
export function textoDelPaso(paso: number, hora: number, aj: AjustesSeguimiento = POR_DEFECTO): string {
  const { texto1, texto2, texto3, textoRecompra } = aj.textos;
  const deInteresada = [texto1, texto2, texto3];
  const t =
    paso === PASO_RECOMPRA
      ? textoRecompra
      : paso > PASO_RECOMPRA
        ? (deInteresada[paso - PASO_RECOMPRA] ?? texto3)
        : (deInteresada[paso] ?? texto3);
  return t.replaceAll("{saludo}", saludo(hora));
}

function etiquetaDelPaso(paso: number): string {
  if (paso < PASO_RECOMPRA) return `seguimiento-${paso + 1}`;
  return paso === PASO_RECOMPRA ? "seguimiento-recompra" : `seguimiento-recompra-${paso - PASO_RECOMPRA + 1}`;
}

/**
 * ¿La clienta dijo que no le interesa o que no le escriban? Una sola vez basta:
 * no se le vuelve a escribir nunca. Conservador a propósito — un "no, gracias"
 * también cuenta: mejor un seguimiento de menos que uno que moleste.
 *
 * «Ya compré» a secas NO está aquí: es una compra (src/followup/compras.ts), y
 * a quien compró se le escribe a los 15 días. «Ya compré en otro lado», sí.
 */
export function noQuiereSeguimiento(texto: string): boolean {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  // Sin \b al final: "interesad" tiene que cubrir interesada e interesado.
  return /\b(no (me )?interes|ya no (me )?interes|no estoy interesad|sin interes|no,? gracias|no me (escriba|escriban|escribas|contacte|contacten|contactes|moleste|molesten|molestes)|dej(e|en|a) de (escribir|mandar)|no (me )?(vuelva|vuelvan|vuelvas) a escribir|no quiero (nada|mas|recibir)|ya (lo |la |los |las )?compre en otr[oa] (lado|parte|sitio|lugar|tienda)|ya (lo )?consegui|ya no (lo |los |las )?necesito|no necesito nada|borr(e|en|a) mi numero)/.test(t);
}

/** Hora y día de la semana del negocio. */
function relojDelNegocio(env: Env, now: number): { hora: number; diaSemana: number } {
  const zona = env.BOT_TIMEZONE || "America/Panama";
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23", weekday: "short" })
    .formatToParts(new Date(now));
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "12");
  const dia = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  return { hora, diaSemana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dia) };
}

/** Dentro del horario del seguimiento (por defecto lunes a viernes, 8:00 a 17:59). */
export function enHorario(env: Env, now: number, aj: AjustesSeguimiento = POR_DEFECTO): boolean {
  const { hora, diaSemana } = relojDelNegocio(env, now);
  return aj.dias.includes(diaSemana) && hora >= aj.horaDesde && hora < aj.horaHasta;
}

/** Lo que el seguimiento necesita saber de una conversación para decidir. */
export interface EstadoConversacion {
  channel: string;
  /** Último mensaje de la clienta. */
  ultimaClienta: number | null;
  /** Último mensaje del negocio (bot o persona del equipo) y de quién fue. */
  ultimoNegocio: number | null;
  ultimoNegocioRol: "assistant" | "owner" | null;
  /** Preguntó por un producto, un precio, una talla o un envío. */
  interes: boolean;
  /** La compra más reciente (cualquiera de las cuatro señales), o null. */
  compra: number | null;
  /** Los seguimientos que ya salieron en esta conversación. */
  hechos: { ciclo: number; paso: number; enviado_en: number }[];
}

/**
 * El paso que le toca AHORA a esta conversación, o null. Pura: toda la regla de
 * a quién sí y a quién no está aquí, sin base de datos.
 */
export function siguientePaso(
  e: EstadoConversacion,
  now: number,
  aj: AjustesSeguimiento,
): { ciclo: number; paso: number } | null {
  const U = e.ultimaClienta;
  if (U === null) return null;
  const conVentana = CON_VENTANA.has(e.channel);
  const cabeEnVentana = () => !conVentana || now - U <= VENTANA_MS;

  // ── Ya compró ──
  if (e.compra !== null) {
    const finDescanso = e.compra + aj.postcompraDias * DIA;
    // Descanso: nada comercial, pase lo que pase en la conversación.
    if (now < finDescanso) return null;
    // Si volvió a escribir después del descanso, es una clienta más (abajo).
    if (U < finDescanso) {
      const ciclo = e.compra;
      const hechos = e.hechos.filter((h) => h.ciclo === ciclo && h.paso >= PASO_RECOMPRA).sort((a, b) => a.paso - b.paso);
      const total = aj.postcompraRecordatorios ? aj.pasosHoras.length : 1;
      const k = hechos.length;
      if (k >= total) return null;
      if (k === 0) {
        if (now - finDescanso > VIGENCIA_RECOMPRA) return null;
        return cabeEnVentana() ? { ciclo, paso: PASO_RECOMPRA } : null;
      }
      // La dueña le escribió después del de recompra: ella decide.
      if (e.ultimoNegocioRol === "owner" && (e.ultimoNegocio ?? 0) > hechos[k - 1].enviado_en) return null;
      if (now - hechos[k - 1].enviado_en < aj.pasosHoras[k] * HORA) return null;
      return cabeEnVentana() ? { ciclo, paso: PASO_RECOMPRA + k } : null;
    }
  }

  // ── Interesada que dejó de contestar ──
  if (!e.interes) return null;
  const B = e.ultimoNegocio;
  // Si ella escribió último, le toca contestar al bot o a una persona, no un seguimiento.
  if (B === null || B < U) return null;
  // Si la última en escribir fue una persona del equipo, ella decide.
  if (e.ultimoNegocioRol === "owner") return null;
  const hechos = e.hechos.filter((h) => h.ciclo === U && h.paso < PASO_RECOMPRA).sort((a, b) => a.paso - b.paso);
  const k = hechos.length;
  if (k >= aj.pasosHoras.length) return null;
  const desde = k === 0 ? B : hechos[k - 1].enviado_en;
  if (now - desde < aj.pasosHoras[k] * HORA) return null;
  return cabeEnVentana() ? { ciclo: U, paso: k } : null;
}

export interface Pendiente {
  id: string;
  channel: string;
  channel_user_id: string;
  ciclo: number;
  paso: number;
}

interface Fila {
  id: string;
  channel: string;
  channel_user_id: string;
  metadata: string | null;
  ultima_clienta: number | null;
  ultimo_negocio: number | null;
  ultimo_rol: "assistant" | "owner" | null;
  interes: number;
  compra: number;
}

/** Hasta cuándo atrás puede haber algo pendiente, en días. */
function ventanaDias(aj: AjustesSeguimiento): number {
  const dias = (hs: number[]) => hs.reduce((a, b) => a + b, 0) / 24;
  const interesadas = dias(aj.pasosHoras);
  const compradoras = aj.postcompraDias + VIGENCIA_RECOMPRA / DIA + dias(aj.pasosHoras.slice(1));
  return Math.ceil(Math.max(interesadas, compradoras)) + 2;
}

/** Las conversaciones a las que les toca un paso ahora mismo. */
export async function pendientes(
  env: Env,
  now: number,
  limite: number,
  aj: AjustesSeguimiento = POR_DEFECTO,
): Promise<Pendiente[]> {
  const db = new Db(env.DB);
  const desde = now - ventanaDias(aj) * DIA;
  const filas = await db.all<Fila>(
    `SELECT c.id, c.channel, c.channel_user_id, c.metadata,
       (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS ultima_clienta,
       (SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('assistant', 'owner')
          ORDER BY created_at DESC LIMIT 1) AS ultimo_negocio,
       (SELECT role FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('assistant', 'owner')
          ORDER BY created_at DESC LIMIT 1) AS ultimo_rol,
       (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.tool_calls IS NOT NULL
                  AND (m.tool_calls LIKE '%"catalogQuery"%' OR m.tool_calls LIKE '%"cotizarEnvio"%' OR m.tool_calls LIKE '%"captureLead"%'))
        OR EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)) AS interes,
       MAX(
         COALESCE((SELECT MAX(comprado_en) FROM compras k WHERE k.conversation_id = c.id), 0),
         COALESCE((SELECT MAX(created_at) FROM stock_movements s WHERE s.conversation_id = c.id AND s.kind = 'venta' AND s.undone_at IS NULL), 0),
         COALESCE((SELECT MAX(created_at) FROM tickets t WHERE t.conversation_id = c.id AND t.category = 'billing'), 0)
       ) AS compra
     FROM conversations c
     WHERE (c.paused_until IS NULL OR c.paused_until < ?)
       AND c.open_ticket_id IS NULL
       AND c.last_message_at >= ?
     ORDER BY c.last_message_at ASC
     LIMIT 500`,
    [now, desde],
  );
  const todos = await db.all<{ conversation_id: string; ciclo: number; paso: number; enviado_en: number }>(
    "SELECT conversation_id, ciclo, paso, enviado_en FROM seguimientos WHERE enviado_en >= ?",
    [desde],
  );
  const hechosDe = new Map<string, EstadoConversacion["hechos"]>();
  for (const h of todos) {
    const l = hechosDe.get(h.conversation_id) ?? [];
    l.push(h);
    hechosDe.set(h.conversation_id, l);
  }

  const salida: Pendiente[] = [];
  for (const f of filas) {
    if (salida.length >= limite) break;
    if (NO_ES_PERSONA.test(f.channel_user_id)) continue;
    try {
      if (JSON.parse(f.metadata ?? "{}")?.sin_seguimiento) continue;
    } catch {
      /* metadata vieja o vacía: sigue */
    }
    const estado: EstadoConversacion = {
      channel: f.channel,
      ultimaClienta: f.ultima_clienta,
      ultimoNegocio: f.ultimo_negocio,
      ultimoNegocioRol: f.ultimo_rol,
      interes: !!f.interes,
      compra: f.compra > 0 ? f.compra : null,
      hechos: hechosDe.get(f.id) ?? [],
    };
    let paso = siguientePaso(estado, now, aj);
    if (!paso) continue;

    // Le tocaría. Antes de escribirle, lo que ella misma dijo: ¿que no le
    // interesa? Fuera para siempre. ¿Que ya compró o ya pagó? Es una compra.
    const suyos = await db.all<{ content: string; created_at: number }>(
      "SELECT content, created_at FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 200",
      [f.id],
    );
    if (suyos.some((m) => noQuiereSeguimiento(m.content))) {
      await marcarSinSeguimiento(db, f.id);
      continue;
    }
    const dicho = await anotarCompraDicha(db, f.id, suyos);
    if (dicho !== null && (estado.compra === null || dicho > estado.compra)) {
      estado.compra = dicho;
      paso = siguientePaso(estado, now, aj);
      if (!paso) continue;
    }
    salida.push({ id: f.id, channel: f.channel, channel_user_id: f.channel_user_id, ...paso });
  }
  return salida;
}

export interface RunFollowupsResult {
  sent: number;
  skipped: number;
  errors: number;
}

export async function runFollowups(
  env: Env,
  opts: { now?: number; limit?: number; dailyCap?: number } = {},
): Promise<RunFollowupsResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const dailyCap = opts.dailyCap ?? 60;
  const nada = { sent: 0, skipped: 0, errors: 0 };

  // El interruptor de la dueña (/seguimiento apagar).
  const aj = await cargarAjustes(env);
  if (!aj.activo) return nada;
  if (!enHorario(env, now, aj)) return nada;

  const db = new Db(env.DB);
  // Respeta la pausa global del bot (el dueño lo apagó a propósito).
  const cfg = await resolveAgentConfig(env, []);
  if (cfg.botPaused) return nada;

  const hoy =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM seguimientos WHERE enviado_en > ?", [now - DIA]))?.n ?? 0;
  if (hoy >= dailyCap) return nada;

  const lista = await pendientes(env, now, Math.min(limit, dailyCap - hoy), aj);
  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);
  const { hora } = relojDelNegocio(env, now);
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of lista) {
    // Claim antes de enviar: dos corridas cruzadas no mandan el mismo paso dos veces.
    const claim = await db.run(
      "INSERT OR IGNORE INTO seguimientos (conversation_id, ciclo, paso, enviado_en) VALUES (?, ?, ?, ?)",
      [p.id, p.ciclo, p.paso, now],
    );
    if ((claim.meta.changes ?? 0) === 0) {
      skipped++;
      continue;
    }

    try {
      const texto = textoDelPaso(p.paso, hora, aj);
      await msgs.append(p.id, "assistant", texto, { modelUsed: etiquetaDelPaso(p.paso), createdAt: now });
      await convs.touchLastMessage(p.id, now);
      await pickAdapter(p.channel as ChannelId).sendReply(
        { channel: p.channel as ChannelId, channelUserId: p.channel_user_id, chunks: [texto], interChunkDelayMs: 0 },
        env,
      );
      sent++;
    } catch (e) {
      // El claim se queda: mejor un seguimiento perdido que uno repetido.
      errors++;
      console.error(`[seguimiento] falló ${p.id} paso ${p.paso}:`, e);
    }
  }

  if (sent > 0) console.log(`[seguimiento] enviados=${sent} saltados=${skipped} errores=${errors}`);
  return { sent, skipped, errors };
}

async function marcarSinSeguimiento(db: Db, convId: string): Promise<void> {
  const fila = await db.first<{ metadata: string | null }>("SELECT metadata FROM conversations WHERE id = ?", [convId]);
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(fila?.metadata ?? "{}") ?? {};
  } catch {
    meta = {};
  }
  meta.sin_seguimiento = true;
  await db.run("UPDATE conversations SET metadata = ? WHERE id = ?", [JSON.stringify(meta), convId]);
}
