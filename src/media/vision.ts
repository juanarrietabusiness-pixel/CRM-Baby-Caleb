import type { ModelMessage } from "ai";
import type { Env } from "../env";
import { bytesDeMedia } from "./almacen";

export function buildMultimodalUserMessage(
  text: string | undefined,
  imageUrl: string | undefined,
): ModelMessage {
  if (!imageUrl) {
    return { role: "user", content: text ?? "" };
  }
  return {
    role: "user",
    content: [
      { type: "image", image: new URL(imageUrl) },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}

/** El tope del proveedor de IA por imagen (Anthropic: 5 MB). */
export const IMAGEN_MAXIMA = 5 * 1024 * 1024;

/**
 * La imagen que mandó el cliente, YA DESCARGADA por el CRM, lista para el
 * modelo. null si no se pudo leer, no es una imagen o pasa del tope.
 *
 * Hasta el 24-sep-2026 se le pasaba al modelo el ENLACE, y era el proveedor de
 * IA quien tenía que ir a buscarla desde afuera. Cuando esa descarga fallaba,
 * se caía la respuesta entera y el cliente recibía "Algo falló de mi lado" por
 * mandar una foto. Y el enlace de Telegram lleva el token del bot adentro: se
 * le estaba entregando al proveedor. Ahora el CRM la lee (de D1 si es del
 * WhatsApp por QR, de Telegram si es de allá) y manda los bytes.
 */
export async function imagenParaElModelo(
  env: Env,
  url: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const m = await bytesDeMedia(env, url);
    if (!m || m.bytes.length === 0 || m.bytes.length > IMAGEN_MAXIMA) return null;
    // Telegram entrega sus archivos como application/octet-stream: el tipo real
    // se lee de los primeros bytes.
    const mime = tipoDeImagen(m.bytes) ?? (m.mime.startsWith("image/") ? m.mime : null);
    return mime ? { bytes: m.bytes, mime } : null;
  } catch (e) {
    console.warn("[vision] no se pudo leer la imagen del cliente:", e);
    return null;
  }
}

/** JPEG, PNG, GIF o WebP por su firma. */
export function tipoDeImagen(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** El mensaje del cliente con su imagen en bytes. */
export function mensajeConImagen(text: string | undefined, img: { bytes: Uint8Array; mime: string }): ModelMessage {
  return {
    role: "user",
    content: [
      { type: "image", image: img.bytes, mediaType: img.mime },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}

/**
 * Lo que se le dice al modelo cuando la imagen no se pudo abrir. El cliente
 * mandó algo de verdad: se le atiende, no se le contesta "algo falló".
 */
export const NOTA_IMAGEN_ILEGIBLE =
  "[La clienta mandó una imagen, pero no se pudo abrir. No la describas ni supongas qué muestra. " +
  "Dile con amabilidad que la recibiste pero no se abrió bien, y pídele que la reenvíe o que te " +
  "cuente qué aparece en ella.]";
