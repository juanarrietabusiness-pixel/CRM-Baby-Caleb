// Tab "Costos" — cuánto cuesta operar el bot. Dos fuentes:
//  • IA (Claude/GPT): EXACTO, calculado desde los tokens que guardamos por
//    mensaje (input/output/cached × precio del modelo).
//  • Twilio (WhatsApp + renta de números): REAL, jalado de la Usage Records API
//    de Twilio (la factura de la cuenta), no un estimado.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import {layout, ico, emptyState} from "./layout";
import { costOfUsage, type ModelId } from "../../pricing";
import { fetchTwilioUsage } from "../twilioUsage";
import { monthIaCostUsd } from "../../budget";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";

const money = (n: number) => `$${n.toFixed(2)}`;
const money4 = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

export async function renderCosts(env: Env, saved = false): Promise<string> {
  const db = new Db(env.DB);
  const thirtyDays = Date.now() - 30 * 86_400_000;
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // --- IA: tokens por (día, modelo) en los últimos 30 días -------------------
  const rows = await db.all<{
    day: string;
    model_used: string;
    input: number;
    output: number;
    cached: number;
    msgs: number;
  }>(
    `SELECT date(created_at / 1000, 'unixepoch') as day, model_used,
            SUM(COALESCE(input_tokens, 0)) as input,
            SUM(COALESCE(output_tokens, 0)) as output,
            SUM(COALESCE(cached_input_tokens, 0)) as cached,
            COUNT(*) as msgs
     FROM messages
     WHERE created_at > ? AND model_used IS NOT NULL
     GROUP BY day, model_used
     ORDER BY day DESC`,
    [thirtyDays],
  );

  let iaMonth = 0;
  let iaToday = 0;
  const byModel = new Map<string, { msgs: number; input: number; output: number; cached: number; cost: number }>();
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const cost = costOfUsage(r.model_used as ModelId, { input: r.input, output: r.output, cached: r.cached });
    iaMonth += cost;
    if (r.day === todayStr) iaToday += cost;
    const m = byModel.get(r.model_used) ?? { msgs: 0, input: 0, output: 0, cached: 0, cost: 0 };
    m.msgs += r.msgs; m.input += r.input; m.output += r.output; m.cached += r.cached; m.cost += cost;
    byModel.set(r.model_used, m);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + cost);
  }

  // --- Presupuesto mensual de IA ---------------------------------------------
  const budgetRaw = await new SettingsRepo(db).get(SETTING_KEYS.monthlyBudget);
  const budget = budgetRaw ? Number.parseFloat(budgetRaw) : NaN;
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const monthToDate = await monthIaCostUsd(db);
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0 ? (monthToDate / dayOfMonth) * daysInMonth : 0;
  const pct = hasBudget ? Math.min(100, Math.round((monthToDate / budget) * 100)) : 0;
  const barColor = pct >= 100 ? "var(--bad)" : pct >= 80 ? "var(--accent-2)" : "var(--accent)";

  const budgetCard = `
    <div class="card bg-panel border border-line p-[18px]">
      ${saved ? `<div class="border border-ok text-ok px-3 py-2 text-[12.5px] mb-3" style="background:var(--panel2)">✓ Presupuesto guardado.</div>` : ""}
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="font-display font-semibold text-[14px]">${ico("target")} Presupuesto mensual de IA</span>
        ${hasBudget && pct >= 100 ? `<span class="text-[9px] px-1.5 py-0.5 border border-bad text-bad">límite alcanzado — el bot bajó al modelo económico</span>` : ""}
      </div>
      ${hasBudget
        ? `
      <div class="flex items-baseline justify-between text-[12.5px] mb-2">
        <span class="text-muted">Gastado este mes: <b class="text-cream">${money(monthToDate)}</b> de ${money(budget)}</span>
        <span class="text-[11px] font-semibold" style="color:${barColor}">${pct}%</span>
      </div>
      <div style="height:12px;background:var(--panel2);border:1px solid var(--line);overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${barColor}"></div>
      </div>`
        : `<p class="text-[12.5px] text-muted mb-2 leading-relaxed">Sin límite configurado. Ponle un tope: al alcanzarlo, el bot sigue contestando pero solo con el modelo económico — nunca se queda callado ni te lleva sorpresas.</p>`}
      <p class="text-[11px] text-dim mt-2.5 mb-[14px]">Al ritmo actual, terminarás el mes en <b class="text-muted">${money(projected)}</b> de IA.</p>
      <form method="POST" action="/admin/costs/budget" class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] text-muted">Límite mensual: $</span>
        <input type="number" name="monthly_budget" min="0" step="0.5" value="${hasBudget ? budget : ""}" placeholder="25"
               style="width:90px;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;outline:none">
        <span class="text-[10.5px] text-dim">USD · deja vacío para quitar el límite</span>
        <button class="bigbtn font-display font-bold text-[12px] cursor-pointer"
          style="background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);box-shadow:0 6px 18px rgba(0,0,0,.45);padding:8px 16px">Guardar</button>
      </form>
    </div>`;

  // --- Twilio: costo real del mes -------------------------------------------
  const tw = await fetchTwilioUsage(env, "ThisMonth");
  const twMonth = tw.available ? tw.total : 0;
  const totalMonth = iaMonth + twMonth;

  // --- Cards resumen ---------------------------------------------------------
  const cards = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="card bg-panel border border-line border-l-[3px] border-l-accent p-5">
        <div class="text-muted text-[11px]">Total este mes</div>
        <div class="font-display font-bold text-[30px] mt-1 leading-none">${money(totalMonth)}</div>
        <div class="text-[10px] text-dim mt-1">IA + Twilio</div>
      </div>
      <div class="card bg-panel border border-line p-5">
        <div class="text-muted text-[11px]">${ico("brain")} IA (Claude)</div>
        <div class="font-display font-bold text-[24px] mt-1.5 leading-none">${money(iaMonth)}</div>
        <div class="text-[10px] text-dim mt-1">hoy ${money4(iaToday)}</div>
      </div>
      <div class="card bg-panel border border-line p-5">
        <div class="text-muted text-[11px]">${ico("message-circle")} WhatsApp / Twilio</div>
        <div class="font-display font-bold text-[24px] mt-1.5 leading-none">${tw.available ? money(twMonth) : "—"}</div>
        <div class="text-[10px] text-dim mt-1">${tw.available ? `${tw.waConversations} conversaciones` : (tw.error ?? "no disponible")}</div>
      </div>
    </div>`;

  // --- Desglose IA por modelo ------------------------------------------------
  const modelRows = [...byModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, m]) => `
      <tr style="border-top:1px solid var(--line)">
        <td class="py-2 pr-2 text-[11px] text-accent2">${esc(model)}</td>
        <td class="text-right text-cream">${m.msgs}</td>
        <td class="text-right text-dim text-[11px]">${(m.input / 1000).toFixed(0)}k / ${(m.output / 1000).toFixed(0)}k</td>
        <td class="text-right font-semibold text-cream">${money4(m.cost)}</td>
      </tr>`).join("") ||
    `<tr><td colspan="4">${emptyState("receipt", "Aún no hay uso de IA")}</td></tr>`;

  const iaCard = `
    <div class="card bg-panel border border-line p-[18px]">
      <div class="font-display font-semibold text-[14px] mb-1">${ico("brain")} IA por modelo <span class="text-[10px] text-dim font-normal">(30 días · exacto)</span></div>
      <table class="w-full text-[12px] mt-2">
        <thead><tr class="text-[9.5px] tracking-[.1em] uppercase text-dim text-left"><th class="font-normal pb-2">Modelo</th><th class="font-normal text-right pb-2">Msgs</th><th class="font-normal text-right pb-2">Tokens in/out</th><th class="font-normal text-right pb-2">Costo</th></tr></thead>
        <tbody>${modelRows}</tbody>
      </table>
    </div>`;

  // --- Desglose Twilio (real) ------------------------------------------------
  const twRows = tw.available
    ? (tw.categories.length
        ? tw.categories.map((c) => `
          <tr style="border-top:1px solid var(--line)">
            <td class="py-2 pr-2 text-cream">${esc(c.label)}</td>
            <td class="text-right text-dim text-[11px]">${esc(String(c.usage))} ${esc(c.unit)}</td>
            <td class="text-right font-semibold text-cream">${money4(c.price)}</td>
          </tr>`).join("")
        : `<tr><td colspan="3" class="py-3 text-dim text-center text-[12.5px]">Sin cargos este mes.</td></tr>`)
    : `<tr><td colspan="3" class="py-3 text-dim text-center text-[12.5px]">${esc(tw.error ?? "Twilio no disponible")}</td></tr>`;

  const twSubtotal = tw.available
    ? `<div class="mt-3 text-[12px] text-muted flex justify-between" style="border-top:1px solid var(--linelit);padding-top:10px">
         <span>Mensajería ${money4(tw.messagingTotal)} · Números ${money4(tw.numbersTotal)}</span>
         <span class="font-bold text-cream">${money(twMonth)}</span>
       </div>`
    : "";

  const twCard = `
    <div class="card bg-panel border border-line p-[18px]">
      <div class="font-display font-semibold text-[14px] mb-1">${ico("message-circle")} Twilio este mes <span class="text-[10px] text-dim font-normal">— real, de tu factura de Twilio</span></div>
      <table class="w-full text-[12px] mt-2">
        <thead><tr class="text-[9.5px] tracking-[.1em] uppercase text-dim text-left"><th class="font-normal pb-2">Concepto</th><th class="font-normal text-right pb-2">Uso</th><th class="font-normal text-right pb-2">Costo</th></tr></thead>
        <tbody>${twRows}</tbody>
      </table>
      ${twSubtotal}
    </div>`;

  // --- Costo IA por día ------------------------------------------------------
  const dayRows = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 30)
    .map(([day, cost]) => `<tr style="border-top:1px solid var(--line)"><td class="py-1.5 text-muted">${esc(day)}</td><td class="text-right text-cream">${money4(cost)}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="py-3 text-dim text-center text-[12.5px]">Sin datos.</td></tr>`;

  const dayCard = `
    <div class="card bg-panel border border-line p-[18px]">
      <div class="font-display font-semibold text-[14px] mb-1">${ico("calendar")} Costo de IA por día</div>
      <table class="w-full text-[12px] mt-2">
        <thead><tr class="text-[9.5px] tracking-[.1em] uppercase text-dim text-left"><th class="font-normal pb-2">Día</th><th class="font-normal text-right pb-2">Costo IA</th></tr></thead>
        <tbody>${dayRows}</tbody>
      </table>
    </div>`;

  const note = `
    <p class="text-[10.5px] text-dim leading-relaxed">
      El costo de <b class="text-muted">IA</b> es exacto (calculado desde los tokens de cada mensaje).
      El de <b class="text-muted">Twilio</b> viene de la Usage Records API de Twilio: es lo que tu cuenta
      realmente gastó (incluye renta de números). Los precios de Meta por conversación de
      WhatsApp aparecen dentro de las categorías de Twilio.
    </p>`;

  const body = `
    <div class="flex flex-col gap-4" style="max-width:1080px">
      ${cards}
      ${budgetCard}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        ${iaCard}
        ${twCard}
      </div>
      ${dayCard}
      ${note}
    </div>`;

  return layout({ title: "Costos", activeTab: "costs", body, env });
}
