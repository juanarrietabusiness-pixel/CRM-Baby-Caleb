import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { purgeOldMessages, MESSAGE_RETENTION_DAYS } from "../../src/crons/purgeOldMessages";

let env: any;
let db: Db;
let convId: string;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1 };
  db = new Db(d1 as any);
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "purge-test");
  convId = conv.id;
});

/** Insert a message with an explicit created_at so we can simulate age. */
async function insertAged(content: string, createdAt: number) {
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), convId, content, createdAt],
  );
}

describe("purgeOldMessages cron", () => {
  it("deletes messages older than the retention window but keeps recent ones", async () => {
    const now = 1_000 * DAY; // arbitrary fixed "now"
    await insertAged("old-1", now - (MESSAGE_RETENTION_DAYS + 5) * DAY);
    await insertAged("old-2", now - (MESSAGE_RETENTION_DAYS + 1) * DAY);
    await insertAged("recent", now - 3 * DAY);

    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(2);

    const remaining = await new MessagesRepo(db).lastN(convId, 50);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("recent");
  });

  it("deletes nothing when all messages are within the window", async () => {
    const now = 1_000 * DAY;
    await insertAged("a", now - 1 * DAY);
    await insertAged("b", now - 10 * DAY);
    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(0);
  });
});
