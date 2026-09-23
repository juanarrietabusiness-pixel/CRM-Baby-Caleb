// La API de Telegram, lo justo para hablar con el dueño: mensajes con botones,
// contestar un botón y editar el mensaje que lo tenía.
//
// Todo devuelve en vez de lanzar. Un aviso al dueño que no sale no puede tumbar
// la respuesta a una clienta, pero tampoco puede perderse en silencio: el
// motivo que da Telegram ("chat not found", "bot was blocked by the user") se
// escribe en los logs, que es lo único que distingue un aviso entregado de uno
// que nunca llegó.

import type { Env } from "../env";

const TG = "https://api.telegram.org/bot";

/** Un botón. `data` va a callback_data, que Telegram corta en 64 bytes. */
export type Boton = { texto: string; data: string } | { texto: string; url: string };
export type Teclado = Boton[][];

function marcado(teclado?: Teclado) {
  if (!teclado || teclado.length === 0) return undefined;
  return {
    inline_keyboard: teclado.map((fila) =>
      fila.map((b) => ("url" in b ? { text: b.texto, url: b.url } : { text: b.texto, callback_data: b.data })),
    ),
  };
}

async function llamar<T = unknown>(env: Env, metodo: string, cuerpo: unknown): Promise<T | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${TG}${token}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) {
      console.error(`[telegram] ${metodo} ${res.status}: ${json?.description ?? "(sin detalle)"}`);
      return null;
    }
    return (json.result ?? null) as T | null;
  } catch (e) {
    console.error(`[telegram] ${metodo} falló:`, e);
    return null;
  }
}

/** Manda un mensaje. Devuelve su message_id, o null si no salió. */
export async function enviar(
  env: Env,
  chatId: string | number,
  texto: string,
  teclado?: Teclado,
): Promise<number | null> {
  const r = await llamar<{ message_id: number }>(env, "sendMessage", {
    chat_id: chatId,
    text: texto.slice(0, 4000),
    reply_markup: marcado(teclado),
    disable_web_page_preview: true,
  });
  return r?.message_id ?? null;
}

/** Cambia el texto (y los botones) de un mensaje ya enviado. */
export async function editar(
  env: Env,
  chatId: string | number,
  messageId: number,
  texto: string,
  teclado?: Teclado,
): Promise<void> {
  await llamar(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: texto.slice(0, 4000),
    reply_markup: marcado(teclado) ?? { inline_keyboard: [] },
    disable_web_page_preview: true,
  });
}

/** Quita el "reloj" del botón tocado. Sin esto Telegram lo deja girando. */
export async function contestarBoton(env: Env, callbackId: string, aviso?: string): Promise<void> {
  await llamar(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(aviso ? { text: aviso.slice(0, 190) } : {}),
  });
}

let nombreCache: { token: string; nombre: string | null } | null = null;

/** El @usuario del bot, para armar el enlace t.me/<bot>?start=… del panel. */
export async function nombreDelBot(env: Env): Promise<string | null> {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return null;
  if (nombreCache?.token === token && nombreCache.nombre) return nombreCache.nombre;
  const r = await llamar<{ username?: string }>(env, "getMe", {});
  nombreCache = { token, nombre: r?.username ?? null };
  return nombreCache.nombre;
}

// ── El webhook, protegido ──────────────────────────────────────────────────
//
// /webhooks/telegram es una URL pública. Mientras solo recibía clientas, un
// update falso no podía hacer mucho. Con la consola del dueño sí: un update
// que dijera venir del chat del dueño podría mandarle mensajes a clientas o
// mover el stock. Telegram firma cada envío con la cabecera
// X-Telegram-Bot-Api-Secret-Token si el webhook se registró con `secret_token`.
//
// El secreto se DERIVA del token del bot: no hay otro secret que guardar ni
// que olvidar, y nadie que no tenga el token lo puede calcular. El panel lo
// registra al vincular el Telegram del dueño (asegurarWebhook).

export async function secretoDelWebhook(env: Env): Promise<string | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`telegram-webhook:${token}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

/** ¿El update trae la firma de Telegram? */
export async function webhookConfiable(env: Env, cabecera: string | undefined | null): Promise<boolean> {
  const esperado = await secretoDelWebhook(env);
  if (!esperado || !cabecera || cabecera.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ cabecera.charCodeAt(i);
  return dif === 0;
}

/**
 * Registra el webhook con el secreto (y con los botones habilitados). Respeta
 * la URL que ya tenga si apunta a /webhooks/telegram — puede ser un dominio
 * propio —; si no hay ninguna, usa DASHBOARD_BASE_URL.
 */
export async function asegurarWebhook(env: Env): Promise<{ ok: true } | { ok: false; error: string }> {
  const secreto = await secretoDelWebhook(env);
  if (!secreto) return { ok: false, error: "Falta el token del bot de Telegram (TELEGRAM_BOT_TOKEN)." };
  const info = await llamar<{ url?: string }>(env, "getWebhookInfo", {});
  const actual = info?.url ?? "";
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const url = actual.endsWith("/webhooks/telegram") ? actual : base ? `${base}/webhooks/telegram` : "";
  if (!url.startsWith("https://")) return { ok: false, error: "Falta DASHBOARD_BASE_URL para registrar el webhook." };
  const r = await llamar<boolean>(env, "setWebhook", {
    url,
    secret_token: secreto,
    allowed_updates: ["message", "callback_query"],
  });
  return r ? { ok: true } : { ok: false, error: "Telegram no aceptó el webhook (revise los logs)." };
}
