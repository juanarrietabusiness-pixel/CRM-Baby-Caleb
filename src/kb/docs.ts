/**
 * La base de conocimiento y su vida en Vectorize. Dos dueños, sin temas en común
 * (29-sep-2026):
 *
 *   · CONOCIMIENTO BASE de la empresa —tallas, productos, quiénes somos, uso del
 *     producto— en GitHub: member/conocimiento/*.md, que viaja en el bundle
 *     (./conocimiento.generado.ts) y sube al índice en cada despliegue. Lo
 *     actualiza la agencia. El panel y la consola de Telegram no lo pueden
 *     pisar: un documento del panel con el id o el título de uno de GitHub se
 *     rechaza al guardar y no se indexa.
 *   · COMPORTAMIENTO —cuándo escalar, pagos, envíos, retiro, cambios, agotados—
 *     en el panel (D1 `kb_docs`), que la dueña cambia desde /admin/kb o desde
 *     Telegram. El seguimiento a clientas NO vive aquí: son ajustes
 *     (src/followup/ajustes.ts), porque el proceso que lo manda no lee esta base.
 *
 * Hasta el 23-sep-2026 los dos lados podían tener el MISMO tema (member/kb/ y
 * el panel), se contradecían y el bot contestaba con el que encontrara primero.
 * Eso no vuelve: cada tema tiene un solo lado. member/kb-respaldo/ sigue siendo
 * una COPIA diaria del panel que no se indexa nunca (hay una prueba que lo
 * vigila).
 *
 * El índice es un ESPEJO de los dos: `kb_indice` anota qué pedazos se subieron,
 * y cada reindex borra los que ya no existen. Un reindex que solo suma deja lo
 * viejo contestando para siempre.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import { reindexKb, type KbChunk } from "./reindex";
import { chunkContent, MAX_CHUNKS } from "./chunk";
import { CONOCIMIENTO_BASE } from "./conocimiento.generado";
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

// ── El conocimiento base (GitHub) ──────────────────────────────────────────

/** Los documentos de member/conocimiento/, tal como viajan en el bundle. */
export const DOCS_DE_GITHUB: KbDoc[] = CONOCIMIENTO_BASE.map((d) => ({ ...d, updated_at: 0 }));

const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * El documento de GitHub con ese id o ese título, o null. Un documento del
 * panel no puede llevar ninguno de los dos: sería el mismo tema con dos dueños.
 */
export function docDeGithub(idOTitulo: string): KbDoc | null {
  const t = plano(idOTitulo);
  return DOCS_DE_GITHUB.find((d) => d.id === idOTitulo.trim() || plano(d.title) === t) ?? null;
}

/** Chunks de un documento de GitHub: `git:<id>#<n>`, para no chocar con los del panel. */
export function gitChunks(doc: KbDoc): KbChunk[] {
  return chunkContent(doc.content).map((content, i) => ({
    id: `git:${doc.id}#${i}`,
    title: doc.title,
    content,
    source: "github",
  }));
}

function gitVectorIds(docId: string): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `git:${docId}#${i}`);
}

/**
 * Lo que la reorganización del 29-sep-2026 saca del panel, una sola vez:
 *   · los documentos que pasaron a GitHub (mismo id o mismo título), para que
 *     el tema no quede con dos dueños;
 *   · «Seguimiento de clientas»: el seguimiento es un ajuste (/seguimiento en
 *     Telegram), no un texto. Ese documento decía «no le escribas a nadie» y el
 *     proceso que manda los seguimientos nunca lo leyó.
 * Queda anotado en `settings` para no repetirse: si la dueña crea después un
 * documento con esos nombres, lo rechaza el panel, no una migración.
 */
export const MIGRACION_KB = "2026-09-29";
const PANEL_RETIRADOS_EN_LA_MIGRACION = ["seguimiento-de-clientas"];

export async function migrarConocimiento(env: Env): Promise<string[]> {
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);
  if ((await settings.get("kb_migracion")) === MIGRACION_KB) return [];
  const repo = new KbDocsRepo(db);
  const borrados: string[] = [];
  for (const d of await repo.list()) {
    if (docDeGithub(d.id) || docDeGithub(d.title) || PANEL_RETIRADOS_EN_LA_MIGRACION.includes(d.id)) {
      await repo.delete(d.id);
      borrados.push(d.id);
    }
  }
  await settings.set("kb_migracion", MIGRACION_KB);
  if (borrados.length) console.log(`[kb] migración ${MIGRACION_KB}: fuera del panel ${borrados.join(", ")}`);
  return borrados;
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
 * Reindex general: el índice queda IGUAL a GitHub + el panel. Sube cada
 * documento y borra todo lo que no salga de ellos: documentos borrados,
 * pedazos que sobraron al acortar uno, los .md viejos del repositorio y los
 * retirados a mano. Lo corre cada despliegue: así llega lo que se mergeó en
 * member/conocimiento/.
 */
export async function reindexAll(env: Env): Promise<{ indexed: number; purged: string[] }> {
  const migrados = await migrarConocimiento(env);
  // Un documento del panel con el id o el título de uno de GitHub no se indexa:
  // el tema ya tiene dueño.
  const docs = (await new KbDocsRepo(new Db(env.DB)).list()).filter((d) => !docDeGithub(d.id) && !docDeGithub(d.title));
  const chunks = [...DOCS_DE_GITHUB.flatMap(gitChunks), ...docs.flatMap(docChunks)];
  const vivos = new Set(chunks.map((c) => c.id));
  const { indexed } = await reindexKb(env, chunks);

  const antes = (
    await env.DB.prepare("SELECT vector_id FROM kb_indice").all<{ vector_id: string }>()
  ).results?.map((r) => r.vector_id) ?? [];
  const docIds = new Set(docs.map((d) => d.id));
  const legado = [
    ...REPO_KB_LEGADO.flatMap((b) => Array.from({ length: MAX_CHUNKS }, (_, i) => `${b}#${i}`)),
    ...RETIRED_DOC_IDS.filter((id) => !docIds.has(id)).flatMap(vectorIds),
    ...migrados.flatMap(vectorIds),
    // Pedazos de un documento vivo que ya no existen (se acortó).
    ...docs.flatMap((d) => vectorIds(d.id)),
    ...DOCS_DE_GITHUB.flatMap((d) => gitVectorIds(d.id)),
  ];
  const sobran = [...new Set([...antes, ...legado])].filter((id) => !vivos.has(id));
  // En lotes chicos: Vectorize rechaza un deleteByIds grande (el 24-sep, con
  // ~480 ids de una vez, el reindex del despliegue devolvió 500).
  for (let i = 0; i < sobran.length; i += 50) await env.KB.deleteByIds(sobran.slice(i, i + 50));

  await env.DB.prepare("DELETE FROM kb_indice").run();
  for (const d of DOCS_DE_GITHUB) await anotarIndice(env, `git:${d.id}`, gitChunks(d).map((c) => c.id));
  for (const d of docs) await anotarIndice(env, d.id, docChunks(d).map((c) => c.id));

  // Lo que salió del índice y no era un simple sobrante de un documento vivo.
  const purged = [...new Set(antes.filter((id) => !vivos.has(id)))];
  return { indexed, purged };
}
