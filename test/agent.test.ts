import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";

let mf: Awaited<ReturnType<typeof createTestMiniflare>>;

beforeEach(async () => {
  mf = await createTestMiniflare();
});

describe("SupportAgent", () => {
  it("instantiates a DO per (channel, user_id)", async () => {
    // createTestMiniflare returns the raw Miniflare instance; bindings are
    // accessed via getBindings() (it has no `.bindings` property).
    const bindings = (await mf.getBindings()) as Record<string, any>;
    const ns = bindings.AGENT as any;
    const id1 = ns.idFromName("telegram:user_1");
    const id2 = ns.idFromName("telegram:user_2");
    const id3 = ns.idFromName("telegram:user_1");
    expect(id1.toString()).toBe(id3.toString());
    expect(id1.toString()).not.toBe(id2.toString());
  });
});
