import { describe, it, expect, vi } from "vitest";

// Mock both providers so createModel returns predictable model objects without
// importing the real SDK client internals.
vi.mock("@ai-sdk/anthropic", () => ({
  // Guarda con qué opciones se creó: es lo que dice A DÓNDE va la llamada y con
  // QUÉ llave (Anthropic y Meta usan este mismo cliente).
  createAnthropic: (opts: unknown) => (modelId: string) => ({ p: "anthropic", modelId, opts }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({ p: "openai", modelId }),
}));

import { resolveProvider, modelIdFor, createModel } from "../../src/llm/provider";
import type { Env } from "../../src/env";

function env(over: Partial<Env> = {}): Env {
  return { ANTHROPIC_API_KEY: "sk-ant", ...over } as Env;
}

describe("resolveProvider", () => {
  it("defaults to anthropic", () => {
    expect(resolveProvider(env())).toBe("anthropic");
  });
  it("honors LLM_PROVIDER=openai", () => {
    expect(resolveProvider(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }))).toBe("openai");
  });
  it("honors LLM_PROVIDER=anthropic even with an openai key present", () => {
    expect(resolveProvider(env({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-oa" }))).toBe("anthropic");
  });
  it("auto-selects openai when only the openai key is set", () => {
    expect(resolveProvider({ OPENAI_API_KEY: "sk-oa" } as Env)).toBe("openai");
  });
});

describe("modelIdFor", () => {
  it("anthropic tier defaults", () => {
    expect(modelIdFor(env(), "anthropic", "fast")).toBe("claude-haiku-4-5-20251001");
    expect(modelIdFor(env(), "anthropic", "smart")).toBe("claude-sonnet-4-5-20250929");
  });
  it("openai tier defaults", () => {
    expect(modelIdFor(env(), "openai", "fast")).toBe("gpt-4o-mini");
    expect(modelIdFor(env(), "openai", "smart")).toBe("gpt-4o");
  });
  it("env overrides win", () => {
    expect(modelIdFor(env({ OPENAI_MODEL_SMART: "gpt-5" }), "openai", "smart")).toBe("gpt-5");
    expect(modelIdFor(env({ ANTHROPIC_MODEL_FAST: "claude-x" }), "anthropic", "fast")).toBe("claude-x");
  });
});

describe("createModel", () => {
  it("anthropic supports prompt cache", () => {
    const r = createModel(env(), "fast");
    expect(r.provider).toBe("anthropic");
    expect(r.supportsPromptCache).toBe(true);
    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
  });
  it("openai does NOT support prompt cache", () => {
    const r = createModel(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }), "smart");
    expect(r.provider).toBe("openai");
    expect(r.supportsPromptCache).toBe(false);
    expect(r.modelId).toBe("gpt-4o");
  });
});

describe("pareceLlaveDeIa — lo que el navegador autocompleta no es una llave", () => {
  it("acepta las formas de los tres proveedores", async () => {
    const { pareceLlaveDeIa } = await import("../../src/llm/provider");
    expect(pareceLlaveDeIa("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(pareceLlaveDeIa("sk-proj-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(pareceLlaveDeIa("xai-abcdefghijklmnopqrstuvwxyz")).toBe(true);
  });

  it("rechaza una contraseña", async () => {
    const { pareceLlaveDeIa } = await import("../../src/llm/provider");
    expect(pareceLlaveDeIa("miClave123")).toBe(false);
  });

  it("createModel ignora una llave guardada que no es del proveedor y usa la del sistema", async () => {
    const { createModel } = await import("../../src/llm/provider");
    const r = createModel({ ANTHROPIC_API_KEY: "sk-ant-sistema-000000000000000" } as any, "fast", { apiKey: "miClave123" });
    expect(r.provider).toBe("anthropic");
    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
  });
});

describe("Meta (Muse Spark) — un proveedor más, sin chocar con las otras llaves", () => {
  const META = "llave-de-meta-0000000000000000";
  const ANT = "sk-ant-api03-sistema-000000000000000";

  it("LLM_PROVIDER=meta lo elige; y es el automático solo si es la ÚNICA llave de IA", () => {
    expect(resolveProvider(env({ LLM_PROVIDER: "meta", META_API_KEY: META }))).toBe("meta");
    expect(resolveProvider({ META_API_KEY: META } as Env)).toBe("meta");
    expect(resolveProvider({ MODEL_API_KEY: META } as Env)).toBe("meta");
    // Con la de Anthropic también puesta, Anthropic sigue siendo el de siempre.
    expect(resolveProvider(env({ META_API_KEY: META }))).toBe("anthropic");
  });

  it("modelos por defecto: Muse Spark 1.3 (el que NO entrena con los datos), con override por env", async () => {
    const { MODELO_MUSE } = await import("../../src/llm/provider");
    expect(modelIdFor(env(), "meta", "fast")).toBe(MODELO_MUSE);
    expect(modelIdFor(env(), "meta", "smart")).toBe(MODELO_MUSE);
    expect(modelIdFor(env({ META_MODEL_SMART: "muse-spark-2" }), "meta", "smart")).toBe("muse-spark-2");
  });

  it("va a api.meta.ai con la llave de Meta como Bearer, sin caché de Anthropic", async () => {
    const { META_BASE_URL } = await import("../../src/llm/provider");
    const r = createModel(env({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META }), "fast", { provider: "meta" });
    expect(r.provider).toBe("meta");
    expect(r.supportsPromptCache).toBe(false);
    const opts = r.model.opts;
    expect(opts.baseURL).toBe(META_BASE_URL);
    expect(opts.authToken).toBe(META);
    expect(opts.apiKey).toBeUndefined(); // sin apiKey el SDK no busca ANTHROPIC_API_KEY en el entorno
    expect(JSON.stringify(opts)).not.toContain(ANT);
  });

  it("Anthropic lleva su base explícita: un ANTHROPIC_BASE_URL apuntando a Meta no la desvía", async () => {
    const { ANTHROPIC_BASE_URL } = await import("../../src/llm/provider");
    const r = createModel(env({ ANTHROPIC_API_KEY: ANT, META_API_KEY: META }), "fast");
    expect(r.model.opts.baseURL).toBe(ANTHROPIC_BASE_URL);
    expect(r.model.opts.apiKey).toBe(ANT);
  });

  it("los tokens de Messenger e Instagram NUNCA se usan como llave de la IA", () => {
    const conCanales = env({
      ANTHROPIC_API_KEY: ANT,
      META_PAGE_ACCESS_TOKEN: "EAAGm0PX4ZCpsBAtokenDeLaPagina000",
      INSTAGRAM_ACCESS_TOKEN: "IGAAtokenDeInstagram0000000000",
      META_APP_SECRET: "secreto-de-la-app-000000000000",
    });
    // Se pide Meta, pero no hay llave de la IA de Meta: cae a Anthropic, y
    // ningún token de la Graph API aparece en la llamada.
    const r = createModel(conCanales, "fast", { provider: "meta" });
    expect(r.provider).toBe("anthropic");
    const todo = JSON.stringify(r.model.opts);
    expect(todo).not.toContain("EAAGm0PX4ZCpsBA");
    expect(todo).not.toContain("IGAAtokenDeInstagram");
    expect(todo).not.toContain("secreto-de-la-app");
  });

  it("la llave del panel que no es de Meta (o es un token de la Página) se ignora y se usa la del sistema", () => {
    for (const guardada of [ANT, "EAAGm0PX4ZCpsBAtokenDeLaPagina000", "IGAAtokenDeInstagram0000000000"]) {
      const r = createModel(env({ META_API_KEY: META }), "fast", { provider: "meta", apiKey: guardada });
      expect(r.provider).toBe("meta");
      expect(r.model.opts.authToken).toBe(META);
    }
  });

  it("un modelo Muse elegido sin proveedor se deduce como Meta", () => {
    const r = createModel(env({ META_API_KEY: META }), "fast", { model: "muse-spark-1.2-contributor" });
    expect(r.provider).toBe("meta");
    expect(r.modelId).toBe("muse-spark-1.2-contributor");
  });

  it("un modelo de OTRO proveedor no se manda: Muse con Claude elegido daría 404 en cada mensaje", () => {
    const r = createModel(env({ META_API_KEY: META }), "fast", { provider: "anthropic", model: "muse-spark-1.3" });
    expect(r.provider).toBe("anthropic");
    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
    // Un id que no se reconoce (modelo nuevo) sí se respeta.
    const nuevo = createModel(env(), "fast", { provider: "anthropic", model: "claude-nuevo-9" });
    expect(nuevo.modelId).toBe("claude-nuevo-9");
  });

  it("respaldo: si Anthropic falla y hay llave de Meta, contesta Meta; si falla Meta, Anthropic", async () => {
    const { fallbackModel } = await import("../../src/llm/provider");
    expect(fallbackModel(env({ META_API_KEY: META }), "fast", "anthropic")?.provider).toBe("meta");
    expect(fallbackModel(env({ META_API_KEY: META }), "fast", "meta")?.provider).toBe("anthropic");
    // Sin su llave, Meta no es respaldo de nadie.
    expect(fallbackModel(env(), "fast", "anthropic")).toBeNull();
  });

  it("pareceLlaveDeMeta: por descarte — ni de otra IA ni de la Graph API", async () => {
    const { pareceLlaveDeIa, pareceLlaveDeMeta } = await import("../../src/llm/provider");
    expect(pareceLlaveDeMeta(META)).toBe(true);
    expect(pareceLlaveDeIa(META, "meta")).toBe(true);
    for (const no of [ANT, "sk-proj-abcdefghijklmnopqrstuvwxyz", "xai-abcdefghijklmnopqrstuvwxyz", "EAAGm0PX4ZCpsBAtoken0000000", "IGAAtoken000000000000000000", "IGQVJtoken00000000000000000", "miClave123"]) {
      expect(pareceLlaveDeMeta(no)).toBe(false);
    }
    // Sin decir el proveedor, una llave de Meta no se confunde con las otras.
    expect(pareceLlaveDeIa(META)).toBe(false);
  });

  it("el Contributor se reconoce como el que entrena con los datos, y los dos tienen precio", async () => {
    const { entrenaConLosDatos, MODELO_MUSE, MODELO_MUSE_CONTRIBUIDOR, CURATED_MODELS } = await import("../../src/llm/provider");
    const { costOfUsage } = await import("../../src/pricing");
    expect(entrenaConLosDatos(MODELO_MUSE_CONTRIBUIDOR)).toBe(true);
    expect(entrenaConLosDatos(MODELO_MUSE)).toBe(false);
    const uso = { input: 1_000_000, cached: 0, output: 1_000_000 };
    expect(costOfUsage(MODELO_MUSE, uso)).toBeCloseTo(5.5, 5);
    expect(costOfUsage(MODELO_MUSE_CONTRIBUIDOR, uso)).toBeCloseTo(0.3, 5);
    // El aviso viaja en la etiqueta del selector del panel.
    expect(CURATED_MODELS.find((m) => m.id === MODELO_MUSE_CONTRIBUIDOR)?.label).toMatch(/entrena/);
  });
});
