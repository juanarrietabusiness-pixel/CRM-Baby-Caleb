import { describe, it, expect, vi } from "vitest";

// Mock both providers so createModel returns predictable model objects without
// importing the real SDK client internals.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ p: "anthropic", modelId }),
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
