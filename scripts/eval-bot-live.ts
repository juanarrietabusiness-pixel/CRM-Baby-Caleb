/**
 * Live eval runner — corre los escenarios de eval contra el bot DESPLEGADO
 * (o cualquier endpoint configurable) y usa Claude Sonnet 4.x como JUEZ.
 *
 * Esto es un script CLI (`pnpm eval`), NO un test de vitest:
 *  - NO corre en la suite de tests.
 *  - NO hace red en CI (solo cuando se invoca manualmente con las env vars puestas).
 *
 * Uso:
 *   ANTHROPIC_API_KEY=... BOT_URL=https://mi-bot.workers.dev \
 *   TELEGRAM_BOT_TOKEN=... [EVAL_THRESHOLD=0.85] [EVAL_WAIT_MS=20000] \
 *   pnpm eval
 *
 * Fuente de escenarios: test/fixtures/eval-scenarios.json (vía
 * scripts/eval-scenarios.ts) — la única fuente de verdad, compartida con los
 * tests unitarios.
 *
 * El judge se construye con AI SDK v6 (`ai` + `@ai-sdk/anthropic`), NO con el
 * SDK crudo de Anthropic (este repo no depende de `@anthropic-ai/sdk`).
 *
 * NOTA de diseño: toda la lógica de scoring/parsing es PURA y exportada
 * (parseJudgeVerdict, scoreResults, summarize) para poder testearla con el
 * judge mockeado, sin red. `main()` solo se ejecuta cuando este archivo es el
 * entrypoint del proceso.
 */

import process from "node:process";
import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { evalScenarios } from "./eval-scenarios";

// Sonnet 4.x — modelo juez. Sonnet evalúa las respuestas que produjo Haiku.
export const JUDGE_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_THRESHOLD = 0.85;
export const DEFAULT_WAIT_MS = 20_000;

export interface EvalFixture {
  id: string;
  userMessage: string;
  rubric: string;
  expectedToolCall?: string | null;
}

export interface JudgeVerdict {
  passed: boolean;
  reason: string;
}

export interface EvalResult {
  id: string;
  passed: boolean;
  reason: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number; // 0..1
  meetsThreshold: boolean;
  threshold: number;
  results: EvalResult[];
}

/**
 * Parsea la salida del juez a un veredicto estructurado.
 *
 * El juez puede devolver JSON puro o JSON embebido en texto. Si no se puede
 * extraer un objeto válido con un boolean `passed`, se cuenta como FALLO
 * (fail-closed) en vez de explotar — un veredicto ilegible no debe pasar.
 */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { passed: false, reason: "Judge devolvió respuesta vacía." };
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return { passed: false, reason: "Judge no devolvió JSON parseable." };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { passed: false, reason: "Judge devolvió JSON inválido." };
  }

  if (obj === null || typeof obj !== "object") {
    return { passed: false, reason: "Judge devolvió un JSON no-objeto." };
  }

  const record = obj as Record<string, unknown>;
  if (typeof record.passed !== "boolean") {
    return { passed: false, reason: "Judge omitió el campo booleano 'passed'." };
  }

  const reason =
    typeof record.reason === "string" && record.reason.trim() !== ""
      ? record.reason.trim()
      : "(sin razón)";

  return { passed: record.passed, reason };
}

/** Agrega resultados individuales en un resumen con pass-rate y umbral. */
export function scoreResults(
  results: EvalResult[],
  threshold: number = DEFAULT_THRESHOLD,
): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = total === 0 ? 0 : passed / total;
  return {
    total,
    passed,
    failed,
    passRate,
    threshold,
    meetsThreshold: total > 0 && passRate >= threshold,
    results,
  };
}

/** Construye el prompt del juez para un escenario + respuesta del bot. */
export function buildJudgePrompt(fix: EvalFixture, botReply: string): string {
  return [
    `Escenario: ${fix.id}`,
    `El usuario escribió: "${fix.userMessage}"`,
    `Rúbrica de aprobación: ${fix.rubric}`,
    `Herramienta esperada: ${fix.expectedToolCall ?? "ninguna"}`,
    "",
    "Respuesta del bot:",
    `"""${botReply}"""`,
    "",
    "¿La respuesta del bot cumple la rúbrica? Responde SOLO con un objeto JSON:",
    `{"passed": <true|false>, "reason": "<una oración>"}`,
  ].join("\n");
}

