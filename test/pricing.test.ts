import { describe, it, expect } from "vitest";
import { costOfUsage, PRICING } from "../src/pricing";

describe("pricing", () => {
  it("calculates Haiku cost from token usage", () => {
    const cost = costOfUsage("claude-haiku-4-5-20251001", {
      input: 1_000_000,
      output: 1_000_000,
      cached: 0,
    });
    expect(cost).toBeCloseTo(PRICING.haiku.input + PRICING.haiku.output);
  });

  it("cached tokens cost less than fresh input", () => {
    const fresh = costOfUsage("claude-haiku-4-5-20251001", {
      input: 1_000_000,
      output: 0,
      cached: 0,
    });
    const cached = costOfUsage("claude-haiku-4-5-20251001", {
      input: 0,
      output: 0,
      cached: 1_000_000,
    });
    expect(cached).toBeLessThan(fresh);
  });

  it("prices OpenAI models too", () => {
    const cost = costOfUsage("gpt-4o-mini", {
      input: 1_000_000,
      output: 1_000_000,
      cached: 0,
    });
    expect(cost).toBeCloseTo(PRICING["gpt-4o-mini"].input + PRICING["gpt-4o-mini"].output);
  });

  it("falls back to the cheapest rate for unknown model ids (never throws)", () => {
    const cost = costOfUsage("some-unknown-model", { input: 1_000_000, output: 0, cached: 0 });
    expect(cost).toBeCloseTo(PRICING.haiku.input);
  });
});
