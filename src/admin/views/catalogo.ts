// Tab "Catálogo" — los productos que el bot puede cotizar, con su inventario
// por bodega.
//
// Se EDITA desde aquí: crear, modificar, activar/desactivar, duplicar y borrar
// (ver catalogoEditor.ts y las rutas /catalogo/* en routes.ts). La dueña ajusta
// un precio o una existencia sin abrir una terminal ni volver a desplegar.
//
// El costo y el margen se ven en esta pantalla y en ninguna otra: el bot nunca
// los lee (ver src/db/catalog.ts).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { CatalogRepo, type CatalogProduct } from "../../db/catalog";
import {
  SUCURSALES,
  STOCK_BAJO,
  fmtUSD,
  marginPct,
  disponibilidad,
} from "../../catalog/validation";
import { layout, ico, emptyState } from "./layout";

function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

const ACCION_BTN =
  "font-size:11px;text-decoration:none;color:var(--muted);border:1px solid var(--line);" +
  "padding:5px 11px;border-radius:4px;display:inline-block";

const PILL =
  "font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px";

function badgeStock(p: CatalogProduct): string {
  const estado = disponibilidad(p.stockTotal);
  if (estado === "agotado") {
    return `<span style="${PILL};color:var(--bad);border:1px solid var(--bad)">Agotado</span>`;
  }
  if (estado === "pocas") {
    return `<span style="${PILL};color:var(--warn);border:1px solid var(--warn)">Quedan pocas</span>`;
  }
  return "";
}

function filaBodega(s: { branch: string; stockQty: number }): string {
  const color =
    s.stockQty === 0 ? "var(--bad)" : s.stockQty < STOCK_BAJO ? "var(--warn)" : "var(--muted)";
  return `<tr style="border-top:1px solid var(--line)">
    <td style="padding:6px 10px;font-size:11.5px;color:var(--muted)">${esc(s.branch)}</td>
    <td style="padding:6px 10px;font-family:var(--font-mono);font-size:11.5px;color:${color};text-align:right">
      ${s.stockQty.toLocaleString("es-PA")}
    </td>
  </tr>`;
}

function productBlock(p: CatalogProduct, q: string): string {
  const volver = q ? `?q=${encodeURIComponent(q)}` : "";
  const sinBodega = p.stock.length === 0;
  return `
    <details style="border-top:1px solid var(--line)${p.active ? "" : ";opacity:.55"}">
      <summary style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;flex-wrap:wrap">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--dim);flex:none">${esc(p.code)}</span>
        <span style="font-family:var(--font-display);font-weight:600;font-size:12.5px;color:var(--cream);flex:1;min-width:120px">${esc(p.name)}</span>
        ${p.active ? "" : `<span style="${PILL};color:var(--warn);border:1px solid var(--warn)">Inactivo</span>`}
        ${badgeStock(p)}
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--cream);flex:none">${fmtUSD(p.salePrice)}</span>
        <span style="font-size:10.5px;color:var(--dim);flex:none">${p.stockTotal.toLocaleString("es-PA")} en stock</span>
      </summary>

      <div style="padding:8px 14px 0 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <a href="/admin/catalogo/${encodeURIComponent(p.code)}/editar" style="${ACCION_BTN};border-color:var(--accent);color:var(--accent)">Editar</a>
        <form method="post" action="/admin/catalogo/${encodeURIComponent(p.code)}/activo${volver}" style="display:inline">
          <input type="hidden" name="active" value="${p.active ? "0" : "1"}">
          <button type="submit" style="${ACCION_BTN};background:none;cursor:pointer;font-family:inherit">${p.active ? "Desactivar" : "Activar"}</button>
        </form>
        <form method="post" action="/admin/catalogo/${encodeURIComponent(p.code)}/duplicar" style="display:inline">
          <button type="submit" style="${ACCION_BTN};background:none;cursor:pointer;font-family:inherit">Duplicar</button>
        </form>
      </div>

      <div style="padding:10px 14px 14px 14px;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)">Costo</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--muted)">${p.costPrice !== null ? fmtUSD(p.costPrice) : "—"}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)">Venta</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--cream)">${fmtUSD(p.salePrice)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)">Margen</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--ok)">${marginPct(p.salePrice, p.costPrice)}</span>
          </div>
        </div>

        <div style="flex:1;min-width:260px;overflow-x:auto">
          ${
            sinBodega
              ? `<span class="text-dim text-[11.5px]">Sin bodegas asignadas todavía.</span>`
              : `<table style="width:100%;border-collapse:collapse">
                  <thead><tr style="text-align:left;color:var(--dim);font-size:10px;letter-spacing:.06em;text-transform:uppercase">
                    <th style="padding:6px 10px">Bodega</th>
                    <th style="padding:6px 10px;text-align:right">Stock</th>
                  </tr></thead>
                  <tbody>${p.stock.map(filaBodega).join("")}</tbody>
                </table>`
          }
        </div>
      </div>
    </details>`;
}

