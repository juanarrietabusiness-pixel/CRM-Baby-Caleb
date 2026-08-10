/**
 * Admin dashboard authentication — HTTP Basic Auth.
 *
 * El acceso normal al panel es la pantalla de `/admin/login` con cookie de
 * sesión (ver `session.ts`). Este módulo se queda para el **acceso de
 * emergencia** por `Authorization: Basic` (usuario "admin", contraseña en el
 * secreto `DASHBOARD_PASSWORD`), que el guard sigue aceptando para que un
 * problema con la cookie no deje a nadie fuera del panel.
 *
 * Sigue sin haber usuarios, magic links ni flujos por correo.
 */
import { basicAuth } from "hono/basic-auth";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";

/** Fixed username for the admin dashboard. */
export const ADMIN_USERNAME = "admin";

/**
 * Hono middleware factory enforcing HTTP Basic Auth on admin routes.
 * Mount it on the `/admin/*` group, e.g. `app.use("/admin/*", adminAuth(env))`.
 */
export function adminAuth(env: Env): MiddlewareHandler {
  return basicAuth({
    username: ADMIN_USERNAME,
    password: env.DASHBOARD_PASSWORD,
  });
}

/**
 * Constant-time string comparison to avoid leaking length/content via timing.
 * Returns true only when both strings are byte-for-byte identical.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Fold the length mismatch into the result while still iterating over the
  // longer of the two to keep timing stable.
  let diff = ab.length ^ bb.length;
  const max = Math.max(ab.length, bb.length);
  for (let i = 0; i < max; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** Decode a base64 string in both Worker (atob) and Node/test (Buffer) runtimes. */
function decodeBase64(input: string): string | null {
  try {
    if (typeof atob === "function") {
      return atob(input);
    }
    return Buffer.from(input, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Pure credential check for an HTTP `Authorization` header value.
 *
 * Accepts a value like `Basic YWRtaW46c2VjcmV0MTIz` and returns true only when
 * it decodes to `admin:<DASHBOARD_PASSWORD>`. Has no Hono dependency so it can
 * be unit-tested directly.
 *
 * @param headerValue the raw `Authorization` header value (may be undefined/null)
 * @param env         environment carrying `DASHBOARD_PASSWORD`
 */
export function checkBasicCredentials(
  headerValue: string | null | undefined,
  env: Env,
): boolean {
  if (!headerValue) return false;

  const match = /^Basic\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return false;

  const decoded = decodeBase64(match[1].trim());
  if (decoded === null) return false;

  // Split only on the FIRST colon: passwords may legitimately contain colons.
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  const userOk = timingSafeEqual(username, ADMIN_USERNAME);
  const passOk = timingSafeEqual(password, env.DASHBOARD_PASSWORD ?? "");
  return userOk && passOk;
}
