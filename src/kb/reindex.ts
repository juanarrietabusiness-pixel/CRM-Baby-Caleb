import type { Env } from "../env";
import kbChunks from "../../scripts/kb-fixtures.json";

/**
 * KB → Vectorize ingestion pipeline.
 *
 * Reads the build-time manifest produced by `scripts/generate-fixtures.ts`
 * (`scripts/kb-fixtures.json`), embeds every chunk's `content` with the
 * multilingual `@cf/baai/bge-m3` model (1024-dim — the SAME model `searchKb`
 * uses for queries, so vectors actually match), and upserts the results into
 * the Vectorize index bound as `KB`.
 *
 * `upsert` overwrites by `id`, so re-running this is idempotent: a redeploy +
 * reindex safely replaces the index contents.
 *
 * searchKb reads `m.metadata.title` and `m.metadata.content` from results, so
 * each upserted vector carries `metadata: { title, content }`.
 */

export interface KbChunk {
  id: string;
  title?: string;
  content: string;
  source?: string;
}

const BATCH_SIZE = 100;

export async function reindexKb(
  env: Env,
  chunks: KbChunk[] = kbChunks as KbChunk[],
): Promise<{ indexed: number }> {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { indexed: 0 };
  }

  let indexed = 0;

  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);
    try {
      const embeddings = await env.AI.run("@cf/baai/bge-m3", {
        text: batch.map((c) => c.content),
      });
      const data = (embeddings as { data: number[][] }).data;

      const vectors: VectorizeVector[] = batch.map((c, i) => ({
        id: c.id,
        values: data[i],
        metadata: { title: c.title ?? "", content: c.content },
      }));

      await env.KB.upsert(vectors);
      indexed += vectors.length;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `reindexKb: batch at offset ${start} (size ${batch.length}) failed: ${msg}`,
      );
      throw e;
    }
  }

  return { indexed };
}
