import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";

// Capturamos free-forms sin red
const freeformSends = vi.hoisted(() => [] as { userId: string; text: string }[]);
vi.mock("../src/replies/sender", () => ({
  pickAdapter: () => ({
    sendReply: async (r: { channelUserId: string; chunks: string[] }) => {
      freeformSends.push({ userId: r.channelUserId, text: r.chunks[0] });
    },
  }),
  sendChunkedReply: async () => {},
}));

import { segmentMembers, segmentCounts } from "../src/segments";
import { sendCampaign, templatesSentLast24h } from "../src/campaigns";

let env: any;
let db: Db;
const NOW = 1_700_000_000_000;
const H = 3600_000;

// Plantillas via fetch → stub global
const templateCalls: string[] = [];

async function seedConv(userId: string, lastMsgAt: number) {
  const conv = await new ConversationsRepo(db).getOrCreate("twilio", userId);
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', 'hola', ?)`,
    [crypto.randomUUID(), conv.id, lastMsgAt],
  );
  return conv;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = {
    DB: d1,
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_WA_FROM: "+15550001111",
  };
  db = new Db(d1 as any);
  freeformSends.length = 0;
  templateCalls.length = 0;
  vi.stubGlobal("fetch", async (url: any) => {
    templateCalls.push(String(url));
    return new Response("{}", { status: 201 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("segments", () => {
  it("quiero_sin_click y click_oferta parten bien la audiencia", async () => {
    const a = await seedConv("+521111", NOW - 2 * H); // QUIERO sin click, en ventana
    const b = await seedConv("+522222", NOW - 2 * H); // QUIERO + click
    await seedConv("+523333", NOW - 30 * H); // solo conversó, fuera de ventana
    await db.run(
      "INSERT INTO keyword_hits (keyword, conversation_id, phase, created_at) VALUES ('QUIERO', ?, 'live', ?), ('QUIERO', ?, 'live', ?)",
      [a.id, NOW, b.id, NOW],
    );
    await db.run(
      "INSERT INTO tracked_links (code, conversation_id, target, target_url, created_at, clicks) VALUES ('abc1234', ?, 'oferta', 'https://x.dev', ?, 3)",
      [b.id, NOW],
    );

    const sinClick = await segmentMembers(db, "quiero_sin_click", NOW);
    expect(sinClick.map((m) => m.channelUserId)).toEqual(["+521111"]);
    expect(sinClick[0].inWindow).toBe(true);

    const conClick = await segmentMembers(db, "click_oferta", NOW);
    expect(conClick.map((m) => m.channelUserId)).toEqual(["+522222"]);

    const todos = await segmentCounts(db, NOW);
    const t = todos.find((s) => s.id === "todos")!;
    expect(t.total).toBe(3);
    expect(t.inWindow).toBe(2);
    expect(t.outWindow).toBe(1);
  });

  it("segmentos por etiqueta (calientes / objeción precio)", async () => {
    const a = await seedConv("+524444", NOW - 1 * H);
    await db.run(
      "INSERT INTO conv_labels (conversation_id, variant, interest, objection, summary, labeled_at) VALUES (?, 'directo', 'caliente', 'precio', 'quiere entrar', ?)",
      [a.id, NOW],
    );
    expect((await segmentMembers(db, "calientes", NOW)).length).toBe(1);
    expect((await segmentMembers(db, "objecion_precio", NOW)).length).toBe(1);
    expect((await segmentMembers(db, "tibios", NOW)).length).toBe(0);
  });
});

describe("sendCampaign", () => {
  it("free-form a los de ventana, plantilla a los de fuera; reintento no duplica", async () => {
    await seedConv("+521111", NOW - 2 * H); // en ventana
    await seedConv("+523333", NOW - 30 * H); // fuera

    const r1 = await sendCampaign(env, {
      segmentId: "todos",
      campaignKey: "test-camp",
      freeformText: "hola en ventana",
      template: { sid: "HX123", body: "Hola {{1}}, ¿vienes hoy? Responde SÍ", variables: { "1": "crack" } },
      now: NOW,
    });
    expect(r1.sentFreeform).toBe(1);
    expect(r1.sentTemplate).toBe(1);
    expect(freeformSends[0]).toEqual({ userId: "+521111", text: "hola en ventana" });
    expect(templateCalls.some((u) => u.includes("api.twilio.com"))).toBe(true);
    expect(await templatesSentLast24h(db, NOW)).toBe(1);

    // El historial guarda el TEXTO de la plantilla (con variables) — el agente
    // necesita ese contexto cuando el cliente responda "SÍ".
    const persisted = await db.first<{ content: string }>(
      `SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.channel_user_id = '+523333' AND m.role = 'assistant'`,
    );
    expect(persisted?.content).toBe("Hola crack, ¿vienes hoy? Responde SÍ");

    // Reintento: mismo campaignKey → todos saltados
    const r2 = await sendCampaign(env, {
      segmentId: "todos",
      campaignKey: "test-camp",
      freeformText: "hola en ventana",
      template: { sid: "HX123" },
      now: NOW,
    });
    expect(r2.sentFreeform + r2.sentTemplate).toBe(0);
    expect(r2.skippedDuplicate).toBe(2);
  });

  it("respeta el tope diario de plantillas", async () => {
    await seedConv("+525555", NOW - 30 * H);
    await seedConv("+526666", NOW - 40 * H);
    const r = await sendCampaign(
      { ...env, WA_DAILY_TEMPLATE_CAP: "1" },
      { segmentId: "todos", campaignKey: "cap-test", template: { sid: "HX9" }, now: NOW },
    );
    expect(r.sentTemplate).toBe(1);
    expect(r.skippedQuota).toBe(1);
  });

  it("sin plantilla dada, los de fuera de ventana no reciben nada", async () => {
    await seedConv("+527777", NOW - 30 * H);
    const r = await sendCampaign(env, {
      segmentId: "todos",
      campaignKey: "solo-ff",
      freeformText: "hola",
      now: NOW,
    });
    expect(r.sentFreeform).toBe(0);
    expect(r.sentTemplate).toBe(0);
  });
});
