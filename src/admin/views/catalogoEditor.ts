// Formulario de alta/edición de un producto del catálogo.
//
// Hablamos en lenguaje del negocio, no de la base de datos: la dueña escribe
// "45.00", no 4500 centavos; elige la bodega de un desplegable en vez de
// teclearla (una bodega mal escrita parte el inventario en dos); y el margen se
// recalcula mientras escribe, para ver al instante si está vendiendo por debajo
// del costo.
//
// Sin framework ni build: HTML server-rendered + un poco de JS para agregar y
// quitar filas de bodega.
import type { Env } from "../../env";
import type { CatalogProduct } from "../../db/catalog";
import { SUCURSALES, centsToInput } from "../../catalog/validation";
import { layout, ico } from "./layout";

function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

const INPUT =
  "width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);" +
  "padding:9px 11px;font-size:12.5px;font-family:inherit;border-radius:4px";
const CELL_INPUT =
  "width:100%;background:transparent;border:1px solid var(--line);color:var(--cream);" +
  "padding:6px 8px;font-size:12px;font-family:var(--font-mono);border-radius:3px";

function campo(label: string, ayuda: string, control: string): string {
  return `
    <div style="display:flex;flex-direction:column;gap:5px">
      <label class="font-display font-semibold text-[12.5px] text-cream">${esc(label)}</label>
      ${ayuda ? `<p class="text-dim text-[11px]" style="margin:0">${esc(ayuda)}</p>` : ""}
      ${control}
    </div>`;
}

function filaBodega(s: { branch?: string; stockQty?: number }): string {
  const opciones = SUCURSALES.map(
    (b) => `<option value="${esc(b)}"${s.branch === b ? " selected" : ""}>${esc(b)}</option>`,
  ).join("");
  return `
    <tr data-fila>
      <td style="padding:4px">
        <select name="stock_branch" style="${CELL_INPUT};font-family:inherit">${opciones}</select>
      </td>
      <td style="padding:4px">
        <input name="stock_qty" value="${s.stockQty ?? ""}" inputmode="numeric" placeholder="0" style="${CELL_INPUT}">
      </td>
      <td style="padding:4px;text-align:center">
        <button type="button" data-quitar title="Quitar esta bodega"
                style="background:none;border:1px solid var(--line);color:var(--dim);cursor:pointer;border-radius:3px;padding:4px 7px;font-size:11px">✕</button>
      </td>
    </tr>`;
}

