/**
 * Provider-agnostic model tier. The active provider (Anthropic/OpenAI) maps each
 * tier to a concrete model id in src/llm/provider.ts.
 *   fast  = cheap default (e.g. Haiku / gpt-4o-mini)
 *   smart = upgrade for hard turns (e.g. Sonnet / gpt-4o)
 */
export type Tier = "fast" | "smart";

export const FRUSTRATION_KEYWORDS_BY_LANG: Record<string, string[]> = {
  es: ["no sirve", "no funciona", "está roto", "horrible", "una porquería", "qué basura", "harta", "harto"],
  en: ["doesn't work", "doesnt work", "broken", "nothing works", "useless", "garbage", "frustrating", "ridiculous"],
  pt: ["não funciona", "nao funciona", "horrível", "horrivel", "uma porcaria", "lixo"],
};

export interface ModelSelectionContext {
  toolCallsInLast2Turns: number;
  lastUserText: string;
  lastUserLang: string;
  hasImage: boolean;
  imageRetryCount: number;
  lastSearchKbScore: number;
}

export function selectModel(ctx: ModelSelectionContext): Tier {
  if (ctx.toolCallsInLast2Turns > 3) return "smart";
  if (ctx.hasImage && ctx.imageRetryCount > 0) return "smart";
  if (ctx.lastSearchKbScore < 0.5) return "smart";

  const keywords = FRUSTRATION_KEYWORDS_BY_LANG[ctx.lastUserLang] ?? [];
  const lower = ctx.lastUserText.toLowerCase();
  if (keywords.some((k) => lower.includes(k))) return "smart";

  return "fast";
}
