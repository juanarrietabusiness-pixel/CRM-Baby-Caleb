#!/usr/bin/env node
/**
 * build-conocimiento.mjs
 *
 * Genera `src/kb/conocimiento.generado.ts` desde `member/conocimiento/*.md`: el
 * CONOCIMIENTO BASE de la empresa (tallas, productos, quiénes somos, uso del
 * producto), que vive en GitHub y lo actualiza la agencia.
 *
 * Por qué un archivo generado y no leer los .md en el Worker: un Worker no tiene
 * sistema de archivos. Los .md se convierten en un módulo que viaja dentro del
 * bundle, y cada despliegue los sube al índice del bot (src/kb/docs.ts,
 * reindexAll). El módulo se versiona, como public/admin.css y public/icons.svg,
 * y una prueba falla si quedó desfasado de los .md.
 *
 * Cada .md empieza con `<!-- id: <id> -->` y un `# Título`. Los comentarios
 * HTML son para quien edita: no llegan al bot.
 *
 * Uso:
 *   pnpm conocimiento           regenera el módulo
 *   pnpm conocimiento --check   no escribe; sale con 1 si está desfasado
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "member", "conocimiento");
const OUT = path.join(ROOT, "src", "kb", "conocimiento.generado.ts");
const CHECK = process.argv.includes("--check");

/** Un .md → { id, title, content }. Lanza si falta el id o el título. */
export function leerDocumento(nombre, texto) {
  const id = texto.match(/<!--\s*id:\s*([a-z0-9-]+)\s*-->/)?.[1];
  if (!id) throw new Error(`${nombre}: falta la línea <!-- id: ... --> al principio`);
  const sinComentarios = texto.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").trim();
  const titulo = sinComentarios.match(/^#\s+(.+)$/m);
  if (!titulo) throw new Error(`${nombre}: falta el título (# Título)`);
  const content = sinComentarios.slice(sinComentarios.indexOf(titulo[0]) + titulo[0].length).trim();
  if (!content) throw new Error(`${nombre}: el documento está vacío`);
  return { id, title: titulo[1].trim(), content };
}

export function generar() {
  const archivos = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".md")).sort() : [];
  const docs = archivos.map((f) => leerDocumento(f, readFileSync(path.join(DIR, f), "utf8")));
  const ids = new Set();
  for (const d of docs) {
    if (ids.has(d.id)) throw new Error(`El id ${d.id} está repetido en member/conocimiento/`);
    ids.add(d.id);
  }
  return [
    "// GENERADO por scripts/build-conocimiento.mjs desde member/conocimiento/*.md.",
    "// No se edita a mano: se edita el .md y se corre `pnpm conocimiento`.",
    "",
    "export interface DocumentoBase {",
    "  id: string;",
    "  title: string;",
    "  content: string;",
    "}",
    "",
    `export const CONOCIMIENTO_BASE: DocumentoBase[] = ${JSON.stringify(docs, null, 2)};`,
    "",
  ].join("\n");
}

const INVOCADO = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOCADO) {
  const nuevo = generar();
  const actual = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (CHECK) {
    if (nuevo !== actual) {
      console.error("✗ src/kb/conocimiento.generado.ts está desfasado de member/conocimiento/. Corra: pnpm conocimiento");
      process.exit(1);
    }
    console.log("✓ El conocimiento base está al día.");
  } else {
    writeFileSync(OUT, nuevo);
    console.log(`✓ ${path.relative(ROOT, OUT)} generado.`);
  }
}
