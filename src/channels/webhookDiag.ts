// Diagnóstico de webhooks: la caja negra de "me llegan los de Messenger pero no
// los de Instagram".
//
// El webhook /webhooks/meta puede descartar un evento por tres motivos y los
// tres eran INVISIBLES desde el panel: firma rechazada (403 sin rastro),
// kill-switch de IG (devuelve 200, así que Meta cree que todo va bien) y
// payloads sin mensaje procesable. Aquí se anota, por fuente, el último evento
// y por qué terminó como terminó, para que /admin/conexiones lo muestre.
//
// Se guarda en la tabla `settings` (clave `webhook_diag`) para no migrar el
// esquema. Nunca guarda texto del cliente ni ids completos — solo la fuente,
// el resultado y un detalle corto.
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import type { Env } from "../env";

export const WEBHOOK_DIAG_KEY = "webhook_diag";

/** Resultado de un evento entrante, en el orden en que puede morir. */
export type WebhookOutcome =
  | "ok" // se encoló al agente
  | "firma_rechazada" // x-hub-signature-256 no cuadró con ningún App Secret
  | "ignorado" // llegó bien pero una bandera lo descartó (IG_OFFICIAL / IG_DM_SOURCE)
  | "sin_mensaje"; // evento válido sin texto/audio/imagen (recibos, echoes, reacciones)

export interface WebhookDiagEntry {
  /** Epoch ms del último evento de esta fuente. */
  at: number;
  outcome: WebhookOutcome;
  /** Por qué, en español y sin datos personales. */
  detail?: string;
  /** Cuántos eventos de esta fuente se han visto (desde que existe el registro). */
  count: number;
}

export type WebhookDiag = Record<string, WebhookDiagEntry>;

function parse(raw: string | null): WebhookDiag {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as WebhookDiag) : {};
  } catch {
    return {};
  }
}

/** Lee el registro. Nunca lanza: sin DB o con JSON roto devuelve {}. */
export async function readWebhookDiag(env: Env): Promise<WebhookDiag> {
  if (!env.DB) return {};
  try {
    return parse(await new SettingsRepo(new Db(env.DB)).get(WEBHOOK_DIAG_KEY));
  } catch {
    return {};
  }
}

/**
 * Anota el último evento de una fuente (`meta:instagram`, `meta:page`, …).
 * Nunca lanza y nunca debe bloquear la respuesta 200 al proveedor: llámala
 * dentro de `ctx.waitUntil` cuando haya contexto.
 */
export async function recordWebhookEvent(
  env: Env,
  source: string,
  outcome: WebhookOutcome,
  detail?: string,
): Promise<void> {
  if (!env.DB) return;
  try {
    const repo = new SettingsRepo(new Db(env.DB));
    const diag = parse(await repo.get(WEBHOOK_DIAG_KEY));
    const prev = diag[source];
    diag[source] = {
      at: Date.now(),
      outcome,
      detail,
      count: (prev?.count ?? 0) + 1,
    };
    await repo.set(WEBHOOK_DIAG_KEY, JSON.stringify(diag));
  } catch {
    // El diagnóstico es best-effort: si D1 falla, el mensaje del cliente manda.
  }
}