export function renderCatalogoEditor(
  env: Env,
  data: {
    product: CatalogProduct | null;
    errors?: string[];
    warnings?: string[];
  },
): string {
  const p = data.product;
  const esNuevo = p === null;
  // Un producto nuevo arranca con las tres bodegas listas en cero: es lo que la
  // dueña va a querer el 90% de las veces, y quitar una fila es más rápido que
  // agregar tres.
  const filas =
    p && p.stock.length > 0 ? p.stock : SUCURSALES.map((b) => ({ branch: b, stockQty: 0 }));

  const avisos = (lista: string[] | undefined, color: string, titulo: string) =>
    lista && lista.length > 0
      ? `<div class="bg-panel border" style="border-color:${color};padding:12px 14px;display:flex;flex-direction:column;gap:6px">
           <span class="font-display font-bold text-[12px]" style="color:${color}">${esc(titulo)}</span>
           ${lista.map((e) => `<span class="text-[12px] text-cream">• ${esc(e)}</span>`).join("")}
         </div>`
      : "";

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px;max-width:920px">
      <div style="display:flex;align-items:center;gap:10px">
        <a href="/admin/catalogo" style="color:var(--dim);text-decoration:none;font-size:12px">← Volver al catálogo</a>
      </div>

      <h1 class="font-display font-bold text-[19px] text-cream">
        ${esNuevo ? "Nuevo producto" : esc(p!.name)}
      </h1>

      ${avisos(data.errors, "var(--bad)", "No se pudo guardar")}
      ${avisos(data.warnings, "var(--warn)", "Revise esto antes de continuar")}

      <form method="post" action="/admin/catalogo/guardar" style="display:flex;flex-direction:column;gap:18px">
        <input type="hidden" name="original_code" value="${esNuevo ? "" : esc(p!.code)}">

        <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
          ${campo(
            "Código de producto",
            "El código que usa usted para identificarlo. Se guarda en mayúsculas y con guiones (nat rn → NAT-RN).",
            `<input name="code" required value="${esNuevo ? "" : esc(p!.code)}" placeholder="NAT-RN" style="${INPUT};font-family:var(--font-mono)">`,
          )}

          ${campo(
            "Nombre del producto",
            "Como se lo dice a la clienta. Es lo que el bot va a repetir por WhatsApp.",
            `<input name="name" required value="${esNuevo ? "" : esc(p!.name)}" placeholder="Pañal Nateen Talla RN (2–5 kg)" style="${INPUT}">`,
          )}

          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:190px">
              ${campo(
                "Precio de costo",
                "Lo que a usted le cuesta. Solo lo ve usted: el bot nunca lo lee. Puede dejarlo vacío.",
                `<input name="cost_price" value="${esNuevo ? "" : centsToInput(p!.costPrice)}" inputmode="decimal" placeholder="28.00" style="${INPUT};font-family:var(--font-mono)" data-costo>`,
              )}
            </div>
            <div style="flex:1;min-width:190px">
              ${campo(
                "Precio de venta",
                "En dólares, con centavos. Es el único precio que el bot le dice a la clienta.",
                `<input name="sale_price" required value="${esNuevo ? "" : centsToInput(p!.salePrice)}" inputmode="decimal" placeholder="45.00" style="${INPUT};font-family:var(--font-mono)" data-precio>`,
              )}
            </div>
            <div style="flex:none;display:flex;flex-direction:column;gap:5px;min-width:96px">
              <label class="font-display font-semibold text-[12.5px] text-cream">Margen</label>
              <p class="text-dim text-[11px]" style="margin:0">Se calcula solo.</p>
              <div style="padding:9px 11px;font-family:var(--font-mono);font-size:14px;color:var(--dim)" data-margen>—</div>
            </div>
          </div>

          <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
            <input type="checkbox" name="active" value="1"${esNuevo || p!.active ? " checked" : ""} style="width:16px;height:16px;accent-color:var(--accent)">
            <span style="display:flex;flex-direction:column;gap:2px">
              <span class="font-display font-semibold text-[12.5px] text-cream">Activo</span>
              <span class="text-dim text-[11px]">Si lo desactiva, el bot deja de ofrecerlo y de dar su precio, pero no se pierde nada.</span>
            </span>
          </label>
        </div>

        <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <h2 class="font-display font-bold text-[14px] text-cream">Stock por bodega</h2>
            <p class="text-dim text-[11px]" style="margin:0">
              Una fila por bodega donde tenga este producto. Si no lo maneja en alguna, quítela.
              El bot suma todas para saber si hay o no hay, pero <strong>nunca le dice a la clienta
              cuántas unidades quedan</strong>.
            </p>
          </div>

          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="text-align:left;color:var(--dim);font-size:10px;letter-spacing:.06em;text-transform:uppercase">
                  <th style="padding:4px 8px">Bodega</th>
                  <th style="padding:4px 8px">Cantidad de stock</th>
                  <th style="padding:4px 8px"></th>
                </tr>
              </thead>
              <tbody id="cuerpo-bodegas">${filas.map(filaBodega).join("")}</tbody>
            </table>
          </div>

          <button type="button" id="agregar-fila"
                  style="width:fit-content;background:none;border:1px dashed var(--line);color:var(--muted);cursor:pointer;padding:8px 14px;font-size:12px;border-radius:4px">
            + Agregar bodega
          </button>
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="submit" class="bigbtn font-display font-bold text-[13px] cursor-pointer"
                  style="background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);box-shadow:0 10px 28px rgba(0,0,0,.5);padding:13px 24px;display:flex;align-items:center;gap:8px">
            ${ico("check", 14)} Guardar producto
          </button>
          <a href="/admin/catalogo" style="color:var(--dim);text-decoration:none;font-size:12.5px;padding:13px 8px">Cancelar</a>
        </div>
      </form>

      ${esNuevo ? "" : renderZonaPeligro(p!)}
    </div>

    <script>
      (function () {
        var cuerpo = document.getElementById("cuerpo-bodegas");
        if (!cuerpo) return;

        var precio = document.querySelector("[data-precio]");
        var costo = document.querySelector("[data-costo]");
        var celda = document.querySelector("[data-margen]");

        function recalcular() {
          if (!celda) return;
          var v = parseFloat((precio && precio.value) || "");
          var c = parseFloat((costo && costo.value) || "");
          if (!isFinite(v) || v <= 0 || !isFinite(c) || c <= 0) {
            celda.textContent = "—";
            celda.style.color = "var(--dim)";
            return;
          }
          var pct = ((v - c) / v) * 100;
          celda.textContent = pct.toFixed(0) + "%";
          // Vender por debajo del costo se ve al instante, antes de guardar.
          celda.style.color = pct < 0 ? "var(--bad)" : pct < 15 ? "var(--warn)" : "var(--ok)";
        }

        if (precio) precio.addEventListener("input", recalcular);
        if (costo) costo.addEventListener("input", recalcular);
        recalcular();

        cuerpo.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-quitar]");
          if (!btn) return;
          var filas = cuerpo.querySelectorAll("[data-fila]");
          // Siempre queda una fila: una tabla vacía no se puede volver a llenar.
          if (filas.length <= 1) {
            var input = btn.closest("[data-fila]").querySelector("input");
            if (input) input.value = "";
            return;
          }
          btn.closest("[data-fila]").remove();
        });

        document.getElementById("agregar-fila").addEventListener("click", function () {
          var ultima = cuerpo.querySelector("[data-fila]:last-child");
          var nueva = ultima.cloneNode(true);
          Array.prototype.forEach.call(nueva.querySelectorAll("input"), function (i) { i.value = ""; });
          cuerpo.appendChild(nueva);
        });
      })();
    </script>`;

  return layout({
    title: esNuevo ? "Nuevo producto" : "Editar producto",
    activeTab: "catalogo",
    body,
    env,
  });
}

/**
 * Borrar es el camino difícil a propósito. Desactivar resuelve el 99% de los
 * casos y es reversible; borrar no.
 */
function renderZonaPeligro(p: CatalogProduct): string {
  return `
    <details class="bg-panel border" style="border-color:var(--bad);padding:16px 18px">
      <summary style="cursor:pointer;font-family:var(--font-display);font-weight:700;font-size:12.5px;color:var(--bad)">
        Borrar este producto
      </summary>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
        <span class="text-dim text-[11.5px]">
          Se borra el producto y su inventario en las ${p.stock.length} bodega${p.stock.length === 1 ? "" : "s"}, para siempre.
          Si solo dejó de venderlo, <strong>desactívelo</strong> en vez de borrarlo: es reversible.
        </span>
        <form method="post" action="/admin/catalogo/${encodeURIComponent(p.code)}/borrar"
              style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input name="confirmacion" placeholder="Escriba BORRAR para confirmar" required
                 style="${INPUT};max-width:280px">
          <button type="submit"
                  style="background:none;border:1px solid var(--bad);color:var(--bad);cursor:pointer;padding:9px 16px;font-size:12.5px;border-radius:4px">
            Borrar definitivamente
          </button>
        </form>
      </div>
    </details>`;
}
