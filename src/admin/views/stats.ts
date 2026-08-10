// Tab "Estadísticas" — métricas que le importan a un dueño de negocio, con
// gráficos SVG server-rendered (cero librerías): actividad de 30 días, funnel
// de conversión, heatmap de horas pico y los números que venden el bot
// (horas ahorradas, costo por conversación / por lead).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { InsightsRepo } from "../../db/insights";
import { costOfUsage, type ModelId } from "../../pricing";
import { channelLabel } from "../../channels/labels";
import {layout, ico, emptyState} from "./layout";

// Espejo de --accent (flash-orange de marca). Se escribe el hex porque va en
// atributos de presentación de SVG (fill/stroke), no en CSS: si cambia el
// token en layout.ts, este valor se cambia con él.
const ACCENT = "#ff5100";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// --- SVG area chart -------------------------------------------------------------

function areaChart(points: { label: string; value: number }[], width = 640, height = 150): string {
  if (points.length === 0) {
    return emptyState("bar-chart-3", "Aún no hay actividad");
  }
  const pad = 12;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = (width - 2 * pad) / Math.max(points.length - 1, 1);
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad - 14);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `M ${x(0)} ${height - pad} L ${line.split(" ").join(" L ")} L ${x(points.length - 1)} ${height - pad} Z`;
  const last = points[points.length - 1];

  return `
  <div class="overflow-x-auto">
    <svg viewBox="0 0 ${width} ${height}" class="w-full" style="min-width:480px" role="img" aria-label="Mensajes por día">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="var(--line)" stroke-width="1"/>
      <path d="${area}" fill="${ACCENT}" opacity="0.14"/>
      <polyline points="${line}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(points.length - 1)}" cy="${y(last.value)}" r="3.5" fill="${ACCENT}"/>
      <text x="${x(points.length - 1)}" y="${y(last.value) - 8}" text-anchor="end" font-size="12" fill="var(--cream)" font-family="'JetBrains Mono',monospace" font-weight="600">${last.value}</text>
      <text x="${pad}" y="${height - 1}" font-size="10" fill="var(--dim)" font-family="'JetBrains Mono',monospace">${esc(points[0].label)}</text>
      <text x="${width - pad}" y="${height - 1}" text-anchor="end" font-size="10" fill="var(--dim)" font-family="'JetBrains Mono',monospace">${esc(last.label)}</text>
    </svg>
  </div>`;
}

// --- Heatmap día × hora -----------------------------------------------------------

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function heatmap(cells: Map<string, number>): string {
  const max = Math.max(...cells.values(), 1);
  const rows = DOW.map((name, dow) => {
    const tds = Array.from({ length: 24 }, (_, hour) => {
      const n = cells.get(`${dow}:${hour}`) ?? 0;
      const alpha = n === 0 ? 0 : 0.12 + 0.8 * (n / max);
      const bg = n === 0 ? "var(--panel2)" : `rgba(255,81,0,${alpha.toFixed(2)})`;
      return `<td class="p-0"><div style="width:13px;height:13px;background:${bg}" title="${name} ${hour}:00 — ${n} ${n === 1 ? "mensaje" : "mensajes"}"></div></td>`;
    }).join("");
    return `<tr><td class="pr-2 text-[9px] text-dim font-mono text-right">${name}</td>${tds}</tr>`;
  }).join("");

  const hourLabels = Array.from({ length: 24 }, (_, h) =>
    `<td class="text-[8px] text-dim font-mono text-center p-0">${h % 6 === 0 ? h : ""}</td>`,
  ).join("");

  return `
  <div class="overflow-x-auto">
    <table class="border-separate" style="border-spacing:2px">
      <tbody>${rows}<tr><td></td>${hourLabels}</tr></tbody>
    </table>
  </div>`;
}

// --- Funnel -----------------------------------------------------------------------

