/**
 * Seguimiento a las clientas que dejaron de contestar — la regla de la dueña
 * (23-sep-2026):
 *
 *   1. A las 5 horas sin respuesta, su mensaje ("¿Desea algún pedido? Estoy
 *      agendando los pedidos de mañana…").
 *   2. Si sigue sin contestar, 3 días después.
 *   3. Si sigue sin contestar, 7 días después. Y ahí se para.
 *
 * Siempre cordial y de usted, en horario (lunes a viernes, 8 a.m. a 6 p.m. de
 * Panamá), y NUNCA a quien dijo que no le interesa: una sola vez que lo diga
 * basta para no volver a escribirle.
 *
 * Antes era un solo mensaje de por vida, redactado por la IA (en tuteo
 * mexicano, contra el trato de usted), que salía en el cron diario de las 10
 * p.m. El documento "Seguimiento" del panel pedía las 5 horas, pero el bot solo
 * lee la base de conocimiento cuando una clienta le escribe: nunca podía
 * cumplirlo.
 *
 * Cada vez que la clienta contesta empieza un ciclo nuevo (el `ciclo` es la
 * hora de su último mensaje). La tabla `seguimientos` es el claim: un paso de un
 * ciclo sale una sola vez aunque dos corridas se crucen.
 *
 * La ventana de 24 h: WhatsApp oficial, Messenger e Instagram no dejan escribir
 * primero pasadas 24 h del último mensaje de la clienta (hace falta una
 * plantilla aprobada). En esos canales solo sale lo que cabe en la ventana; los
 * de 3 y 7 días salen por WhatsApp por QR y Telegram.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { resolveAgentConfig } from "../settings-loader";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Cuánto se espera antes de cada paso, contado desde el mensaje anterior del negocio. */
export const PASOS = [
  { espera: 5 * HORA },
  { espera: 3 * DIA },
  { espera: 7 * DIA },
] as const;

/** Canales con la ventana de 24 h de Meta/WhatsApp. */
const CON_VENTANA = new Set(["whatsapp", "messenger", "instagram", "twilio", "manychat"]);
const VENTANA_MS = 23 * HORA; // margen antes de que cierre

/** "Buen día" o "Buenas tardes", según la hora del negocio. */
function saludo(hora: number): string {
  return hora < 12 ? "Buen día" : "Buenas tardes";
}

/** Los tres mensajes. El primero es el de la dueña, tal cual (con el saludo de la hora). */
export function textoDelPaso(paso: number, hora: number): string {
  const s = saludo(hora);
  if (paso === 0) {
    return `${s}, espero se encuentre bien. ¿Desea algún pedido? Estoy agendando los pedidos de mañana. ¡Estamos a la orden por cualquier consulta! 🙌🏻🙋🏻‍♀️`;
  }
  if (paso === 1) {
    return `${s}, espero que usted y su bebé se encuentren muy bien 😊 Le escribo por si todavía le interesa su pedido: con gusto le ayudo a elegir la talla o a coordinar el envío. ¡Quedo a la orden! 🙌🏻`;
  }
  return `${s}, espero que estén muy bien 👶🏻✨ Solo quería recordarle que seguimos a la orden por si necesita pañales, toallitas o su fular. Cuando guste, aquí estamos. ¡Que tenga un lindo día!`;
}

/**
 * ¿La clienta dijo que no le interesa, que ya compró o que no le escriban? Una
 * sola vez basta: no se le vuelve a escribir nunca. Conservador a propósito —
 * un "no, gracias" también cuenta: mejor un seguimiento de menos que uno que
 * moleste.
 */
