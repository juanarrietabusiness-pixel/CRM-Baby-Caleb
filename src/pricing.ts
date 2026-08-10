// USD per million tokens. Update when providers adjust pricing.
export const PRICING = {
  haiku: {
    input: 0.80,
    cacheRead: 0.08,
    output: 4.00,
  },
  sonnet: {
    input: 3.00,
    cacheRead: 0.30,
    output: 15.00,
  },
  // OpenAI alternative (defaults mapped in src/llm/provider.ts).
  "gpt-4o-mini": {
    input: 0.15,
    cacheRead: 0.075,
    output: 0.60,
  },
  "gpt-4o": {
    input: 2.50,
    cacheRead: 1.25,
    output: 10.00,
  },
} as const;

interface Rates {
  input: number;
  cacheRead: number;
  output: number;
}

// Concrete model ids we price natively. Unknown ids fall back to the cheapest
// rate (Haiku) so cost logging never throws — it just under/over-estimates.
const RATES: Record<string, Rates> = {
  "claude-haiku-4-5-20251001": PRICING.haiku,
  "claude-sonnet-4-5-20250929": PRICING.sonnet,
  "gpt-4o-mini": PRICING["gpt-4o-mini"],
  "gpt-4o": PRICING["gpt-4o"],
  // BYO-LLM picker (dashboard "Modelo de IA")
  "claude-sonnet-4-6": PRICING.sonnet,
  "claude-opus-4-6": { input: 5.0, cacheRead: 0.5, output: 25.0 },
  "gpt-4.1": { input: 2.0, cacheRead: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cacheRead: 0.1, output: 1.6 },
  "grok-4": { input: 3.0, cacheRead: 0.75, output: 15.0 },
  "grok-4-fast-non-reasoning": { input: 0.2, cacheRead: 0.05, output: 0.5 },
  "grok-3-mini": { input: 0.3, cacheRead: 0.075, output: 0.5 },
};

// Any concrete model id string (Anthropic or OpenAI). Kept as a string alias so
// env-overridden / custom models still type-check at call sites.
export type ModelId = string;

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

export function costOfUsage(model: ModelId, usage: Usage): number {
  const rates = RATES[model] ?? PRICING.haiku;
  return (
    (usage.input - usage.cached) * (rates.input / 1_000_000) +
    usage.cached * (rates.cacheRead / 1_000_000) +
    usage.output * (rates.output / 1_000_000)
  );
}
