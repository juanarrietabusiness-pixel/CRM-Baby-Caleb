// Tab "Conocimiento" — la KB editable desde el dashboard (F4).
//
// El dueño escribe documentos (horarios, políticas, FAQ, promos) y quedan
// indexados en Vectorize AL GUARDAR: el bot los usa vía searchKb desde el
// siguiente mensaje. Los fragmentos precargados del repo conviven con estos.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { KbDocsRepo, FIXTURE_CHUNKS, MAX_DOC_CHARS, chunkContent, type KbDoc } from "../../kb/docs";
import {layout, ico, emptyState} from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Callout banner. `tone` picks the token: ok=verde (éxito), bad=rojo (error), neutral=gris (info). */
function banner(tone: "ok" | "bad" | "neutral", text: string): string {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--dim)";
  const bg = tone === "ok" ? "rgba(87,201,138,.1)" : tone === "bad" ? "rgba(244,54,76,.1)" : "var(--panel2)";
  return `<div style="border:1px solid ${color};background:${bg};color:${tone === "neutral" ? "var(--muted)" : color};padding:10px 14px;font-size:12.5px;margin-bottom:16px">${text}</div>`;
}

export async function renderKbList(
  env: Env,
  flash?: { saved?: boolean; deleted?: boolean; reindexed?: string },
): Promise<string> {
  const docs = await new KbDocsRepo(new Db(env.DB)).list();

  const bannerHtml = flash?.saved
    ? banner("ok", "✓ Guardado e indexado — el bot ya puede usarlo.")
    : flash?.deleted
      ? banner("neutral", "Documento eliminado (también del índice del bot).")
      : flash?.reindexed
        ? banner("ok", `✓ Reindexado: ${esc(flash.reindexed)} fragmentos actualizados.`)
        : "";

  const rows = docs.length
    ? docs
        .map((d) => {
          const chunks = chunkContent(d.content).length;
          return `
      <div class="kbrow" style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-top:1px solid var(--line);transition:background .12s ease">
        <div style="min-width:0;flex:1">
          <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="font-display font-semibold text-[13px] text-cream" style="display:block">${esc(d.title)}</a>
          <div class="text-dim text-[11.5px]" style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.content.replace(/\s+/g, " ").slice(0, 90))}</div>
        </div>
        <div class="text-dim text-[10.5px]" style="text-align:right;white-space:nowrap;flex:none">
          <div>${d.content.length.toLocaleString("es-MX")} caracteres · ${chunks} ${chunks === 1 ? "fragmento" : "fragmentos"}</div>
          <div>${ago(d.updated_at)}</div>
        </div>
        <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="kbedit" style="border:1px solid var(--line);color:var(--muted);padding:5px 12px;font-size:11px;white-space:nowrap;transition:all .12s ease;flex:none">Editar</a>
      </div>`;
        })
        .join("")
    : `<div class="text-dim text-[12.5px]" style="padding:40px 18px;text-align:center">
         ${emptyState("book-open", "Aún no tienes documentos propios", "Crea el primero: horarios, precios, políticas, promociones…")}
       </div>`;

  const body = `
    ${bannerHtml}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">
      <p class="text-muted text-[13px]" style="max-width:62ch">Lo que tu bot sabe del negocio. Cada documento se indexa al guardar y el bot lo usa de inmediato.</p>
      <a href="/admin/kb/new" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
         style="margin-left:auto;background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);box-shadow:0 6px 18px rgba(0,0,0,.45);padding:9px 16px;display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i data-lucide="plus" width="14" height="14"></i> Nuevo documento
      </a>
    </div>

    <div class="bg-panel border border-line" style="margin-bottom:16px;overflow:hidden">
      ${rows}
    </div>

    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px" class="text-dim text-[11.5px]">
      <span>Además, tu bot trae <b class="text-cream">${FIXTURE_CHUNKS.length}</b> fragmentos precargados del repo.</span>
      <form method="POST" action="/admin/kb/reindex" style="margin-left:auto">
        <button class="ghostbtn cursor-pointer" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 14px;font-size:11.5px;transition:all .12s ease">
          <i data-lucide="refresh-cw" width="13" height="13"></i> Reindexar todo
        </button>
      </form>
    </div>`;

  return layout({ title: "Conocimiento", activeTab: "kb", body, env });
}

export function renderKbEditor(doc: KbDoc | null, env: Env): string {
  const isNew = doc === null;
  const body = `
    <div style="margin-bottom:16px">
      <a href="/admin/kb" style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px">
        <i data-lucide="arrow-left" width="14" height="14"></i> Volver a Conocimiento
      </a>
    </div>
    <form method="POST" action="/admin/kb/save" class="bg-panel border border-line" style="padding:22px;display:flex;flex-direction:column;gap:18px">
      <h2 class="font-display font-semibold text-[15px] text-cream">${isNew ? "＋ Nuevo documento" : "Editar documento"}</h2>
      ${isNew ? "" : `<input type="hidden" name="id" value="${esc(doc.id)}">`}

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="title" class="font-display font-semibold text-[12.5px] text-cream">Título</label>
        <p class="text-dim text-[11px]">Un nombre claro del tema (el bot lo ve como contexto).</p>
        <input type="text" id="title" name="title" required maxlength="200"
               value="${esc(doc?.title ?? "")}" placeholder="Ej. Horarios y ubicación"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="content" class="font-display font-semibold text-[12.5px] text-cream">Contenido</label>
        <p class="text-dim text-[11px]">Escribe en lenguaje natural, como se lo explicarías a un empleado nuevo. Máximo ${MAX_DOC_CHARS.toLocaleString("es-MX")} caracteres.</p>
        <textarea id="content" name="content" rows="14" required maxlength="${MAX_DOC_CHARS}"
                  placeholder="Ej. Abrimos de lunes a sábado de 9am a 7pm. Los domingos cerramos. Estamos en Av. Reforma 123, a dos cuadras del metro…"
                  style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;resize:vertical">${esc(doc?.content ?? "")}</textarea>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);box-shadow:0 10px 28px rgba(0,0,0,.5);padding:11px 20px">Guardar e indexar</button>
        ${isNew ? "" : `
        <details style="margin-left:auto">
          <summary class="text-bad text-[12px]" style="cursor:pointer;list-style:none">Eliminar documento…</summary>
          <span style="display:inline-flex;align-items:center;gap:10px;margin-top:8px">
            <span class="text-dim text-[11px]">¿Seguro? El bot dejará de saber esto.</span>
            <button type="submit" formaction="/admin/kb/${encodeURIComponent(doc.id)}/delete" formnovalidate
                    style="background:transparent;border:1px solid var(--bad);color:var(--bad);padding:6px 12px;font-size:11px;cursor:pointer">Sí, eliminar</button>
          </span>
        </details>`}
      </div>
    </form>`;

  return layout({ title: isNew ? "Nuevo documento" : "Editar documento", activeTab: "kb", body, env });
}
