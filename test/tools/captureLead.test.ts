import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import { captureLeadTool } from "../../src/tools/captureLead";

let env: any;
let leads: LeadsRepo;
let convId: string;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  const db = new Db(d1 as any);
  leads = new LeadsRepo(db);
  // The leads table FKs conversation_id -> conversations(id), so we need a real
  // conversation row before the tool can attach a lead to it (same pattern as
  // the green handoffHuman/pauseBot tool tests).
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "u1");
  convId = conv.id;
  env = { DB: d1, BOT_TIER: "pro" };
});

describe("captureLeadTool", () => {
  it("creates lead in D1 even without external service", async () => {
    const tool = captureLeadTool(env, () => convId);
    // AI SDK v6: tool.execute is optional + expects (input, options). Invoke with
    // 2 args and cast the result (same pattern as the repo's green tool tests).
    const result = (await tool.execute!(
      {
        name: "María",
        contact: "+5215512345",
        intent: "Corte + barba 5pm",
      },
      {} as any,
    )) as { leadId: string; message: string };
    expect(result.leadId).toBeTruthy();
    const list = await leads.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].intent).toBe("Corte + barba 5pm");
  });
});
