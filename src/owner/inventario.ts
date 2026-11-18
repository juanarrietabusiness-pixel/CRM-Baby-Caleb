// El inventario, manejado desde el Telegram del dueño.
//
// Hasta ahora el stock solo se movía desde /admin/catalogo, a mano: una venta
// cerrada por WhatsApp no descontaba nada, y el bot seguía ofreciendo como
// "disponible" la última caja que ya se había vendido. La dueña pidió que el
// CRM gestione el catálogo igual que gestiona las conversaciones:
//
//   · una venta descuenta del stock,
//   · una devolución PREGUNTA si el producto vuelve al inventario — puede
//     llegar abierto, y un paquete abierto no se revende,
//   · y todo queda en una bitácora que se puede deshacer.
//
// El stock sigue viviendo en UN solo sitio, `catalog_items.stock_qty`: esto
// solo lo mueve, con la misma regla de no quedar en negativo. Ver
// docs/FUENTES_DE_VERDAD.md.

import { generateText, tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { CatalogRepo, type CatalogProduct } from "../db/catalog";
import { StockRepo, type Movimiento } from "../db/stock";
import { normalizeCode, SUCURSALES, fmtUSD } from "../catalog/validation";
import { MessagesRepo } from "../db/messages";
import { crearAccion, nuevoGrupo, buscarConversaciones } from "./acciones";
import type { Contexto, ExtensionDeConsola, Respuesta } from "./tipos";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";

// ── Productos y bodegas ────────────────────────────────────────────────────

const plano = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const palabras = (s: string) => plano(s).split(/[^a-z0-9]+/).filter(Boolean);

/** "Bodega Ciudad de Panamá Este Línea 2" → "Ciudad de Panamá Este Línea 2". */
export function bodegaCorta(branch: string): string {
  return branch.replace(/^Bodega\s+/i, "");
}

/**
 * Encuentra el producto por código exacto o, si no, por nombre. Si la
 * búsqueda deja más de uno, NO elige: devuelve las opciones y que decida la
 * dueña. Descontar el pañal equivocado es peor que preguntar.
 */
export async function resolverProducto(
  env: Env,
  texto: string,
): Promise<{ ok: true; producto: CatalogProduct } | { ok: false; error: string }> {
  const repo = new CatalogRepo(new Db(env.DB));
  const code = normalizeCode(texto);
  if (code) {
    const exacto = await repo.getForAdmin(code);
    if (exacto) return { ok: true, producto: exacto };
  }
  const encontrados = await repo.search(texto, 6);
  if (encontrados.length === 1) {
    return { ok: true, producto: (await repo.getForAdmin(encontrados[0].code)) ?? encontrados[0] };
  }
  if (encontrados.length === 0) return { ok: false, error: `No encontré "${texto}" en el catálogo. Use /stock para ver los códigos.` };
  return {
    ok: false,
    error: `"${texto}" coincide con varios productos: ${encontrados.map((p) => p.code).join(", ")}. Use el código exacto.`,
  };
}

/**
 * De qué bodega sale (o a cuál vuelve) el movimiento.
 *
 *   · Si la dueña la nombra ("oeste", "línea 2"), esa. Palabra completa:
 *     "este" no puede caer en "Oeste".
 *   · Una venta sale de la bodega con más stock que alcance.
 *   · Una devolución vuelve a la bodega principal, la primera de SUCURSALES.
 */
export function elegirBodega(
  p: CatalogProduct,
  delta: number,
  pista?: string,
): { ok: true; branch: string } | { ok: false; error: string } {
  if (pista?.trim()) {
    const buscadas = palabras(pista);
    const coinciden = p.stock
      .filter((s) => {
        const w = palabras(s.branch);
        return buscadas.every((b) => w.includes(b));
      })
      .sort((a, b) => a.branch.length - b.branch.length);
    if (coinciden.length === 0) {
      return { ok: false, error: `${p.code} no tiene la bodega "${pista}". Tiene: ${p.stock.map((s) => bodegaCorta(s.branch)).join(", ")}.` };
    }
    return { ok: true, branch: coinciden[0].branch };
  }
  if (p.stock.length === 0) return { ok: false, error: `${p.code} no tiene ninguna bodega cargada.` };
  if (delta < 0) {
    const alcanza = [...p.stock].filter((s) => s.stockQty >= -delta).sort((a, b) => b.stockQty - a.stockQty);
    if (alcanza.length === 0) {
      return {
        ok: false,
        error:
          `No hay ${-delta} de ${p.code} en una sola bodega (${p.stock.map((s) => `${bodegaCorta(s.branch)}: ${s.stockQty}`).join(" · ")}). ` +
          "Regístrela por partes indicando la bodega, p. ej. /venta NAT-M 2 oeste.",
      };
    }
    return { ok: true, branch: alcanza[0].branch };
  }
  const principal = p.stock.find((s) => s.branch === SUCURSALES[0]);
  return { ok: true, branch: (principal ?? p.stock[0]).branch };
}

export function lineaDeStock(p: CatalogProduct): string {
  const bodegas = p.stock.map((s) => `${bodegaCorta(s.branch)} ${s.stockQty}`).join(" · ");
  return `${p.code} — ${p.stockTotal} en total${p.active ? "" : " (INACTIVO)"}\n   ${bodegas} · ${fmtUSD(p.salePrice)}`;
}

// ── Movimientos ────────────────────────────────────────────────────────────

export interface Item {
  code: string;
  qty: number;
  pista?: string;
}

/**
 * "NAT-M 2, NAT-S 1 oeste" → [{NAT-M, 2}, {NAT-S, 1, oeste}]. También "2 NAT-M".
 * La cantidad es obligatoria: una venta sin número no se adivina.
 */
export function parsearItems(texto: string): { ok: true; items: Item[] } | { ok: false; error: string } {
  const partes = texto.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (partes.length === 0) return { ok: false, error: "Falta el producto y la cantidad. Ejemplo: /venta NAT-M 2" };
  const items: Item[] = [];
  for (const parte of partes) {
    const tokens = parte.split(/\s+/);
    const iNum = tokens.findIndex((t) => /^\d+$/.test(t));
    if (iNum === -1) return { ok: false, error: `"${parte}": falta la cantidad. Ejemplo: NAT-M 2` };
    const qty = Number(tokens[iNum]);
    if (qty <= 0 || qty > 500) return { ok: false, error: `"${parte}": la cantidad tiene que estar entre 1 y 500.` };
    const resto = tokens.filter((_, i) => i !== iNum);
    const codigo = iNum === 0 ? resto.shift() : resto.slice(0, iNum).join(" ");
    const pista = iNum === 0 ? resto.join(" ") : resto.slice(iNum).join(" ");
    if (!codigo) return { ok: false, error: `"${parte}": falta el producto.` };
    items.push({ code: codigo, qty, pista: pista || undefined });
  }
  return { ok: true, items };
}

/**
 * Descuenta una venta completa, o nada. Si el tercer producto no alcanza, los
 * dos primeros se devuelven: una venta a medias deja el inventario mintiendo.
 */
export async function aplicarVenta(
  ctx: Contexto,
  items: Item[],
  conversationId?: string | null,
): Promise<{ ok: true; texto: string; movimientos: string[] } | { ok: false; error: string }> {
  const stock = new StockRepo(new Db(ctx.env.DB));
  const hechos: string[] = [];
  const lineas: string[] = [];
  const fallar = async (error: string) => {
    for (const id of hechos.slice().reverse()) await stock.deshacer(id, ctx.actor);
    return { ok: false as const, error: `${error}\nNo se descontó nada.` };
  };
  for (const it of items) {
    const prod = await resolverProducto(ctx.env, it.code);
    if (!prod.ok) return fallar(prod.error);
    const bodega = elegirBodega(prod.producto, -it.qty, it.pista);
    if (!bodega.ok) return fallar(bodega.error);
    const res = await stock.aplicar({
      code: prod.producto.code,
      branch: bodega.branch,
      delta: -it.qty,
      kind: "venta",
      conversationId: conversationId ?? null,
      actor: ctx.actor,
    });
    if (!res.ok) return fallar(res.error);
    hechos.push(res.id);
    lineas.push(
      `• ${it.qty} × ${prod.producto.code} (${bodegaCorta(bodega.branch)}): ${res.antes} → ${res.despues}` +
        (res.despues === 0 ? " ⚠️ se agotó en esa bodega" : ""),
    );
  }
  return { ok: true, texto: lineas.join("\n"), movimientos: hechos };
}

async function aplicarDevolucion(
  ctx: Contexto,
  it: Item,
  reingresa: boolean,
  conversationId?: string | null,
): Promise<Respuesta> {
  const prod = await resolverProducto(ctx.env, it.code);
  if (!prod.ok) return { texto: `❌ ${prod.error}` };
  const bodega = elegirBodega(prod.producto, it.qty, it.pista);
  if (!bodega.ok) return { texto: `❌ ${bodega.error}` };
  const res = await new StockRepo(new Db(ctx.env.DB)).aplicar({
    code: prod.producto.code,
    branch: bodega.branch,
    delta: reingresa ? it.qty : 0,
    kind: "devolucion",
    note: reingresa ? "vuelve al inventario" : "NO vuelve al inventario (abierto o dañado)",
    conversationId: conversationId ?? null,
    actor: ctx.actor,
  });
  if (!res.ok) return { texto: `❌ ${res.error}` };
  if (!reingresa) {
    return { texto: `📝 Devolución anotada: ${it.qty} × ${prod.producto.code}. No se sumó al stock (sigue en ${res.despues}).` };
  }
  return {
    texto: `✅ Devolución: ${it.qty} × ${prod.producto.code} volvió a ${bodegaCorta(bodega.branch)}: ${res.antes} → ${res.despues}.`,
    teclado: [[{ texto: "↩️ Deshacer", data: await crearAccion(ctx.env, "deshacer", { movimientos: [res.id] }) }]],
  };
}

async function preguntarDevolucion(ctx: Contexto, it: Item, conversationId?: string | null): Promise<Respuesta> {
  const prod = await resolverProducto(ctx.env, it.code);
  if (!prod.ok) return { texto: `❌ ${prod.error}` };
  const grupo = nuevoGrupo();
  const base = { code: prod.producto.code, qty: it.qty, pista: it.pista, conversationId, grupo };
  return {
    texto:
      `↩️ Devolución de ${it.qty} × ${prod.producto.code}\n${prod.producto.name}\n\n` +
      "¿El producto vuelve al inventario? Si llegó abierto o dañado, no se revende.",
    teclado: [
      [{ texto: "✅ Sí, sumar al stock", data: await crearAccion(ctx.env, "devolucion", { ...base, reingresa: true }) }],
      [{ texto: "🚫 No, está abierto/dañado", data: await crearAccion(ctx.env, "devolucion", { ...base, reingresa: false }) }],
    ],
  };
}

/** La venta como propuesta con botones: la dueña confirma antes de descontar. */
export async function proponerVenta(ctx: Contexto, items: Item[], conversationId?: string | null): Promise<Respuesta> {
  const lineas: string[] = [];
  let total = 0;
  for (const it of items) {
    const prod = await resolverProducto(ctx.env, it.code);
    if (!prod.ok) return { texto: `❌ ${prod.error}` };
    total += prod.producto.salePrice * it.qty;
    lineas.push(`• ${it.qty} × ${prod.producto.code} — ${prod.producto.name} (quedan ${prod.producto.stockTotal})`);
  }
  const grupo = nuevoGrupo();
  return {
    texto: `🛒 ¿Registro esta venta y descuento del stock?\n${lineas.join("\n")}\nTotal de productos: ${fmtUSD(total)} (sin envío)`,
    conversationId: conversationId ?? null,
    teclado: [
      [
        { texto: "✅ Confirmar venta", data: await crearAccion(ctx.env, "venta", { items, conversationId, grupo }) },
        { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
      ],
    ],
  };
}

function textoMovimiento(m: Movimiento): string {
  const cuando = new Date(m.created_at).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" });
  const signo = m.delta > 0 ? `+${m.delta}` : String(m.delta);
  return `${cuando} · ${m.kind} ${m.code} ${signo} (${bodegaCorta(m.branch)})${m.undone_at ? " · deshecho" : ""}${m.note ? ` · ${m.note}` : ""}`;
}

// ── Leer una venta de la conversación ──────────────────────────────────────

/**
 * "🛒 Registrar venta" en el aviso de un ticket: se lee la conversación y se
 * PROPONE lo que se vendió, con botones. El modelo solo sugiere; descontar lo
 * decide la dueña con un toque. Si no se entiende, se dice, y ella escribe
 * /venta a mano.
 */
async function ventaDeLaConversacion(ctx: Contexto, conversationId: string): Promise<Respuesta> {
  const db = new Db(ctx.env.DB);
  const historial = await new MessagesRepo(db).lastN(conversationId, 30);
  const catalogo = await new CatalogRepo(db).listAllForAdmin(200);
  if (historial.length === 0) return { texto: "Esa conversación no tiene mensajes." };
  const { model } = createModel(ctx.env, "fast", await loadLlmOverrides(ctx.env));
  const r = await generateText({
    model,
    system:
      "Lees una conversación de una tienda y extraes QUÉ se vendió. Responde SOLO con líneas 'CODIGO CANTIDAD', " +
      "una por producto, usando los códigos del catálogo. Si no queda claro qué producto o cuántas unidades, responde exactamente NO_CLARO.\n\n" +
      `Catálogo:\n${catalogo.map((p) => `${p.code}: ${p.name}`).join("\n")}`,
    messages: [
      {
        role: "user",
        content: historial.map((m) => `${m.role === "user" ? "Clienta" : "Tienda"}: ${m.content}`).join("\n"),
      },
    ],
  });
  const texto = r.text.trim();
  const items = parsearItems(texto.replace(/\n/g, ","));
  if (/NO_CLARO/i.test(texto) || !items.ok) {
    return { texto: "No me queda claro qué se vendió en esa conversación. Regístrelo con /venta CÓDIGO CANTIDAD." };
  }
  return proponerVenta(ctx, items.items, conversationId);
}

// ── La extensión ───────────────────────────────────────────────────────────

async function conversacionDeRef(ctx: Contexto, ref: unknown): Promise<string | null> {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const [c] = await buscarConversaciones(ctx.env, ref, 1);
  return c?.id ?? null;
}

export const inventario: ExtensionDeConsola = {
  nombre: "inventario",
  ayuda: [
    "📦 Inventario",
    "/stock — todo el stock (o /stock nateen m)",
    "/venta NAT-M 2 — descuenta una venta (varias: NAT-M 2, NAT-S 1)",
    "/devolucion NAT-L 1 — pregunta si vuelve al inventario",
    "/ajuste NAT-M +3 · -1 · =10 — corrige el stock (bodega al final: oeste)",
    "/movimientos [código] — lo último que se movió",
  ],
  comandos: {
    stock: async (ctx, args) => {
      const repo = new CatalogRepo(new Db(ctx.env.DB));
      const productos = args.trim()
        ? await Promise.all((await repo.search(args, 12)).map(async (p) => (await repo.getForAdmin(p.code)) ?? p))
        : await repo.listAllForAdmin(60);
      if (productos.length === 0) return [{ texto: args.trim() ? `No encontré "${args}".` : "El catálogo está vacío." }];
      return [{ texto: `📦 Stock${args.trim() ? ` · ${args.trim()}` : ""}\n\n${productos.map(lineaDeStock).join("\n")}` }];
    },
    venta: async (ctx, args) => {
      const p = parsearItems(args);
      if (!p.ok) return [{ texto: `❌ ${p.error}` }];
      const r = await aplicarVenta(ctx, p.items);
      if (!r.ok) return [{ texto: `❌ ${r.error}` }];
      return [
        {
          texto: `✅ Venta registrada\n${r.texto}`,
          teclado: [[{ texto: "↩️ Deshacer", data: await crearAccion(ctx.env, "deshacer", { movimientos: r.movimientos }) }]],
        },
      ];
    },
    devolucion: async (ctx, args) => {
      const p = parsearItems(args);
      if (!p.ok) return [{ texto: `❌ ${p.error.replace("/venta", "/devolucion")}` }];
      return Promise.all(p.items.map((it) => preguntarDevolucion(ctx, it)));
    },
    ajuste: async (ctx, args) => {
      const m = args.trim().match(/^(\S+)\s+([+=-]?)(\d+)(?:\s+(.+))?$/);
      if (!m) return [{ texto: "❌ Formato: /ajuste NAT-M +3 (sumar), -1 (restar) o =10 (dejar en 10)." }];
      const [, codigo, signo, numero, pista] = m;
      const prod = await resolverProducto(ctx.env, codigo);
      if (!prod.ok) return [{ texto: `❌ ${prod.error}` }];
      const n = Number(numero);
      const bodegaPrev = elegirBodega(prod.producto, signo === "-" ? -n : 1, pista);
      if (!bodegaPrev.ok) return [{ texto: `❌ ${bodegaPrev.error}` }];
      const actual = prod.producto.stock.find((s) => s.branch === bodegaPrev.branch)?.stockQty ?? 0;
      const delta = signo === "=" ? n - actual : signo === "-" ? -n : n;
      const res = await new StockRepo(new Db(ctx.env.DB)).aplicar({
        code: prod.producto.code,
        branch: bodegaPrev.branch,
        delta,
        kind: "ajuste",
        actor: ctx.actor,
      });
      if (!res.ok) return [{ texto: `❌ ${res.error}` }];
      return [
        {
          texto: `✅ Ajuste: ${prod.producto.code} en ${bodegaCorta(bodegaPrev.branch)}: ${res.antes} → ${res.despues}.`,
          teclado: [[{ texto: "↩️ Deshacer", data: await crearAccion(ctx.env, "deshacer", { movimientos: [res.id] }) }]],
        },
      ];
    },
    movimientos: async (ctx, args) => {
      const code = args.trim() ? normalizeCode(args) : undefined;
      const movs = await new StockRepo(new Db(ctx.env.DB)).ultimos(code, 12);
      if (movs.length === 0) return [{ texto: "Todavía no hay movimientos registrados." }];
      return [{ texto: `🧾 Últimos movimientos\n\n${movs.map(textoMovimiento).join("\n")}` }];
    },
  },
  acciones: {
    venta: async (ctx, p) => {
      const r = await aplicarVenta(ctx, (p.items as Item[]) ?? [], (p.conversationId as string) ?? null);
      if (!r.ok) return { texto: `❌ ${r.error}` };
      return {
        texto: `✅ Venta registrada\n${r.texto}`,
        teclado: [[{ texto: "↩️ Deshacer", data: await crearAccion(ctx.env, "deshacer", { movimientos: r.movimientos }) }]],
      };
    },
    devolucion: async (ctx, p) =>
      aplicarDevolucion(
        ctx,
        { code: String(p.code), qty: Number(p.qty), pista: (p.pista as string) || undefined },
        p.reingresa === true,
        (p.conversationId as string) ?? null,
      ),
    deshacer: async (ctx, p) => {
      const stock = new StockRepo(new Db(ctx.env.DB));
      const lineas: string[] = [];
      for (const id of ((p.movimientos as string[]) ?? []).slice().reverse()) {
        const r = await stock.deshacer(id, ctx.actor);
        const mov = await stock.porId(id);
        lineas.push(r.ok ? `• ${mov?.code}: ${r.antes} → ${r.despues}` : `• ${r.error}`);
      }
      return { texto: `↩️ Deshecho\n${lineas.join("\n")}` };
    },
    ventaDeChat: async (ctx, p) => ventaDeLaConversacion(ctx, String(p.conversationId)),
  },
  botonesDeAviso: async (ctx, conversationId) => [
    { texto: "🛒 Registrar venta", data: await crearAccion(ctx.env, "ventaDeChat", { conversationId }) },
  ],
  instrucciones:
    "INVENTARIO: puedes consultar el stock exacto (consultarStock) y PROPONER ventas, devoluciones y ajustes; " +
    "la dueña los confirma con un botón. Una devolución siempre pregunta si el producto vuelve al inventario " +
    "(puede llegar abierto). Nunca digas que descontaste algo: tú solo propones.",
  herramientas: (ctx, salida) => ({
    consultarStock: tool({
      description: "Stock exacto por bodega de los productos que coinciden (o de todo si la búsqueda va vacía).",
      inputSchema: z.object({ busqueda: z.string().default("") }),
      execute: async ({ busqueda }) => (await inventario.comandos.stock(ctx, busqueda))[0].texto,
    }),
    proponerVenta: tool({
      description: "Propone registrar una venta (descontar del stock). La dueña confirma con un botón.",
      inputSchema: z.object({
        items: z.array(z.object({ codigo: z.string(), cantidad: z.number().int().min(1).max(500), bodega: z.string().optional() })).min(1),
        conversacion: z.string().optional().describe("Nombre o referencia de la conversación de la clienta, si la hay"),
      }),
      execute: async ({ items, conversacion }) => {
        const conv = await conversacionDeRef(ctx, conversacion);
        salida.push(await proponerVenta(ctx, items.map((i) => ({ code: i.codigo, qty: i.cantidad, pista: i.bodega })), conv));
        return "Propuesta enviada con botones. La dueña confirma.";
      },
    }),
    proponerDevolucion: tool({
      description: "Pregunta a la dueña, con botones, si una devolución vuelve al inventario.",
      inputSchema: z.object({
        codigo: z.string(),
        cantidad: z.number().int().min(1).max(500),
        bodega: z.string().optional(),
        conversacion: z.string().optional(),
      }),
      execute: async ({ codigo, cantidad, bodega, conversacion }) => {
        salida.push(await preguntarDevolucion(ctx, { code: codigo, qty: cantidad, pista: bodega }, await conversacionDeRef(ctx, conversacion)));
        return "Pregunta enviada con botones.";
      },
    }),
    proponerVentaDeConversacion: tool({
      description: "Lee la conversación de una clienta y propone la venta que se cerró ahí.",
      inputSchema: z.object({ conversacion: z.string() }),
      execute: async ({ conversacion }) => {
        const conv = await conversacionDeRef(ctx, conversacion);
        if (!conv) return "No encontré esa conversación.";
        salida.push(await ventaDeLaConversacion(ctx, conv));
        return "Propuesta enviada.";
      },
    }),
    verMovimientos: tool({
      description: "Últimos movimientos de inventario (de un código o de todos).",
      inputSchema: z.object({ codigo: z.string().default("") }),
      execute: async ({ codigo }) => (await inventario.comandos.movimientos(ctx, codigo))[0].texto,
    }),
  }),
};

// Exportados para las pruebas.
export const _interno = { aplicarDevolucion, preguntarDevolucion, ventaDeLaConversacion };
