import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";

/** Messages older than this are purged by the daily cron. Leads + tickets are kept forever. */
export const MESSAGE_RETENTION_DAYS = 90;

/**
 * Daily cron: delete messages older than the retention window (90 days).
 * Conversations, leads and tickets are NOT touched. Returns the number of
 * deleted rows so the caller can log it.
 *
 * `now` is injectable for tests; defaults to the current time.
 */
export async function purgeOldMessages(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = now - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const msgs = new MessagesRepo(new Db(env.DB));
  const deleted = await msgs.purgeOlderThan(cutoff);
  console.log(`[cron purgeOldMessages] deleted ${deleted} messages older than ${MESSAGE_RETENTION_DAYS}d`);
  return deleted;
}
