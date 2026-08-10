/**
 * Tests for dashboard-editable KB docs: chunker, D1 repo, and the Vectorize
 * lifecycle (index on save, blanket-delete on remove, global reindex).
 * Vectorize + Workers AI are stubbed; D1 is real via miniflare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import {
  KbDocsRepo,
  chunkContent,
  docChunks,
  indexDoc,
  removeDocVectors,
  reindexAll,
  FIXTURE_CHUNKS,
  MAX_CHUNKS,
} from "../../src/kb/docs";
import type { Env } from "../../src/env";

let env: Env;
let repo: KbDocsRepo;
let kbUpsert: ReturnType<typeof vi.fn>;
let kbDelete: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  kbUpsert = vi.fn(async () => ({}));
  kbDelete = vi.fn(async () => ({}));
  env = {
    DB: d1,
    KB: { upsert: kbUpsert, deleteByIds: kbDelete },
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => [0.1, 0.2, 0.3]),
      })),
    },
  } as unknown as Env;
  repo = new KbDocsRepo(new Db(d1));
});

describe("chunkContent", () => {
  it("keeps a short doc as a single chunk", () => {
    expect(chunkContent("Abrimos de 9 a 7.\n\nCerramos domingos.")).toHaveLength(1);
  });

  it("splits long content on paragraph boundaries at ~1200 chars", () => {
    const para = "x".repeat(500);
    const content = Array(6).fill(para).join("\n\n"); // 3000+ chars
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
  });

  it("hard-splits a single oversized paragraph and caps total chunks", () => {
    const chunks = chunkContent("y".repeat(40_000));
    expect(chunks.length).toBe(MAX_CHUNKS);
  });
});

describe("KbDocsRepo + vector lifecycle", () => {
  it("upserts, lists and deletes docs", async () => {
    await repo.upsert({ id: "d1", title: "Horarios", content: "Abrimos 9-7." });
    await repo.upsert({ id: "d1", title: "Horarios v2", content: "Abrimos 10-8." });
    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Horarios v2");

    await repo.delete("d1");
    expect(await repo.list()).toHaveLength(0);
  });

  it("indexDoc blanket-deletes stale vectors then upserts fresh chunks", async () => {
    await repo.upsert({ id: "d2", title: "Precios", content: "Corte $150.\n\nBarba $100." });
    const doc = (await repo.getById("d2"))!;

    const r = await indexDoc(env, doc);
    expect(r.indexed).toBe(1);

    // Blanket delete covers the full possible chunk range for the doc.
    expect(kbDelete).toHaveBeenCalledTimes(1);
    const deletedIds = kbDelete.mock.calls[0][0] as string[];
    expect(deletedIds).toHaveLength(MAX_CHUNKS);
    expect(deletedIds[0]).toBe("dash:d2#0");

    // Upserted vectors carry title+content metadata (searchKb reads them).
    const vectors = kbUpsert.mock.calls[0][0] as any[];
    expect(vectors[0].id).toBe("dash:d2#0");
    expect(vectors[0].metadata.title).toBe("Precios");
    expect(vectors[0].metadata.content).toContain("Corte $150");
  });

  it("removeDocVectors deletes the doc's id range", async () => {
    await removeDocVectors(env, "gone");
    expect(kbDelete).toHaveBeenCalledWith(
      expect.arrayContaining(["dash:gone#0", `dash:gone#${MAX_CHUNKS - 1}`]),
    );
  });

  it("reindexAll combines repo fixtures with dashboard docs", async () => {
    await repo.upsert({ id: "d3", title: "FAQ", content: "Pregunta y respuesta." });
    const r = await reindexAll(env);
    expect(r.indexed).toBe(FIXTURE_CHUNKS.length + 1);
  });

  it("docChunks prefixes ids with dash: and the doc id", async () => {
    await repo.upsert({ id: "d4", title: "T", content: "C" });
    const doc = (await repo.getById("d4"))!;
    expect(docChunks(doc)[0]).toMatchObject({ id: "dash:d4#0", title: "T", content: "C" });
  });
});
