// Lo que la consola del dueño necesita guardar entre un mensaje y el siguiente.
//
//   · Acciones pendientes: un botón de Telegram solo carga 64 bytes. El botón
//     lleva el id de la acción; qué hace, con qué producto y cuántas unidades,
//     vive en `owner_actions`.
//   · Avisos: cada mensaje que se le manda al dueño sobre una conversación se
//     anota, para que el dueño pueda tocar "Responder" en Telegram y su texto
//     le llegue a ESA clienta, sin copiar identificadores.

import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo, type Conversation } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { channelLabel } from "../channels/labels";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";
import { pausarPorHumano } from "../takeover";

// ── Acciones pendientes (los botones) ──────────────────────────────────────

export interface Accion {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

function idCorto(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

/** Guarda la acción y devuelve el callback_data del botón que la dispara. */
export async function crearAccion(env: Env, kind: string, payload: Record<string, unknown>): Promise<string> {
  const id = idCorto();
  await new Db(env.DB).run(
    "INSERT INTO owner_actions (id, kind, payload, status, created_at) VALUES (?, ?, ?, 'pendiente', ?)",
    [id, kind, JSON.stringify(payload), Date.now()],
  );
  return `a:${id}`;
}

/**
 * Reclama la acción: la marca hecha SOLO si seguía pendiente, en una sola
 * sentencia. Dos toques seguidos al mismo botón —pasa en un teléfono lento—
 * no pueden descontar dos veces la misma venta.
 */
export async function tomarAccion(env: Env, id: string): Promise<Accion | null> {
  const db = new Db(env.DB);
  const r = await db.run(
    "UPDATE owner_actions SET status = 'hecha', decided_at = ? WHERE id = ? AND status = 'pendiente'",
    [Date.now(), id],
  );
  if ((r.meta?.changes ?? 0) !== 1) return null;
  const fila = await db.first<{ id: string; kind: string; payload: string }>(
    "SELECT id, kind, payload FROM owner_actions WHERE id = ?",
    [id],
  );
  if (!fila) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(fila.payload);
  } catch {
    /* payload roto: se devuelve vacío y quien llama decide */
  }
  // Las acciones hermanas (el "No" de un "Sí/No") ya no valen.
  if (typeof payload.grupo === "string") {
    await db.run(
      "UPDATE owner_actions SET status = 'descartada', decided_at = ? WHERE status = 'pendiente' AND json_extract(payload, '$.grupo') = ?",
      [Date.now(), payload.grupo],
    );
  }
  return { id: fila.id, kind: fila.kind, payload };
}

/** Un id de grupo para los botones que se excluyen entre sí. */
export function nuevoGrupo(): string {
  return idCorto();
}

/** Las acciones viejas no sirven: nadie toca un botón de hace un mes. */
export async function purgarAcciones(env: Env, antesDe: number): Promise<void> {
  const db = new Db(env.DB);
  await db.run("DELETE FROM owner_actions WHERE created_at < ?", [antesDe]);
  await db.run("DELETE FROM owner_notices WHERE created_at < ?", [antesDe]);
  await db.run("DELETE FROM owner_fotos WHERE enviada_en < ?", [antesDe]);
}

// ── Avisos (el "Responder" de Telegram) ────────────────────────────────────

export async function anotarAviso(
  env: Env,
  chatId: string | number,
  messageId: number,
  conversationId: string | null,
  ticketId: string | null = null,
): Promise<void> {
  await new Db(env.DB).run(
    `INSERT OR REPLACE INTO owner_notices (tg_chat_id, tg_message_id, conversation_id, ticket_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [String(chatId), messageId, conversationId, ticketId, Date.now()],
  );
}

export async function conversacionDelAviso(
  env: Env,
  chatId: string | number,
  messageId: number,
): Promise<string | null> {
  const fila = await new Db(env.DB).first<{ conversation_id: string | null }>(
    "SELECT conversation_id FROM owner_notices WHERE tg_chat_id = ? AND tg_message_id = ?",
    [String(chatId), messageId],
  );
  return fila?.conversation_id ?? null;
}

/** ¿Ya se le avisó al dueño de esta conversación hace poco? (para no repetir avisos) */
export async function avisoReciente(env: Env, conversationId: string, ms: number): Promise<boolean> {
  const fila = await new Db(env.DB).first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM owner_notices WHERE conversation_id = ? AND created_at > ?",
    [conversationId, Date.now() - ms],
  );
  return (fila?.n ?? 0) > 0;
}

// ── Conversaciones, vistas desde Telegram ──────────────────────────────────

/**
 * Una referencia corta y estable para escribir a mano: `/bot k3f9a`. Sale del
 * id de la conversación, así que no hay que guardarla en ningún lado.
 */
export function refCorta(conversationId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < conversationId.length; i++) {
    h ^= conversationId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(5, "0").slice(-5);
}

export function nombreDe(c: Pick<Conversation, "display_name" | "channel_user_id" | "channel">): string {
  const quien = c.display_name?.trim() || c.channel_user_id.replace(/@.*$/, "");
  return `${quien} · ${channelLabel(c.channel)}`;
}

/**
 * Busca por referencia corta, por nombre o por los dígitos del número. Mira
 * las conversaciones recientes: es para encontrar a "la clienta de hoy", no
 * para buscar en el archivo del año.
 */
/** Canales con la ventana de 24 h de Meta: pasado ese plazo no se escribe primero. */
const CON_VENTANA_24H = new Set(["whatsapp", "messenger", "instagram", "manychat"]);
const VENTANA_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Las conversaciones de los avisos que se le mandaron al dueño en las últimas
 * horas, la más reciente primero. Es el "de quién estamos hablando": si el
 * dueño dice "respóndele a Brian" justo después del aviso de Brian, es ESA
 * conversación — no otra de Brian por otro canal.
 */
export async function conversacionesDeAvisosRecientes(
  env: Env,
  chatId: string | number,
  horas = 6,
): Promise<Conversation[]> {
  const filas = await new Db(env.DB).all<Conversation & { ultimo_aviso: number }>(
    `SELECT c.*, MAX(n.created_at) AS ultimo_aviso FROM owner_notices n
       JOIN conversations c ON c.id = n.conversation_id
      WHERE n.tg_chat_id = ? AND n.created_at > ?
      GROUP BY c.id ORDER BY ultimo_aviso DESC LIMIT 5`,
    [String(chatId), Date.now() - horas * 3_600_000],
  );
  return filas;
}

export async function buscarConversaciones(env: Env, texto: string, limite = 5): Promise<Conversation[]> {
  const q = texto.trim().replace(/^#/, "").toLowerCase();
  if (!q) return [];
  const recientes = await new Db(env.DB).all<Conversation>(
    "SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 400",
  );
  const porRef = recientes.filter((c) => refCorta(c.id) === q);
  if (porRef.length) return porRef;
  const plano = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return recientes
    .filter(
      (c) =>
        plano(c.display_name ?? "").includes(plano(q)) ||
        (q.replace(/\D/g, "").length >= 4 && c.channel_user_id.includes(q.replace(/\D/g, ""))),
    )
    .slice(0, limite);
}

/**
 * El dueño le escribe a una clienta desde Telegram: sale por el canal de la
 * conversación, queda anotado como `owner` y el bot se calla ahí — igual que
 * si hubiera contestado desde el panel o desde el teléfono.
 */
export async function responderACliente(
  env: Env,
  conversationId: string,
  texto: string,
): Promise<{ ok: true; nombre: string } | { ok: false; error: string }> {
  const db = new Db(env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(conversationId);
  if (!conv) return { ok: false, error: "No encontré esa conversación (¿la borraron del panel?)." };
  // Los canales oficiales de Meta no dejan escribir primero pasadas 24 h del
  // último mensaje del cliente: el envío "sale" y nadie lo recibe. El 24-sep-2026
  // la consola dijo "✅ Enviado" a un WhatsApp oficial viejo y al cliente no le
  // llegó nada. Mejor decirlo que fingirlo.
  if (CON_VENTANA_24H.has(conv.channel)) {
    const ultimo = await db.first<{ t: number | null }>(
      "SELECT MAX(created_at) AS t FROM messages WHERE conversation_id = ? AND role = 'user'",
      [conversationId],
    );
    if (!ultimo?.t || Date.now() - ultimo.t > VENTANA_24H_MS) {
      return {
        ok: false,
        error:
          `Por ${channelLabel(conv.channel)} no se le puede escribir primero: pasaron más de 24 h desde su último mensaje. ` +
          "Si tiene otra conversación más reciente (p. ej. por WhatsApp QR), escríbale por esa.",
      };
    }
  }
  try {
    await pickAdapter(conv.channel as ChannelId).sendReply(
      { channel: conv.channel as ChannelId, channelUserId: conv.channel_user_id, chunks: [texto], interChunkDelayMs: 0 },
      env,
    );
  } catch (e) {
    return { ok: false, error: `No salió por ${channelLabel(conv.channel)}: ${e instanceof Error ? e.message : String(e)}` };
  }
  await new MessagesRepo(db).append(conversationId, "owner", texto);
  await convs.touchLastMessage(conversationId);
  await pausarPorHumano(env, conversationId, "telegram");
  return { ok: true, nombre: nombreDe(conv) };
}
