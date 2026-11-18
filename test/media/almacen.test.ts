/**
 * Las notas de voz y las imágenes del WhatsApp por QR. El contenedor las manda
 * en base64 (Baileys no deja una URL para después); el CRM las guarda en D1 y
 * las ve como las de cualquier canal: una URL firmada.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { whatsappQrAdapter } from "../../src/channels/whatsappQr";
import { bytesDeMedia, guardarMedia, idDeUrlPropia, leerMedia, purgarMedia, servirMedia, urlDeMedia } from "../../src/media/almacen";
import { transcribeAudio } from "../../src/media/transcribe";

let env: any;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  env = {
    DB: await mf.getD1Database("DB"),
    WA_TOKEN: "token-de-prueba-1234567890abcdef",
    DASHBOARD_BASE_URL: "https://bot.ejemplo",
    AI: { run: vi.fn(async () => ({ text: "hola, ¿tienen talla M?" })) },
  };
});

afterEach(() => vi.restoreAllMocks());

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function entrante(cuerpo: unknown): Request {
  return new Request("https://crm/webhooks/whatsapp-qr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

describe("una nota de voz por el WhatsApp por QR", () => {
  it("llega como audioUrl y se transcribe leyendo D1, sin que el Worker se llame a sí mismo", async () => {
    const audio = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({
        de: "507@s.whatsapp.net",
        texto: null,
        tipo: "audioMessage",
        media: { clase: "audio", mime: "audio/ogg", base64: b64(audio) },
        recibidoEn: 1,
      }),
      env,
    );
    expect(msg.audioUrl).toMatch(/^https:\/\/bot\.ejemplo\/webhooks\/whatsapp-qr\/media\/[0-9a-f]+\?exp=\d+&sig=[0-9a-f]{64}$/);
    expect(msg.text).toBeUndefined();

    const t = await transcribeAudio(msg.audioUrl!, env);
    expect(t.text).toBe("hola, ¿tienen talla M?");
    expect(fetchSpy).not.toHaveBeenCalled();
    const enviado = (env.AI.run.mock.calls[0][1] as any).audio;
    expect(Uint8Array.from(atob(enviado), (c) => c.charCodeAt(0))).toEqual(audio);
  });
});

describe("una imagen por el WhatsApp por QR", () => {
  it("llega como imageUrl con su leyenda, y la URL firmada la sirve", async () => {
    const foto = new Uint8Array([255, 216, 255, 224, 9, 9]);
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({
        de: "507@s.whatsapp.net",
        texto: "este es mi comprobante",
        tipo: "imageMessage",
        media: { clase: "imagen", mime: "image/jpeg", base64: b64(foto) },
        recibidoEn: 1,
      }),
      env,
    );
    expect(msg.text).toBe("este es mi comprobante");
    const u = new URL(msg.imageUrl!);
    const res = await servirMedia(env, idDeUrlPropia(msg.imageUrl!)!, u.searchParams.get("exp")!, u.searchParams.get("sig")!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(foto);
  });

  it("una firma falsa o vencida no sirve nada", async () => {
    const id = await guardarMedia(env, new Uint8Array([1]), "image/jpeg");
    const u = new URL(await urlDeMedia(env, id));
    expect((await servirMedia(env, id, u.searchParams.get("exp")!, "0".repeat(64))).status).toBe(403);
    const vieja = new URL(await urlDeMedia(env, id, Date.now() - 7 * 60 * 60 * 1000));
    expect((await servirMedia(env, id, vieja.searchParams.get("exp")!, vieja.searchParams.get("sig")!)).status).toBe(403);
  });
});

describe("el almacén", () => {
  it("un archivo grande se guarda en partes y vuelve entero", { timeout: 90_000 }, async () => {
    const grande = new Uint8Array(2_100_000).map((_, i) => i % 251);
    const id = await guardarMedia(env, grande, "image/jpeg");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media_temporal WHERE id = ?").bind(id).first();
    expect(n.n).toBe(3);
    const de = await leerMedia(env, id);
    const igual = (a: Uint8Array) => Buffer.from(a).equals(Buffer.from(grande));
    expect(igual(de!.bytes)).toBe(true);
    expect(igual((await bytesDeMedia(env, await urlDeMedia(env, id)))!.bytes)).toBe(true);
  });

  it("la purga borra lo viejo", async () => {
    const id = await guardarMedia(env, new Uint8Array([1, 2]), "audio/ogg", Date.now() - 3 * 86_400_000);
    await purgarMedia(env, Date.now() - 2 * 86_400_000);
    expect(await leerMedia(env, id)).toBeNull();
  });
});
