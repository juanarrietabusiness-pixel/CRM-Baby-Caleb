import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { AdminEmailsRepo } from "../../src/db/adminEmails";

let repo: AdminEmailsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new AdminEmailsRepo(new Db(d1 as any));
});

describe("AdminEmailsRepo", () => {
  it("add + isAuthorized works case-insensitively", async () => {
    await repo.add("Hugo@Example.com");
    expect(await repo.isAuthorized("hugo@example.com")).toBe(true);
    expect(await repo.isAuthorized("HUGO@EXAMPLE.COM")).toBe(true);
    expect(await repo.isAuthorized("other@x.com")).toBe(false);
  });
  it("remove takes the email out", async () => {
    await repo.add("h@x.com");
    await repo.remove("h@x.com");
    expect(await repo.isAuthorized("h@x.com")).toBe(false);
  });
});
