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
   * `limit` cuenta productos, no filas: se traen más filas de la base porque
   * cada producto ocupa una por bodega, y se recorta después de agrupar.
   */
  async search(query: string, limit = 8): Promise<CatalogProduct[]> {
    const q = `%${query.trim()}%`;
    const rows = await this.db.all<CatalogRow>(
      `SELECT ${PUBLIC_COLS} FROM catalog_items
       WHERE active = 1 AND (name LIKE ? OR code LIKE ?)
       ORDER BY name, branch
       LIMIT ?`,
      [q, q, limit * 8],
    );
    // Se castea a AdminCatalogRow para reusar agrupar(); cost_price viene
    // undefined porque no se seleccionó, y agrupar() lo deja en null.
    return agrupar(rows as AdminCatalogRow[]).slice(0, limit);
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
