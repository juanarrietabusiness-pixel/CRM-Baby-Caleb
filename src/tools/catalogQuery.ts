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
 * La ÚNICA excepción a (2) es `cantidad`: cuando la clienta pide una cantidad
 * concreta ("necesito 30 cajas") el bot la pasa y la tool responde si alcanza.
 * Si NO alcanza —y solo entonces— devuelve el máximo que sí se puede prometer,
 * porque decir "de 30 no, de 25 sí" es la respuesta útil y no hay forma de
 * darla sin el número. Si alcanza, el número sigue sin salir: basta un sí.
 *
 * El desglose por bodega sí viene, sin cantidades: sirve para coordinar el
 * delivery, que es como vende Baby Caleb.
 */

const CATALOGO_VACIO =
  "El catálogo todavía no está cargado. No inventes precios: pasa la conversación a una persona.";

export function catalogQueryTool(env: Env) {
  return tool({
    description:
      "La ÚNICA fuente de verdad sobre qué vende este negocio, a qué precio y si hay existencias. " +
      "ÚSALA SIEMPRE antes de nombrar un producto, decir un precio o afirmar que hay o no hay disponibilidad — " +
      "nunca de memoria, nunca estimando. Busca por nombre o código ('pañal talla M', 'wipes', 'NAT-XL'). " +
      "Si la pregunta es general ('¿qué tienen?', '¿qué hay disponible?', 'mándame la lista') llámala SIN `query` " +
      "y responde solo con lo que devuelva. Si un producto no aparece, no se vende: dilo y ofrece pasar con una " +
      "persona — jamás lo ofrezcas 'por si acaso'. Cuando pidan una cantidad concreta ('necesito 30 cajas') pasa " +
      "esa cantidad en `cantidad`: si `alcanza` es true, confirma sin dar cifras de inventario; si es false, " +
      "ofrece `maximoDisponible`, que es lo máximo que puedes prometer. Fuera de ese caso la cantidad exacta de " +
      "inventario no se le dice a la clienta: si viene 'pocas', di que quedan pocas unidades; si viene 'agotado', " +
      "dilo y ofrece avisar cuando entre.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Nombre, talla o código del producto. Omítelo para traer el catálogo completo (pregunta general).",
        ),
      cantidad: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Cuántas unidades pide la clienta. Solo cuando dio un número ('30 cajas'): la tool responde si alcanza.",
        ),
    }),
    execute: async ({ query, cantidad }) => {
      const repo = new CatalogRepo(new Db(env.DB));
      const q = (query ?? "").trim();

      // Pregunta general ("¿qué tienen?"): sin término de búsqueda se devuelve
      // el catálogo activo. Este es el hueco por el que el bot se inventó
      // "cremas y lociones" — no tenía forma de listar, así que improvisó.
      if (!q) {
        const todos = await repo.listActive(20);
        return todos.length > 0
          ? { catalogoCompleto: todos.map((p) => publico(p, cantidad)) }
          : { catalogoCompleto: [], mensaje: CATALOGO_VACIO };
      }

      const matches = await repo.search(q, 8);

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
              : CATALOGO_VACIO,
          catalogoCompleto: todos.map((p) => publico(p, cantidad)),
        };
      }

      return { matches: matches.map((p) => publico(p, cantidad)) };
    },
  });
}

function publico(p: CatalogProduct, cantidad?: number) {
  const base = {
    codigo: p.code,
    nombre: p.name,
    precio: fmtUSD(p.salePrice),
    // "disponible" | "pocas" | "agotado" — nunca el número exacto.
    disponibilidad: disponibilidadDe(p),
    bodegas: p.stock.filter((s) => s.stockQty > 0).map((s) => s.branch),
  };
  return cantidad === undefined ? base : { ...base, pedido: cobertura(p, cantidad) };
}

/**
 * ¿Se puede cumplir el pedido? Suma todas las bodegas: Baby Caleb entrega por
 * delivery, así que para la clienta el inventario es uno solo.
 *
 * `maximoDisponible` SOLO aparece cuando no alcanza. Es el único punto donde el
 * número real sale de la base, y sale porque sin él la respuesta útil ("de 30
 * no, de 25 sí") no existe.
 */
function cobertura(p: CatalogProduct, cantidad: number) {
  return p.stockTotal >= cantidad
    ? { cantidadPedida: cantidad, alcanza: true as const }
    : { cantidadPedida: cantidad, alcanza: false as const, maximoDisponible: p.stockTotal };
}
