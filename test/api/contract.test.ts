/**
 * Contract tests for the control-plane API (src/api.ts). Verifies the
 * fail-closed Bearer guard and the response shapes of /api/health and
 * /api/metrics. Real D1 via miniflare; the sub-app is exercised directly
 * (apiApp.request), the same way the admin tests hit adminApp.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp, type MetricsResponse } from "../../src/api";
import { Db } from "../../src/db/client";
import { BOT_VERSION } from "../../src/version";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();
const IN_WINDOW = NOW - 60 * 60 * 1000; // 1h ago → inside the 7d window

let d1: any;
let db: Db;

/** env WITH the control-plane token configured (auth can pass). */
function authedEnv(): Env {
  return {
    DB: d1,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
  } as unknown as Env;
}

/** env WITHOUT the token → every /api/* call must fail closed. */
function noTokenEnv(): Env {
  const e = authedEnv() as any;
  delete e.CONTROL_PLANE_TOKEN;
  return e as Env;
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
});

/** Seed: 2 conversations (one escalated via a ticket), 3 messages, 2 leads. */
async function seedActivity() {
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES ('cA','twilio','uA','A',?,?), ('cB','twilio','uB','B',?,?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ('m1','cA','user','hola',?), ('m2','cA','assistant','buenas',?), ('m3','cB','user','info',?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  await db.run(
    `INSERT INTO leads (id, conversation_id, intent, created_at, updated_at)
     VALUES ('l1','cA','compra',?,?), ('l2','cB','duda',?,?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  // conv A escalated to a human → one handoff ticket.
  await db.run(
    `INSERT INTO tickets (id, conversation_id, summary, transcript, created_at)
     VALUES ('t1','cA','handoff','...',?)`,
    [IN_WINDOW],
  );
}

describe("control-plane guard (fail-closed)", () => {
  for (const path of ["/health", "/metrics"]) {
    it(`${path}: 401 when CONTROL_PLANE_TOKEN is unset (even with a Bearer)`, async () => {
      const res = await apiApp.request(path, { headers: bearer(TOKEN) }, noTokenEnv());
      expect(res.status).toBe(401);
    });

    it(`${path}: 401 with token set but missing Bearer`, async () => {
      const res = await apiApp.request(path, {}, authedEnv());
      expect(res.status).toBe(401);
    });

    it(`${path}: 401 with token set but wrong Bearer`, async () => {
      const res = await apiApp.request(path, { headers: bearer("wrong-token") }, authedEnv());
      expect(res.status).toBe(401);
    });
  }
});

describe("GET /api/health", () => {
  it("200 + { ok, version, tier } with the right Bearer", async () => {
    const res = await apiApp.request("/health", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; tier: string };
    expect(body).toEqual({ ok: true, version: BOT_VERSION, tier: "pro" });
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });
});

describe("GET /api/metrics", () => {
  it("200 + correct shape and numeric aggregates with the right Bearer", async () => {
    await seedActivity();
    const res = await apiApp.request("/metrics?range=7d", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;

    expect(body.range).toBe("7d");
    expect(typeof body.leads).toBe("number");
    expect(typeof body.messages).toBe("number");
    expect(typeof body.conversations).toBe("number");
    expect(typeof body.health_score).toBe("number");

    // Seeded: 2 leads, 3 messages, 2 conversations, 1 of 2 escalated → score 50.
    expect(body.leads).toBe(2);
    expect(body.messages).toBe(3);
    expect(body.conversations).toBe(2);
    expect(body.health_score).toBe(50);
    expect(body.health_score).toBeGreaterThanOrEqual(0);
    expect(body.health_score).toBeLessThanOrEqual(100);
  });

  it("defaults to range=7d when the param is absent/invalid", async () => {
    const res = await apiApp.request("/metrics?range=bogus", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;
    expect(body.range).toBe("7d");
  });

  it("range=all counts everything and reports 100 with no traffic", async () => {
    const res = await apiApp.request("/metrics?range=all", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;
    expect(body.range).toBe("all");
    expect(body.conversations).toBe(0);
    expect(body.health_score).toBe(100); // no conversations ≠ unhealthy
  });
});
