/**
 * La base de conocimiento: los documentos del panel (D1 `kb_docs`) y su vida en
 * Vectorize.
 *
 * El panel es la ÚNICA fuente. Hasta el 23-sep-2026 había dos: estos
 * documentos y los .md de member/kb/ que subía cada despliegue. Se buscaban a
 * la vez, se contradecían (cambios de talla, retiro, recomendar talla) y el bot
 * contestaba con la que encontrara primero. Ahora member/kb-respaldo/ es solo
 * una COPIA del panel que guarda GitHub: no se indexa nunca (hay una prueba que
 * lo vigila).
 *
 * El índice es un ESPEJO del panel: `kb_indice` anota qué pedazos se subieron,
 * y cada reindex borra los que ya no existen. Un reindex que solo suma deja lo
 * viejo contestando para siempre.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { reindexKb, type KbChunk } from "./reindex";
import { chunkContent, MAX_CHUNKS } from "./chunk";
import kbRetirados from "../../member/kb-retirados.json";

export interface KbDoc {
  id: string;
  title: string;
  content: string;
  updated_at: number;
}

/** Max content length per doc — bounds the chunk count (≤ MAX_CHUNKS). */
export const MAX_DOC_CHARS = 24_000;

// El troceado vive en ./chunk para que scripts/generate-fixtures.ts use el
// MISMO, y los .md de member/kb/ entren al índice igual que los del panel.
export { chunkContent, MAX_CHUNKS } from "./chunk";

/**
 * Los .md que member/kb/ subía al índice antes del 23-sep-2026. Ya no se suben;
 * sus pedazos se borran en cada reindex por si alguno quedó.
 */
export const REPO_KB_LEGADO = [
  "01-tallas-y-productos",
  "02-envios-y-delivery",
  "03-pagos-y-abonos",
  "04-uso-del-producto",
  "05-el-negocio",
  "06-cuando-escalar-a-humano",
];

export class KbDocsRepo {
  constructor(private readonly db: Db) {}

  async list(): Promise<KbDoc[]> {
    return this.db.all<KbDoc>("SELECT * FROM kb_docs ORDER BY updated_at DESC");
  }

  async getById(id: string): Promise<KbDoc | null> {
    return this.db.first<KbDoc>("SELECT * FROM kb_docs WHERE id = ?", [id]);
  }

  async upsert(doc: { id: string; title: string; content: string }): Promise<void> {
    await this.db.run(
      `INSERT INTO kb_docs (id, title, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
      [doc.id, doc.title, doc.content, Date.now()],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run("DELETE FROM kb_docs WHERE id = ?", [id]);
  }
}

function vectorIds(docId: string): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `dash:${docId}#${i}`);
}

/** Chunks for one dashboard doc, title-prefixed so matches carry context. */
export function docChunks(doc: KbDoc): KbChunk[] {
  return chunkContent(doc.content).map((content, i) => ({
    id: `dash:${doc.id}#${i}`,
    title: doc.title,
    content,
    source: "dashboard",
  }));
}

async function anotarIndice(env: Env, docId: string, ids: string[]): Promise<void> {
  const ahora = Date.now();
  await env.DB.prepare("DELETE FROM kb_indice WHERE doc_id = ?").bind(docId).run();
  if (ids.length === 0) return;
  const stmt = env.DB.prepare("INSERT OR REPLACE INTO kb_indice (vector_id, doc_id, created_at) VALUES (?, ?, ?)");
  await env.DB.batch(ids.map((id) => stmt.bind(id, docId, ahora)));
}

/** Re-embed one doc: blanket-delete its old vectors, then upsert fresh ones. */
export async function indexDoc(env: Env, doc: KbDoc): Promise<{ indexed: number }> {
  await env.KB.deleteByIds(vectorIds(doc.id));
  const chunks = docChunks(doc);
  const r = await reindexKb(env, chunks);
  await anotarIndice(env, doc.id, chunks.map((c) => c.id));
  return r;
}

/** Remove a deleted doc's vectors from the index. */
export async function removeDocVectors(env: Env, docId: string): Promise<void> {
  await env.KB.deleteByIds(vectorIds(docId));
  await anotarIndice(env, docId, []);
}

/** All dashboard docs as chunks (for the global reindex). */
export async function dashboardChunks(env: Env): Promise<KbChunk[]> {
  const docs = await new KbDocsRepo(new Db(env.DB)).list();
  return docs.flatMap(docChunks);
}

/** Ids de documentos retirados (member/kb-retirados.json). */
export const RETIRED_DOC_IDS: string[] = (kbRetirados as { ids?: string[] }).ids ?? [];

/**
 * Borra del índice los vectores de los documentos retirados.
 *
 * Borrar la fila de `kb_docs` no borra nada de Vectorize: los vectores viven
 * como `dash:<id>#0`…`#23` y solo la ruta de borrado del panel llama a
 * `removeDocVectors`. Un reindex hace `upsert`, que nunca borra. Así que un
 * documento borrado por SQL seguiría contestando para siempre, sin dejar rastro
 * de dónde salió la respuesta — que es la peor forma de estar equivocado.
 *
 * Si un id retirado VUELVE a existir en kb_docs, no se toca: alguien lo recreó
 * a propósito desde el panel y ahí manda el panel.
 */
export async function purgeRetiredDocVectors(env: Env): Promise<{ purged: string[] }> {
  if (RETIRED_DOC_IDS.length === 0) return { purged: [] };
  const vivos = new Set((await new KbDocsRepo(new Db(env.DB)).list()).map((d) => d.id));
  const aPurgar = RETIRED_DOC_IDS.filter((id) => !vivos.has(id));
  for (const id of aPurgar) await env.KB.deleteByIds(vectorIds(id));
  return { purged: aPurgar };
}

/**
 * Reindex general: el índice queda IGUAL al panel. Sube cada documento y borra
 * todo lo que no salga de él: documentos borrados, pedazos que sobraron al
 * acortar uno, los .md viejos del repositorio y los retirados a mano.
 */
export async function reindexAll(env: Env): Promise<{ indexed: number; purged: string[] }> {
  const docs = await new KbDocsRepo(new Db(env.DB)).list();
  const chunks = docs.flatMap(docChunks);
  const vivos = new Set(chunks.map((c) => c.id));
  const { indexed } = await reindexKb(env, chunks);

  const antes = (
    await env.DB.prepare("SELECT vector_id FROM kb_indice").all<{ vector_id: string }>()
  ).results?.map((r) => r.vector_id) ?? [];
  const docIds = new Set(docs.map((d) => d.id));
  const legado = [
    ...REPO_KB_LEGADO.flatMap((b) => Array.from({ length: MAX_CHUNKS }, (_, i) => `${b}#${i}`)),
    ...RETIRED_DOC_IDS.filter((id) => !docIds.has(id)).flatMap(vectorIds),
    // Pedazos de un documento vivo que ya no existen (se acortó).
    ...docs.flatMap((d) => vectorIds(d.id)),
  ];
  const sobran = [...new Set([...antes, ...legado])].filter((id) => !vivos.has(id));
  for (let i = 0; i < sobran.length; i += 500) await env.KB.deleteByIds(sobran.slice(i, i + 500));

  await env.DB.prepare("DELETE FROM kb_indice").run();
  for (const d of docs) await anotarIndice(env, d.id, docChunks(d).map((c) => c.id));

  // Lo que salió del índice y no era un simple sobrante de un documento vivo.
  const purged = [...new Set(antes.filter((id) => !vivos.has(id)))];
  return { indexed, purged };
}