function funnel(stages: { label: string; value: number }[]): string {
  const base = Math.max(stages[0]?.value ?? 0, 1);
  return stages
    .map((s) => {
      const pct = Math.round((s.value / base) * 100);
      return `
    <div class="grid grid-cols-[120px_1fr_66px] gap-[10px] items-center text-[12.5px]">
      <span class="text-muted">${esc(s.label)}</span>
      <div style="height:22px;background:var(--panel2);border:1px solid var(--line);overflow:hidden">
        <div style="width:${Math.max(pct, s.value > 0 ? 3 : 0)}%;height:100%;background:var(--accent);opacity:.85"></div>
      </div>
      <span class="text-right text-[11px] text-muted">${s.value} <span class="text-dim">· ${pct}%</span></span>
    </div>`;
    })
    .join("");
}

// --- Page -------------------------------------------------------------------------

export async function renderStats(env: Env): Promise<string> {
  const db = new Db(env.DB);
  const thirtyDays = Date.now() - 30 * 86_400_000;

  const [byDay, convs30, leadStatuses, heatRows, tokenRows, assistantMsgs, channels, tools, insightStats] =
    await Promise.all([
      db.all<{ day: string; msgs: number }>(
        `SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as msgs
         FROM messages WHERE created_at > ? GROUP BY day ORDER BY day ASC`,
        [thirtyDays],
      ),
      db.first<{ n: number }>(
        "SELECT COUNT(DISTINCT conversation_id) as n FROM messages WHERE created_at > ?",
        [thirtyDays],
      ),
      db.all<{ status: string; n: number }>(
        "SELECT status, COUNT(*) as n FROM leads WHERE created_at > ? GROUP BY status",
        [thirtyDays],
      ),
      db.all<{ dow: number; hour: number; n: number }>(
        `SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) as dow,
                CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) as hour,
                COUNT(*) as n
         FROM messages WHERE role = 'user' AND created_at > ?
         GROUP BY dow, hour`,
        [thirtyDays],
      ),
      db.all<{ model_used: string; input: number; output: number; cached: number }>(
        `SELECT model_used,
                SUM(COALESCE(input_tokens, 0)) as input,
                SUM(COALESCE(output_tokens, 0)) as output,
                SUM(COALESCE(cached_input_tokens, 0)) as cached
         FROM messages WHERE created_at > ? AND model_used IS NOT NULL
         GROUP BY model_used`,
        [thirtyDays],
      ),
      db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE role = 'assistant' AND created_at > ?",
        [thirtyDays],
      ),
      db.all<{ channel: string; n: number }>(
        `SELECT c.channel, COUNT(m.id) as n
         FROM messages m JOIN conversations c ON m.conversation_id = c.id
         WHERE m.created_at > ? GROUP BY c.channel ORDER BY n DESC`,
        [thirtyDays],
      ),
      db
        .all<{ tool: string; n: number }>(
          `SELECT json_extract(value, '$.toolName') as tool, COUNT(*) as n
           FROM messages, json_each(messages.tool_calls)
           WHERE messages.tool_calls IS NOT NULL AND messages.created_at > ?
           GROUP BY tool ORDER BY n DESC`,
          [thirtyDays],
        )
        .catch(() => [] as { tool: string; n: number }[]),
      new InsightsRepo(db).stats(thirtyDays),
    ]);

  // --- Derived business numbers ---
  let cost30 = 0;
  for (const r of tokenRows) {
    cost30 += costOfUsage(r.model_used as ModelId, { input: r.input, output: r.output, cached: r.cached });
  }
  const nConvs = convs30?.n ?? 0;
  const statusCount = (s: string) => leadStatuses.find((l) => l.status === s)?.n ?? 0;
  const nLeads = leadStatuses.reduce((sum, l) => sum + l.n, 0);
  const nContacted = statusCount("contacted") + statusCount("sold");
  const nSold = statusCount("sold");

  const savedHours = ((assistantMsgs?.n ?? 0) * 2) / 60; // ~2 min por mensaje atendido
  const costPerConv = nConvs > 0 ? cost30 / nConvs : null;
  const costPerLead = nLeads > 0 ? cost30 / nLeads : null;
  const resolvedPct =
    insightStats.analyzed > 0 ? Math.round((insightStats.resolvedNoHuman / insightStats.analyzed) * 100) : null;

  const heatCells = new Map(heatRows.map((r) => [`${r.dow}:${r.hour}`, r.n]));

  const money = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
  const bigCard = (value: string, label: string, sub: string, accent = false) => `
    <div class="card bg-panel border border-line p-4${accent ? " border-l-[3px] border-l-accent" : ""}">
      <div class="font-display font-bold text-[28px] leading-none">${value}</div>
      <div class="text-[11px] text-muted mt-1">${label}</div>
      <div class="text-[10px] text-dim mt-0.5">${sub}</div>
    </div>`;

  const body = `
    <div class="flex flex-col gap-4" style="max-width:1080px">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${bigCard(`${savedHours.toFixed(1)}<span class="text-[16px] text-dim"> h</span>`, "⏱ Horas ahorradas", "mensajes atendidos × 2 min · 30 días", true)}
        ${bigCard(costPerConv === null ? "—" : money(costPerConv), "Costo por conversación", "IA / conversaciones · 30 días")}
        ${bigCard(`<span class="text-accent">${costPerLead === null ? "—" : money(costPerLead)}</span>`, `${ico("banknote")} Costo por lead`, "IA / leads captados · 30 días")}
        ${bigCard(`<span class="text-ok">${resolvedPct === null ? "—" : `${resolvedPct}%`}</span>`, "Resueltas sin humano", "según el análisis de IA · 30 días")}
      </div>

      <div class="card bg-panel border border-line p-[18px]">
        <div class="font-display font-semibold text-[14px] mb-3">${ico("trending-up")} Mensajes por día <span class="text-[10px] text-dim font-normal">(30 días)</span></div>
        ${areaChart(byDay.map((d) => ({ label: d.day.slice(5), value: d.msgs })))}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        <div class="card bg-panel border border-line p-[18px]">
          <div class="font-display font-semibold text-[14px] mb-4">${ico("target")} Funnel de conversión <span class="text-[10px] text-dim font-normal">(30 días)</span></div>
          <div class="flex flex-col gap-3">
            ${funnel([
              { label: "Conversaciones", value: nConvs },
              { label: "Leads", value: nLeads },
              { label: "Contactados", value: nContacted },
              { label: "Vendidos", value: nSold },
            ])}
          </div>
        </div>
        <div class="card bg-panel border border-line p-[18px]">
          <div class="font-display font-semibold text-[14px] mb-4">${ico("flame")} Horas pico <span class="text-[10px] text-dim font-normal">(mensajes de clientes, 30 días)</span></div>
          ${heatmap(heatCells)}
          <p class="text-[10px] text-dim mt-2.5 leading-relaxed">Las horas fuera de tu horario son donde el bot es el único que contesta.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        <div class="card bg-panel border border-line p-[18px]">
          <div class="font-display font-semibold text-[14px] mb-2.5">Por canal</div>
          <table class="w-full text-[12.5px]"><tbody>
            ${channels.map((c) => `<tr style="border-top:1px solid var(--line)"><td class="py-2.5 text-cream">${esc(channelLabel(c.channel))}</td><td class="text-right text-muted text-[11px]">${c.n}</td></tr>`).join("") || `<tr><td class="py-3 text-dim text-[12.5px]">Sin datos.</td></tr>`}
          </tbody></table>
        </div>
        <div class="card bg-panel border border-line p-[18px]">
          <div class="font-display font-semibold text-[14px] mb-2.5">Tools más usadas</div>
          <table class="w-full text-[12px]"><tbody>
            ${tools.filter((t) => t.tool).map((t) => `<tr style="border-top:1px solid var(--line)"><td class="py-2.5 text-accent2">${esc(t.tool)}</td><td class="text-right text-muted text-[11px]">${t.n}</td></tr>`).join("") || `<tr><td class="py-3 text-dim text-[12.5px]">Aún sin tool calls registradas.</td></tr>`}
          </tbody></table>
        </div>
      </div>
    </div>`;

  return layout({ title: "Estadísticas", activeTab: "stats", body, env });
}
