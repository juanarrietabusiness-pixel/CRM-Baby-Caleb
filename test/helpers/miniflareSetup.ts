import { Miniflare } from "miniflare";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// Minimal inline worker for tests.
//
// The real `src/index.ts` imports `hono`, `agents`, `ai`, etc. `agents` and its
// transitive deps (partyserver) import `cloudflare:workers` / `cloudflare:email`
// and Node builtins at module load time, so neither loading the raw TS file via
// `{ scriptPath }` nor bundling it with esbuild works inside Miniflare.
//
// The DB/agent unit tests don't exercise the real agent logic — they only need
// Miniflare to boot and expose the D1 (`DB`) binding and the `AGENT` Durable
// Object namespace (for `idFromName`). So we hand Miniflare a tiny self-contained
// module that declares an empty `SupportAgent` DO and a default fetch handler.
// Production code in `src/` is never touched.
const INLINE_WORKER = `
export class SupportAgent {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch() {
    return new Response("ok", { status: 200 });
  }
}

export default {
  async fetch() {
    return new Response("ok", { status: 200 });
  },
  async scheduled() {},
};
`;

export async function createTestMiniflare() {
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "index.js", contents: INLINE_WORKER }],
    d1Databases: ["DB"],
    durableObjects: { AGENT: "SupportAgent" },
    compatibilityDate: "2026-05-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      BOT_NAME: "Testi",
      BUSINESS_NAME: "Test Business",
      BOT_LANGUAGE: "es",
      BOT_TIER: "pro",
      BUFFER_SECONDS: "1", // fast for tests
    },
  });
  // Apply schema
  const db = await mf.getD1Database("DB");
  const schemaSql = await import("fs").then((fs) =>
    fs.readFileSync(path.join(ROOT, "src", "db", "schema.sql"), "utf-8")
  );
  // D1's exec() expects one complete statement per call, so split on ";",
  // strip SQL comment lines, and collapse each statement onto a single line.
  const statements = schemaSql
    .split(";")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((stmt) => stmt.length > 0);
  for (const stmt of statements) {
    await db.exec(stmt);
  }
  return mf;
}
