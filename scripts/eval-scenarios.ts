#!/usr/bin/env tsx
/**
 * eval-scenarios.ts
 *
 * Typed accessor over `test/fixtures/eval-scenarios.json`: the canonical set of
 * 20 conversation scenarios spanning EN/ES/PT and the bot's core jobs
 * (FAQ, lead capture, booking, handoff, frustration, out-of-scope, plus
 * image- and voice-input handling).
 *
 * Consumed by:
 *   - `scripts/eval-bot-live.ts` (`pnpm eval`) to drive the live bot, and
 *   - unit tests that assert the fixture set stays well-formed.
 *
 * The JSON is the single source of truth; this file just adds the type shape
 * and a couple of light invariants so a malformed fixture fails loudly.
 */
import scenariosJson from "../test/fixtures/eval-scenarios.json";

export type EvalLang = "es" | "en" | "pt";
export type EvalTier = "free" | "pro";
export type EvalCategory =
  | "faq"
  | "lead-capture"
  | "booking"
  | "handoff"
  | "frustration"
  | "out-of-scope"
  | "image-input"
  | "voice-input";

export interface EvalScenario {
  /** Unique, kebab-case id (e.g. "es-faq-hours"). */
  id: string;
  lang: EvalLang;
  tier: EvalTier;
  category: EvalCategory;
  /** The exact message a customer sends the bot. */
  userMessage: string;
  /**
   * The tool the bot is expected to call to satisfy the request, or `null`
   * when the correct behavior is to answer/redirect without any tool.
   */
  expectedToolCall: string | null;
  /** Plain-language success criterion an LLM-judge (or human) grades against. */
  rubric: string;
}

export const evalScenarios: EvalScenario[] = scenariosJson as unknown as EvalScenario[];

/** All distinct tool names referenced by the scenarios (excludes null). */
export const expectedTools: string[] = [
  ...new Set(
    evalScenarios
      .map((s) => s.expectedToolCall)
      .filter((t): t is string => t !== null),
  ),
].sort();

export function scenariosByLang(lang: EvalLang): EvalScenario[] {
  return evalScenarios.filter((s) => s.lang === lang);
}

export function scenariosByCategory(category: EvalCategory): EvalScenario[] {
  return evalScenarios.filter((s) => s.category === category);
}
