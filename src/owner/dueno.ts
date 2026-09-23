// Quién es el dueño en Telegram, y cómo se vincula sin abrir una terminal.
//
// El aviso al dueño dependía del secret OWNER_TELEGRAM_CHAT_ID, y un secret
// solo se guarda con `wrangler secret put`: la dueña de Baby Caleb no usa la
// terminal, así que el panel mostraba "⚠ HANDOFF SIN AVISO" y cada ticket —una
// clienta que quiere pagar, un comprobante— se quedaba esperando a que alguien
// abriera el panel por casualidad.
//
// Ahora hay dos fuentes, y el secret sigue mandando si existe:
//   1. OWNER_TELEGRAM_CHAT_ID (secret), como siempre.
//   2. `owner_telegram_chat_id` en D1, que se llena solo cuando la dueña toca
//      el enlace del panel —t.me/<bot>?start=dueno_<código>— y el bot recibe
//      el código. Un código de seis dígitos, de un solo uso, que vence.

import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

/** Cuánto vale un código de vinculación. Lo justo para abrir Telegram. */
export const CODIGO_VENCE_MS = 15 * 60_000;

function repo(env: Env) {
  return new SettingsRepo(new Db(env.DB));
}

/** El chat de Telegram del dueño, o null si todavía no está vinculado. */
export async function chatDelDueno(env: Env): Promise<string | null> {
  const delSecret = (env.OWNER_TELEGRAM_CHAT_ID ?? "").trim();
  if (delSecret) return delSecret;
  try {
    const guardado = ((await repo(env).get(SETTING_KEYS.ownerTelegramChatId)) ?? "").trim();
    return guardado || null;
  } catch {
    return null;
  }
}

export async function esElDueno(env: Env, chatId: string | number | undefined): Promise<boolean> {
  if (chatId === undefined || chatId === null) return false;
  const dueno = await chatDelDueno(env);
  return !!dueno && dueno === String(chatId);
}

/** Genera un código nuevo (invalida el anterior) y lo guarda con su vencimiento. */
export async function crearCodigoDeVinculo(env: Env, ahora = Date.now()): Promise<{ codigo: string; venceEn: number }> {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const codigo = String(n).padStart(6, "0");
  const venceEn = ahora + CODIGO_VENCE_MS;
  await repo(env).set(SETTING_KEYS.ownerLinkCode, `${codigo}:${venceEn}`);
  return { codigo, venceEn };
}

/**
 * Si el código es el vigente, este chat queda como el del dueño. El código se
 * borra al usarse — de un solo uso — y también si ya venció.
 */
export async function canjearCodigo(
  env: Env,
  codigo: string,
  chatId: string | number,
  ahora = Date.now(),
): Promise<boolean> {
  const r = repo(env);
  const guardado = (await r.get(SETTING_KEYS.ownerLinkCode)) ?? "";
  const [vigente, vence] = guardado.split(":");
  if (!vigente || !vence) return false;
  if (ahora > Number(vence)) {
    await r.set(SETTING_KEYS.ownerLinkCode, "");
    return false;
  }
  if (codigo.trim() !== vigente) return false;
  await r.set(SETTING_KEYS.ownerTelegramChatId, String(chatId));
  await r.set(SETTING_KEYS.ownerLinkCode, "");
  return true;
}

/** Olvida el chat vinculado desde el panel (el secret, si existe, sigue). */
export async function desvincular(env: Env): Promise<void> {
  await repo(env).set(SETTING_KEYS.ownerTelegramChatId, "");
}

/**
 * "cliente": la dueña está probando el bot como si fuera una clienta, y sus
 * mensajes van al agente. Sin esto, vincularse como dueña le quitaba la forma
 * de probar su propio bot por Telegram.
 */
export async function enModoCliente(env: Env): Promise<boolean> {
  try {
    return (await repo(env).get(SETTING_KEYS.ownerTelegramMode)) === "cliente";
  } catch {
    return false;
  }
}

export async function ponerModoCliente(env: Env, activo: boolean): Promise<void> {
  await repo(env).set(SETTING_KEYS.ownerTelegramMode, activo ? "cliente" : "");
}
