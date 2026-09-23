import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";

const TG_API = "https://api.telegram.org/bot";

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name?: string; is_bot: boolean };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number };
    photo?: { file_id: string; width: number; height: number }[];
  };
}

export async function resolveTelegramFileUrl(
  fileId: string,
  token: string,
): Promise<string | null> {
  // Telegram files are NOT directly addressable by file_id. You must call
  // getFile to obtain a file_path, then download from
  // https://api.telegram.org/file/bot<token>/<file_path> (per Bot API docs).
  const res = await fetch(`${TG_API}${token}/getFile?file_id=${fileId}`);
  if (!res.ok) return null;
  const json: any = await res.json();
  if (!json?.ok) return null;
  return `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
}

/**
 * `/miid` → el bot contesta el chat id de quien lo escribe.
 *
 * Es el número que va en el secret OWNER_TELEGRAM_CHAT_ID para que los avisos
 * le lleguen al dueño. Sin esto, la única forma de conocerlo era llamar a la
 * API de Telegram a mano. Lo contesta a cualquiera —cada quien ve solo el
 * suyo— y NO intercepta `/start`: una clienta nueva tiene que recibir el
 * saludo del bot, no un número.
 */
export async function contestarMiId(update: TgUpdate, env: Env): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const msg = update?.message;
  const cmd = msg?.text?.trim().toLowerCase().split(/[\s@]/)[0];
  if (!token || !msg || cmd !== "/miid") return false;
  await fetch(`${TG_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text:
        `Su chat id es:\n${msg.from.id}\n\n` +
        "Si usted es el dueño, ese número va en el secret OWNER_TELEGRAM_CHAT_ID " +
        "(GitHub → Settings → Secrets and variables → Actions).",
    }),
  }).catch((e) => console.error("[telegram] /miid falló:", e));
  return true;
}

/**
 * Un update de Telegram como mensaje de una CLIENTA. Lo del dueño no llega
 * aquí: la ruta /webhooks/telegram se lo entrega antes a la consola del dueño
 * (src/owner/consola.ts). Antes se marcaba `isOwnerMessage` y eso solo
 * pausaba la propia conversación del dueño con su bot — que no le servía a
 * nadie.
 */
export async function mensajeDeTelegram(update: TgUpdate, env: Env): Promise<IncomingMessage> {
  const msg = update.message;
  if (!msg) throw new Error("not a message update");
  const channelUserId = String(msg.from.id);
  const displayName = msg.from.first_name;
  let text = msg.text;
  let audioUrl: string | undefined;
  let imageUrl: string | undefined;
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (msg.voice) {
    // Resolve to a real, fetchable HTTPS URL via getFile (see docs above).
    audioUrl = (await resolveTelegramFileUrl(msg.voice.file_id, token)) ?? undefined;
  } else if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    imageUrl = (await resolveTelegramFileUrl(largest.file_id, token)) ?? undefined;
    text = msg.caption;
  }
  return {
    channel: "telegram",
    channelUserId,
    displayName,
    text,
    audioUrl,
    imageUrl,
    isOwnerMessage: false,
    receivedAt: Date.now(),
    rawPayload: update,
  };
}

export const telegramAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    return mensajeDeTelegram((await request.json()) as TgUpdate, env);
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
    for (let i = 0; i < reply.chunks.length; i++) {
      // typing indicator (best effort)
      await fetch(`${TG_API}${token}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: reply.channelUserId, action: "typing" }),
      }).catch(() => {});
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(`${TG_API}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: reply.channelUserId, text: reply.chunks[i] }),
      });
      // No te tragues el fallo. El mensaje ya se guardó en D1 antes de llegar
      // aquí, así que aparece en el panel pase lo que pase: si Telegram lo
      // rechaza y nadie lo registra, el síntoma es "el bot responde en el panel
      // pero al cliente no le llega nada", sin ninguna pista de por qué.
      //
      // Telegram devuelve el motivo en `description`, y suele ser muy concreto:
      //   401 Unauthorized              → TELEGRAM_BOT_TOKEN mal o de otro bot
      //   400 chat not found            → chat_id que ya no existe
      //   403 bot was blocked by the user → el cliente bloqueó al bot
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`telegram sendReply ${res.status}: ${errBody}`);
      }
    }
  },

  async showTyping(channelUserId: string, env: Env): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`${TG_API}${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelUserId, action: "typing" }),
    }).catch(() => {});
  },
};
