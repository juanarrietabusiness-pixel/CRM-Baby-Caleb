// Las DOS rutas de Instagram, conviviendo sin pisarse.
//
// La misma cuenta puede estar suscrita a la vez por:
//   • la Página de Facebook  → firma con META_APP_SECRET, se responde por
//     graph.facebook.com con el Page Access Token;
//   • Instagram Login        → firma con el App Secret de Instagram, se
//     responde por graph.instagram.com con el token IG…
//
// Eso trae dos problemas que este módulo resuelve:
//
// 1. EL MISMO DM DOS VECES. Si las dos rutas lo entregan, el bot contestaría
//    dos veces: dos llamadas al modelo, dos mensajes a la clienta. Se
//    deduplica por el `mid` que Meta le pone a cada mensaje.
//
// 2. RESPONDER POR LA RUTA EQUIVOCADA. El id de quien escribe NO tiene por qué
//    ser el mismo en las dos rutas: cada una vive en su propio espacio de ids.
//    Contestar por Instagram a un id que vino de la Página puede terminar en
//    "destinatario desconocido". Por eso se recuerda, por persona, cuál fue la
//    ruta que trajo su último mensaje, y por ahí se le responde.
//
// Cuál fue la ruta no se adivina del payload: se sabe con certeza por cuál de
// los dos App Secrets validó la firma.
import { Db } from "../db/client";
import type { Env } from "../env";

export type RutaMeta = "page" | "ig";

/**
 * ¿Ya procesamos este mensaje? Marca el `mid` como visto y dice si YA estaba.
 *
 * Falla hacia "no visto" a propósito: ante un error de D1 preferimos arriesgar
 * una respuesta repetida antes que tragarnos el mensaje de una clienta.
 */
export async function yaProcesado(env: Env, mid: string | undefined): Promise<boolean> {
  if (!env.DB || !mid) return false;
  try {
    const db = new Db(env.DB);
    const prev = await db.first<{ mid: string }>("SELECT mid FROM meta_seen WHERE mid = ?", [mid]);
    if (prev) return true;
    // La ventana de carrera (dos entregas simultáneas del mismo mid) es
    // minúscula: las dos rutas entregan con segundos de diferencia.
    await db.run("INSERT OR IGNORE INTO meta_seen (mid, at) VALUES (?, ?)", [mid, Date.now()]);
    return false;
  } catch {
    return false;
  }
}

/** Anota por qué ruta llegó el último mensaje de esta persona. */
export async function recordarRuta(env: Env, channelUserId: string, ruta: RutaMeta): Promise<void> {
  if (!env.DB || !channelUserId) return;
  try {
    await new Db(env.DB).run(
      `INSERT INTO meta_ruta (channel_user_id, ruta, at) VALUES (?, ?, ?)
       ON CONFLICT(channel_user_id) DO UPDATE SET ruta = excluded.ruta, at = excluded.at`,
      [channelUserId, ruta, Date.now()],
    );
  } catch {
    // El registro es best-effort: sin él se cae al comportamiento de siempre.
  }
}

/** Por qué ruta hay que contestarle. `null` = nunca se anotó. */
export async function rutaDe(env: Env, channelUserId: string): Promise<RutaMeta | null> {
  if (!env.DB || !channelUserId) return null;
  try {
    const row = await new Db(env.DB).first<{ ruta: string }>(
      "SELECT ruta FROM meta_ruta WHERE channel_user_id = ?",
      [channelUserId],
    );
    return row?.ruta === "ig" || row?.ruta === "page" ? row.ruta : null;
  } catch {
    return null;
  }
}

/** Días que se guarda un `mid` antes de que el cron lo borre. */
export const DIAS_DEDUP = 7;

/** Limpieza diaria: los mid viejos ya no pueden repetirse. */
export async function purgarVistos(env: Env, now: number = Date.now()): Promise<number> {
  if (!env.DB) return 0;
  try {
    const res = await new Db(env.DB).run("DELETE FROM meta_seen WHERE at < ?", [
      now - DIAS_DEDUP * 24 * 60 * 60 * 1000,
    ]);
    return (res as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  } catch {
    return 0;
  }
}
