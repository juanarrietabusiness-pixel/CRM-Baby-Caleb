import { Db } from "./client";

export interface CustomerFact {
  conversation_id: string;
  fact: string;
  learned_at: number;
}

/**
 * Per-customer memory. Conversation ids are stable (`channel:userId`), so the
 * facts naturally follow the same customer across visits on that channel.
 */
export class CustomerFactsRepo {
  constructor(private readonly db: Db) {}

  async addMany(conversationId: string, facts: string[]): Promise<void> {
    const now = Date.now();
    for (const raw of facts) {
      const fact = raw.trim().slice(0, 300);
      if (!fact) continue;
      await this.db.run(
        "INSERT OR IGNORE INTO customer_facts (conversation_id, fact, learned_at) VALUES (?, ?, ?)",
        [conversationId, fact, now],
      );
    }
  }

  async forConversation(conversationId: string, limit = 8): Promise<CustomerFact[]> {
    return this.db.all<CustomerFact>(
      "SELECT * FROM customer_facts WHERE conversation_id = ? ORDER BY learned_at DESC LIMIT ?",
      [conversationId, limit],
    );
  }
}
