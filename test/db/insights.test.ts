import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { InsightsRepo, type UpsertInsightInput } from "../../src/db/insights";

let db: Db;
let convs: ConversationsRepo;
let repo: InsightsRepo;

function makeInput(conversationId: string, overrides: Partial<UpsertInsightInput> = {}): UpsertInsightInput {
  return {
    conversationId,
    sentiment: "positive",
    resolution: "resolved",
    botScore: 4,
    topics: ["precios"],
    summary: "El cliente preguntó precios y agendó cita.",
    missedKb: null,
    saleOpportunity: false,
    ...overrides,
  };
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  db = new Db((await mf.getD1Database("DB")) as any);
  convs = new ConversationsRepo(db);
  repo = new InsightsRepo(db);
});

describe("InsightsRepo", () => {
  it("upsert inserts and getByConversation reads it back", async () => {
    const conv = await convs.getOrCreate("telegram", "u1");
    await repo.upsert(makeInput(conv.id, { missedKb: "¿Hacen envíos?" }));

    const row = await repo.getByConversation(conv.id);
    expect(row?.sentiment).toBe("positive");
    expect(row?.resolution).toBe("resolved");
    expect(row?.bot_score).toBe(4);
    expect(row?.missed_kb).toBe("¿Hacen envíos?");
    expect(JSON.parse(row!.topics!)).toEqual(["precios"]);
    expect(row?.sale_opportunity).toBe(0);
  });

  it("upsert overwrites the existing row for the same conversation", async () => {
    const conv = await convs.getOrCreate("telegram", "u2");
    await repo.upsert(makeInput(conv.id));
    await repo.upsert(makeInput(conv.id, { sentiment: "angry", botScore: 2, saleOpportunity: true }));

    const row = await repo.getByConversation(conv.id);
    expect(row?.sentiment).toBe("angry");
    expect(row?.bot_score).toBe(2);
    expect(row?.sale_opportunity).toBe(1);
  });

  it("stats aggregates the window: counts, resolved, avg score, negatives", async () => {
    const a = await convs.getOrCreate("telegram", "a");
    const b = await convs.getOrCreate("telegram", "b");
    const c = await convs.getOrCreate("telegram", "c");
    await repo.upsert(makeInput(a.id, { sentiment: "positive", resolution: "resolved", botScore: 5 }));
    await repo.upsert(makeInput(b.id, { sentiment: "angry", resolution: "escalated", botScore: 3 }));
    // Outside the window:
    await repo.upsert(makeInput(c.id, { analyzedAt: Date.now() - 30 * 86_400_000 }));

    const stats = await repo.stats(Date.now() - 7 * 86_400_000);
    expect(stats.analyzed).toBe(2);
    expect(stats.resolvedNoHuman).toBe(1);
    expect(stats.avgScore).toBe(4);
    expect(stats.negative).toBe(1);
  });

  it("missedKb groups identical questions and orders by count", async () => {
    const a = await convs.getOrCreate("telegram", "ka");
    const b = await convs.getOrCreate("telegram", "kb");
    const c = await convs.getOrCreate("telegram", "kc");
    await repo.upsert(makeInput(a.id, { missedKb: "¿Envíos a GDL?" }));
    await repo.upsert(makeInput(b.id, { missedKb: "¿Envíos a GDL?" }));
    await repo.upsert(makeInput(c.id, { missedKb: "¿Aceptan dólares?" }));

    const missed = await repo.missedKb(Date.now() - 86_400_000);
    expect(missed[0]).toEqual({ question: "¿Envíos a GDL?", n: 2 });
    expect(missed[1]).toEqual({ question: "¿Aceptan dólares?", n: 1 });
  });

  it("opportunities returns only sale_opportunity rows joined with the conversation", async () => {
    const a = await convs.getOrCreate("telegram", "oa", "Ana");
    const b = await convs.getOrCreate("telegram", "ob");
    await repo.upsert(makeInput(a.id, { saleOpportunity: true }));
    await repo.upsert(makeInput(b.id, { saleOpportunity: false }));

    const opps = await repo.opportunities(Date.now() - 86_400_000);
    expect(opps).toHaveLength(1);
    expect(opps[0].conversation_id).toBe(a.id);
    expect(opps[0].display_name).toBe("Ana");
  });
});
