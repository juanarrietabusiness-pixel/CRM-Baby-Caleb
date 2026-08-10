import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { pauseBotTool } from "../../src/tools/pauseBot";

let env: any;
let convs: ConversationsRepo;
let convId: string;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  convs = new ConversationsRepo(new Db(d1 as any));
  const conv = await convs.getOrCreate("telegram", "u1");
  convId = conv.id;
  env = { DB: d1 };
});

describe("pauseBotTool", () => {
  it("sets paused_until in the future by given minutes", async () => {
    const tool = pauseBotTool(env, () => convId);
    await tool.execute!({ minutes: 60 }, {} as any);
    const isPaused = await convs.isPaused(convId);
    expect(isPaused).toBe(true);
  });
});
