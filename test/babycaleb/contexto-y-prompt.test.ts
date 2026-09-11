/**
 * De dónde saca el bot lo que "sabe" antes de llamar cualquier tool.
 *
 * El <business_context> se inyecta ENTERO en el system prompt y en CADA turno.
 * Eso lo vuelve la fuente más peligrosa del sistema: el modelo lo lee antes de
 * decidir si consulta el catálogo, así que un precio escrito ahí le gana a D1
 * sin que nadie se entere. Este archivo vigila las dos cosas: que diga la
 * verdad de Baby Caleb, y que NO diga nada que le toque al catálogo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { renderBusinessContext } from "../../src/businessContext";
import { memberConfig, businessConfig, catalog } from "../../member/config.local";
import { renderSystemPrompt } from "../../src/system-prompt";
import { resolveAgentConfig } from "../../src/settings-loader";
import { PRODUCTOS, OPERACION } from "./verdad-del-cliente";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRANGLER = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");

const contexto = renderBusinessContext();

describe("member/config.local.ts — ya no es la plantilla", () => {
  it("el negocio es Baby Caleb, no la barbería de ejemplo", () => {
    // La plantilla trae una barbería en Monterrey con cortes a $250. Mientras
    // el setting `business_context` de D1 esté vacío, ESO es lo que el bot
    // recibe como contexto del negocio. Fue el hueco más grande que había.
    expect(memberConfig.businessName).toBe("Baby Caleb");
    expect(memberConfig.timezone).toBe("America/Panama");
    for (const rastro of ["Mi Negocio Ejemplo", "Monterrey", "Corte", "Barba", "minegocio"]) {
      expect(contexto, `quedó rastro de la plantilla: ${rastro}`).not.toContain(rastro);
    }
  });

  it("wrangler.toml y el config del miembro dicen lo mismo", () => {
    // Dos archivos con el nombre del negocio es una oportunidad de que digan
    // cosas distintas. BUSINESS_NAME va al prompt por env; businessName, por
    // el contexto. Si divergen, el bot se presenta con dos nombres.
    expect(WRANGLER).toContain(`BUSINESS_NAME = "${memberConfig.businessName}"`);
    expect(WRANGLER).toContain(`BOT_TIMEZONE = "${memberConfig.timezone}"`);
    expect(WRANGLER).toMatch(/BOT_LANGUAGE = "es/);
  });
});

describe("el contexto del negocio no compite con el catálogo", () => {
  it("no lleva ningún precio de producto", () => {
    for (const producto of PRODUCTOS) {
      const precio = `$${(producto.precioCents / 100).toFixed(0)}`;
      expect(contexto, `${precio} (${producto.code}) está en el business_context`)
        .not.toContain(precio);
    }
  });

  it("`services` va vacío: si no, se renderiza como una lista de precios", () => {
    expect(businessConfig.services).toHaveLength(0);
    expect(contexto).not.toContain("Servicios y precios");
  });

  it("el array `catalog` de la plantilla sigue vacío", () => {
    // catalogQuery lee D1. Llenar este array crearía una tercera lista de
    // precios que nadie mira y que nadie actualiza.
    expect(catalog).toHaveLength(0);
  });

  it("manda a consultar catalogQuery en vez de contestar de memoria", () => {
    expect(contexto).toContain("catalogQuery");
  });
});

describe("el contexto sí trae lo que no está en ninguna otra parte", () => {
  it("el trato de usted, que es una decisión de negocio", () => {
    expect(contexto).toMatch(/hable siempre de usted/i);
    expect(contexto).toMatch(/nunca tutee/i);
  });

  it("el Yappy y el abono mínimo", () => {
    expect(contexto).toContain(OPERACION.yappy);
    expect(contexto).toContain(OPERACION.abonoMinimo);
  });

  it("qué no se maneja, para que el bot no lo ofrezca", () => {
    expect(contexto).toMatch(/pañales dany baby/i);
    expect(contexto).toMatch(/wipes nateen/i);
  });

  it("que las imágenes y comprobantes los revisa una persona, siempre", () => {
    // Antes decía "escale" a secas. Ahora dice algo más fuerte y además
    // cierto: el archivo ni siquiera le llega al bot, y el ticket ya está
    // creado. Y prohíbe lo único que no puede pasar nunca — dar por bueno un
    // pago que nadie verificó.
    expect(contexto).toMatch(/imagen/i);
    expect(contexto).toMatch(/retiene el archivo y abre el ticket solo/i);
    expect(contexto).toMatch(/NUNCA dé por confirmado un pago a partir de un archivo/i);
  });

  it("que el delivery se consulta, nunca se estima", () => {
    expect(contexto).toMatch(/nunca estime una tarifa/i);
  });
});

describe("<fuentes_de_verdad> separa el precio del producto de la tarifa de envío", () => {
  const prompt = renderSystemPrompt({
    botName: "Baby Caleb",
    businessName: "Baby Caleb",
    language: "es-419",
    businessContext: contexto,
    toolList: ["searchKb", "catalogQuery", "handoffHuman"],
  });

  it("dice que cada dato tiene una sola fuente", () => {
    expect(prompt).toContain("cada dato tiene UNA sola");
  });

  it("el precio del producto es de catalogQuery y la tarifa de envío de searchKb", () => {
    // Sin esta distinción el prompt se contradecía solo: exigía catalogQuery
    // "antes de decir un precio", pero el tarifario de delivery vive en el KB
    // y no tiene forma de salir del catálogo. El bot quedaba entre inventar la
    // tarifa o negarse a darla.
    const bloque = prompt.split("<fuentes_de_verdad>")[1].split("</fuentes_de_verdad>")[0];
    expect(bloque).toMatch(/tarifas de envío/i);
    expect(bloque).toMatch(/ni catalogQuery te va a dar una\s+tarifa de envío/i);
    expect(bloque).toMatch(/no la deduzcas por parecido|NO cuesta lo que la de al lado/i);
  });
});

describe("con D1 vacío, el bot igual arranca diciendo la verdad", () => {
  it("el contexto por defecto es el de Baby Caleb", async () => {
    // Este es el camino real de un bot recién desplegado, o de uno al que
    // nadie tocó la pestaña Config: settings vacío → cae al fallback del repo.
    const mf = await createTestMiniflare();
    const env = {
      DB: await mf.getD1Database("DB"),
      BOT_NAME: "Baby Caleb",
      BUSINESS_NAME: "Baby Caleb",
      BOT_LANGUAGE: "es-419",
    } as never;

    const cfg = await resolveAgentConfig(env, ["searchKb", "catalogQuery", "handoffHuman"]);
    expect(cfg.systemPrompt).toContain("Baby Caleb");
    expect(cfg.systemPrompt).toMatch(/hable siempre de usted/i);
    expect(cfg.systemPrompt).not.toContain("Monterrey");
    for (const producto of PRODUCTOS) {
      const precio = `$${(producto.precioCents / 100).toFixed(0)}`;
      expect(cfg.systemPrompt).not.toContain(precio);
    }
  });
});
