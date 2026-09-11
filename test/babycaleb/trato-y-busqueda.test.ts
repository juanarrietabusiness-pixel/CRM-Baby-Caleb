/**
 * Los dos fallos que se vieron en una conversación real de Telegram.
 *
 *  1. El bot tuteó y voseó ("mejor lo hablás con el equipo", "¿te sirven las 30
 *     cajas?") a un negocio cuya dueña trata de usted a todas sus clientas. La
 *     regla existía, pero enterrada en el contexto del negocio: una línea entre
 *     otras quince. El modelo arrastró el registro y nadie se lo impidió.
 *
 *  2. Le preguntaron la tarifa de envío a Tocumen —que estaba escrita en la
 *     base de conocimiento a $8— y contestó "no tengo esa tarifa en el
 *     sistema". No fue el dato: fue el umbral inventado de la tool.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSystemPrompt } from "../../src/system-prompt";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEARCH_KB = readFileSync(resolve(ROOT, "src/tools/searchKb.ts"), "utf8");

const prompt = (formaDeTrato?: "usted" | "tu" | "vos") =>
  renderSystemPrompt({
    botName: "Baby Caleb",
    businessName: "Baby Caleb",
    language: "es-419",
    businessContext: "contexto",
    toolList: ["searchKb", "catalogQuery", "cotizarEnvio", "handoffHuman"],
    formaDeTrato,
  });

describe("la forma de trato es una decisión del negocio, no del modelo", () => {
  it("va pegada a <output_language>, que es el bloque que el modelo sí respeta", () => {
    const p = prompt("usted");
    const trato = p.indexOf("<forma_de_trato>");
    expect(trato).toBeGreaterThan(-1);
    expect(trato).toBeLessThan(p.indexOf("<role>"));
    expect(p).toContain("IGUAL DE OBLIGATORIO QUE EL IDIOMA");
  });

  it("nombra las formas verbales, no solo 'usa usted'", () => {
    // "Usa usted" no basta: "¿te sirven?" se cuela igual. Por eso el bloque
    // lista las conjugaciones concretas, que es lo que el modelo copia.
    const p = prompt("usted");
    for (const forma of ["le dejamos", "su bebé", "indíquenos", "dígame"]) {
      expect(p).toContain(forma);
    }
    for (const prohibido of ["tienes", "puedes", "prefieres", "contigo"]) {
      expect(p).toContain(prohibido); // aparecen como PROHIBIDOS, explícitamente
    }
    expect(p).toMatch(/ninguna forma de voseo/i);
  });

  it("aguanta que la clienta tutee primero", () => {
    expect(prompt("usted")).toMatch(/aunque la clienta te tutee/i);
    expect(prompt("usted")).toContain("Cambiar la forma de trato porque el cliente te habla de otra manera");
  });

  it("soporta tuteo y voseo para otros negocios", () => {
    expect(prompt("tu")).toMatch(/tutea a quien te escribe/i);
    expect(prompt("vos")).toMatch(/usa el voseo/i);
  });

  it("sin forma de trato declarada, el prompt no dice nada", () => {
    // La plantilla la usan negocios de varios países: imponer un trato por
    // defecto sería peor que no decir nada.
    expect(prompt()).not.toContain("<forma_de_trato>");
  });
});

describe("searchKb ya no descarta respuestas buenas", () => {
  it("no le da al modelo ningún umbral de score", () => {
    // Decía "Si top-1 score < 0.7 no hay match útil — escala". bge-m3 puntúa
    // una pregunta en español contra el párrafo que la contesta típicamente
    // entre 0.5 y 0.7: el umbral tiraba respuestas correctas.
    // Se mira la DESCRIPCIÓN, que es lo que lee el modelo. El comentario de
    // arriba del archivo sí menciona el 0.7: cuenta por qué se quitó, y esa
    // explicación es justo lo que evita que alguien lo vuelva a poner.
    const descripcion = SEARCH_KB.split("description:")[1].split("inputSchema")[0];
    expect(descripcion).not.toMatch(/0\.\d/);
    expect(descripcion).not.toMatch(/no hay match útil/i);
    expect(descripcion).not.toMatch(/score\s*<|top-1/i);
  });

  it("le dice al modelo que lea el contenido, no el parecido", () => {
    expect(SEARCH_KB).toMatch(/LEE EL CONTENIDO/);
    expect(SEARCH_KB).toMatch(/score.*mide parecido de REDACCIÓN/);
    expect(SEARCH_KB).toMatch(/score bajo puede contener el dato exacto/);
  });

  it("trae más fragmentos, porque la respuesta puede caer en el trozo vecino", () => {
    expect(SEARCH_KB).toMatch(/topK:\s*8/);
  });
});
