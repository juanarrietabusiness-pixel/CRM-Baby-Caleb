import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
import { saveLearnedMapping, type LearnedMapping } from "../../src/learn/mapping";
import { makeLearnedAdapter } from "../../src/channels/learned";
import type { Env } from "../../src/env";

let d1: any;
let repo: SettingsRepo;
let env: Env;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = await mf.getD1Database("DB");
  repo = new SettingsRepo(new Db(d1));
  env = { DB: d1, MANYCHAT_API_KEY: "key" } as unknown as Env;
});

afterEach(() => vi.restoreAllMocks());

function req(body: unknown): Request {
  return new Request("https://x", { method: "POST", body: JSON.stringify(body) });
}

describe("makeLearnedAdapter.parseIncoming — with a learned mapping", () => {
  it("extracts id/text/audio/image/channel by custom paths", async () => {
    const mapping: LearnedMapping = {
      idPath: "data.user.uid",
      textPath: "data.message.body",
      audioPath: "media.voice.link",
      channelPath: "meta.source",
    };
    await saveLearnedMapping(repo, "n8n", mapping);

    const adapter = makeLearnedAdapter("n8n");
    const payload = {
      data: {
        user: { uid: 7788 }, // number id -> stringified
        message: { body: "hola desde n8n" },
      },
      media: { voice: { link: "https://cdn/voice.ogg" } },
      meta: { source: "whatsapp" },
    };
    const msg = await adapter.parseIncoming(req(payload), env);

    expect(msg.channel).toBe("manychat");
    expect(msg.channelUserId).toBe("7788");
    expect(msg.text).toBe("hola desde n8n");
    expect(msg.audioUrl).toBe("https://cdn/voice.ogg");
    expect(msg.imageUrl).toBeUndefined();
    expect(msg.rawPayload).toEqual(payload);
  });

  it("extracts an image by its custom path", async () => {
    await saveLearnedMapping(repo, "make", {
      idPath: "id",
      imagePath: "attachments.0.url",
    });
    const adapter = makeLearnedAdapter("make");
    const msg = await adapter.parseIncoming(
      req({ id: "u1", attachments: [{ url: "https://cdn/p.png" }] }),
      env,
    );
    expect(msg.channelUserId).toBe("u1");
    expect(msg.imageUrl).toBe("https://cdn/p.png");
    expect(msg.text).toBeUndefined();
  });

  it("drops the [audio] placeholder text via the learned textPath", async () => {
    await saveLearnedMapping(repo, "custom", {
      idPath: "id",
      textPath: "txt",
    });
    const adapter = makeLearnedAdapter("custom");
    const msg = await adapter.parseIncoming(req({ id: "u9", txt: "[audio]" }), env);
    expect(msg.text).toBeUndefined();
  });
});

describe("makeLearnedAdapter.parseIncoming — fallback ManyChat contract", () => {
  it("reads id, last_input_text, and last_growth_tool.channel when no mapping", async () => {
    const adapter = makeLearnedAdapter("instagram");
    const msg = await adapter.parseIncoming(
      req({
        id: "abc123",
        first_name: "María",
        last_name: "G",
        last_input_text: "hola",
        last_growth_tool: { channel: "instagram" },
      }),
      env,
    );
    expect(msg.channel).toBe("manychat");
    expect(msg.channelUserId).toBe("abc123");
    expect(msg.displayName).toBe("María G");
    expect(msg.text).toBe("hola");
  });

  it("falls back to subscriber_id when id is absent", async () => {
    const adapter = makeLearnedAdapter("instagram");
    const msg = await adapter.parseIncoming(
      req({ subscriber_id: "legacy999", last_input_text: "hey" }),
      env,
    );
    expect(msg.channelUserId).toBe("legacy999");
  });

  it("parses ManyChat audio attachment + drops [audio] placeholder", async () => {
    const adapter = makeLearnedAdapter("instagram");
    const msg = await adapter.parseIncoming(
      req({
        id: "abc123",
        last_input_text: "[audio]",
        attachments: [{ type: "audio", payload: { url: "https://cdn/a.mp3" } }],
      }),
      env,
    );
    expect(msg.audioUrl).toBe("https://cdn/a.mp3");
    expect(msg.text).toBeUndefined();
  });

  it("parses ManyChat image attachment", async () => {
    const adapter = makeLearnedAdapter("instagram");
    const msg = await adapter.parseIncoming(
      req({
        id: "abc123",
        last_input_text: "ese corte",
        attachments: [{ type: "image", payload: { url: "https://cdn/i.jpg" } }],
      }),
      env,
    );
    expect(msg.imageUrl).toBe("https://cdn/i.jpg");
    expect(msg.text).toBe("ese corte");
  });
});

