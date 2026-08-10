/**
 * Tests del setup de la plantilla HSM del handoff: crea vía Content API
 * (fetch stubbeado), somete aprobación UTILITY, guarda el SID en settings, y
 * el endpoint de status lo consulta. D1 real via miniflare.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = {
  Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`,
};

let env: Env;
let settings: SettingsRepo;
const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "tok",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  settings = new SettingsRepo(new Db(d1));
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /handoff/template/setup", () => {
  it("crea la plantilla, la somete a aprobación UTILITY y guarda el SID", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: "HXhandoff123" }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "received" }), { status: 201 }),
      );

    const res = await adminApp.request(
      "/handoff/template/setup",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sid: string; approval: string; name: string; body: string };
    expect(json.sid).toBe("HXhandoff123");
    expect(json.approval).toBe("received");
    // Devuelve nombre y cuerpo para confirmar QUÉ se sometió (el cuerpo no
    // puede terminar en variable — Meta lo rechaza).
    expect(json.name).toBe("handoff_aviso_dueno_v2");
    expect(json.body.trim().endsWith("de tu bot.")).toBe(true);
    expect(await settings.get(SETTING_KEYS.twilioHandoffContentSid)).toBe("HXhandoff123");

    // La creación llevó el contrato correcto: es_MX + las 3 variables del código.
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(createBody.language).toBe("es_MX");
    expect(createBody.types["twilio/text"].body).toContain("{{1}}");
    expect(createBody.types["twilio/text"].body).toContain("{{3}}");
    // La aprobación fue UTILITY (no marketing).
    const apprBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(apprBody.category).toBe("UTILITY");
  });

  it("propaga errores de la Content API sin guardar nada", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 20003 }), { status: 401 }),
    );
    const res = await adminApp.request(
      "/handoff/template/setup",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(502);
    expect(await settings.get(SETTING_KEYS.twilioHandoffContentSid)).toBeNull();
  });
});

describe("GET /handoff/template/status", () => {
  it("404 sin plantilla configurada", async () => {
    const res = await adminApp.request("/handoff/template/status", { headers: AUTH }, env);
    expect(res.status).toBe(404);
  });

  it("consulta el estado de aprobación con el SID guardado", async () => {
    await settings.set(SETTING_KEYS.twilioHandoffContentSid, "HXabc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 }),
    );
    const res = await adminApp.request("/handoff/template/status", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sid: string; status: string };
    expect(data.sid).toBe("HXabc");
    expect(data.status).toBe("approved");
  });
});
