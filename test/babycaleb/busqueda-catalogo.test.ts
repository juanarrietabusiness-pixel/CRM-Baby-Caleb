/**
 * Que el bot encuentre EL producto, no doce.
 *
 * catalogQuery, cuando la búsqueda no da coincidencias, devuelve el catálogo
 * completo para no dejar al bot sin nada que decir. Es una buena red, pero se
 * volvía la conducta normal: la búsqueda pedía la frase entera como subcadena,
 * y "pañal talla M" no es subcadena de "Pañal Nateen Talla M de cierre…".
 * Resultado: la clienta pregunta por la M y el modelo recibe las doce cajas,
 * con seis precios distintos, y elige. Ahí nacen los precios equivocados.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo } from "../../src/db/catalog";
import { catalogQueryTool } from "../../src/tools/catalogQuery";
import { SUCURSALES } from "../../src/catalog/validation";
import { PRODUCTOS } from "./verdad-del-cliente";

const NOMBRES: Record<string, string> = {
  "NAT-RN": "Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)",
  "NAT-S": "Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)",
  "NAT-M": "Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)",
  "NAT-L": "Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)",
  "NAT-XL": "Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)",
  "NAT-XXL": "Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)",
  "NAT-P-L": "Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)",
  "NAT-P-XL": "Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)",
  "NAT-P-XXL": "Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)",
  "DANY-AW1200": "Water wipes hipoalergénicas Dany Baby — 1,200 toallitas (24 paquetes de 50)",
  "DANY-AW600": "Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)",
  "MOON-FUL": "Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)",
};

let repo: CatalogRepo;
let env: { DB: unknown };

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1 };
  repo = new CatalogRepo(new Db(d1 as never));
  // El catálogo real, activo y con existencias, como quedaría en producción.
  for (const producto of PRODUCTOS) {
    await repo.saveProduct({
      code: producto.code,
      name: NOMBRES[producto.code],
      costPrice: null,
      salePrice: producto.precioCents,
      active: true,
      stock: SUCURSALES.map((branch) => ({ branch, stockQty: 10 })),
    });
  }
});

const codigos = (ps: Array<{ code: string }>) => ps.map((p) => p.code).sort();

describe("CatalogRepo.search — palabra por palabra, no la frase entera", () => {
  it("'pañal talla M' encuentra solo la M", async () => {
    expect(codigos(await repo.search("pañal talla M"))).toEqual(["NAT-M"]);
  });

  it("'talla XL' trae las dos presentaciones de XL y ninguna XXL", async () => {
    expect(codigos(await repo.search("talla XL"))).toEqual(["NAT-P-XL", "NAT-XL"]);
  });

  it("'pañales de pants' trae las tres tallas que existen en pants", async () => {
    expect(codigos(await repo.search("pants"))).toEqual(["NAT-P-L", "NAT-P-XL", "NAT-P-XXL"]);
  });

  it("'wipes dany' trae las dos cajas de toallitas", async () => {
    expect(codigos(await repo.search("wipes dany"))).toEqual(["DANY-AW1200", "DANY-AW600"]);
  });

  it("'fular' encuentra el Moon", async () => {
    expect(codigos(await repo.search("fular"))).toEqual(["MOON-FUL"]);
  });

  it("sigue encontrando por código", async () => {
    expect(codigos(await repo.search("NAT-XXL"))).toEqual(["NAT-XXL"]);
  });

  it("una búsqueda vacía no devuelve nada (la lista completa la pide la tool)", async () => {
    expect(await repo.search("   ")).toEqual([]);
  });

  it("la clienta escribe sin tildes y encuentra igual", async () => {
    // "panales talla m" es como se escribe de verdad por WhatsApp.
    expect(codigos(await repo.search("panal talla m"))).toEqual(["NAT-M"]);
    expect(codigos(await repo.search("bambu"))).toEqual(["MOON-FUL"]);
  });

  it("XL no arrastra a XXL ni al 3XL del fular", async () => {
    // El fular dice "unitalla ajustable XS a 3XL" y la XXL contiene "XL"
    // dentro. Buscando por subcadena, preguntar por la XL traía tres precios.
    expect(codigos(await repo.search("XL"))).toEqual(["NAT-P-XL", "NAT-XL"]);
    expect(codigos(await repo.search("XXL"))).toEqual(["NAT-P-XXL", "NAT-XXL"]);
  });

  it("lo que no existe no aparece por parecido", async () => {
    expect(await repo.search("pañales huggies")).toEqual([]);
  });
});

describe("catalogQuery con el catálogo real de Baby Caleb", () => {
  it("por la talla M devuelve un solo producto, con su precio y su caja", async () => {
    const tool = catalogQueryTool(env as never);
    const r = (await (tool as never as { execute: Function }).execute({ query: "talla M" })) as {
      matches: Array<{ codigo: string; precio: string; nombre: string }>;
    };
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].codigo).toBe("NAT-M");
    expect(r.matches[0].precio).toBe("$50.00");
    expect(r.matches[0].nombre).toContain("144");
  });

  it("cada producto sale con el precio exacto del documento", async () => {
    const tool = catalogQueryTool(env as never);
    const r = (await (tool as never as { execute: Function }).execute({})) as {
      catalogoCompleto: Array<{ codigo: string; precio: string }>;
    };
    expect(r.catalogoCompleto).toHaveLength(PRODUCTOS.length);
    for (const producto of PRODUCTOS) {
      const fila = r.catalogoCompleto.find((p) => p.codigo === producto.code);
      expect(fila, `${producto.code} no salió en el catálogo`).toBeDefined();
      expect(fila!.precio).toBe(`$${(producto.precioCents / 100).toFixed(2)}`);
    }
  });

  it("preguntar por algo que no se vende no devuelve un sustituto silencioso", async () => {
    const tool = catalogQueryTool(env as never);
    const r = (await (tool as never as { execute: Function }).execute({
      query: "pañales Dany Baby",
    })) as { matches: unknown[]; mensaje: string };
    // La tool ofrece el catálogo completo como plan B, pero deja dicho que no
    // hubo coincidencia: el prompt es el que obliga a responder "eso no lo
    // manejamos" en vez de empujar otra cosa.
    expect(r.matches).toEqual([]);
    expect(r.mensaje).toMatch(/no hay ningún producto que coincida/i);
  });
});
