import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telegramAdapter, resolveTelegramFileUrl } from "../../src/channels/telegram";
import type { Env } from "../../src/env";

function makeReq(body: unknown): Request {
  return new Request("https://bot.test/webhooks/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = { TELEGRAM_BOT_TOKEN: "test-token" } as Env;

// Telegram media (voice/photo) is NOT directly addressable by file_id — the
// adapter must call getFile to obtain a file_path, then build the download URL.
// So media tests mock fetch to stand in for that getFile call.
function mockGetFile(filePath: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }), {
      status: 200,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telegramAdapter.parseIncoming", () => {
  it("parses a text message (no fetch needed)", async () => {
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          text: "hola",
        },
      }),
      env,
    );
    expect(msg.channel).toBe("telegram");
    expect(msg.channelUserId).toBe("555");
    expect(msg.text).toBe("hola");
    expect(msg.displayName).toBe("Ana");
  });

  it("resolves voice notes to a real download URL via getFile", async () => {
    mockGetFile("voice/file_5.oga");
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          voice: { file_id: "voice-abc", duration: 5 },
        },
      }),
      env,
    );
    // The resolved URL is the downloadable HTTPS path, not the raw file_id.
    expect(msg.audioUrl).toBe(
      "https://api.telegram.org/file/bottest-token/voice/file_5.oga",
    );
  });

  it("resolves photos to a real download URL + uses caption as text", async () => {
    mockGetFile("photos/file_9.jpg");
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 3,
        message: {
          message_id: 12,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          photo: [
            { file_id: "photo-small", width: 90, height: 90 },
            { file_id: "photo-large", width: 800, height: 800 },
          ],
          caption: "mira esto",
        },
      }),
      env,
    );
    expect(msg.imageUrl).toBe(
      "https://api.telegram.org/file/bottest-token/photos/file_9.jpg",
    );
    expect(msg.text).toBe("mira esto");
  });

  it("el adaptador ya no marca al dueño: sus mensajes los atiende la consola antes de llegar aquí", async () => {
    // Antes se marcaba isOwnerMessage y eso solo pausaba la conversación del
    // dueño con su propio bot. Ahora /webhooks/telegram le entrega lo del dueño
    // a src/owner/consola.ts, y lo que llega al adaptador es siempre una clienta.
    const ownerEnv = { TELEGRAM_BOT_TOKEN: "t", OWNER_TELEGRAM_CHAT_ID: "999" } as Env;
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 4,
        message: {
          message_id: 13,
          from: { id: 999, first_name: "Dueño", is_bot: false },
          chat: { id: 999, type: "private" },
          date: 100,
          text: "yo me encargo",
        },
      }),
      ownerEnv,
    );
    expect(msg.isOwnerMessage).toBe(false);
  });
});

describe("POST /webhooks/telegram", () => {
  it("lo del dueño lo consume la consola y NO llega al agente; siempre contesta 200", async () => {
    vi.doMock("agents", () => ({ Agent: class {} }));
    const { createTestMiniflare } = await import("../helpers/miniflareSetup");
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    const ingest = vi.fn();
    const env: any = {
      DB: d1,
      TELEGRAM_BOT_TOKEN: "t",
      OWNER_TELEGRAM_CHAT_ID: "999",
      BUSINESS_NAME: "Negocio",
      AGENT: { idFromName: () => "id", get: () => ({ ingest }) },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }));
    const { default: worker } = await import("../../src/index");
    const llamar = (update: unknown) =>
      worker.fetch(
        new Request("https://bot/webhooks/telegram", { method: "POST", body: JSON.stringify(update) }),
        env,
        {} as any,
      );

    const delDueno = await llamar({
      update_id: 1,
      message: { message_id: 1, from: { id: 999 }, chat: { id: 999, type: "private" }, date: 1, text: "/pendientes" },
    });
    expect(delDueno.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();

    const deClienta = await llamar({
      update_id: 2,
      message: { message_id: 2, from: { id: 5, first_name: "Ana" }, chat: { id: 5, type: "private" }, date: 1, text: "hola" },
    });
    expect(deClienta.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);

    // /miid lo contesta el bot sin pasar por el agente (es el número que va
    // en el secret OWNER_TELEGRAM_CHAT_ID).
    const miid = await llamar({
      update_id: 4,
      message: { message_id: 4, from: { id: 55, first_name: "Luz" }, chat: { id: 55, type: "private" }, date: 1, text: "/miid" },
    });
    expect(miid.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);

    // Un update sin mensaje (edición, alta en un grupo) ya no devuelve 500.
    const raro = await llamar({ update_id: 3, edited_message: { text: "x" } });
    expect(raro.status).toBe(200);
  });
});

describe("resolveTelegramFileUrl", () => {
  it("returns null when getFile fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 400 }));
    const url = await resolveTelegramFileUrl("x", "tok");
    expect(url).toBeNull();
  });
});

// El mensaje se guarda en D1 ANTES de enviarse, así que aparece en el panel
// aunque Telegram lo rechace. Si el rechazo no se registra, el síntoma que ve
// el dueño es "el bot responde en el panel pero al cliente no le llega nada",
// sin ninguna pista de por qué. Estos dos tests fijan que quede registrado.
describe("telegramAdapter.sendReply — fallos de Telegram", () => {
  it("registra el motivo cuando Telegram rechaza el envío", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }),
        { status: 401 },
      ),
    );

    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "42", chunks: ["hola"] },
      env,
    );

    expect(err).toHaveBeenCalled();
    const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("telegram sendReply 401");
    expect(logged).toContain("Unauthorized"); // el motivo exacto, no solo el código
  });

  it("no registra nada cuando el envío sale bien", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );

    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "42", chunks: ["hola"] },
      env,
    );

    expect(err).not.toHaveBeenCalled();
  });
});
