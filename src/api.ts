// Control-plane API — read-only glue so a future hosted control plane can poll
// this self-hosted bot. Mounted at /api from index.ts. Every route is guarded
// (fail-closed Bearer via requireControlPlane); nothing here mutates state.
import { Hono } from "hono";
import type { Env } from "./env";
import { Db } from "./db/client";
import { requireControlPlane } from "./http-auth";
import { BOT_VERSION } from "./version";

export const apiApp = new Hono<{ Bindings: Env }>();

// Fail-closed Bearer guard on the whole sub-app (same pattern as /admin, /funnels).
apiApp.use("*", async (c, next) => {
  if (!requireControlPlane(c.req.raw, c.env)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

// GET /api/health → liveness + identity for the control plane.
apiApp.get("/health", (c) =>
  c.json({ ok: true, version: BOT_VERSION, tier: c.env.BOT_TIER }, 200),
);

export type MetricsRange = "7d" | "30d" | "all";

/** Window start (ms epoch) for a range. "all" = 0 (no lower bound). */
export function sinceForRange(range: MetricsRange, now: number): number {
  if (range === "all") return 0;
  const days = range === "30d" ? 30 : 7; // default / fallback = 7d
  return now - days * 24 * 60 * 60 * 1000;
}

/** Normalize the ?range query param to a supported value (default 7d). */
export function parseRange(raw: string | undefined): MetricsRange {
  return raw === "30d" || raw === "all" ? raw : "7d";
}

export interface MetricsResponse {
  range: MetricsRange;
  leads: number;
  messages: number;
  conversations: number;
  health_score: number;
}

/**
 * Aggregate the bot's activity over the requested window from the real D1
 * tables (schema.sql):
 *   leads          = COUNT(leads)          created_at >= since
 *   messages       = COUNT(messages)       created_at >= since
 *   conversations  = COUNT(conversations)  last_message_at >= since (active in window)
 *
 * health_score (0–100): the share of in-window conversations that did NOT get
 * escalated to a human — i.e. never opened a handoff ticket (the tickets table
 * is written only on handoffHuman). 100 = nobody had to be escalated; lower =
 * more conversations needed a human. escalated is clamped to [0, conversations]
 * so the ratio stays in range, and with zero conversations we report 100
 * (no traffic ≠ unhealthy).
 */
export async function computeMetrics(
  db: Db,
  range: MetricsRange,
  now = Date.now(),
): Promise<MetricsResponse> {
  const since = sinceForRange(range, now);

  const leads =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?", [since]))
      ?.n ?? 0;
  const messages =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?", [since]))
      ?.n ?? 0;
  const conversations =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversations WHERE last_message_at >= ?",
      [since],
    ))?.n ?? 0;

  // Distinct conversations that opened a handoff ticket in the window.
  const escalatedRaw =
    (await db.first<{ n: number }>(
      "SELECT COUNT(DISTINCT conversation_id) AS n FROM tickets WHERE conversation_id IS NOT NULL AND created_at >= ?",
      [since],
    ))?.n ?? 0;

  const escalated = Math.min(escalatedRaw, conversations);
  const healthScore =
    conversations === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(((conversations - escalated) / conversations) * 100)));

  return { range, leads, messages, conversations, health_score: healthScore };
}

// GET /api/metrics?range=7d|30d|all → aggregates for the control-plane dashboard.
apiApp.get("/metrics", async (c) => {
  const range = parseRange(c.req.query("range"));
  const metrics = await computeMetrics(new Db(c.env.DB), range);
  return c.json(metrics, 200);
});
