import { Db } from "./client";

/**
 * Movimientos de inventario que NO pasan por el editor del panel: una venta
 * que la dueña registra desde Telegram, una devolución, un ajuste.
 *
 * El número vivo sigue siendo `catalog_items.stock_qty` —un dato, un solo
 * dueño, ver docs/FUENTES_DE_VERDAD.md—. Esta tabla es la bitácora: por qué
 * cambió, quién lo pidió, y cómo deshacerlo.
 */
export interface Movimiento {
  id: string;
  code: string;
  branch: string;
  delta: number;
  kind: "venta" | "devolucion" | "ajuste" | "deshacer";
  note: string | null;
  conversation_id: string | null;
  actor: string | null;
  undone_at: number | null;
  created_at: number;
}

export interface NuevoMovimiento {
  code: string;
  branch: string;
  delta: number;
  kind: Movimiento["kind"];
  note?: string | null;
  conversationId?: string | null;
  actor: string;
}

export type ResultadoMovimiento =
  | { ok: true; id: string; antes: number; despues: number }
  | { ok: false; error: string };

export class StockRepo {
  constructor(private readonly db: Db) {}

  /**
   * Aplica el movimiento y lo anota. El cambio de stock es UNA sentencia
   * condicionada a que no quede en negativo: dos ventas que llegan a la vez
   * por la última caja no pueden dejar el inventario en -1.
   *
   * delta 0 es válido: una devolución de un producto abierto se anota (pasó)
   * aunque no vuelva al inventario.
   */
  async aplicar(m: NuevoMovimiento): Promise<ResultadoMovimiento> {
    if (!Number.isInteger(m.delta)) return { ok: false, error: "La cantidad tiene que ser un número entero." };
    const fila = await this.db.first<{ stock_qty: number }>(
      "SELECT stock_qty FROM catalog_items WHERE code = ? AND branch = ?",
      [m.code, m.branch],
    );
    if (!fila) return { ok: false, error: `${m.code} no está cargado en ${m.branch}.` };

    if (m.delta !== 0) {
      const r = await this.db.run(
        `UPDATE catalog_items SET stock_qty = stock_qty + ?, updated_at = ?
          WHERE code = ? AND branch = ? AND stock_qty + ? >= 0`,
        [m.delta, Date.now(), m.code, m.branch, m.delta],
      );
      if ((r.meta?.changes ?? 0) !== 1) {
        return {
          ok: false,
          error: `En ${m.branch} hay ${fila.stock_qty} de ${m.code}: no alcanza para descontar ${-m.delta}.`,
        };
      }
    }

    const despues =
      (await this.db.first<{ stock_qty: number }>(
        "SELECT stock_qty FROM catalog_items WHERE code = ? AND branch = ?",
        [m.code, m.branch],
      ))?.stock_qty ?? fila.stock_qty + m.delta;

    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO stock_movements (id, code, branch, delta, kind, note, conversation_id, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, m.code, m.branch, m.delta, m.kind, m.note ?? null, m.conversationId ?? null, m.actor, Date.now()],
    );
    return { ok: true, id, antes: despues - m.delta, despues };
  }

  async porId(id: string): Promise<Movimiento | null> {
    return this.db.first<Movimiento>("SELECT * FROM stock_movements WHERE id = ?", [id]);
  }

  async ultimos(code?: string, n = 10): Promise<Movimiento[]> {
    return code
      ? this.db.all<Movimiento>(
          "SELECT * FROM stock_movements WHERE code = ? ORDER BY created_at DESC LIMIT ?",
          [code, n],
        )
      : this.db.all<Movimiento>("SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT ?", [n]);
  }

  /**
   * Deshace un movimiento aplicando el contrario, y lo marca. Un movimiento
   * se deshace una sola vez: el segundo intento no vuelve a sumar.
   */
  async deshacer(id: string, actor: string): Promise<ResultadoMovimiento> {
    const mov = await this.porId(id);
    if (!mov) return { ok: false, error: "No encontré ese movimiento." };
    const r = await this.db.run(
      "UPDATE stock_movements SET undone_at = ? WHERE id = ? AND undone_at IS NULL",
      [Date.now(), id],
    );
    if ((r.meta?.changes ?? 0) !== 1) return { ok: false, error: "Ese movimiento ya estaba deshecho." };
    const res = await this.aplicar({
      code: mov.code,
      branch: mov.branch,
      delta: -mov.delta,
      kind: "deshacer",
      note: `deshace ${mov.kind} ${id.slice(0, 8)}`,
      conversationId: mov.conversation_id,
      actor,
    });
    if (!res.ok) {
      // No se pudo revertir (ya se vendió lo que había vuelto): se deja como estaba.
      await this.db.run("UPDATE stock_movements SET undone_at = NULL WHERE id = ?", [id]);
    }
    return res;
  }
}
