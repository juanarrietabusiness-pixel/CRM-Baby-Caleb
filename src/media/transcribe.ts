import type { Env } from "../env";
import { bytesDeMedia } from "./almacen";

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
}

export async function transcribeAudio(
  audioUrl: string,
  env: Env,
): Promise<TranscriptionResult> {
  // Los audios del WhatsApp por QR viven en D1 (src/media/almacen.ts): se leen
  // directo, sin que el Worker se llame a sí mismo por HTTP.
  const media = await bytesDeMedia(env, audioUrl);
  if (!media) throw new Error("audio fetch failed");
  return transcribirBytes(media.bytes, env);
}

/** La misma transcripción, con los bytes ya en la mano (la consola del dueño). */
export async function transcribirBytes(buffer: Uint8Array, env: Env): Promise<TranscriptionResult> {
  // whisper-large-v3-turbo expects a base64-encoded string in `audio` (per the
  // Cloudflare Workers AI docs), NOT a raw byte array. nodejs_compat is enabled
  // (see wrangler.toml) so Buffer is available, matching the official example.
  const base64 = Buffer.from(buffer).toString("base64");
  const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo" as any, {
    audio: base64,
  } as any);
  return {
    text: (result as any).text ?? "",
  };
}
