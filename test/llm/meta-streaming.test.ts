import { describe, it, expect, vi, afterEach } from "vitest";
import { streamText, tool } from "ai";
import { z } from "zod";
import { createModel, OPCIONES_POR_PROVEEDOR } from "../../src/llm/provider";
import type { Env } from "../../src/env";

/**
 * El chat real (7-oct-2026): «Probar mi configuración» salía en verde con Muse
 * Spark y cada mensaje real fallaba. La prueba manda una petición mínima; el chat
 * manda herramientas y streaming, y con streaming el SDK de Anthropic agrega
 * `eager_input_streaming: true` a CADA herramienta, un campo que no es de la API
 * de mensajes estándar. Aquí se mira la petición del chat tal cual saldría.
 */

const ANT = "sk-ant-api03-sistema-000000000000000";
const META = "llave-de-meta-0000000000000000";

const sse = (eventos: [string, unknown][]) =>
  eventos.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

function espiarStream() {
  const cuerpos: any[] = [];
  vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      sse([
        ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }],
        ["message_stop", { type: "message_stop" }],
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  });
  return cuerpos;
}

const herramientas = {
  buscar: tool({
    description: "Busca algo",
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({ ok: true }),
  }),
};

async function chat(env: Env, overrides: { provider: string }) {
  const { model } = createModel(env, "fast", overrides);
  const r = streamText({
    model,
    system: "Eres un asistente.",
    messages: [{ role: "user", content: "hola" }],
    tools: herramientas,
    providerOptions: OPCIONES_POR_PROVEEDOR,
  });
  let texto = "";
  for await (const c of r.textStream) texto += c;
  return texto;
}

afterEach(() => vi.unstubAllGlobals());

describe("el chat real con herramientas y streaming", () => {
  it("Meta: las herramientas salen SIN eager_input_streaming", async () => {
    const cuerpos = espiarStream();
    const texto = await chat({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META } as Env, { provider: "meta" });
    expect(texto).toBe("Hola");
    expect(cuerpos[0].stream).toBe(true);
    expect(cuerpos[0].tools).toHaveLength(1);
    expect(cuerpos[0].tools[0]).not.toHaveProperty("eager_input_streaming");
  });

  it("Claude: las opciones de Meta no le cambian nada (sigue con su streaming fino)", async () => {
    const cuerpos = espiarStream();
    await chat({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META } as Env, { provider: "anthropic" });
    expect(cuerpos[0].tools[0].eager_input_streaming).toBe(true);
  });
});
