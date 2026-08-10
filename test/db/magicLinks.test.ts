import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { MagicLinksRepo } from "../../src/db/magicLinks";

let repo: MagicLinksRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new MagicLinksRepo(new Db(d1 as any));
});

describe("MagicLinksRepo", () => {
  it("create returns a token; consume returns the row once", async () => {
    const token = await repo.create("hugo@x.com");
    const link = await repo.consume(token);
    expect(link?.email).toBe("hugo@x.com");
    const replay = await repo.consume(token);
    expect(replay).toBeNull();
  });

  it("consume rejects unknown tokens", async () => {
    expect(await repo.consume("nonexistent")).toBeNull();
  });

  it("purgeExpired clears used + expired", async () => {
    const t = await repo.create("a@x.com");
    await repo.consume(t);
    const cleaned = await repo.purgeExpired();
    expect(cleaned).toBeGreaterThanOrEqual(1);
  });
});
