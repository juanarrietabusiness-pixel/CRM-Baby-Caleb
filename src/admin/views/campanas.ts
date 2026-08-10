// "Campañas" — envío segmentado por WhatsApp respetando las reglas del canal:
// dentro de la ventana de 24h va mensaje free-form (gratis); fuera va plantilla
// HSM aprobada (Twilio Content API) que gasta el tope diario del número
// (default 250). La página enseña ambos números ANTES de mandar para que el
// dueño planee — la cuota es oro el día del evento.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import {layout, ico, emptyState} from "./layout";
import { SEGMENTS, segmentCounts } from "../../segments";
import {
  listContentTemplates,
  templatesSentLast24h,
  dailyTemplateCap,
  campaignHistory,
} from "../../campaigns";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function fmtAgo(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export async function renderCampanas(
  env: Env,
  q: Record<string, string | undefined> = {},
): Promise<string> {
  const db = new Db(env.DB);
  const [counts, templates, spent, history] = await Promise.all([
    segmentCounts(db),
    listContentTemplates(env).catch(() => []),
    templatesSentLast24h(db),
    campaignHistory(db),
  ]);
  const cap = dailyTemplateCap(env);
  const pct = Math.min(100, Math.round((spent / cap) * 100));

  const banner = q.ok
    ? `<div style="border:1px solid var(--ok);background:rgba(87,201,138,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">
        ${ico("circle-check")} Campaña enviada — free-form: <b>${esc(q.ff ?? "0")}</b> · plantillas: <b>${esc(q.tp ?? "0")}</b>
        · ya la tenían (saltados): ${esc(q.dup ?? "0")} · sin cuota: ${esc(q.quota ?? "0")} · fallidos: ${esc(q.fail ?? "0")}
      </div>`
    : q.err
      ? `<div style="border:1px solid var(--bad);background:rgba(244,54,76,.10);padding:12px 16px;margin-bottom:18px;font-size:12.5px">⚠ ${esc(q.err)}</div>`
      : "";

  const segRows = counts
    .map((s, i) => {
      const def = SEGMENTS.find((d) => d.id === s.id)!;
      return `
      <label style="display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);padding:12px 14px;cursor:pointer;background:var(--panel)">
        <input type="radio" name="segment" value="${esc(s.id)}" ${i === 0 ? "checked" : ""} style="margin-top:3px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px">${esc(def.label)}</span>
            <span class="font-mono" style="font-size:11px">
              <b>${s.total}</b> total ·
              <span style="color:var(--ok)">${s.inWindow} en ventana</span> ·
              <span style="color:var(--warn)">${s.outWindow} necesitan plantilla</span>
            </span>
          </div>
          <div class="text-dim" style="font-size:11.5px;margin-top:2px">${esc(def.desc)}</div>
        </div>
      </label>`;
    })
    .join("");

  const templateOpts =
    templates.length > 0
      ? templates
          .map(
            (t) =>
              `<option value="${esc(t.sid)}">${esc(t.name)} — “${esc(t.body.slice(0, 70))}${t.body.length > 70 ? "…" : ""}”</option>`,
          )
          .join("")
      : "";

  const templateSection =
    templates.length > 0
      ? `<select name="template_sid" style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
          <option value="">— sin plantilla (solo mandar a los que están en ventana) —</option>
          ${templateOpts}
        </select>
        <input name="template_vars" placeholder='Variables JSON opcional, ej {"1":"Ana"}' class="font-mono"
          style="width:100%;margin-top:8px;background:var(--panel);border:1px solid var(--line);color:inherit;padding:8px 10px;font-size:11.5px">`
      : `<div class="text-dim" style="font-size:12px;border:1px dashed var(--line);padding:12px 14px">
          No hay plantillas aprobadas en tu cuenta de Twilio (o faltan credenciales).
          Créalas en Twilio → Content Template Builder y sométlas a aprobación de Meta —
          tardan de horas a días, hazlo con anticipación.
        </div>`;

  const historyRows =
    history.length === 0
      ? `<tr><td colspan="4">${emptyState("megaphone", "Sin campañas todavía")}</td></tr>`
      : history
          .map(
            (h) => `<tr style="border-top:1px solid var(--line)">
          <td style="padding:8px 12px;font-size:12px" class="font-mono">${esc(h.campaign_key)}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.freeform}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.template}</td>
          <td style="padding:8px 12px;font-size:11px;text-align:right" class="text-dim">${fmtAgo(h.last_at)}</td>
        </tr>`,
          )
          .join("");

  const body = `
  ${banner}

  <div style="display:grid;grid-template-columns:1fr;gap:18px;max-width:860px">

    <div style="border:1px solid var(--line);background:var(--panel2);padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase" class="text-dim">Cuota de plantillas (últimas 24h)</div>
        <div class="font-mono" style="font-size:13px"><b>${spent}</b> / ${cap}</div>
      </div>
      <div style="height:8px;background:var(--raise);margin-top:8px;border:1px solid var(--line)">
        <div style="height:100%;width:${pct}%;background:${pct > 85 ? "var(--bad)" : "var(--accent)"}"></div>
      </div>
      <div class="text-dim" style="font-size:11px;margin-top:6px">
        Los mensajes a gente <b>en ventana</b> (escribió hace &lt;23h) van free-form y NO gastan cuota.
        Solo las plantillas a gente fuera de ventana cuentan. La cuota es rolling de 24h.
      </div>
    </div>

    <form method="post" action="/admin/campanas/send"
      onsubmit="return confirm('¿Mandar la campaña al segmento seleccionado? Los envíos free-form salen de inmediato y las plantillas gastan cuota.')">

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">1 · Elige el segmento</div>
      <div style="display:grid;gap:8px">${segRows}</div>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">2 · Mensaje free-form (para los EN ventana)</div>
      <textarea name="freeform_text" rows="3" placeholder="Se manda tal cual a quienes escribieron hace <23h. Déjalo vacío para no mandarles nada."
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:10px 12px;font-size:12.5px"></textarea>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">3 · Plantilla HSM (para los FUERA de ventana)</div>
      ${templateSection}

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">4 · Nombre de la campaña (candado anti-duplicados)</div>
      <input name="campaign_key" required placeholder="ej: deadline-bonos-26jul" class="font-mono"
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
      <div class="text-dim" style="font-size:11px;margin-top:4px">
        Si reintentas una campaña con el mismo nombre, a nadie le llega dos veces.
      </div>

      <button type="submit" class="btn" style="margin-top:16px;border:1px solid var(--accent);background:var(--accent-soft);padding:10px 22px;font-weight:700;font-size:12px;letter-spacing:.08em;cursor:pointer">
        ${ico("zap")} ENVIAR CAMPAÑA
      </button>
      <span class="text-dim" style="font-size:11px;margin-left:10px">Puede tardar ~1 min con audiencias grandes.</span>
    </form>

    <div>
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">Historial</div>
      <table style="width:100%;border:1px solid var(--line);border-collapse:collapse;background:var(--panel)">
        <thead><tr class="text-dim" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase">
          <th style="padding:8px 12px;text-align:left">Campaña</th>
          <th style="padding:8px 12px;text-align:right">Free-form</th>
          <th style="padding:8px 12px;text-align:right">Plantillas</th>
          <th style="padding:8px 12px;text-align:right">Último envío</th>
        </tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  </div>`;

  return layout({ title: "Campañas", activeTab: "campanas", body, env });
}
