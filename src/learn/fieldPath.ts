// Universal webhook field extraction + learning helpers.
//
// These are pure functions (no D1, no network). The "learn mode" lets the bot
// observe a real payload from ANY app (ManyChat IG/Messenger/WhatsApp, n8n,
// Make, custom webhooks) and self-configure where each field lives, instead of
// hardcoding one app's contract.

/**
 * Extract a value from a nested object using a dot/bracket path.
 *
 * Supports:
 *   - dot segments:        "body.id"
 *   - array index segments: "attachments.0.payload.url"
 *   - bracket notation:     "attachments[0].payload[url]" / "body['id']"
 *
 * Returns `undefined` when any segment along the path is missing or the
 * traversal hits a non-object (null/undefined/primitive) before the end.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null || typeof path !== "string" || path.length === 0) {
    return undefined;
  }
  const segments = toSegments(path);
  if (segments.length === 0) return undefined;

  let current: unknown = obj;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (typeof current !== "object") return undefined;
    // Arrays and plain objects both index by string/number key here.
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Recursively search `obj` (DFS) for the FIRST path whose value equals
 * `targetValue`. Comparison is done as trimmed strings so numeric ids match
 * regardless of whether the payload stored them as number or string.
 *
 * Returns the dot/bracket path (e.g. "attachments.0.payload.url") or
 * `undefined` if no match is found.
 */
export function inferPath(obj: unknown, targetValue: unknown): string | undefined {
  if (targetValue == null) return undefined;
  const target = normalize(targetValue);
  // An empty/whitespace-only target would match too many things; bail out.
  if (target === "") return undefined;
  return dfs(obj, target, []);
}

function dfs(node: unknown, target: string, trail: string[]): string | undefined {
  if (node == null) return undefined;

  // Leaf comparison (string | number | boolean).
  if (typeof node !== "object") {
    if (normalize(node) === target) return trail.join(".");
    return undefined;
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const found = dfs(node[i], target, [...trail, String(i)]);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const key of Object.keys(node as Record<string, unknown>)) {
    const found = dfs((node as Record<string, unknown>)[key], target, [...trail, key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

const AUDIO_EXT = [".mp3", ".ogg", ".m4a", ".wav"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * Heuristically classify the dominant media kind of a payload.
 *
 * Strategy:
 *   1. Look at any attachment `type` fields ("audio" / "image").
 *   2. Otherwise scan every string value for a recognizable media URL/extension.
 *   3. Fall back to "text".
 *
 * Audio wins over image when both are present (a voice note that also carries a
 * thumbnail should still be transcribed as audio).
 */
export function detectKind(payload: unknown): "audio" | "image" | "text" {
  let sawAudio = false;
  let sawImage = false;

  walk(payload, (value, key) => {
    if (typeof value !== "string") return;
    const v = value.toLowerCase();

    // Attachment type markers: { type: "audio" } / { type: "image" }.
    if (key === "type") {
      if (v === "audio" || v === "voice") sawAudio = true;
      else if (v === "image" || v === "photo") sawImage = true;
    }

    // URL / filename extension sniffing (ignore querystrings/fragments).
    const clean = v.split(/[?#]/)[0];
    if (AUDIO_EXT.some((ext) => clean.endsWith(ext))) sawAudio = true;
    else if (IMAGE_EXT.some((ext) => clean.endsWith(ext))) sawImage = true;
  });

  if (sawAudio) return "audio";
  if (sawImage) return "image";
  return "text";
}

// --- internal helpers -------------------------------------------------------

/** Visit every leaf value, passing (value, key) where key is the last segment. */
function walk(
  node: unknown,
  visit: (value: unknown, key: string | undefined) => void,
  key?: string,
): void {
  if (node == null) return;
  if (typeof node !== "object") {
    visit(node, key);
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], visit, String(i));
    return;
  }
  for (const k of Object.keys(node as Record<string, unknown>)) {
    walk((node as Record<string, unknown>)[k], visit, k);
  }
}

/** Split a dot/bracket path into flat segment keys. */
function toSegments(path: string): string[] {
  // Convert bracket notation to dots: a[0].b['c'] -> a.0.b.c
  const normalized = path
    .replace(/\[\s*'([^']*)'\s*\]/g, ".$1") // ['c'] -> .c
    .replace(/\[\s*"([^"]*)"\s*\]/g, ".$1") // ["c"] -> .c
    .replace(/\[\s*([^\]]+?)\s*\]/g, ".$1"); // [0] -> .0
  return normalized
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Compare-as-string: trims and stringifies so 123 === "123". */
function normalize(value: unknown): string {
  return String(value).trim();
}