describe("makeLearnedAdapter.sendReply — content.type (auto-channel)", () => {
  it("sends via sendContent with subscriber_id + chunk text", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const adapter = makeLearnedAdapter("instagram");
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "abc123", chunks: ["hola"] },
      env,
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.manychat.com/fb/sending/sendContent");
    const body = JSON.parse(String(init.body));
    expect(body.subscriber_id).toBe("abc123");
    expect(body.data.version).toBe("v2");
    expect(body.data.content.messages[0].text).toBe("hola");
  });

  it("echoes the auto-channel detected at parse time (last_growth_tool.channel)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const adapter = makeLearnedAdapter("instagram");
    // Inbound on whatsapp -> the reply should go back as content.type "whatsapp".
    await adapter.parseIncoming(
      req({
        id: "abc123",
        last_input_text: "hola",
        last_growth_tool: { channel: "whatsapp" },
      }),
      env,
    );
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "abc123", chunks: ["hi"] },
      env,
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.data.content.type).toBe("whatsapp");
  });

  it("echoes the auto-channel via a learned channelPath", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await saveLearnedMapping(repo, "n8n", {
      idPath: "uid",
      channelPath: "src",
    });
    const adapter = makeLearnedAdapter("n8n");
    await adapter.parseIncoming(req({ uid: "u1", src: "messenger" }), env);
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "u1", chunks: ["yo"] },
      env,
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.data.content.type).toBe("messenger");
  });

  it("uses learned mapping.sendType when no channel is detected in the payload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await saveLearnedMapping(repo, "custom", {
      idPath: "id",
      sendType: "telegram",
    });
    const adapter = makeLearnedAdapter("custom");
    await adapter.parseIncoming(req({ id: "u3" }), env);
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "u3", chunks: ["hi"] },
      env,
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.data.content.type).toBe("telegram");
  });

  it("falls back to env.MANYCHAT_CONTENT_TYPE when nothing else resolves", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const envWa = { DB: d1, MANYCHAT_API_KEY: "key", MANYCHAT_CONTENT_TYPE: "whatsapp" } as unknown as Env;
    const adapter = makeLearnedAdapter("zapier");
    // No channel in payload, no mapping, env override present.
    await adapter.parseIncoming(req({ id: "u4", last_input_text: "x" }), envWa);
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "u4", chunks: ["hi"] },
      envWa,
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.data.content.type).toBe("whatsapp");
  });

  it("falls back to the channel name when no detection, mapping, or env", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const adapter = makeLearnedAdapter("messenger");
    await adapter.parseIncoming(req({ id: "u5", last_input_text: "x" }), env);
    await adapter.sendReply(
      { channel: "manychat", channelUserId: "u5", chunks: ["hi"] },
      env,
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.data.content.type).toBe("messenger");
  });

  it("sends multiple chunks (no real delay via fake timers not needed for chunk 0)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const adapter = makeLearnedAdapter("instagram");
    await adapter.sendReply(
      {
        channel: "manychat",
        channelUserId: "abc",
        chunks: ["one", "two"],
        interChunkDelayMs: 0, // avoid real setTimeout wait in tests
      },
      env,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const b0 = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    const b1 = JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body));
    expect(b0.data.content.messages[0].text).toBe("one");
    expect(b1.data.content.messages[0].text).toBe("two");
  });

  it("throws when MANYCHAT_API_KEY is not set", async () => {
    const adapter = makeLearnedAdapter("instagram");
    await expect(
      adapter.sendReply(
        { channel: "manychat", channelUserId: "abc", chunks: ["hi"] },
        { DB: d1 } as unknown as Env,
      ),
    ).rejects.toThrow("MANYCHAT_API_KEY not set");
  });
});
