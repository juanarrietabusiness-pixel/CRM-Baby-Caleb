import type { Env } from "../env";

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
}

export async function transcribeAudio(
  audioUrl: string,
  env: Env,
): Promise<TranscriptionResult> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
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
