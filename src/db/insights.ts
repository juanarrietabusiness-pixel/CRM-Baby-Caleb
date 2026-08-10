import { Db } from "./client";

export type Sentiment = "positive" | "neutral" | "frustrated" | "angry";
export type Resolution = "resolved" | "unresolved" | "escalated" | "abandoned";

export interface ConversationInsight {
  conversation_id: string;
  analyzed_at: number;
  sentiment: Sentiment | null;
  resolution: Resolution | null;
  bot_score: number | null;
  topics: string | null; // JSON array
  summary: string | null;
  missed_kb: string | null;
  sale_opportunity: number; // 0 | 1
}

export interface UpsertInsightInput {
  conversationId: string;
  analyzedAt?: number;
  sentiment: Sentiment;
  resolution: Resolution;
  botScore: number;
  topics: string[];
  summary: string;
  missedKb: string | null;
  saleOpportunity: boolean;
}

/** Aggregates for the Insights tab header cards. */
export interface InsightStats {
  analyzed: number;
  resolvedNoHuman: number;
  avgScore: number | null;
  negative: number; // frustrated + angry
}

/** Insight joined with its conversation, for dashboard listings. */
export interface InsightWithConversation extends ConversationInsight {
  display_name: string | null;
  channel_user_id: string | null;
  channel: string | null;
  last_message_at: number | null;
}

export class InsightsRepo {
  constructor(private readonly db: Db) {}

  async upsert(input: UpsertInsightInput): Promise<void> {
    await this.db.run(
      `INSERT INTO conversation_insights
         (conversation_id, analyzed_at, sentiment, resolution, bot_score,
          topics, summary, missed_kb, sale_opportunity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         analyzed_at = excluded.analyzed_at,
         sentiment = excluded.sentiment,
         resolution = excluded.resolution,
         bot_score = excluded.bot_score,
         topics = excluded.topics,
         summary = excluded.summary,
         missed_kb = excluded.missed_kb,
         sale_opportunity = excluded.sale_opportunity`,
      [
        input.conversationId,
        input.analyzedAt ?? Date.now(),
        input.sentiment,
        input.resolution,
        input.botScore,
        JSON.stringify(input.topics),
        input.summary,
        input.missedKb,
        input.saleOpportunity ? 1 : 0,
      ],
    );
  }

  async getByConversation(id: string): Promise<ConversationInsight | null> {
    return this.db.first<ConversationInsight>(
      "SELECT * FROM conversation_insights WHERE conversation_id = ?",
      [id],
    );
  }

  async recent(limit = 20): Promise<InsightWithConversation[]> {
    return this.db.all<InsightWithConversation>(
      `SELECT i.*, c.display_name, c.channel_user_id, c.channel, c.last_message_at
       FROM conversation_insights i
       LEFT JOIN conversations c ON c.id = i.conversation_id
       ORDER BY i.analyzed_at DESC LIMIT ?`,
      [limit],
    );
  }

  async stats(sinceMs: number): Promise<InsightStats> {
    const row = await this.db.first<{
      analyzed: number;
      resolved: number;
      avg_score: number | null;
      negative: number;
    }>(
      `SELECT COUNT(*) as analyzed,
              SUM(CASE WHEN resolution = 'resolved' THEN 1 ELSE 0 END) as resolved,
              AVG(bot_score) as avg_score,
              SUM(CASE WHEN sentiment IN ('frustrated', 'angry') THEN 1 ELSE 0 END) as negative
       FROM conversation_insights WHERE analyzed_at > ?`,
      [sinceMs],
    );
    return {
      analyzed: row?.analyzed ?? 0,
      resolvedNoHuman: row?.resolved ?? 0,
      avgScore: row?.avg_score ?? null,
      negative: row?.negative ?? 0,
    };
  }

  /** KB radar: questions the bot couldn't answer, grouped by exact text. */
  async missedKb(sinceMs: number, limit = 10): Promise<{ question: string; n: number }[]> {
    return this.db.all<{ question: string; n: number }>(
      `SELECT missed_kb as question, COUNT(*) as n
       FROM conversation_insights
       WHERE missed_kb IS NOT NULL AND missed_kb != '' AND analyzed_at > ?
       GROUP BY missed_kb ORDER BY n DESC, MAX(analyzed_at) DESC LIMIT ?`,
      [sinceMs, limit],
    );
  }

  /** Open sales left on the table (recoverable customers). */
  async opportunities(sinceMs: number, limit = 10): Promise<InsightWithConversation[]> {
    return this.db.all<InsightWithConversation>(
      `SELECT i.*, c.display_name, c.channel_user_id, c.channel, c.last_message_at
       FROM conversation_insights i
       LEFT JOIN conversations c ON c.id = i.conversation_id
       WHERE i.sale_opportunity = 1 AND i.analyzed_at > ?
       ORDER BY i.analyzed_at DESC LIMIT ?`,
      [sinceMs, limit],
    );
  }
}
