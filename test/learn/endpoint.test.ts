import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
import { startLearnMode, loadCapture } from "../../src/learn/mapping";
import { detectKind } from "../../src/learn/fieldPath";

// `src/index.ts` re-exports `SupportAgent` from `./agent`, which imports the
// `agents` SDK. `agents` (via `partyserver`) imports the virtual
// `cloudflare:workers` module at load time, which Node's ESM loader can't
// resolve outside workerd. Mock the `agents` package so the import graph stays
// in Node-land — we only exercise the Hono router here. The D1 binding comes
// from Miniflare and is injected into the `env` object the worker receives.
vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../../src/index";

// detectKind already lives in fieldPath.ts; the endpoint just delegates to it.
// Re-test the heuristic here so the endpoint contract (captured: <kind>) is
// pinned to the same classifier behavior.
describe("detectKind (heuristic reused by the learn endpoint)", () => {
  it("classifies audio by extension", () => {
    expect(
      detectKind({ attachments: [{ payload: { url: "https://x/a.mp3" } }] }),
    ).toBe("audio");
    expect(detectKind({ url: "https://x/voice.ogg?sig=abc" })).toBe("audio");
  });

  it("classifies image by extension", () => {
    expect(
      detectKind({ attachments: [{ payload: { url: "https://x/p.jpg" } }] }),
    ).toBe("image");
    expect(detectKind({ photo: "https://x/pic.png#frag" })).toBe("image");
  });

  it("classifies by attachment type marker", () => {
    expect(detectKind({ attachments: [{ type: "audio" }] })).toBe("audio");
    expect(detectKind({ attachments: [{ type: "image" }] })).toBe("image");
  });

  it("prefers audio when both audio and image are present", () => {
    expect(
      detectKind({
        attachments: [
          { type: "image", payload: { url: "https://x/thumb.jpg" } },
          { type: "audio", payload: { url: "https://x/voice.mp3" } },
        ],
      }),
    ).toBe("audio");
  });

  it("falls back to text", () => {
    expect(detectKind({ body: { id: "123" }, last_input_text: "hola" })).toBe(
      "text",
    );
  });

  it("tolerates null/undefined/arrays", () => {
    expect(detectKind(null)).toBe("text");
    expect(detectKind(undefined)).toBe("text");
    expect(detectKind([{ url: "https://x/a.mp3" }])).toBe("audio");
  });
});

describe("POST /webhooks/learn/:channel", () => {
  let env: any;
  let repo: SettingsRepo;

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    repo = new SettingsRepo(new Db(d1 as any));
    env = {
      BOT_NAME: "Testi",
      BUSINESS_NAME: "Test",
      BOT_LANGUAGE: "es",
      BOT_TIER: "pro",
      BUFFER_SECONDS: "15",
      DASHBOARD_BASE_URL: "https://test.workers.dev",
      DB: d1,
    };
  });

  function post(channel: string, payload: unknown) {
    return worker.fetch(
      new Request(`https://test/webhooks/learn/${channel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      env,
      {} as any,
    );
  }

  it("returns 409 with learn mode off and does NOT capture", async () => {
    const res = await post("instagram", {
      attachments: [{ payload: { url: "https://x/a.mp3" } }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "learn mode off" });
    // Nothing should have been persisted.
    expect(await loadCapture(repo, "instagram", "audio")).toBeNull();
  });

  it("captures and returns the detected kind when learn mode is on", async () => {
    await startLearnMode(repo, "instagram", 15);
    const payload = {
      body: { id: "999" },
      attachments: [{ payload: { url: "https://x/voice.mp3" } }],
    };
    const res = await post("instagram", payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      captured: "audio",
      channel: "instagram",
    });
    expect(await loadCapture(repo, "instagram", "audio")).toEqual(payload);
  });

  it("captures text payloads under the text kind", async () => {
    await startLearnMode(repo, "whatsapp", 15);
    const payload = { body: { id: "7" }, last_input_text: "hola" };
    const res = await post("whatsapp", payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      captured: "text",
      channel: "whatsapp",
    });
    expect(await loadCapture(repo, "whatsapp", "text")).toEqual(payload);
  });

  it("isolates learn mode per channel (on for one, off for another)", async () => {
    await startLearnMode(repo, "instagram", 15);
    // messenger never entered learn mode -> 409
    const res = await post("messenger", { body: { id: "1" } });
    expect(res.status).toBe(409);
    expect(await loadCapture(repo, "messenger", "text")).toBeNull();
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await worker.fetch(
      new Request("https://test/webhooks/learn/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      env,
      {} as any,
    );
    expect(res.status).toBe(400);
  });

  it("does not 404/500 the rest of the router (health still works)", async () => {
    const res = await worker.fetch(
      new Request("https://test/health"),
      env,
      {} as any,
    );
    expect(res.status).toBe(200);
  });
});
