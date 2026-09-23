// Audios e imágenes del WhatsApp por QR, guardados unas horas en D1.
//
// Los otros canales dejan el archivo en un sitio que se puede descargar
// después: Telegram con getFile, la Cloud API con su media_id (por el proxy
// firmado de whatsapp.ts). Baileys no: el archivo se descarga dentro del
// contenedor, en el momento, o se pierde. Hasta el 23-sep-2026 el contenedor
// solo mandaba el texto, y una nota de voz le llegaba al bot vacía.
//
// Ahora el contenedor manda los bytes, se guardan aquí y el resto del bot los
// ve como a los de cualquier canal: una URL. Firmada y con vencimiento —el
// proveedor de IA la descarga para ver la imagen—, pero quien vive en este
// Worker (la transcripción, el aviso al dueño) lee los bytes directo de D1 con
// `bytesDeMedia` y no se llama a sí mismo por HTTP.

import type { Env } from "../env";

/** Una fila de D1 tiene tope de tamaño: el archivo va en partes. */
const PARTE = 900_000;
/** Más que esto no es una nota de voz ni una foto de WhatsApp. */
export const MEDIA_MAXIMA = 12 * 1024 * 1024;
/** Lo que vive la URL firmada: el bot la usa en segundos, el dueño en minutos. */
const URL_VIVE_MS = 6 * 60 * 60 * 1000;
const RUTA = "/webhooks/whatsapp-qr/media/";

async function hmacHex(secreto: string, mensaje: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(mensaje));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function secreto(env: Env): string | null {
  return env.WA_TOKEN ? `media:${env.WA_TOKEN}` : null;
}

/** Guarda el archivo y devuelve su id. */
export async function guardarMedia(env: Env, bytes: Uint8Array, mime: string, ahora = Date.now()): Promise<string> {
  if (bytes.byteLength > MEDIA_MAXIMA) throw new Error(`archivo demasiado grande (${bytes.byteLength} bytes)`);
  const id = crypto.randomUUID().replace(/-/g, "");
  const partes = Math.max(1, Math.ceil(bytes.byteLength / PARTE));
  const stmt = env.DB.prepare(
    "INSERT INTO media_temporal (id, parte, mime, datos, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  await env.DB.batch(
    // .slice() copia: su .buffer es exactamente la parte (D1 guarda ArrayBuffer como BLOB).
    Array.from({ length: partes }, (_, i) => stmt.bind(id, i, mime, bytes.slice(i * PARTE, (i + 1) * PARTE).buffer, ahora)),
  );
  return id;
}

/** Los bytes de un archivo guardado, o null si ya no está. */
export async function leerMedia(env: Env, id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const r = await env.DB.prepare("SELECT mime, datos FROM media_temporal WHERE id = ? ORDER BY parte").bind(id).all<{
    mime: string;
    datos: ArrayBuffer | number[];
  }>();
  const filas = r.results ?? [];
  if (filas.length === 0) return null;
  const trozos = filas.map((f) => (f.datos instanceof ArrayBuffer ? new Uint8Array(f.datos) : Uint8Array.from(f.datos)));
  const total = trozos.reduce((n, t) => n + t.byteLength, 0);
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const t of trozos) {
    bytes.set(t, i);
    i += t.byteLength;
  }
  return { bytes, mime: filas[0].mime };
}

/** La URL pública y firmada del archivo (la que se guarda como audioUrl/imageUrl). */
export async function urlDeMedia(env: Env, id: string, ahora = Date.now()): Promise<string> {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "") || "https://bot.invalid";
  const s = secreto(env);
  const exp = ahora + URL_VIVE_MS;
  const sig = s ? await hmacHex(s, `${id}.${exp}`) : "";
  return `${base}${RUTA}${id}?exp=${exp}&sig=${sig}`;
}

/** El id si la URL es de este almacén, venga del dominio que venga. */
export function idDeUrlPropia(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.startsWith(RUTA) ? decodeURIComponent(u.pathname.slice(RUTA.length)) || null : null;
  } catch {
    return null;
  }
}

/**
 * Los bytes de un audio o una imagen, venga de donde venga. Los de este almacén
 * se leen de D1; los demás (Telegram, Cloud API) se descargan.
 */
export async function bytesDeMedia(env: Env, url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const id = idDeUrlPropia(url);
  if (id) return leerMedia(env, id);
  const res = await fetch(url);
  if (!res.ok) return null;
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream",
  };
}

/** GET /webhooks/whatsapp-qr/media/:id — lo descarga el proveedor de IA. */
export async function servirMedia(env: Env, id: string, exp: string | undefined, sig: string | undefined): Promise<Response> {
  const s = secreto(env);
  const vence = Number(exp);
  if (!s || !sig || !Number.isFinite(vence) || Date.now() > vence) return new Response("vencida", { status: 403 });
  const esperado = await hmacHex(s, `${id}.${vence}`);
  let dif = esperado.length ^ sig.length;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  if (dif !== 0) return new Response("firma inválida", { status: 403 });
  const m = await leerMedia(env, id);
  if (!m) return new Response("ya no está", { status: 404 });
  return new Response(m.bytes, { headers: { "content-type": m.mime, "cache-control": "private, max-age=600" } });
}

export async function purgarMedia(env: Env, antesDe: number): Promise<void> {
  await env.DB.prepare("DELETE FROM media_temporal WHERE created_at < ?").bind(antesDe).run();
}
