import { Db } from "./client";
import { disponibilidad, type Disponibilidad } from "../catalog/validation";

/**
 * Una fila de `catalog_items` = un producto en una bodega.
 *
 * El bot NUNCA ve `cost_price`: las consultas que alimentan a catalogQuery
 * seleccionan PUBLIC_COLS, que no incluye esa columna. No es un filtro que se
 * aplica después — el dato no sale de la base.
 */
export interface CatalogRow {
  code: string;
  name: string;
  sale_price: number; // centavos USD
  stock_qty: number;
  branch: string;
  active: number;
  updated_at: number;
}

/** Igual que CatalogRow pero CON costo — SOLO para el panel admin. */
export interface AdminCatalogRow extends CatalogRow {
  cost_price: number | null;
}

/** Un producto visto como lo entiende el negocio: precio único, stock por bodega. */
export interface CatalogProduct {
  code: string;
  name: string;
  salePrice: number;
  costPrice: number | null;
  active: boolean;
  stock: Array<{ branch: string; stockQty: number }>;
  stockTotal: number;
  updatedAt: number;
}

const PUBLIC_COLS = "code, name, sale_price, stock_qty, branch, active, updated_at";

/**
 * Tope de filas que trae una búsqueda. Son filas (producto × bodega), no
 * productos: con tres bodegas esto son ~666 productos activos, muy por encima
 * de lo que maneja el negocio. Es una red contra un catálogo desbocado, no un
 * límite de uso.
 */
const MAX_FILAS_BUSQUEDA = 2_000;

