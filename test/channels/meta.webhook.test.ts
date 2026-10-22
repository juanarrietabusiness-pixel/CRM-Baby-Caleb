import { describe, it, expect, vi } from "vitest";

// Igual que test/index.test.ts: `src/index.ts` re-exporta SupportAgent, que
// importa el SDK `agents` (necesita workerd). Lo mockeamos para quedarnos en
// Node y ejercitar solo el router de Hono.
vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../../src/index";
import { WEBHOOK_DIAG_KEY, type WebhookDiag } from "../../src/channels/webhookDiag";

const APP_SECRET = "fb-app-secret";
const IG_APP_SECRET = "ig-app-secret";

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

/** D1 de juguete: solo lo que usa SettingsRepo (SELECT / UPSERT en settings). */
function fakeDb() {
  const rows = new Map<string, string>();
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes("SELECT value FROM settings")) {
                const v = rows.get(String(params[0]));
                return v === undefined ? null : { value: v };
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO settings")) {
                rows.set(String(params[0]), String(params[1]));
              }
              return {};
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { d1, rows };
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
    META_APP_SECRET: APP_SECRET,
    DB: db.d1,
    AGENT: {
      idFromName: () => "do-id",
      get: () => ({ ingest }),
    },
    ...extra,
  } as any;
  return { env, ingest, rows: db.rows };
}

function igBody() {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "17841400000000000",
        messaging: [{ sender: { id: "99887766" }, recipient: { id: "178414" }, message: { mid: "m1", text: "hola, precio?" } }],
      },
    ],
  });
}

function pageBody() {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: "1122334455",
        messaging: [{ sender: { id: "55443322" }, recipient: { id: "112233" }, message: { mid: "m2", text: "buenas" } }],
      },
    ],
  });
}

async function post(env: any, body: string, signature?: string) {
  return worker.fetch(
    new Request("https://test/webhooks/meta", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-hub-signature-256": signature } : {}),
      },
      body,
    }),
    env,
    {} as any,
  );
}

function diagOf(rows: Map<string, string>): WebhookDiag {
  const raw = rows.get(WEBHOOK_DIAG_KEY);
  return raw ? (JSON.parse(raw) as WebhookDiag) : {};
}

describe("POST /webhooks/meta — Instagram vs Messenger", () => {
  it("encola un DM de Instagram firmado con el App Secret de Facebook", async () => {
    const { env, ingest, rows } = makeEnv();
    const body = igBody();
    const res = await post(env, body, await sign(body, APP_SECRET));
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0]).toMatchObject({ channel: "instagram", text: "hola, precio?" });
    expect(diagOf(rows)["meta:instagram"]).toMatchObject({ outcome: "ok", count: 1 });
  });

  it("acepta la firma del App Secret del producto Instagram (IG Login)", async () => {
    const { env, ingest } = makeEnv({ INSTAGRAM_APP_SECRET: IG_APP_SECRET });
    const body = igBody();
    const res = await post(env, body, await sign(body, IG_APP_SECRET));
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("rechaza y DEJA RASTRO cuando la firma de Instagram no cuadra con ningún secret", async () => {
    const { env, ingest, rows } = makeEnv();
    const body = igBody();
    const res = await post(env, body, await sign(body, IG_APP_SECRET)); // secret no configurado
    expect(res.status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
    expect(diagOf(rows)["meta:instagram"]).toMatchObject({ outcome: "firma_rechazada" });
  });

  it('IG_OFFICIAL="off" descarta Instagram y lo anota, sin tocar Messenger', async () => {
    const { env, ingest, rows } = makeEnv({ IG_OFFICIAL: "off" });
    const ig = igBody();
    expect((await post(env, ig, await sign(ig, APP_SECRET))).status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(diagOf(rows)["meta:instagram"]).toMatchObject({ outcome: "ignorado" });

    const page = pageBody();
    expect((await post(env, page, await sign(page, APP_SECRET))).status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(diagOf(rows)["meta:page"]).toMatchObject({ outcome: "ok" });
  });

  it('IG_DM_SOURCE="manychat" descarta el DM oficial y lo anota', async () => {
    const { env, ingest, rows } = makeEnv({ IG_DM_SOURCE: "manychat" });
    const body = igBody();
    expect((await post(env, body, await sign(body, APP_SECRET))).status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(diagOf(rows)["meta:instagram"]).toMatchObject({ outcome: "ignorado" });
  });

  it("anota los eventos sin contenido (echoes, recibos) sin encolar nada", async () => {
    const { env, ingest, rows } = makeEnv();
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "1", messaging: [{ sender: { id: "9" }, message: { mid: "m", text: "eco", is_echo: true } }] }],
    });
    expect((await post(env, body, await sign(body, APP_SECRET))).status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(diagOf(rows)["meta:instagram"]).toMatchObject({ outcome: "sin_mensaje" });
  });
});
