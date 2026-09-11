/**
 * Ningún canal se traga un archivo en silencio.
 *
 * Esto no es una prueba de texto fuente: ejerce los adaptadores de verdad.
 *
 * El fallo que cierra: WhatsApp tenía `if (!text && !audioUrl && !imageUrl)
 * continue;` y Telegram dejaba todo en `undefined`. Un PDF, un video o un
 * sticker se descartaban ENTEROS — no se guardaba el mensaje, no se abría
 * ticket, no se contestaba nada. Desde afuera parecía que el negocio dejó a la
 * clienta en visto, y el comprobante de una transferencia bancaria llega en PDF
 * muy seguido.
 */
import { describe, it, expect } from "vitest";
import { parseWhatsAppEvents } from "../../src/channels/whatsapp";
import { telegramAdapter } from "../../src/channels/telegram";

const env = { WHATSAPP_APP_SECRET: "s3cr3t", TELEGRAM_BOT_TOKEN: "t0ken" } as any;

function waBody(m: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "50760000000", ...m }] } }] }],
  };
}

function tgRequest(message: Record<string, unknown>) {
  return new Request("https://x/webhook", {
    method: "POST",
    body: JSON.stringify({
      update_id: 1,
      message: { message_id: 1, from: { id: 42, first_name: "Ana", is_bot: false }, chat: { id: 42, type: "private" }, date: 0, ...message },
    }),
  });
}

describe("WhatsApp", () => {
  it("un comprobante en PDF genera mensaje, no se descarta", async () => {
    const out = await parseWhatsAppEvents(waBody({ type: "document", document: { id: "d1", filename: "comprobante.pdf" } }) as any, env, "https://w.dev");
    expect(out).toHaveLength(1);
    expect(out[0].fileKind).toBe("documento");
  });

  it("un video genera mensaje", async () => {
    const out = await parseWhatsAppEvents(waBody({ type: "video", video: { id: "v1" } }) as any, env, "https://w.dev");
    expect(out[0].fileKind).toBe("video");
  });

  it("un sticker genera mensaje en vez de desaparecer", async () => {
    const out = await parseWhatsAppEvents(waBody({ type: "sticker", sticker: { id: "s1" } }) as any, env, "https://w.dev");
    expect(out).toHaveLength(1);
  });

  it("el pie que la clienta escribió sobre el documento se conserva", async () => {
    const out = await parseWhatsAppEvents(
      waBody({ type: "document", document: { id: "d1", caption: "ahí va el comprobante" } }) as any,
      env,
      "https://w.dev",
    );
    expect(out[0].text).toBe("ahí va el comprobante");
  });

  it("un texto normal sigue sin marcarse como archivo", async () => {
    const out = await parseWhatsAppEvents(waBody({ type: "text", text: { body: "hola" } }) as any, env, "https://w.dev");
    expect(out[0].fileKind).toBeUndefined();
    expect(out[0].text).toBe("hola");
  });
});

describe("Telegram", () => {
  it("un documento ya no muere con todo en undefined", async () => {
    const msg = await telegramAdapter.parseIncoming(tgRequest({ document: { file_id: "f1", file_name: "pago.pdf" } }), env);
    expect(msg.fileKind).toBe("documento");
  });

  it("un video se marca como video", async () => {
    const msg = await telegramAdapter.parseIncoming(tgRequest({ video: { file_id: "v1" } }), env);
    expect(msg.fileKind).toBe("video");
  });

  it("un texto normal no se marca", async () => {
    const msg = await telegramAdapter.parseIncoming(tgRequest({ text: "hola" }), env);
    expect(msg.fileKind).toBeUndefined();
    expect(msg.text).toBe("hola");
  });
});
