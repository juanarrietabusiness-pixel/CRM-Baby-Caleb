/**
 * Monthly AI budget guard.
 *
 * The owner can set `monthly_budget` (USD) from the Costos tab. When the
 * month-to-date AI spend reaches it, the agent downgrades to the "fast" tier
 * (cheap model) instead of going silent — the bot keeps answering, it just
 * stops burning money on the smart model.
 */
import { Db } from "./db/client";
import { costOfUsage, type ModelId } from "./pricing";
import type { Tier } from "./upgrade/modelSelector";

/** UTC start of the current month (injectable clock for tests). */
export function monthStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Exact month-to-date AI cost, computed from per-message token usage. */
export async function monthIaCostUsd(db: Db, now = Date.now()): Promise<number> {
  const rows = await db.all<{ model_used: string; input: number; output: number; cached: number }>(
    `SELECT model_used,
            SUM(COALESCE(input_tokens, 0)) as input,
            SUM(COALESCE(output_tokens, 0)) as output,
            SUM(COALESCE(cached_input_tokens, 0)) as cached
     FROM messages
     WHERE created_at >= ? AND model_used IS NOT NULL
     GROUP BY model_used`,
    [monthStartMs(now)],
  );
  let total = 0;
  for (const r of rows) {
    total += costOfUsage(r.model_used as ModelId, {
      input: r.input,
      output: r.output,
      cached: r.cached,
    });
  }
  return total;
}

/** Pure decision: downgrade to "fast" once spend reaches the budget. */
export function applyBudgetGuard(
  tier: Tier,
  monthCostUsd: number,
  budgetUsd: number | undefined,
): { tier: Tier; downgraded: boolean } {
  if (budgetUsd === undefined || budgetUsd <= 0) return { tier, downgraded: false };
  if (monthCostUsd >= budgetUsd && tier !== "fast") {
    return { tier: "fast", downgraded: true };
  }
  return { tier, downgraded: false };
}