export function noQuiereSeguimiento(texto: string): boolean {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  // Sin \b al final: "interesad" tiene que cubrir interesada e interesado.
  return /\b(no (me )?interes|ya no (me )?interes|no estoy interesad|sin interes|no,? gracias|no me (escriba|escriban|contacte|contacten|moleste|molesten)|dej(e|en) de (escribir|mandar)|no (me )?(vuelva|vuelvan) a escribir|no quiero (nada|mas|recibir)|ya (lo )?compre|ya (lo )?consegui|ya no (lo |los |las )?necesito|no necesito nada|borr(e|en) mi numero)/.test(t);
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

/** Lunes a viernes, 8:00 a 17:59 del negocio. */
export function enHorario(env: Env, now: number): boolean {
  const { hora, diaSemana } = relojDelNegocio(env, now);
  return diaSemana >= 1 && diaSemana <= 5 && hora >= 8 && hora < 18;
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
  last_user_at: number | null;
  last_bot_at: number | null;
}

/** Las conversaciones a las que les toca un paso ahora mismo. */
export async function pendientes(env: Env, now: number, limite: number): Promise<Pendiente[]> {
  const db = new Db(env.DB);
  const filas = await db.all<Fila>(
    `SELECT * FROM (
       SELECT c.id, c.channel, c.channel_user_id, c.metadata,
         (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_at,
         (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('assistant', 'owner')) AS last_bot_at
       FROM conversations c
       WHERE (c.paused_until IS NULL OR c.paused_until < ?)
         AND c.open_ticket_id IS NULL
         AND c.last_message_at >= ?
     )
     WHERE last_user_at IS NOT NULL AND last_bot_at IS NOT NULL AND last_bot_at >= last_user_at
     ORDER BY last_bot_at ASC
     LIMIT 200`,
    // Nada de lo que lleve más de 12 días quieto: el último paso sale a los 10.
    [now, now - 12 * DIA],
  );

  const salida: Pendiente[] = [];
  for (const f of filas) {
    if (salida.length >= limite) break;
    try {
      if (JSON.parse(f.metadata ?? "{}")?.sin_seguimiento) continue;
    } catch {
      /* metadata vieja o vacía: sigue */
    }
    const ciclo = f.last_user_at!;
    const hechos = await db.all<{ paso: number; enviado_en: number }>(
      "SELECT paso, enviado_en FROM seguimientos WHERE conversation_id = ? AND ciclo = ? ORDER BY paso",
      [f.id, ciclo],
    );
    const paso = hechos.length;
    if (paso >= PASOS.length) continue;
    const desde = paso === 0 ? f.last_bot_at! : hechos[hechos.length - 1].enviado_en;
    if (now - desde < PASOS[paso].espera) continue;
    if (CON_VENTANA.has(f.channel) && now - ciclo > VENTANA_MS) continue;
    salida.push({ id: f.id, channel: f.channel, channel_user_id: f.channel_user_id, ciclo, paso });
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
  if (!enHorario(env, now)) return nada;

  const db = new Db(env.DB);
  // Respeta la pausa global del bot (el dueño lo apagó a propósito).
  const cfg = await resolveAgentConfig(env, []);
  if (cfg.botPaused) return nada;

  const hoy =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM seguimientos WHERE enviado_en > ?", [now - DIA]))?.n ?? 0;
  if (hoy >= dailyCap) return nada;

  const lista = await pendientes(env, now, Math.min(limit, dailyCap - hoy));
  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);
  const { hora } = relojDelNegocio(env, now);
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of lista) {
    // ¿Dijo alguna vez que no le interesa? Se marca para siempre y no se escribe.
    const suyos = await db.all<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 200",
      [p.id],
    );
    if (suyos.some((m) => noQuiereSeguimiento(m.content))) {
      await marcarSinSeguimiento(db, p.id);
      skipped++;
      continue;
    }

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
      const texto = textoDelPaso(p.paso, hora);
      await msgs.append(p.id, "assistant", texto, { modelUsed: `seguimiento-${p.paso + 1}`, createdAt: now });
      await convs.touchLastMessage(p.id, now);
      await pickAdapter(p.channel as ChannelId).sendReply(
        { channel: p.channel as ChannelId, channelUserId: p.channel_user_id, chunks: [texto], interChunkDelayMs: 0 },
        env,
      );
      sent++;
    } catch (e) {
      // El claim se queda: mejor un seguimiento perdido que uno repetido.
      errors++;
      console.error(`[seguimiento] falló ${p.id} paso ${p.paso + 1}:`, e);
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
