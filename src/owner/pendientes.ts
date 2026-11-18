// "¿Qué tengo pendiente?" — tickets abiertos y conversaciones en pausa.
import type { Env } from "../env";
import { Db } from "../db/client";
import type { Conversation } from "../db/conversations";
import { crearAccion, nombreDe, refCorta } from "./acciones";
import type { Respuesta } from "./tipos";

interface FilaTicket {
  summary: string;
  created_at: number;
  conversation_id: string | null;
}

function hora(env: Env, ms: number): string {
  return new Date(ms).toLocaleString("es-PA", {
    timeZone: env.BOT_TIMEZONE || "America/Panama",
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function datos(env: Env) {
  const db = new Db(env.DB);
  const tickets = await db.all<FilaTicket & Pick<Conversation, "display_name" | "channel_user_id" | "channel">>(
    `SELECT t.summary, t.created_at, t.conversation_id, c.display_name, c.channel_user_id, c.channel
       FROM tickets t LEFT JOIN conversations c ON c.id = t.conversation_id
      WHERE t.status != 'resolved' ORDER BY t.created_at DESC LIMIT 15`,
  );
  const pausadas = await db.all<Conversation>(
    "SELECT * FROM conversations WHERE paused_until > ? ORDER BY paused_until DESC LIMIT 15",
    [Date.now()],
  );
  return { tickets, pausadas };
}

/** El texto de pendientes, para el asistente y para /pendientes. */
export async function textoDePendientes(env: Env): Promise<string> {
  const { tickets, pausadas } = await datos(env);
  if (tickets.length === 0 && pausadas.length === 0) return "✅ Nada pendiente: sin tickets abiertos ni conversaciones en pausa.";
  const partes: string[] = ["📋 Pendientes"];
  if (tickets.length) {
    partes.push("", `🎫 Tickets abiertos (${tickets.length})`);
    for (const t of tickets) {
      const quien = t.conversation_id && t.channel ? nombreDe(t) : "sin conversación";
      const ref = t.conversation_id ? ` · #${refCorta(t.conversation_id)}` : "";
      partes.push(`• ${quien}${ref}\n   ${t.summary.slice(0, 140)} (${hora(env, t.created_at)})`);
    }
  }
  if (pausadas.length) {
    partes.push("", `⏸ Atendidas por una persona (${pausadas.length})`);
    for (const c of pausadas) partes.push(`• ${nombreDe(c)} · #${refCorta(c.id)} — bot en pausa hasta ${hora(env, c.paused_until!)}`);
  }
  partes.push("", "Para devolver una al bot: /bot #referencia");
  return partes.join("\n");
}

/** /pendientes: el texto, con un botón "Devolver" por cada conversación en pausa. */
export async function pendientes(env: Env): Promise<Respuesta[]> {
  const texto = await textoDePendientes(env);
  const { pausadas } = await datos(env);
  const teclado = await Promise.all(
    pausadas.slice(0, 6).map(async (c) => [
      {
        texto: `▶️ Devolver: ${(c.display_name || c.channel_user_id.replace(/@.*$/, "")).slice(0, 24)}`,
        data: await crearAccion(env, "devolver", { conversationId: c.id }),
      },
    ]),
  );
  return [{ texto, teclado }];
}
