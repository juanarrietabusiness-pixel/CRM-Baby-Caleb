import { describe, it, expect } from "vitest";
import { parsePeerBots } from "../../src/admin/projects";
import type { Env } from "../../src/env";

const env = (raw?: string) => ({ PEER_BOTS: raw }) as Env;

describe("parsePeerBots", () => {
  it("parsea la lista válida", () => {
    const peers = parsePeerBots(
      env('[{"name":"Bot A","url":"https://a.dev/admin"},{"name":"B","url":"https://b.dev/admin"}]'),
    );
    expect(peers).toHaveLength(2);
    expect(peers[0]).toEqual({ name: "Bot A", url: "https://a.dev/admin" });
  });

  it("vacío/ausente/JSON roto/no-array → []", () => {
    expect(parsePeerBots(env())).toEqual([]);
    expect(parsePeerBots(env(""))).toEqual([]);
    expect(parsePeerBots(env("{no json"))).toEqual([]);
    expect(parsePeerBots(env('{"name":"x"}'))).toEqual([]);
  });

  it("filtra entradas sin url http(s)", () => {
    expect(
      parsePeerBots(env('[{"name":"mala","url":"javascript:alert(1)"},{"name":"ok","url":"https://x.dev"}]')),
    ).toEqual([{ name: "ok", url: "https://x.dev" }]);
  });
});
