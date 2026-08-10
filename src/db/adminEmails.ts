import { Db } from "./client";

export interface AdminEmail {
  email: string;
  role: "owner" | "staff";
  added_at: number;
}

export class AdminEmailsRepo {
  constructor(private readonly db: Db) {}

  async add(email: string, role: "owner" | "staff" = "owner"): Promise<void> {
    await this.db.run(
      "INSERT OR REPLACE INTO admin_emails (email, role, added_at) VALUES (?, ?, ?)",
      [email.toLowerCase(), role, Date.now()],
    );
  }

  async isAuthorized(email: string): Promise<boolean> {
    const row = await this.db.first("SELECT email FROM admin_emails WHERE email = ?", [email.toLowerCase()]);
    return row !== null;
  }

  async list(): Promise<AdminEmail[]> {
    return this.db.all<AdminEmail>("SELECT * FROM admin_emails ORDER BY added_at");
  }

  async remove(email: string): Promise<void> {
    await this.db.run("DELETE FROM admin_emails WHERE email = ?", [email.toLowerCase()]);
  }
}
