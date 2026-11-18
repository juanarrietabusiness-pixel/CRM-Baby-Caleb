import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { metaAdapter } from "../../src/channels/meta";

// Los tres caminos de envío de Meta y qué va en el cuerpo de cada uno.
// `messaging_type` es de Messenger: la Send API de Instagram no lo acepta, ni
// por graph.instagram.com (IG Login) ni por graph.facebook.com (IG ligado a
// una Página, que usa el mismo host y token que Messenger).
describe("metaAdapter.sendReply", () => {
  const calls: { url: string; body: any }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Messenger: graph.facebook.com y messaging_type RESPONSE", async () => {
    await metaAdapter.sendReply(
      { channel: "messenger", channelUserId: "555", chunks: ["hola"] },
      { META_PAGE_ACCESS_TOKEN: "page-token" } as any,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("https://graph.facebook.com/");
    expect(calls[0].url).toContain("/me/messages");
    expect(calls[0].body).toMatchObject({ recipient: { id: "555" }, messaging_type: "RESPONSE" });
  });

  it("Instagram ligado a Página: graph.facebook.com SIN messaging_type", async () => {
    await metaAdapter.sendReply(
      { channel: "instagram", channelUserId: "777", chunks: ["hola"] },
      { META_PAGE_ACCESS_TOKEN: "page-token" } as any,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("https://graph.facebook.com/");
    expect(calls[0].body).toMatchObject({ recipient: { id: "777" }, message: { text: "hola" } });
    expect(calls[0].body).not.toHaveProperty("messaging_type");
  });

  it("Instagram Login: graph.instagram.com, envía como user_id y sin messaging_type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        // La primera llamada resuelve `me?fields=user_id` (dueño del hilo).
        if (String(url).includes("fields=user_id")) {
          return new Response(JSON.stringify({ user_id: "17841400000000000" }), { status: 200 });
        }
        return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
      }),
    );
    await metaAdapter.sendReply(
      { channel: "instagram", channelUserId: "888", chunks: ["hola"] },
      { INSTAGRAM_ACCESS_TOKEN: `IGAA-${Math.random()}` } as any,
    );
    const send = calls.find((c) => c.url.includes("/messages"))!;
    expect(send.url).toContain("https://graph.instagram.com/");
    expect(send.url).toContain("/17841400000000000/messages");
    expect(send.body).not.toHaveProperty("messaging_type");
  });
});
