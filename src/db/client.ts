export class Db {
  constructor(public readonly d1: D1Database) {}

  async run(sql: string, params: unknown[] = []): Promise<D1Result> {
    return this.d1.prepare(sql).bind(...params).run();
  }

  async first<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.d1.prepare(sql).bind(...params).first()) as T | null;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.d1.prepare(sql).bind(...params).all();
    return res.results as T[];
  }
}
