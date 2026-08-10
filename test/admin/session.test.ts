/**
 * Cookie de sesión firmada + la cascada del guard de /admin.
 *
 * Lo que se protege aquí no es "que la firma sea bonita", sino las cuatro
 * formas de quedarse fuera del panel o de entrar sin permiso: cookie
 * manipulada, cookie caducada, DASHBOARD_PUBLIC y el acceso de emergencia por
 * Basic Auth.
 */
import { describe, it, expect } from "vitest";
import {
  createSession,
  verifySession,
  readSessionCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from "../../src/admin/session";
import { adminApp } from "../../src/admin/routes";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const baseEnv = { DASHBOARD_PASSWORD: PASSWORD } as unknown as Env;

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("session — firma y vigencia", () => {
  it("acepta una cookie recién emitida", async () => {
    const v = await createSession(PASSWORD);
    expect(await verifySession(PASSWORD, v)).toBe(true);
  });

  it("rechaza una cookie manipulada", async () => {
    const v = await createSession(PASSWORD);
    const [payload, sig] = v.split(".");
    // Payload cambiado, firma vieja.
    const forgedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 9e9 }))
      .toString("base64url");
    expect(await verifySession(PASSWORD, `${forgedPayload}.${sig}`)).toBe(false);
    // Firma cambiada, payload bueno.
    expect(await verifySession(PASSWORD, `${payload}.${"A".repeat(sig.length)}`)).toBe(false);
  });

  it("rechaza una cookie caducada", async () => {
    const v = await createSession(PASSWORD, -1000); // ya nació vencida
    expect(await verifySession(PASSWORD, v)).toBe(false);
  });

  it("rechaza si la contraseña cambió — rotarla cierra las sesiones", async () => {
    const v = await createSession(PASSWORD);
    expect(await verifySession("otra-contraseña", v)).toBe(false);
  });

  it("falla cerrado sin contraseña o sin cookie", async () => {
    const v = await createSession(PASSWORD);
    expect(await verifySession(undefined, v)).toBe(false);
    expect(await verifySession(PASSWORD, undefined)).toBe(false);
    expect(await verifySession(PASSWORD, "sin-punto")).toBe(false);
    expect(await verifySession(PASSWORD, ".")).toBe(false);
  });
});

describe("session — cabeceras", () => {
  it("marca Secure solo en https", () => {
    expect(sessionCookieHeader("v", "https://x.workers.dev/admin/login")).toContain("; Secure");
    // pnpm dev corre en http: con Secure siempre, nunca se podría entrar en local.
    expect(sessionCookieHeader("v", "http://localhost:8787/admin/login")).not.toContain("Secure");
  });

  it("es HttpOnly, SameSite=Lax y vive bajo /admin", () => {
    const h = sessionCookieHeader("v", "https://x.dev/admin");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
    expect(h).toContain("Path=/admin");
  });

  it("el logout vence la cookie", () => {
    expect(clearSessionCookieHeader("https://x.dev/admin")).toContain("Max-Age=0");
  });

  it("lee la cookie entre otras", () => {
    expect(readSessionCookie(`a=1; ${SESSION_COOKIE}=abc.def; b=2`)).toBe("abc.def");
    expect(readSessionCookie("a=1; b=2")).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
  });
});

describe("guard de /admin", () => {
  it("sin sesión redirige al login en vez de pedir Basic Auth", async () => {
    // Se prueba contra /projects, que va detrás del guard pero no toca D1: así
    // el test falla por el guard y no por el render de una vista.
    const res = await adminApp.request("/projects", {}, baseEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    // La ventana gris del navegador aparecía por esta cabecera: ya no va.
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("el login se sirve sin sesión y no entra en bucle", async () => {
    const res = await adminApp.request("/login", {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="password"');
  });

  it("contraseña correcta emite cookie y entra", async () => {
    const body = new FormData();
    body.set("password", PASSWORD);
    const res = await adminApp.request("/login", { method: "POST", body }, baseEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    const value = readSessionCookie(setCookie.split(";")[0]);
    expect(await verifySession(PASSWORD, value)).toBe(true);
  });

  it("contraseña incorrecta re-muestra el formulario con el error", async () => {
    const body = new FormData();
    body.set("password", "no-es-esta");
    const res = await adminApp.request("/login", { method: "POST", body }, baseEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toContain("Esa contraseña no es");
  });

  it("una cookie válida abre el panel", async () => {
    const v = await createSession(PASSWORD);
    const res = await adminApp.request(
      "/projects",
      { headers: { cookie: `${SESSION_COOKIE}=${v}` } },
      baseEnv,
    );
    expect(res.status).toBe(200);
  });

  it("una cookie manipulada NO abre el panel", async () => {
    const res = await adminApp.request(
      "/projects",
      { headers: { cookie: `${SESSION_COOKIE}=falsa.firma` } },
      baseEnv,
    );
    expect(res.status).toBe(302);
  });

  it("el acceso de emergencia por Basic Auth sigue funcionando", async () => {
    const res = await adminApp.request(
      "/projects",
      { headers: { authorization: basic("admin", PASSWORD) } },
      baseEnv,
    );
    expect(res.status).toBe(200);
  });

  it("DASHBOARD_PUBLIC=1 sigue dejando el panel abierto", async () => {
    const env = { ...baseEnv, DASHBOARD_PUBLIC: "1" } as unknown as Env;
    const res = await adminApp.request("/projects", {}, env);
    expect(res.status).toBe(200);
  });

  it("logout borra la cookie y manda al login", async () => {
    const res = await adminApp.request("/logout", { method: "POST" }, baseEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("con sesión, /login manda al panel en vez de repreguntar", async () => {
    const v = await createSession(PASSWORD);
    const res = await adminApp.request(
      "/login",
      { headers: { cookie: `${SESSION_COOKIE}=${v}` } },
      baseEnv,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
  });
});
