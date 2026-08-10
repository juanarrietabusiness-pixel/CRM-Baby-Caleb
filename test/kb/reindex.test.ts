import { describe, it, expect, vi } from "vitest";
import { reindexKb, type KbChunk } from "../../src/kb/reindex";
import type { Env } from "../../src/env";

const DIM = 1024;

function vec(seed: number): number[] {
  return Array.from({ length: DIM }, (_, i) => (seed + i) / 10000);
}

function makeChunks(n: number): KbChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `chunk-${i}`,
    title: `Título ${i}`,
    content: `Contenido del chunk ${i}`,
  }));
}

type UpsertVector = {
  id: string;
  values: number[];
  metadata: { title: string; content: string };
};

// env.AI.run returns one 1024-dim embedding per input text — never hits the net.
function makeEnv() {
  const upsert = vi.fn(async (_vectors: UpsertVector[]) => ({ mutationId: "m1" }));
  const run = vi.fn(async (_model: string, opts: { text: string[] }) => ({
    shape: [opts.text.length, DIM],
    data: opts.text.map((_t, i) => vec(i)),
  }));
  const env = { AI: { run }, KB: { upsert } } as unknown as Env;
  return { env, run, upsert };
}

describe("reindexKb", () => {
  it("returns indexed:0 and never calls AI/upsert for empty chunks", async () => {
    const { env, run, upsert } = makeEnv();

    const result = await reindexKb(env, []);

    expect(result).toEqual({ indexed: 0 });
    expect(run).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("embeds with @cf/baai/bge-m3 and upserts {id, values, metadata:{title,content}}", async () => {
    const { env, run, upsert } = makeEnv();
    const chunks = makeChunks(3);

    const result = await reindexKb(env, chunks);

    expect(result).toEqual({ indexed: 3 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: [
        "Contenido del chunk 0",
        "Contenido del chunk 1",
        "Contenido del chunk 2",
      ],
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const vectors = upsert.mock.calls[0][0];
    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toEqual({
      id: "chunk-0",
      values: vec(0),
      metadata: { title: "Título 0", content: "Contenido del chunk 0" },
    });
    expect(vectors[2].id).toBe("chunk-2");
    expect(vectors[2].values).toHaveLength(DIM);
    expect(vectors[2].metadata).toEqual({
      title: "Título 2",
      content: "Contenido del chunk 2",
    });
  });

  it("defaults a missing title to empty string in metadata", async () => {
    const { env, upsert } = makeEnv();
    const chunks: KbChunk[] = [{ id: "x", content: "sin título" }];

    const result = await reindexKb(env, chunks);

    expect(result).toEqual({ indexed: 1 });
    const vectors = upsert.mock.calls[0][0];
    expect(vectors[0].metadata).toEqual({ title: "", content: "sin título" });
  });

  it("processes chunks in batches of 100", async () => {
    const { env, run, upsert } = makeEnv();
    const chunks = makeChunks(250);

    const result = await reindexKb(env, chunks);

    expect(result).toEqual({ indexed: 250 });
    // 250 -> 100 + 100 + 50 = 3 batches.
    expect(run).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[0][0].length).toBe(100);
    expect(upsert.mock.calls[1][0].length).toBe(100);
    expect(upsert.mock.calls[2][0].length).toBe(50);
  });
});
