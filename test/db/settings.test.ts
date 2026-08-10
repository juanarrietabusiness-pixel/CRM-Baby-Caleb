import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";

let repo: SettingsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new SettingsRepo(new Db(d1 as any));
});

describe("SettingsRepo", () => {
  it("get returns null for an unset key", async () => {
    expect(await repo.get(SETTING_KEYS.tone)).toBeNull();
  });

  it("set then get round-trips a value", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    expect(await repo.get(SETTING_KEYS.botName)).toBe("Pelusa");
  });

  it("set upserts (second set overwrites, no duplicate row)", async () => {
    await repo.set(SETTING_KEYS.tone, "cálido y cercano");
    await repo.set(SETTING_KEYS.tone, "formal y profesional");
    expect(await repo.get(SETTING_KEYS.tone)).toBe("formal y profesional");
    const all = await repo.all();
    // exactly one key present
    expect(Object.keys(all)).toEqual([SETTING_KEYS.tone]);
  });

  it("all returns a Record of every stored key/value", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    await repo.set(SETTING_KEYS.bufferSeconds, "5");
    await repo.set(SETTING_KEYS.botPaused, "1");
    const all = await repo.all();
    expect(all).toEqual({
      [SETTING_KEYS.botName]: "Pelusa",
      [SETTING_KEYS.bufferSeconds]: "5",
      [SETTING_KEYS.botPaused]: "1",
    });
  });

  it("all returns an empty object when nothing is set", async () => {
    expect(await repo.all()).toEqual({});
  });
});
