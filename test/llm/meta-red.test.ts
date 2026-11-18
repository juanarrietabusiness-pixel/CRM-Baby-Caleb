import { describe, it, expect, vi, afterEach } from "vitest";
import { generateText } from "ai";
import { createModel } from "../../src/llm/provider";
import type { Env } from "../../src/env";

/**
 * Las llamadas DE VERDAD (con un fetch de mentira): a dónde van y con qué
 * cabeceras. El otro archivo mira las opciones con que se crea el cliente; este
 * mira lo que saldría por la red, que es lo que importa si un día el SDK cambia.
 *
 * El caso que justifica el archivo: con `nodejs_compat` el Worker pone sus
 * secrets en `process.env`, y el SDK de Anthropic lee de ahí ANTHROPIC_API_KEY
 * y ANTHROPIC_BASE_URL cuando no se le pasan. La documentación de Meta pide
 * justo ANTHROPIC_BASE_URL=https://api.meta.ai/v1 para usar Muse con ese SDK.
 */

const ANT = "sk-ant-api03-sistema-000000000000000";
const META = "llave-de-meta-0000000000000000";

const respuesta = () =>
  new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "x",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

function espiarFetch() {
  const llamadas: { url: string; headers: Record<string, string>; body: string }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    h.forEach((v, k) => (headers[k] = v));
    llamadas.push({ url: String(url), headers, body: String(init?.body ?? "") });
    return respuesta();
  });
  return llamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("lo que sale por la red", () => {
  it("Meta: a api.meta.ai, con su llave en Bearer y x-api-key, y nada de la de Anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = ANT;
    const llamadas = espiarFetch();
    const { model } = createModel({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META } as Env, "fast", { provider: "meta" });
    await generateText({ model, prompt: "hola", maxOutputTokens: 8 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.meta.ai/v1/messages");
    expect(llamadas[0].headers.authorization).toBe(`Bearer ${META}`);
    expect(llamadas[0].headers["x-api-key"]).toBe(META);
    expect(JSON.stringify(llamadas[0])).not.toContain(ANT);
    // Sin caché de Anthropic: Meta no la reconoce.
    expect(llamadas[0].body).not.toContain("cache_control");
    expect(JSON.parse(llamadas[0].body).model).toBe("muse-spark-1.3");
  });

  it("Anthropic: un ANTHROPIC_BASE_URL hacia Meta en el entorno NO desvía la llave de Anthropic", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.meta.ai/v1";
    const llamadas = espiarFetch();
    const { model } = createModel({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META } as Env, "fast");
    await generateText({ model, prompt: "hola", maxOutputTokens: 8 });
    expect(llamadas[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(llamadas[0].headers["x-api-key"]).toBe(ANT);
    expect(JSON.stringify(llamadas[0])).not.toContain(META);
  });
});
