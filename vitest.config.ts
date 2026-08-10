import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Safety net: `agents` / `partyserver` import the virtual `cloudflare:*`
    // modules (only available inside workerd). The worker-entry test mocks the
    // `agents` package so these never load in Node, but if any test transitively
    // pulls them in, these aliases resolve them to local stubs rather than
    // crashing Node's ESM loader. Tests needing real runtime behavior use
    // Miniflare instead.
    alias: {
      "cloudflare:workers": path.resolve(HERE, "test/stubs/cloudflare-workers.ts"),
      "cloudflare:email": path.resolve(HERE, "test/stubs/cloudflare-email.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // Most tests spin up a real Miniflare (workerd process + full D1 schema)
    // in beforeEach; under machine load that alone can blow the 5s default.
    // These are integration tests — give them real headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
