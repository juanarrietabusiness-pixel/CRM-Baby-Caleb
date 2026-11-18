import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import {
  anotarFalloLlm,
  describirError,
  haceCuanto,
  leerFalloLlm,
  secretosDelEntorno,
} from "../../src/llm/ultimoFallo";
import type { Env } from "../../src/env";

const META = "llave-de-meta-0000000000000000";
const AUTH = { Authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}` };

describe("describirError", () => {
  it("lleva el código HTTP, el mensaje y el cuerpo que devolvió el proveedor", () => {
    const e = Object.assign(new Error("Bad Request"), {
      statusCode: 400,
      responseBody: '{"error":{"message":"tools.0: Extra inputs are not permitted"}}',
    });
    const t = describirError(e);
    expect(t).toContain("HTTP 400");
    expect(t).toContain("Bad Request");
    expect(t).toContain("Extra inputs are not permitted");
  });

  it("tapa las llaves del entorno y cualquier cosa con forma de llave", () => {
    const e = new Error(`Incorrect API key: ${META} y también sk-ant-api03-abcdefghijklmnop`);
    const t = describirError(e, [META]);
    expect(t).not.toContain(META);
    expect(t).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(t).toContain("***");
  });

  it("recorta lo larguísimo", () => {
    const t = describirError(new Error("x".repeat(5000)));
    expect(t.length).toBeLessThanOrEqual(501);
    expect(t.endsWith("…")).toBe(true);
  });

  it("no revienta con lo que no es un Error", () => {
    expect(describirError("se cayó")).toBe("se cayó");
    expect(describirError(undefined)).toBe("undefined");
  });

  it("secretosDelEntorno junta todas las llaves de IA", () => {
    const s = secretosDelEntorno({ META_API_KEY: "m", ANTHROPIC_API_KEY: "a", XAI_API_KEY: "x" } as Env, "guardada");
    expect(s).toEqual(expect.arrayContaining(["m", "a", "x", "guardada"]));
  });
});

describe("haceCuanto", () => {
  const ahora = 1_000_000_000_000;
  it.each([
    [0, "hace un momento"],
    [5 * 60_000, "hace 5 min"],
    [3 * 3_600_000, "hace 3 h"],
    [72 * 3_600_000, "hace 3 días"],
  ])("%i ms atrás → %s", (atras, texto) => {
    expect(haceCuanto(ahora - atras, ahora)).toBe(texto);
  });
});

describe("leerFalloLlm", () => {
  it("devuelve null sin nada o con basura", () => {
    expect(leerFalloLlm({})).toBeNull();
    expect(leerFalloLlm({ [SETTING_KEYS.ultimoFalloLlm]: "no es json" })).toBeNull();
    expect(leerFalloLlm({ [SETTING_KEYS.ultimoFalloLlm]: '{"cuando":"ayer"}' })).toBeNull();
  });
});

describe("el fallo se guarda y Config lo muestra", () => {
  let env: Env;
  let settings: SettingsRepo;

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    const d1 = (await mf.getD1Database("DB")) as any;
    env = {
      DB: d1,
      BOT_NAME: "TestBot",
      BUSINESS_NAME: "Negocio de Prueba",
      BOT_TIER: "pro",
      BUFFER_SECONDS: "8",
      DASHBOARD_PASSWORD: "secret123",
    } as unknown as Env;
    settings = new SettingsRepo(new Db(d1));
  });

  it("anotarFalloLlm lo guarda y leerFalloLlm lo recupera", async () => {
    await anotarFalloLlm(env, {
      cuando: Date.now(),
      proveedor: "meta",
      modelo: "muse-spark-1.2-contributor",
      mensaje: "HTTP 400 — tools.0: Extra inputs are not permitted",
      recuperado: false,
    });
    const f = leerFalloLlm(await settings.all());
    expect(f?.proveedor).toBe("meta");
    expect(f?.mensaje).toContain("Extra inputs");
    expect(f?.recuperado).toBe(false);
  });

  it("Config muestra el error real, la hora y qué recibió la clienta", async () => {
    await anotarFalloLlm(env, {
      cuando: Date.now() - 5 * 60_000,
      proveedor: "meta",
      modelo: "muse-spark-1.2-contributor",
      mensaje: "HTTP 400 — tools.0: Extra inputs are not permitted",
      recuperado: false,
    });
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("Último fallo real del bot");
    expect(html).toContain("hace 5 min");
    expect(html).toContain("meta/muse-spark-1.2-contributor");
    expect(html).toContain("Extra inputs are not permitted");
    expect(html).toContain("Algo falló de mi lado");
  });

  it("si el modelo de respaldo contestó, lo dice", async () => {
    await anotarFalloLlm(env, {
      cuando: Date.now(),
      proveedor: "meta",
      modelo: "muse-spark-1.3",
      mensaje: "HTTP 500",
      recuperado: true,
      respaldo: "claude-haiku-4-5-20251001",
    });
    const html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).toContain("modelo de respaldo (claude-haiku-4-5-20251001)");
  });

  it("no muestra un fallo de hace más de dos días, ni HTML suelto del mensaje", async () => {
    await anotarFalloLlm(env, {
      cuando: Date.now() - 72 * 3_600_000,
      proveedor: "meta",
      modelo: "m",
      mensaje: "viejo",
      recuperado: false,
    });
    let html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).not.toContain("Último fallo real del bot");

    await anotarFalloLlm(env, {
      cuando: Date.now(),
      proveedor: "meta",
      modelo: "m",
      mensaje: "<script>alert(1)</script>",
      recuperado: false,
    });
    html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
