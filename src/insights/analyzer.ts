/**
 * Insights analyzer — the "Analista" layer of the dashboard.
 *
 * Once a conversation goes idle (no messages for IDLE_MS), a cheap "fast"-tier
 * model (Haiku by default) grades it against a fixed rubric and the result is
 * stored in `conversation_insights` (one row per conversation, re-analyzed if
 * the customer comes back). Cost ≈ $0.0006 per conversation on Haiku.
 *
 * Triggered from the admin dashboard (button + opportunistic waitUntil on the
 * Insights tab). TODO: also wire into `scheduled()` in src/index.ts for a
 * nightly run — deferred while that file is being reworked on another branch
 * of work (channels/meta).
 */
import { generateText } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { InsightsRepo, type UpsertInsightInput } from "../db/insights";
import { CustomerFactsRepo } from "../db/facts";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";

/** A conversation counts as "closed" after this much silence. */
export const IDLE_MS = 3 * 60 * 60 * 1000; // 3h

/** Max messages fed to the grader (ascending order, each truncated). */
const TRANSCRIPT_MESSAGES = 40;
const MAX_MSG_CHARS = 500;

const insightSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]),
  resolution: z.enum(["resolved", "unresolved", "escalated", "abandoned"]),
  bot_score: z.number().int().min(1).max(5),
  topics: z.array(z.string()).max(6).default([]),
  summary: z.string().max(600),
  missed_kb: z.string().nullable().default(null),
  sale_opportunity: z.boolean().default(false),
  customer_facts: z.array(z.string()).max(8).default([]),
});

export interface AnalyzeOptions {
  /** Max conversations to grade in this run (cost guard). */
  limit?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export interface AnalyzeResult {
  analyzed: number;
  errors: number;
  pending: number;
}

interface PendingConv {
  id: string;
  open_tickets: number;
}

/** Conversations that are idle, have a real exchange, and lack a fresh insight. */
async function pickPending(db: Db, now: number, limit: number): Promise<PendingConv[]> {
  return db.all<PendingConv>(
    `SELECT c.id,
       (SELECT COUNT(*) FROM tickets t
         WHERE t.conversation_id = c.id AND t.status != 'resolved') as open_tickets
     FROM conversations c
     LEFT JOIN conversation_insights i ON i.conversation_id = c.id
     WHERE c.last_message_at < ?
       AND (i.conversation_id IS NULL OR i.analyzed_at < c.last_message_at)
       AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 2
     ORDER BY c.last_message_at DESC
     LIMIT ?`,
    [now - IDLE_MS, limit],
  );
}

/** How many idle conversations are still waiting for analysis (for the UI). */
export async function countPending(env: Env, now = Date.now()): Promise<number> {
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) as n
     FROM conversations c
     LEFT JOIN conversation_insights i ON i.conversation_id = c.id
     WHERE c.last_message_at < ?
       AND (i.conversation_id IS NULL OR i.analyzed_at < c.last_message_at)
       AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 2`,
    [now - IDLE_MS],
  );
  return row?.n ?? 0;
}

const ROLE_LABEL: Record<string, string> = {
  user: "Cliente",
  assistant: "Bot",
  owner: "Dueño",
  tool: "Tool",
};

function buildTranscript(msgs: { role: string; content: string }[]): string {
  return msgs
    .map((m) => {
      const text =
        m.content.length > MAX_MSG_CHARS
          ? `${m.content.slice(0, MAX_MSG_CHARS)}…`
          : m.content;
      return `${ROLE_LABEL[m.role] ?? m.role}: ${text}`;
    })
    .join("\n");
}

function gradingPrompt(env: Env, transcript: string, hasOpenTicket: boolean): string {
  return `Eres un auditor de calidad del chatbot de atención a clientes de ${env.BUSINESS_NAME}.
Analiza la conversación completa y responde SOLO con un objeto JSON válido, sin markdown ni explicación:

{
  "sentiment": "positive" | "neutral" | "frustrated" | "angry",
  "resolution": "resolved" | "unresolved" | "escalated" | "abandoned",
  "bot_score": 1-5,
  "topics": ["tema1", "tema2"],
  "summary": "...",
  "missed_kb": "..." | null,
  "sale_opportunity": true | false,
  "customer_facts": ["hecho1", "hecho2"]
}

Criterios:
- sentiment: emoción del CLIENTE al final de la conversación.
- resolution: "escalated" si intervino un humano o se creó un ticket; "abandoned" si el cliente dejó de responder sin resolución clara.
- bot_score: calidad de las respuestas del bot (exactitud, tono, brevedad, no inventar).
- topics: 1 a 4 temas cortos en español, en minúsculas.
- summary: 1-2 frases en español — qué quería el cliente y cómo terminó.
- missed_kb: si el bot NO supo responder algo concreto del negocio, la pregunta del cliente tal cual; si no, null.
- sale_opportunity: true SOLO si el cliente mostró intención real de contratar/comprar algo de PAGO y quedó sin cerrar. NO cuentes como oportunidad: registros a eventos gratuitos, saludos, dudas informativas, ni interés vago sin un negocio o necesidad de pago detrás.
- customer_facts: 0 a 5 datos del CLIENTE útiles para recordarlo en futuras conversaciones (nombre, preferencias, qué compró, qué le molestó). En español, cortos. NUNCA datos sensibles (tarjetas, passwords, direcciones exactas). Lista vacía si no hay nada memorable.

Dato: la conversación ${hasOpenTicket ? "SÍ" : "NO"} tiene ticket abierto.

Conversación:
${transcript}`;
}

/** Extract the first JSON object from LLM output (tolerates code fences). */
export function parseInsightJson(raw: string): z.infer<typeof insightSchema> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const result = insightSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Grade pending conversations. Safe to call concurrently/repeatedly: upserts
 * by conversation_id and the batch `limit` caps cost per run.
 */
export async function analyzeConversations(
  env: Env,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const db = new Db(env.DB);
  const msgs = new MessagesRepo(db);
  const insights = new InsightsRepo(db);

  const pending = await pickPending(db, now, limit);
  let analyzed = 0;
  let errors = 0;

  const { model } = createModel(env, "fast", await loadLlmOverrides(env));

  for (const conv of pending) {
    try {
      const history = await msgs.lastN(conv.id, TRANSCRIPT_MESSAGES);
      const transcript = buildTranscript(history);
      if (!transcript.trim()) continue;

      const result = await generateText({
        model,
        prompt: gradingPrompt(env, transcript, conv.open_tickets > 0),
      });

      const insight = parseInsightJson(result.text);
      if (!insight) {
        errors++;
        console.error(`[insights] unparseable grader output for ${conv.id}`);
        continue;
      }

      const input: UpsertInsightInput = {
        conversationId: conv.id,
        analyzedAt: now,
        sentiment: insight.sentiment,
        resolution: insight.resolution,
        botScore: insight.bot_score,
        topics: insight.topics,
        summary: insight.summary,
        missedKb: insight.missed_kb,
        saleOpportunity: insight.sale_opportunity,
      };
      await insights.upsert(input);
      if (insight.customer_facts.length > 0) {
        await new CustomerFactsRepo(db).addMany(conv.id, insight.customer_facts);
      }
      analyzed++;
    } catch (e) {
      errors++;
      console.error(`[insights] failed to analyze ${conv.id}:`, e);
    }
  }

  const remaining = await countPending(env, now);
  return { analyzed, errors, pending: remaining };
}
