import { describe, it, expect } from "vitest";
import { buildMultimodalUserMessage } from "../../src/media/vision";

describe("buildMultimodalUserMessage", () => {
  it("returns a plain text user message when there is no image", () => {
    const msg = buildMultimodalUserMessage("hola, ¿agendan hoy?", undefined);
    expect(msg).toEqual({ role: "user", content: "hola, ¿agendan hoy?" });
  });

  it("returns an empty-string user message when there is neither text nor image", () => {
    const msg = buildMultimodalUserMessage(undefined, undefined);
    expect(msg).toEqual({ role: "user", content: "" });
  });

  it("builds a multimodal message with image + text caption", () => {
    const msg = buildMultimodalUserMessage(
      "¿qué es esto?",
      "https://x/photo.jpg",
    );
    expect(msg.role).toBe("user");
    const content = msg.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);

    const imagePart = content[0];
    expect(imagePart.type).toBe("image");
    expect(imagePart.image).toBeInstanceOf(URL);
    expect((imagePart.image as URL).href).toBe("https://x/photo.jpg");

    const textPart = content[1];
    expect(textPart).toEqual({ type: "text", text: "¿qué es esto?" });
  });

  it("builds an image-only message when there is no caption", () => {
    const msg = buildMultimodalUserMessage(undefined, "https://x/photo.jpg");
    const content = msg.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image");
    expect((content[0].image as URL).href).toBe("https://x/photo.jpg");
  });

  it("does not perform any network call (pure message builder)", () => {
    // buildMultimodalUserMessage only constructs a CoreMessage; no fetch/provider involved.
    const fetchSpy = (globalThis as { fetch?: unknown }).fetch;
    const msg = buildMultimodalUserMessage("hi", "https://x/photo.jpg");
    expect(msg.role).toBe("user");
    // fetch reference unchanged / untouched by the builder
    expect((globalThis as { fetch?: unknown }).fetch).toBe(fetchSpy);
  });
});

// 24-sep-2026: una foto por el WhatsApp por QR terminaba en "Algo falló de mi
// lado". La imagen se le pasaba al modelo como ENLACE; ahora va en bytes.
describe("imagenParaElModelo y mensajeConImagen", () => {
  it("reconoce la imagen por su firma aunque Telegram diga octet-stream", async () => {
    const { tipoDeImagen } = await import("../../src/media/vision");
    expect(tipoDeImagen(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(tipoDeImagen(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(tipoDeImagen(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // un PDF no es imagen
  });

  it("el mensaje lleva los BYTES, no un enlace que el proveedor tenga que ir a buscar", async () => {
    const { mensajeConImagen } = await import("../../src/media/vision");
    const m = mensajeConImagen("mi comprobante", { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg" });
    const partes = m.content as any[];
    expect(partes[0].image).toBeInstanceOf(Uint8Array);
    expect(partes[0].mediaType).toBe("image/jpeg");
    expect(partes[1]).toEqual({ type: "text", text: "mi comprobante" });
  });

  it("una imagen que no se puede leer devuelve null (y el bot atiende con la nota, no con 'algo falló')", async () => {
    const { imagenParaElModelo, NOTA_IMAGEN_ILEGIBLE } = await import("../../src/media/vision");
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("no", { status: 404 })) as any;
    try {
      expect(await imagenParaElModelo({} as any, "https://api.telegram.org/file/botX/foto.jpg")).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
    expect(NOTA_IMAGEN_ILEGIBLE).toMatch(/no se pudo abrir/);
  });

  it("el agente ya no le pasa el enlace de la imagen al modelo", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/agent.ts", "utf8");
    expect(src).not.toContain("buildMultimodalUserMessage(");
    expect(src).toContain("imagenParaElModelo(");
    expect(src).toContain("textoSinImagen");
  });
});
