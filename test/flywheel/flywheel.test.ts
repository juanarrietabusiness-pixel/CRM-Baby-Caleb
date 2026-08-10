/**
 * Tests for the F5 flywheel: detectors (KB gaps, takeover lessons), the apply
 * pipeline (kb_entry → kb_docs+Vectorize, leccion → learned_lessons setting),
 * dedupe by fingerprint, and the Mejoras routes. LLM + Vectorize stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({
    provider: "anthropic",
    modelId: "claude-haiku-test",
    model: {},
    supportsPromptCache: true,
  }),
}));

vi.mock("../../src/businessContext", () => ({
  renderBusinessContext: () => "CONTEXTO DE NEGOCIO DE PRUEBA",
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { InsightsRepo } from "../../src/db/insights";
import { SuggestionsRepo } from "../../src/db/suggestions";
import { KbDocsRepo } from "../../src/kb/docs";
import { detectKbGaps, detectLessons, getLessons } from "../../src/flywheel/detect";
import { applySuggestion, dismissSuggestion } from "../../src/flywheel/apply";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = {
  Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`,
};

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let insights: InsightsRepo;
let suggestions: SuggestionsRepo;

async function seedKbGap(userId: string, question: string) {
  const conv = await convs.getOrCreate("twilio", userId);
  await insights.upsert({
    conversationId: conv.id,
    sentiment: "neutral",
    resolution: "unresolved",
    botScore: 3,
    topics: [],
    summary: "x",
    missedKb: question,
    saleOpportunity: false,
  });
}

async function seedTakeover(userId: string): Promise<string> {
  const conv = await convs.getOrCreate("twilio", userId, "Cliente X");
  await msgs.append(conv.id, "user", "Ya pagué y no tengo acceso");
  await msgs.append(conv.id, "assistant", "Tu acceso llega en unos minutos.");
  await msgs.append(conv.id, "owner", "Ya revisé tu pago y te activé el acceso manualmente.");
  return conv.id;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    KB: { upsert: vi.fn(async () => ({})), deleteByIds: vi.fn(async () => ({})) },
    AI: {
      run: vi.fn(async (_m: string, input: { text: string[] }) => ({
        data: input.text.map(() => [0.1, 0.2]),
      })),
    },
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  insights = new InsightsRepo(db);
  suggestions = new SuggestionsRepo(db);
  generateTextMock.mockReset();
});

describe("detectKbGaps", () => {
  it("drafts a kb_entry suggestion from a missed question and dedupes on re-run", async () => {
    await seedKbGap("u1", "¿Hacen envíos a Guadalajara?");
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ title: "Envíos a Guadalajara", content: "Sí, hacemos envíos. [COMPLETA AQUÍ] el costo." }),
    });

    const r1 = await detectKbGaps(env);
    expect(r1.created).toBe(1);

    const [s] = await suggestions.listProposed();
    expect(s.kind).toBe("kb_entry");
    expect(s.title).toBe("Envíos a Guadalajara");
    expect(s.evidence).toContain("no supo responder");
    expect(JSON.parse(s.payload).content).toContain("envíos");

    // Same gap never re-proposed (even if later dismissed).
    const r2 = await detectKbGaps(env);
    expect(r2.created).toBe(0);
  });

  it("counts an unparseable draft as an error", async () => {
    await seedKbGap("u2", "¿Aceptan dólares?");
    generateTextMock.mockResolvedValue({ text: "no json" });
    const r = await detectKbGaps(env);
    expect(r.created).toBe(0);
    expect(r.errors).toBe(1);
  });
});

describe("detectLessons", () => {
  it("distills a lesson from an owner takeover and dedupes per conversation", async () => {
    await seedTakeover("u3");
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ lesson: "Confirma el pago antes de prometer tiempos de activación." }),
    });

    const r1 = await detectLessons(env);
    expect(r1.created).toBe(1);
    const [s] = await suggestions.listProposed();
    expect(s.kind).toBe("leccion");
    expect(s.title).toContain("Confirma el pago");

    // The grader saw both sides of the conversation.
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain("Dueño: Ya revisé tu pago");
    expect(prompt).toContain("Bot: Tu acceso llega");

    const r2 = await detectLessons(env);
    expect(r2.created).toBe(0);
  });

  it("skips conversations without a clear lesson (null)", async () => {
    await seedTakeover("u4");
    generateTextMock.mockResolvedValue({ text: JSON.stringify({ lesson: null }) });
    const r = await detectLessons(env);
    expect(r.created).toBe(0);
    expect(r.errors).toBe(0);
  });
});

describe("apply / dismiss", () => {
  it("applying a kb_entry creates the doc and indexes it", async () => {
    const id = (await suggestions.createIfNew({
      kind: "kb_entry",
      fingerprint: "q1",
      title: "Envíos",
      payload: { question: "q1", title: "Envíos", content: "Sí hacemos envíos a todo México." },
      evidence: "2 clientes",
    }))!;

    expect(await applySuggestion(env, id)).toBe(true);

    const docs = await new KbDocsRepo(db).list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Envíos");
    expect((env.KB as any).upsert).toHaveBeenCalledTimes(1);
    expect((await suggestions.getById(id))?.status).toBe("applied");

    // Re-applying an already-applied suggestion is a no-op.
    expect(await applySuggestion(env, id)).toBe(false);
  });

  it("applying a leccion adds it to learned_lessons (no duplicates)", async () => {
    const id = (await suggestions.createIfNew({
      kind: "leccion",
      fingerprint: "conv-1",
      title: "Confirma el pago primero.",
      payload: { lesson: "Confirma el pago primero.", conversationId: "conv-1" },
      evidence: "takeover",
    }))!;

    expect(await applySuggestion(env, id)).toBe(true);
    expect(await getLessons(env)).toEqual(["Confirma el pago primero."]);
  });

  it("dismiss marks the suggestion and it never returns", async () => {
    const id = (await suggestions.createIfNew({
      kind: "kb_entry",
      fingerprint: "q2",
      title: "T",
      payload: { content: "C" },
      evidence: "e",
    }))!;
    expect(await dismissSuggestion(env, id)).toBe(true);
    expect((await suggestions.getById(id))?.status).toBe("dismissed");
    expect(await suggestions.exists("kb_entry", "q2")).toBe(true); // dedupe still holds
  });
});

describe("Mejoras routes", () => {
  it("renders the tab with proposed suggestions", async () => {
    await suggestions.createIfNew({
      kind: "leccion",
      fingerprint: "c9",
      title: "Nunca prometas tiempos exactos.",
      payload: { lesson: "Nunca prometas tiempos exactos." },
      evidence: "De tu intervención",
    });
    const res = await adminApp.request("/mejoras", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Igual que en KB: el título es del shell, la vista ya no lo duplica.
    expect(html).toContain(">Mejoras</h1>");
    expect(html).toContain("Nunca prometas tiempos exactos.");
    expect(html).toContain("Aplicar");
  });

  it("apply route applies and redirects", async () => {
    const id = (await suggestions.createIfNew({
      kind: "leccion",
      fingerprint: "c10",
      title: "Saluda por su nombre.",
      payload: { lesson: "Saluda por su nombre." },
      evidence: "e",
    }))!;
    const res = await adminApp.request(
      `/mejoras/${encodeURIComponent(id)}/apply`,
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/mejoras?applied=1");
    expect(await getLessons(env)).toContain("Saluda por su nombre.");
  });

  it("requires auth — sends you to the login screen", async () => {
    const res = await adminApp.request("/mejoras", {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
  });
});
