import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { CatalogRepo, disponibilidadDe, type CatalogProduct } from "../db/catalog";
import { fmtUSD } from "../catalog/validation";

/**
 * Consulta el catálogo real (D1: catalog_items). Antes leía un array en
 * member/config.local.ts que llegaba vacío, así que el bot improvisaba precios.
 *
 * Dos cosas que esta tool deliberadamente NO devuelve:
 *
 *  1. El costo. La consulta no selecciona `cost_price` (ver PUBLIC_COLS en
 *     src/db/catalog.ts). No es un filtro sobre la respuesta: el dato no sale
 *     de la base, así que el bot no lo puede soltar ni presionado.
 *  2. La cantidad exacta de stock. Devuelve una etiqueta —disponible / pocas /
 *     agotado— porque el bot solo puede decir lo que recibe. Si nunca ve el
 *     número, no hay forma de que responda "quedan 3".
 *
 * El desglose por bodega sí viene, sin cantidades: sirve para coordinar el
 * delivery, que es como vende Baby Caleb.
 */
export function catalogQueryTool(env: Env) {
  return tool({
    description:
      "Consulta el catálogo real del negocio por nombre o código de producto (ej. 'pañal talla M', 'wipes', 'NAT-XL'). " +
      "Devuelve el precio de venta y si hay existencias. ÚSALA SIEMPRE antes de decir un precio o afirmar que hay " +
      "disponibilidad — nunca inventes ni estimes un precio. Si un producto no aparece, es que no se vende: dilo y " +
      "ofrece pasar con una persona. La cantidad exacta de inventario no se le dice a la clienta: si viene 'pocas', " +
      "di que quedan pocas unidades; si viene 'agotado', dilo y ofrece avisar cuando entre.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Nombre, talla o código del producto a buscar. Vacío no: usa una palabra del producto."),
    }),
    execute: async ({ query }) => {
      const repo = new CatalogRepo(new Db(env.DB));
      const matches = await repo.search(query, 8);

      if (matches.length === 0) {
        // Se ofrece el catálogo completo como plan B: la clienta que escribe
        // "hola, precios?" no busca nada en particular, y devolver una lista
        // vacía haría que el bot se disculpe en vez de vender.
        const todos = await repo.listActive(20);
        return {
          matches: [],
          mensaje:
            todos.length > 0
              ? "No hay ningún producto que coincida con esa búsqueda. Esto es lo que sí hay disponible."
              : "El catálogo todavía no está cargado. No inventes precios: pasa la conversación a una persona.",
          catalogoCompleto: todos.map(publico),
        };
      }

      return { matches: matches.map(publico) };
    },
  });
}

function publico(p: CatalogProduct) {
  return {
    codigo: p.code,
    nombre: p.name,
    precio: fmtUSD(p.salePrice),
    // "disponible" | "pocas" | "agotado" — nunca el número exacto.
    disponibilidad: disponibilidadDe(p),
    bodegas: p.stock.filter((s) => s.stockQty > 0).map((s) => s.branch),
  };
}
