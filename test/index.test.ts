import { describe, it, expect, vi } from "vitest";

// `src/index.ts` re-exports `SupportAgent` from `./agent`, which imports the
// `agents` SDK. `agents` (via `partyserver`) imports the virtual
// `cloudflare:workers` module at load time, which Node's ESM loader can't
// resolve outside workerd. Mock the `agents` package so the import graph stays
// in Node-land — we only exercise the Hono router here. Tests that need real
// agent/runtime behavior use Miniflare instead.
vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../src/index";

describe("Worker entry", () => {
  const env = {
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "https://test.workers.dev",
  } as any;

  it("returns 200 on /health", async () => {
    const res = await worker.fetch(new Request("https://test/health"), env, {} as any);
    expect(res.status).toBe(200);
  });

  it("returns 404 on unknown route", async () => {
    const res = await worker.fetch(new Request("https://test/nope"), env, {} as any);
    expect(res.status).toBe(404);
  });
});
