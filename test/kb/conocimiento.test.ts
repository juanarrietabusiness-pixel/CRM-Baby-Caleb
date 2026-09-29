/**
 * El conocimiento base de la empresa vive en member/conocimiento/*.md (GitHub)
 * y viaja al Worker como src/kb/conocimiento.generado.ts. Si alguien edita un
 * .md y no regenera, el bot seguiría con el texto viejo sin que nada fallara.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — módulo .mjs sin tipos
import { generar, leerDocumento } from "../../scripts/build-conocimiento.mjs";
import { DOCS_DE_GITHUB } from "../../src/kb/docs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("member/conocimiento → src/kb/conocimiento.generado.ts", () => {
  it("el módulo está al día con los .md (si falla: pnpm conocimiento)", () => {
    expect(readFileSync(resolve(ROOT, "src/kb/conocimiento.generado.ts"), "utf8")).toBe(generar());
  });

  it("cada .md trae su id y su título, y los comentarios no llegan al bot", () => {
    const archivos = readdirSync(resolve(ROOT, "member/conocimiento")).filter((f) => f.endsWith(".md"));
    expect(archivos.length).toBe(DOCS_DE_GITHUB.length);
    for (const d of DOCS_DE_GITHUB) {
      expect(d.content).not.toMatch(/<!--/);
      expect(d.title.trim()).not.toBe("");
    }
    expect(() => leerDocumento("x.md", "# Sin id\n\ntexto")).toThrow(/id/);
  });

  it("GitHub y el respaldo del panel no comparten temas", () => {
    // Un mismo tema con dos dueños es lo que se contradecía antes del 23-sep.
    const respaldo = readdirSync(resolve(ROOT, "member/kb-respaldo"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(resolve(ROOT, "member/kb-respaldo", f), "utf8"));
    for (const d of DOCS_DE_GITHUB) {
      for (const texto of respaldo) {
        expect(texto).not.toContain(`<!-- id: ${d.id} -->`);
        expect(texto).not.toMatch(new RegExp(`^# ${d.title}$`, "m"));
      }
    }
  });
});
