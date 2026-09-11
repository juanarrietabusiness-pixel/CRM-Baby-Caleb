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
import { renderBusinessContext } from "../../src/businessContext";
import { cotizarEnvioTool } from "../../src/tools/cotizarEnvio";

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

  it("la regla se repite al FINAL, que es lo último que lee el modelo", () => {
    // Con la regla solo arriba, el bot tuteó y voseó en una conversación real
    // teniendo el bloque completo en el prompt. Los modelos pequeños pesan
    // mucho más lo último que leyeron, y este bot corre en Haiku por decisión
    // del dueño: arriba se establece la regla, al final se recuerda.
    const p = prompt("usted");
    expect(p).toContain("<ultimo_recordatorio>");
    expect(p.trimEnd().endsWith("</ultimo_recordatorio>")).toBe(true);
    expect(p.indexOf("<ultimo_recordatorio>")).toBeGreaterThan(p.indexOf("</anti_patterns>"));
  });

  it("enseña con frases corregidas, no solo con reglas", () => {
    // Un modelo pequeño copia patrones mejor de lo que sigue reglas abstractas.
    // Los ejemplos son las frases exactas que el bot dijo mal en producción.
    const p = prompt("usted");
    expect(p).toContain('MAL: "¿Te sirven las 30 cajas?"');
    expect(p).toContain('BIEN: "¿Le sirven las 30 cajas?"');
    expect(p).toContain('MAL: "Aquí está el estado de tu pedido"');
    expect(p).toMatch(/ANTES DE ENVIAR CADA MENSAJE, reléelo/);
  });

  it("sin forma de trato declarada, el prompt no dice nada", () => {
    // La plantilla la usan negocios de varios países: imponer un trato por
    // defecto sería peor que no decir nada.
    expect(prompt()).not.toContain("<forma_de_trato>");
    expect(prompt()).not.toContain("<ultimo_recordatorio>");
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

describe("escalar es llamar handoffHuman, no repartir el teléfono", () => {
  const contexto = renderBusinessContext();

  it("el contexto no ofrece los canales como salida fácil", () => {
    // Estuvo aquí con los teléfonos completos y se volvió la vía de escape:
    // ante un pedido de 70 cajas a una zona sin tarifa, el bot pegó el
    // WhatsApp y el Instagram en vez de escalar. Cero tickets: la dueña nunca
    // supo del pedido.
    expect(contexto).toMatch(/NUNCA los ofrezca para quitarse una conversación/i);
    expect(contexto).toMatch(/eso se hace con handoffHuman/i);
    expect(contexto).toMatch(/Mandar a la clienta a otro canal por su cuenta es perder la venta/i);
  });

  it("los datos se dan si los piden, no para despedirse", () => {
    expect(contexto).toMatch(/Si le PIDEN los datos de contacto/i);
    expect(contexto).toMatch(/no dar un número y despedirse/i);
  });

  it("cotizarEnvio manda a escalar, no a otro canal", async () => {
    const tool = cotizarEnvioTool({} as never);
    const r = (await (tool as never as { execute: Function }).execute({
      zona: "Marbella",
    })) as { encontrada: boolean; mensaje: string };
    expect(r.encontrada).toBe(false);
    expect(r.mensaje).toMatch(/LLAMA A handoffHuman AHORA/);
    expect(r.mensaje).toMatch(/NO le des el WhatsApp, el Instagram ni el correo/);
  });
});

describe("el mismo producto para varios destinos se suma", () => {
  it("catalogQuery avisa de no consultar por separado", async () => {
    // Pidieron 40 cajas de talla L para una zona y 20 para otra. El bot
    // consultó dos veces y prometió las dos: 60 cajas de un inventario de 30.
    const { catalogQueryTool } = await import("../../src/tools/catalogQuery");
    const desc = (catalogQueryTool({} as never) as { inputSchema?: unknown }) as never;
    const fuente = readFileSync(resolve(ROOT, "src/tools/catalogQuery.ts"), "utf8");
    expect(fuente).toMatch(/SUMA las cantidades y consulta UNA sola vez/);
    expect(fuente).toMatch(/prometas dos veces las mismas cajas/);
    expect(desc).toBeDefined();
  });
});