/** Renderiza un reporte legible del resumen. */
export function summarize(summary: EvalSummary): string {
  const lines: string[] = [];
  for (const r of summary.results) {
    lines.push(`  ${r.passed ? "✓" : "✗"} ${r.id} — ${r.reason}`);
  }
  lines.push("");
  lines.push(
    `${summary.passed}/${summary.total} aprobados ` +
      `(${(summary.passRate * 100).toFixed(0)}%) — ` +
      `umbral ${(summary.threshold * 100).toFixed(0)}% — ` +
      `${summary.meetsThreshold ? "PASS ✅" : "FAIL ❌"}`,
  );
  return lines.join("\n");
}

// --- Capa con efectos (red). No se ejecuta al importar. ---

/** Envía el mensaje del fixture al webhook de Telegram del bot desplegado. */
async function sendToBot(
  botUrl: string,
  text: string,
  chatId = 99_999,
): Promise<void> {
  const fakeUpdate = {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, first_name: "EvalUser", is_bot: false },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
  const res = await fetch(`${botUrl}/webhooks/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fakeUpdate),
  });
  if (!res.ok) {
    throw new Error(`Webhook devolvió ${res.status} ${res.statusText}`);
  }
}

/**
 * Recupera la respuesta del bot desde la API de Telegram (getUpdates).
 * El bot responde vía sendMessage; aquí leemos esos mensajes salientes.
 * Devuelve el último texto enviado a `chatId`, o "" si no hay.
 */
async function fetchBotReply(
  tgToken: string,
  chatId = 99_999,
): Promise<string> {
  const res = await fetch(
    `https://api.telegram.org/bot${tgToken}/getUpdates?limit=20`,
  );
  if (!res.ok) return "";
  const data = (await res.json()) as {
    ok: boolean;
    result?: Array<{
      message?: { chat?: { id?: number }; text?: string };
    }>;
  };
  if (!data.ok || !Array.isArray(data.result)) return "";
  const replies = data.result
    .map((u) => u.message)
    .filter((m) => m?.chat?.id === chatId && typeof m?.text === "string")
    .map((m) => m!.text as string);
  return replies.at(-1) ?? "";
}

/** Pide al juez Sonnet un veredicto sobre la respuesta del bot. */
async function judgeOne(
  model: LanguageModel,
  fix: EvalFixture,
  botReply: string,
): Promise<JudgeVerdict> {
  const { text } = await generateText({
    model,
    maxOutputTokens: 200,
    prompt: buildJudgePrompt(fix, botReply),
  });
  return parseJudgeVerdict(text);
}

async function loadFixtures(): Promise<EvalFixture[]> {
  // Single source of truth: test/fixtures/eval-scenarios.json, via the typed
  // accessor in scripts/eval-scenarios.ts (same set the unit tests validate).
  if (!Array.isArray(evalScenarios) || evalScenarios.length === 0) {
    throw new Error("No hay escenarios en test/fixtures/eval-scenarios.json.");
  }
  return evalScenarios;
}

async function main(): Promise<void> {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const BOT_URL = process.env.BOT_URL;
  const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const threshold = process.env.EVAL_THRESHOLD
    ? Number(process.env.EVAL_THRESHOLD)
    : DEFAULT_THRESHOLD;
  const waitMs = process.env.EVAL_WAIT_MS
    ? Number(process.env.EVAL_WAIT_MS)
    : DEFAULT_WAIT_MS;

  if (!ANTHROPIC_KEY || !BOT_URL || !TG_TOKEN) {
    console.error(
      "Faltan env vars. Necesitas: ANTHROPIC_API_KEY, BOT_URL, TELEGRAM_BOT_TOKEN.",
    );
    process.exit(1);
  }

  const fixtures = await loadFixtures();
  const anthropic = createAnthropic({ apiKey: ANTHROPIC_KEY });
  const model = anthropic(JUDGE_MODEL);

  const results: EvalResult[] = [];
  for (const fix of fixtures) {
    console.log(`Corriendo ${fix.id}...`);
    try {
      await sendToBot(BOT_URL, fix.userMessage);
      await new Promise((r) => setTimeout(r, waitMs));
      const botReply = await fetchBotReply(TG_TOKEN);
      const verdict = await judgeOne(model, fix, botReply);
      results.push({ id: fix.id, ...verdict });
      console.log(`  ${verdict.passed ? "✓" : "✗"} ${verdict.reason}`);
    } catch (err) {
      const reason = `Error corriendo escenario: ${(err as Error).message}`;
      results.push({ id: fix.id, passed: false, reason });
      console.log(`  ✗ ${reason}`);
    }
  }

  const summary = scoreResults(results, threshold);
  console.log("\n" + summarize(summary));
  process.exit(summary.meetsThreshold ? 0 : 1);
}

// Solo corre la red cuando este archivo es el entrypoint (no al importarlo en tests).
const isEntrypoint =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
