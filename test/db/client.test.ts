import { describe, it, expect } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";

describe("Db client", () => {
  it("instantiates with a D1 binding", async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    const db = new Db(d1 as any);
    expect(db).toBeDefined();
  });
});