/** Quita tildes y pasa a minúsculas para comparar "panal" con "Pañal". */
function plano(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const ESCAPAR_REGEX = /[.*+?^${}()|[\]\\]/g;

/**
 * ¿Aparecen TODAS las palabras, completas, en el texto?
 *
 * "Completa" quiere decir que no esté pegada a otra letra o número: así "XL"
 * no coincide con "XXL" ni con "3XL", y "M" no coincide con "Moon". El guion
 * sí corta palabra, para que buscar "NAT-M" o "M" funcione en el código.
 */
function coincide(texto: string, palabras: string[]): boolean {
  const heno = plano(texto);
  return palabras.every((palabra) => {
    const aguja = plano(palabra).replace(ESCAPAR_REGEX, "\\$&");
    if (!aguja) return true;
    return new RegExp(`(?<![\\p{L}\\p{N}])${aguja}(?![\\p{L}\\p{N}])`, "u").test(heno);
  });
}
const ADMIN_COLS = `${PUBLIC_COLS}, cost_price`;

/** Agrupa filas (producto × bodega) en productos. Conserva el orden de entrada. */
function agrupar(rows: AdminCatalogRow[]): CatalogProduct[] {
  const porCodigo = new Map<string, CatalogProduct>();
  for (const r of rows) {
    let p = porCodigo.get(r.code);
    if (!p) {
      p = {
        code: r.code,
        name: r.name,
        salePrice: r.sale_price,
        costPrice: r.cost_price ?? null,
        active: r.active === 1,
        stock: [],
        stockTotal: 0,
        updatedAt: r.updated_at,
      };
      porCodigo.set(r.code, p);
    }
    p.stock.push({ branch: r.branch, stockQty: r.stock_qty });
    p.stockTotal += r.stock_qty;
    p.updatedAt = Math.max(p.updatedAt, r.updated_at);
  }
  return [...porCodigo.values()];
}

export class CatalogRepo {
  constructor(private readonly db: Db) {}

  // ── Lectura para el AGENTE (sin costo) ───────────────────────────────────

  /**
   * Busca por código o por nombre entre los productos ACTIVOS.
   *
   * Cada PALABRA de la búsqueda tiene que aparecer completa en el nombre o en
   * el código. Dos precisiones que parecen detalle y no lo son:
   *
   *  · Palabra completa, no subcadena. Buscando "XL" la subcadena encuentra
   *    también "XXL" y el "3XL" del fular; buscando "M", encuentra "Moon".
   *    El modelo recibía tres productos donde había uno y elegía precio.
   *  · Sin tildes. La clienta escribe "panales talla m" y el catálogo dice
   *    "Pañal". El LIKE de SQLite no dobla la ñ ni las tildes.
   *
   * Por eso el filtrado ocurre en JS y no en el WHERE: es un catálogo de un
   * negocio, decenas de productos, y ya se traía el conjunto activo entero
   * para las preguntas generales. La precisión vale mucho más que el ahorro.
   *
   * Si no hay coincidencia devuelve [] y quien llama decide el plan B (hoy
   * catalogQuery ofrece el catálogo completo, que es la conducta de siempre).
   *
   * `limit` cuenta productos, no filas.
   */
  async search(query: string, limit = 8): Promise<CatalogProduct[]> {
    const palabras = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    if (palabras.length === 0) return [];

    const rows = await this.db.all<CatalogRow>(
      `SELECT ${PUBLIC_COLS} FROM catalog_items WHERE active = 1 ORDER BY name, branch LIMIT ?`,
      [MAX_FILAS_BUSQUEDA],
    );
    const productos = agrupar(rows as AdminCatalogRow[]);
    return productos.filter((p) => coincide(`${p.name} ${p.code}`, palabras)).slice(0, limit);
  }

  /** Todos los activos — para cuando la clienta pregunta "¿qué tienen?". */
  async listActive(limit = 50): Promise<CatalogProduct[]> {
    const rows = await this.db.all<CatalogRow>(
      `SELECT ${PUBLIC_COLS} FROM catalog_items WHERE active = 1 ORDER BY name, branch LIMIT ?`,
      [limit * 8],
    );
    return agrupar(rows as AdminCatalogRow[]).slice(0, limit);
  }

  // ── Lectura para el PANEL (con costo) ────────────────────────────────────

  async listAllForAdmin(limit = 500): Promise<CatalogProduct[]> {
    const rows = await this.db.all<AdminCatalogRow>(
      `SELECT ${ADMIN_COLS} FROM catalog_items ORDER BY name, branch LIMIT ?`,
      [limit * 8],
    );
    return agrupar(rows).slice(0, limit);
  }

  async getForAdmin(code: string): Promise<CatalogProduct | null> {
    const rows = await this.db.all<AdminCatalogRow>(
      `SELECT ${ADMIN_COLS} FROM catalog_items WHERE code = ? ORDER BY branch`,
      [code],
    );
    return rows.length ? agrupar(rows)[0] : null;
  }

  async allCodes(): Promise<string[]> {
    const rows = await this.db.all<{ code: string }>("SELECT DISTINCT code FROM catalog_items");
    return rows.map((r) => r.code);
  }

  // ── Escritura (solo panel admin) ─────────────────────────────────────────

  /**
   * Guarda el producto completo: una fila por bodega, todas con el mismo
   * nombre y los mismos precios.
   *
   * Borrar y reinsertar en vez de calcular el diff, por la misma razón que
   * PanaClaw hace con sus tramos: las filas no tienen identidad propia para la
   * dueña. Ella edita "el pañal M", no "la fila 3".
   *
   * El precio va en el producto y el stock en la bodega — por eso el nombre y
   * los precios se escriben iguales en todas las filas del código. Si cada
   * bodega pudiera tener su precio, bastaría con que la dueña editara una para
   * que el bot cotizara distinto según de cuál leyera.
   */
  async saveProduct(p: {
    code: string;
    name: string;
    costPrice: number | null;
    salePrice: number;
    active: boolean;
    stock: Array<{ branch: string; stockQty: number }>;
  }): Promise<void> {
    const now = Date.now();
    await this.db.run("DELETE FROM catalog_items WHERE code = ?", [p.code]);
    for (const s of p.stock) {
      await this.db.run(
        `INSERT INTO catalog_items
           (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.code, p.name, p.costPrice, p.salePrice, s.stockQty, s.branch, p.active ? 1 : 0, now],
      );
    }
  }

  async setActive(code: string, active: boolean): Promise<void> {
    await this.db.run("UPDATE catalog_items SET active = ?, updated_at = ? WHERE code = ?", [
      active ? 1 : 0,
      Date.now(),
      code,
    ]);
  }

  async delete(code: string): Promise<void> {
    await this.db.run("DELETE FROM catalog_items WHERE code = ?", [code]);
  }
}

/** Lo que la clienta puede oír: etiqueta de existencia, nunca el número. */
export function disponibilidadDe(p: CatalogProduct): Disponibilidad {
  return disponibilidad(p.stockTotal);
}
