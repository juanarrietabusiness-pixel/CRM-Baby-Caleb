import { Db } from "./client";

const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface MagicLink {
  token: string;
  email: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class MagicLinksRepo {
  constructor(private readonly db: Db) {}

  async create(email: string): Promise<string> {
    const token = newToken();
    const now = Date.now();
    await this.db.run(
      "INSERT INTO magic_links (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
      [token, email.toLowerCase(), now, now + TOKEN_TTL_MS],
    );
    return token;
  }

  async consume(token: string): Promise<MagicLink | null> {
    const link = await this.db.first<MagicLink>(
      "SELECT * FROM magic_links WHERE token = ?",
      [token],
    );
    if (!link || link.used_at !== null) return null;
    if (link.expires_at < Date.now()) return null;
    await this.db.run("UPDATE magic_links SET used_at = ? WHERE token = ?", [Date.now(), token]);
    return link;
  }

  async purgeExpired(): Promise<number> {
    const res = await this.db.run(
      "DELETE FROM magic_links WHERE expires_at < ? OR used_at IS NOT NULL",
      [Date.now()],
    );
    return res.meta.changes ?? 0;
  }
}
