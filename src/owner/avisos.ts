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
import { chatDelDueno } from "./dueno";
import { enviar, type Teclado } from "./telegram";
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

  const messageId = await enviar(env, chatId, lineas.join("\n"), teclado);
  if (messageId === null) return false;
  await anotarAviso(env, chatId, messageId, convId, aviso.ticketId ?? null);
  return true;
}
