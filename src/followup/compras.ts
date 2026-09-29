/**
 * ¿Esta clienta ya compró? El seguimiento lo necesita saber para no escribirle
 * «¿Desea algún pedido?» a quien acaba de pagar.
 *
 * Hasta el 29-sep-2026 el sistema no lo sabía: la única pista era que la
 * clienta escribiera «ya compré», y eso la sacaba del seguimiento PARA SIEMPRE,
 * como si hubiera dicho que no le interesa. De 280 conversaciones, 4 tenían una
 * venta registrada. El resto de las ventas se cerraban a mano por WhatsApp y el
 * seguimiento salía 5 horas después igual.
 *
 * Ahora cuentan cuatro señales, la más reciente manda:
 *   1. la dueña la marca: botón «✅ Compró» en el aviso, o /compro #ref;
 *   2. una venta registrada con conversación (/venta desde un aviso, «🛒 Registrar venta»);
 *   3. un ticket de pago (handoffHuman con categoría billing: comprobante, «ya pagué»);
 *   4. la clienta lo dice por escrito: «ya compré», «ya me llegó el pedido», «ya pagué».
 *
 * Las señales 1 y 4 viven en `compras`; la 2 y la 3 se leen de sus tablas, sin
 * copiarlas: un dato, un solo dueño.
 */
import type { Env } from "../env";
import { Db } from "../db/client";

const sinTildes = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * «Ya compré», «ya me llegó el pedido», «ya lo recibí». NO «ya compré en otro
 * lado»: eso es que no le interesa (ver noQuiereSeguimiento).
 */
export function diceQueCompro(texto: string): boolean {
  const t = sinTildes(texto);
  if (/\bya (lo |la |los |las )?compre en otr[oa] (lado|parte|sitio|lugar|tienda)/.test(t)) return false;
  return /\b(ya (lo |la |los |las )?compre\b|ya (me )?(llego|llegaron) (el|mi|los|mis|la|las) (pedido|caja|cajas|panales|panal|wipes|toallitas|fular|paquete)|ya (lo|la|los|las) recibi\b|ya recibi (el|mi|los|mis|la|las) (pedido|caja|cajas|panales|wipes|toallitas|fular|paquete)|ya (hice|realice) (el|mi) pedido)/.test(
    t,
  );
}

/** «Ya pagué», «ya le mandé el comprobante», «ya hice el yappy». */
export function diceQuePago(texto: string): boolean {
  const t = sinTildes(texto);
  return /\b(ya (le |les )?(pague|abone|transferi|deposite|yappie)\b|ya (le |les )?(hice|mande|envie) (el )?(pago|abono|yappy|comprobante|deposito|transferencia)|(aqui|ahi) (esta|va|le va|les va) (el )?comprobante)/.test(
    t,
  );
}

/**
 * La última compra registrada (señales 1, 2 y 3), o null. La 4 la agrega
 * `anotarCompraDicha` al revisar los mensajes, y desde ahí también vive en
 * `compras`.
 */
export async function ultimaCompra(db: Db, conversationId: string): Promise<number | null> {
  const r = await db.first<{ p: number | null }>(
    `SELECT MAX(p) AS p FROM (
       SELECT MAX(comprado_en) AS p FROM compras WHERE conversation_id = ?
       UNION ALL
       SELECT MAX(created_at) FROM stock_movements WHERE conversation_id = ? AND kind = 'venta' AND undone_at IS NULL
       UNION ALL
       SELECT MAX(created_at) FROM tickets WHERE conversation_id = ? AND category = 'billing'
     )`,
    [conversationId, conversationId, conversationId],
  );
  return r?.p ?? null;
}

/** La dueña marca que la clienta compró. Devuelve cuándo quedó anotada. */
export async function marcarCompra(
  env: Env,
  conversationId: string,
  opts: { actor?: string; nota?: string; cuando?: number } = {},
): Promise<number> {
  const cuando = opts.cuando ?? Date.now();
  await new Db(env.DB).run(
    "INSERT INTO compras (id, conversation_id, comprado_en, origen, nota, actor, created_at) VALUES (?, ?, ?, 'duena', ?, ?, ?)",
    [crypto.randomUUID(), conversationId, cuando, opts.nota ?? null, opts.actor ?? null, Date.now()],
  );
  return cuando;
}

/**
 * Quita las compras anotadas en `compras` (las de la dueña y las dichas). Las
 * ventas registradas y los tickets de pago siguen contando: esas se deshacen en
 * su sitio (/movimientos, el panel).
 */
export async function desmarcarCompra(env: Env, conversationId: string): Promise<number> {
  const r = await new Db(env.DB).run("DELETE FROM compras WHERE conversation_id = ?", [conversationId]);
  return r.meta?.changes ?? 0;
}

/**
 * Si entre sus mensajes la clienta dijo que ya compró o ya pagó, lo anota (una
 * vez por mensaje) y devuelve la hora del más reciente; si no, null.
 */
export async function anotarCompraDicha(
  db: Db,
  conversationId: string,
  mensajes: { content: string; created_at: number }[],
): Promise<number | null> {
  const dicho = mensajes
    .filter((m) => diceQueCompro(m.content) || diceQuePago(m.content))
    .reduce<number | null>((max, m) => (max === null || m.created_at > max ? m.created_at : max), null);
  if (dicho === null) return null;
  await db.run(
    "INSERT OR IGNORE INTO compras (id, conversation_id, comprado_en, origen, nota, actor, created_at) VALUES (?, ?, ?, 'dijo', NULL, NULL, ?)",
    [`${conversationId}:dijo:${dicho}`, conversationId, dicho, Date.now()],
  );
  return dicho;
}
