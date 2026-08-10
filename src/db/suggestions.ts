import { Db } from "./client";

export type SuggestionKind = "kb_entry" | "leccion";
export type SuggestionStatus = "proposed" | "applied" | "dismissed";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  fingerprint: string;
  title: string;
  payload: string; // JSON
  evidence: string | null;
  status: SuggestionStatus;
  created_at: number;
  applied_at: number | null;
}

export interface CreateSuggestionInput {
  kind: SuggestionKind;
  /** Dedupe key within the kind (question text, conversation id, …). */
  fingerprint: string;
  title: string;
  payload: unknown;
  evidence: string;
}

export class SuggestionsRepo {
  constructor(private readonly db: Db) {}

  /** Insert unless an equal (kind, fingerprint) exists in ANY status. */
  async createIfNew(input: CreateSuggestionInput): Promise<string | null> {
    if (await this.exists(input.kind, input.fingerprint)) return null;
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO improvement_suggestions (id, kind, fingerprint, title, payload, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.kind, input.fingerprint, input.title, JSON.stringify(input.payload), input.evidence, Date.now()],
    );
    return id;
  }

  async exists(kind: SuggestionKind, fingerprint: string): Promise<boolean> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM improvement_suggestions WHERE kind = ? AND fingerprint = ?",
      [kind, fingerprint],
    );
    return (row?.n ?? 0) > 0;
  }

  async getById(id: string): Promise<Suggestion | null> {
    return this.db.first<Suggestion>("SELECT * FROM improvement_suggestions WHERE id = ?", [id]);
  }

  async listProposed(): Promise<Suggestion[]> {
    return this.db.all<Suggestion>(
      "SELECT * FROM improvement_suggestions WHERE status = 'proposed' ORDER BY created_at DESC",
    );
  }

  async listHandled(limit = 10): Promise<Suggestion[]> {
    return this.db.all<Suggestion>(
      "SELECT * FROM improvement_suggestions WHERE status != 'proposed' ORDER BY COALESCE(applied_at, created_at) DESC LIMIT ?",
      [limit],
    );
  }

  async setStatus(id: string, status: SuggestionStatus): Promise<void> {
    await this.db.run(
      "UPDATE improvement_suggestions SET status = ?, applied_at = ? WHERE id = ?",
      [status, status === "proposed" ? null : Date.now(), id],
    );
  }
}