function aviso(texto: string, color: string): string {
  return `<div class="bg-panel border" style="border-color:${color};padding:11px 14px;margin-bottom:14px">
    <span class="text-[12px]" style="color:${color}">${esc(texto)}</span>
  </div>`;
}

export async function renderCatalogo(
  env: Env,
  opts: { q?: string; saved?: string; deleted?: boolean } = {},
): Promise<string> {
  const repo = new CatalogRepo(new Db(env.DB));
  const todos = await repo.listAllForAdmin(500);

  // Se filtra en el servidor por consistencia con el resto del panel; con
  // decenas de productos cualquiera de los dos caminos da igual.
  const q = (opts.q ?? "").trim();
  const needle = q.toLowerCase();
  const productos = needle
    ? todos.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle),
      )
    : todos;

  const activos = todos.filter((p) => p.active);
  const agotados = activos.filter((p) => p.stockTotal === 0).length;
  const bajos = activos.filter((p) => p.stockTotal > 0 && p.stockTotal < STOCK_BAJO).length;

  const kpi = (label: string, valor: string, color = "var(--cream)") => `
    <div class="bg-panel border border-line" style="padding:12px 16px;display:flex;flex-direction:column;gap:3px;min-width:120px">
      <span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)">${esc(label)}</span>
      <span style="font-family:var(--font-display);font-weight:700;font-size:20px;color:${color}">${esc(valor)}</span>
    </div>`;

  const body = `
    <div style="display:flex;flex-direction:column;gap:16px">
      ${opts.saved ? aviso(`Guardado: ${opts.saved}`, "var(--ok)") : ""}
      ${opts.deleted ? aviso("Producto borrado.", "var(--muted)") : ""}

      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${kpi("Productos", String(todos.length))}
        ${kpi("Activos", String(activos.length), "var(--accent)")}
        ${kpi("Agotados", String(agotados), agotados > 0 ? "var(--bad)" : "var(--cream)")}
        ${kpi("Quedan pocas", String(bajos), bajos > 0 ? "var(--warn)" : "var(--cream)")}
        ${kpi("Bodegas", String(SUCURSALES.length))}
      </div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <form method="get" action="/admin/catalogo" style="display:flex;gap:8px;align-items:center;flex:1;min-width:220px">
          <input name="q" value="${esc(q)}" placeholder="Buscar por nombre o código…"
                 style="flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px 12px;font-size:12.5px;font-family:inherit;border-radius:4px">
          <button type="submit" style="${ACCION_BTN};background:none;cursor:pointer;font-family:inherit;padding:9px 14px">Buscar</button>
        </form>
        <a href="/admin/catalogo/nuevo" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
           style="background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);box-shadow:0 6px 18px rgba(0,0,0,.45);padding:9px 16px;display:flex;align-items:center;gap:8px;white-space:nowrap;text-decoration:none">
          ${ico("plus", 14)} Nuevo producto
        </a>
      </div>

      ${
        productos.length === 0
          ? todos.length === 0
            ? emptyState(
                "package",
                "El catálogo está vacío",
                "Agregue su primer producto y el bot podrá dar precios reales. Mientras esté vacío, no cotiza nada.",
              )
            : emptyState("search-x", "Ningún producto coincide", `No hay resultados para "${esc(q)}".`)
          : `<div class="bg-panel border border-line" style="overflow:hidden">
              <div style="padding:12px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
                <span class="font-display font-bold text-[13px] text-cream">Productos</span>
                <span style="font-size:11px;color:var(--dim)">${productos.length}${q ? ` de ${todos.length}` : ""}</span>
              </div>
              ${productos.map((p) => productBlock(p, q)).join("")}
            </div>`
      }

      <p class="text-dim text-[11px]" style="margin:0;max-width:640px">
        El costo y el margen <strong>solo los ve usted</strong>: el bot nunca los consulta.
        A la clienta tampoco le dice cuántas unidades quedan — con menos de ${STOCK_BAJO} dice
        "quedan pocas", y en cero dice que está agotado y ofrece avisar cuando entre.
      </p>
    </div>`;

  return layout({ title: "Catálogo", activeTab: "catalogo", body, env });
}
