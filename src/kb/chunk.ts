/**
 * Troceado de documentos del knowledge base.
 *
 * Vive aparte —sin importar `Env`, D1 ni el manifiesto de fixtures— porque lo
 * usan dos caminos que antes no coincidían:
 *
 *   · src/kb/docs.ts        → los documentos que la dueña escribe en /admin/kb
 *   · scripts/generate-fixtures.ts → los .md versionados en member/kb/
 *
 * El segundo camino NO troceaba: subía el archivo entero como un solo vector.
 * Un vector de 5,000 caracteres se parece un poco a todas las preguntas y
 * mucho a ninguna, así que searchKb devolvía el documento completo con un
 * score mediocre y el bot terminaba contestando con lo que le sonaba. Con las
 * dos rutas troceando igual, una pregunta sobre el abono trae el párrafo del
 * abono y no el manual entero.
 */

/** Caracteres por trozo. Un párrafo más largo que esto se corta en seco. */
export const CHUNK_CHARS = 1_200;

/** Tope de trozos por documento. Acota cuántos vectores puede crear un doc. */
export const MAX_CHUNKS = 24;

/** Parte el contenido en trozos de ~CHUNK_CHARS respetando los párrafos. */
export function chunkContent(content: string): string[] {
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (current.length + p.length + 2 > CHUNK_CHARS) push();
    current = current ? `${current}\n\n${p}` : p;
  }
  push();
  return chunks.slice(0, MAX_CHUNKS);
}
