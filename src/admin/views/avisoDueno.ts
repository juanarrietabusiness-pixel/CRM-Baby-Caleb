// "Aviso al dueño" — dentro de la tarjeta de Telegram en Conexiones.
//
// Reemplaza el paso que la dueña de Baby Caleb no podía hacer: guardar
// OWNER_TELEGRAM_CHAT_ID con `wrangler secret put`. Sin ese secret el bot creaba
// tickets y nadie se enteraba ("⚠ HANDOFF SIN AVISO"). Ahora es un botón: el
// panel genera un enlace de un solo uso, ella lo abre en el teléfono, Telegram
// le manda el código al bot y queda vinculada. Todo desde el navegador.
//
// Es un fragmento de htmx: la tarjeta lo carga al abrirse y lo reemplaza en
// cada paso, así que no necesita recargar la página.

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

const BTN =
  "font-size:12px;font-weight:700;padding:10px 14px;min-height:44px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;text-decoration:none";
const BTN_PRIMARIO = `${BTN};background:var(--accent);border:1px solid var(--accent);color:var(--on-accent)`;
const BTN_SECUNDARIO = `${BTN};background:none;border:1px solid var(--line);color:var(--cream)`;

function marco(contenido: string): string {
  return `<div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:10px">
    <div class="font-display font-semibold text-[13px] text-cream">Aviso al dueño</div>
    ${contenido}
  </div>`;
}

/** El lugar donde se carga el fragmento. Va en la tarjeta de Telegram. */
export function renderAvisoDuenoCargando(): string {
  return `<div id="aviso-dueno" hx-get="/admin/telegram/dueno" hx-trigger="load" hx-swap="innerHTML">
    <p class="text-dim text-[12px]" style="margin:0">Revisando si su Telegram está vinculado…</p>
  </div>`;
}

export function renderAvisoDuenoVinculado(opts: { chatId: string; porSecret: boolean; resultado?: string }): string {
  const final = opts.chatId.slice(-4);
  return marco(`
    <p class="text-[12.5px]" style="margin:0;color:var(--ok)">✓ Vinculado (chat …${esc(final)}). Los avisos de tickets, pagos e interesadas le llegan a su Telegram, y desde ahí puede contestar.</p>
    ${opts.resultado ? `<p class="text-[12px]" style="margin:0;color:var(--muted)">${esc(opts.resultado)}</p>` : ""}
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button type="button" style="${BTN_SECUNDARIO}" hx-post="/admin/telegram/prueba" hx-target="#aviso-dueno" hx-swap="innerHTML">🔔 Enviarme un aviso de prueba</button>
      ${
        opts.porSecret
          ? ""
          : `<button type="button" style="${BTN_SECUNDARIO}" hx-post="/admin/telegram/desvincular" hx-target="#aviso-dueno" hx-swap="innerHTML"
                     hx-confirm="¿Dejar de recibir los avisos en este Telegram?">Desvincular</button>`
      }
    </div>
    ${opts.porSecret ? `<p class="text-dim text-[12px]" style="margin:0">Vinculado por el secret OWNER_TELEGRAM_CHAT_ID.</p>` : ""}`);
}

export function renderAvisoDuenoSinVincular(nota?: string): string {
  return marco(`
    <p class="text-[12.5px]" style="margin:0;color:var(--warn)">⚠ Todavía nadie recibe los avisos. Cuando una clienta quiera pagar o pida una persona, el bot crea el ticket pero no le avisa a nadie.</p>
    ${nota ? `<p class="text-[12px]" style="margin:0;color:var(--bad)">${esc(nota)}</p>` : ""}
    <button type="button" style="${BTN_PRIMARIO};align-self:flex-start" hx-post="/admin/telegram/vincular" hx-target="#aviso-dueno" hx-swap="innerHTML">
      Vincular mi Telegram
    </button>`);
}

export function renderAvisoDuenoEnlace(opts: { bot: string | null; codigo: string }): string {
  const enlace = opts.bot ? `https://t.me/${encodeURIComponent(opts.bot)}?start=dueno_${opts.codigo}` : null;
  return marco(`
    <ol class="text-[12.5px] text-cream" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>${enlace ? "Abra este enlace en el teléfono donde tiene Telegram" : "Abra en Telegram el bot del negocio"}.</li>
      <li>${enlace ? "Toque <strong>Iniciar</strong>." : `Envíele este mensaje: <span class="font-mono">/dueno ${esc(opts.codigo)}</span>`}</li>
      <li>Listo: aquí se pone en verde solo.</li>
    </ol>
    ${enlace ? `<a href="${esc(enlace)}" target="_blank" rel="noopener" style="${BTN_PRIMARIO};align-self:flex-start">Abrir Telegram y vincular</a>` : ""}
    <p class="text-dim text-[12px]" style="margin:0">Si el enlace no abre, envíele al bot: <span class="font-mono">/dueno ${esc(opts.codigo)}</span> · El código vence en 15 minutos y sirve una sola vez.</p>
    <div hx-get="/admin/telegram/dueno?esperando=1" hx-trigger="every 4s" hx-target="#aviso-dueno" hx-swap="innerHTML"></div>`);
}
