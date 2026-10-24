import { describe, it, expect, vi } from "vitest";

vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../../src/index";
import { metaAdapter } from "../../src/channels/meta";
import { rutaDe } from "../../src/channels/metaRuta";

const SECRET_PAGE = "fb-app-secret";
const SECRET_IG = "ig-app-secret";

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** D1 de juguete con las tablas que tocan estas pruebas. */
function fakeDb() {
  const settings = new Map<string, string>();
  const seen = new Map<string, number>();
  const rutas = new Map<string, string>();
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...p: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM settings")) {
                const v = settings.get(String(p[0]));
                return v === undefined ? null : { value: v };
              }
              if (sql.includes("FROM meta_seen")) {
                return seen.has(String(p[0])) ? { mid: String(p[0]) } : null;
              }
              if (sql.includes("FROM meta_ruta")) {
                const r = rutas.get(String(p[0]));
                return r === undefined ? null : { ruta: r };
              }
              return null;
            },
            async run() {
              if (sql.includes("INTO settings")) settings.set(String(p[0]), String(p[1]));
              if (sql.includes("INTO meta_seen")) seen.set(String(p[0]), Number(p[1]));
              if (sql.includes("INTO meta_ruta")) rutas.set(String(p[0]), String(p[1]));
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { d1, rutas, seen };
}

function makeEnv(extra: Record<string, unknown> = {}) {
  const ingest = vi.fn().mockResolvedValue(undefined);
  const db = fakeDb();
  const env = {
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "https://test.workers.dev",
    META_APP_SECRET: SECRET_PAGE,
    DB: db.d1,
    AGENT: { idFromName: () => "do", get: () => ({ ingest }) },
    ...extra,
  } as any;
  return { env, ingest, ...db };
}

function dm(mid: string, sender = "99887766") {
  return JSON.stringify({
    object: "instagram",
    entry: [{ id: "17841471553036144", messaging: [{ sender: { id: sender }, message: { mid, text: "hola" } }] }],
  });
}

async function post(env: any, body: string, secret: string) {
  return worker.fetch(
    new Request("https://test/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": await sign(body, secret) },
      body,
    }),
    env,
    {} as any,
  );
}

describe("Las dos rutas de Instagram conviviendo", () => {
  it("acepta los secrets de IG Login con el nombre META_IG_APP_SECRET", async () => {
    const { env, ingest } = makeEnv({ META_IG_APP_SECRET: SECRET_IG });
    const res = await post(env, dm("m1"), SECRET_IG);
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("anota la ruta según QUÉ secret validó la firma", async () => {
    const { env } = makeEnv({ INSTAGRAM_APP_SECRET: SECRET_IG });
    await post(env, dm("m1", "111"), SECRET_IG);
    expect(await rutaDe(env, "111")).toBe("ig");

    await post(env, dm("m2", "222"), SECRET_PAGE);
    expect(await rutaDe(env, "222")).toBe("page");
  });

  it("el mismo mid por las dos rutas se procesa UNA sola vez", async () => {
    const { env, ingest } = makeEnv({ INSTAGRAM_APP_SECRET: SECRET_IG });
    await post(env, dm("mismo-mid"), SECRET_IG);
    await post(env, dm("mismo-mid"), SECRET_PAGE); // el duplicado de la otra ruta
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("sin los secrets nuevos, todo sigue como antes", async () => {
    const { env, ingest } = makeEnv(); // solo META_APP_SECRET
    expect((await post(env, dm("m1"), SECRET_PAGE)).status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    // Y una firma de IG Login sin su secret configurado se sigue rechazando.
    expect((await post(env, dm("m2"), SECRET_IG)).status).toBe(403);
  });
});

describe("metaAdapter responde por la ruta por la que entró", () => {
  const calls: string[] = [];

  function stubFetch() {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify(String(url).includes("fields=user_id") ? { user_id: "178414" } : { message_id: "m" }),
          { status: 200 },
        );
      }),
    );
  }

  it("ruta ig → graph.instagram.com, con el token de IG Login", async () => {
    const { env, rutas } = makeEnv({ META_IG_ACCESS_TOKEN: "IGAA-token", META_PAGE_ACCESS_TOKEN: "page-token" });
    rutas.set("777", "ig");
    stubFetch();
    await metaAdapter.sendReply({ channel: "instagram", channelUserId: "777", chunks: ["hola"] }, env);
    expect(calls.find((u) => u.includes("/messages"))).toContain("graph.instagram.com");
    vi.unstubAllGlobals();
  });

  it("ruta page → graph.facebook.com AUNQUE exista el token de Instagram", async () => {
    const { env, rutas } = makeEnv({ META_IG_ACCESS_TOKEN: "IGAA-token", META_PAGE_ACCESS_TOKEN: "page-token" });
    rutas.set("888", "page");
    stubFetch();
    await metaAdapter.sendReply({ channel: "instagram", channelUserId: "888", chunks: ["hola"] }, env);
    expect(calls[0]).toContain("graph.facebook.com");
    vi.unstubAllGlobals();
  });

  it("sin ruta anotada, prefiere Instagram Login si hay token suyo", async () => {
    const { env } = makeEnv({ META_IG_ACCESS_TOKEN: "IGAA-token", META_PAGE_ACCESS_TOKEN: "page-token" });
    stubFetch();
    await metaAdapter.sendReply({ channel: "instagram", channelUserId: "999", chunks: ["hola"] }, env);
    expect(calls.find((u) => u.includes("/messages"))).toContain("graph.instagram.com");
    vi.unstubAllGlobals();
  });

  it("Messenger no se toca: siempre por la Página", async () => {
    const { env } = makeEnv({ META_IG_ACCESS_TOKEN: "IGAA-token", META_PAGE_ACCESS_TOKEN: "page-token" });
    stubFetch();
    await metaAdapter.sendReply({ channel: "messenger", channelUserId: "555", chunks: ["hola"] }, env);
    expect(calls[0]).toContain("graph.facebook.com");
    vi.unstubAllGlobals();
  });
});
