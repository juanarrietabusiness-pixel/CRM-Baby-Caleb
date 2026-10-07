/**
 * «Probar mi configuración» (GET /admin/config/llm-test) con Muse Spark.
 *
 * El 7-oct-2026 la prueba fallaba con «`max_tokens` The number must be >= 16»:
 * la llave llegaba a Meta y se aceptaba, pero la prueba pedía 8 tokens de
 * respuesta y Meta exige 16 como mínimo. Aquí el fetch de mentira hace lo mismo
 * que Meta: contesta 400 si `max_tokens` baja de 16.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { MAX_TOKENS_DE_PRUEBA } from "../../src/llm/provider";
import type { Env } from "../../src/env";

const AUTH = { Authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}` };
const META = "llave-de-meta-0000000000000000";

let env: Env;
let settings: SettingsRepo;
let pedidos: { url: string; maxTokens: number }[];

function respuestaDeMeta(maxTokens: number): Response {
  if (maxTokens < 16) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "`max_tokens` The number must be `>= 16`." },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "muse-spark-1.2-contributor",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: "secret123",
    META_API_KEY: META,
  } as unknown as Env;
  settings = new SettingsRepo(new Db(d1));
  await settings.set(SETTING_KEYS.llmProvider, "meta");
  await settings.set(SETTING_KEYS.llmModel, "muse-spark-1.2-contributor");

  pedidos = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const maxTokens = JSON.parse(String(init?.body ?? "{}")).max_tokens as number;
    pedidos.push({ url: String(url), maxTokens });
    return respuestaDeMeta(maxTokens);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Probar mi configuración con Muse Spark", () => {
  it("pide a Meta al menos 16 tokens, que es lo que Meta acepta", () => {
    expect(MAX_TOKENS_DE_PRUEBA).toBeGreaterThanOrEqual(16);
  });

  it("sale en verde con Muse Spark Contributor", async () => {
    const res = await adminApp.request("/config/llm-test", { headers: AUTH }, env);
    expect(res.status).toBe(302);
    const destino = decodeURIComponent(res.headers.get("location") ?? "");
    expect(destino).toContain("llmtest=ok:");
    expect(destino).toContain("meta/muse-spark-1.2-contributor");
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://api.meta.ai/v1/messages");
    expect(pedidos[0].maxTokens).toBeGreaterThanOrEqual(16);
  });
});
