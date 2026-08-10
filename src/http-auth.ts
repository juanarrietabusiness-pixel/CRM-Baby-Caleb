import type { Env } from "./env";

/** Constant-time-ish comparison to avoid leaking the token via timing. */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fail-closed Bearer auth for the control-plane `/api/*` endpoints.
 *
 * Passes ONLY when CONTROL_PLANE_TOKEN is configured AND the request carries a
 * matching `Authorization: Bearer <token>` (constant-time compare via
 * tokensMatch). If the token is unset, the header is missing/malformed, or it
 * mismatches → returns false (the caller answers 401).
 */
export function requireControlPlane(req: Request, env: Env): boolean {
  const expected = env.CONTROL_PLANE_TOKEN?.trim();
  if (!expected) return false; // fail-closed: no token configured → nothing is allowed in
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return tokensMatch(match[1].trim(), expected);
}
