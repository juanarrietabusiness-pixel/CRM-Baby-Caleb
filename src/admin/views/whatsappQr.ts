// Panel de WhatsApp por QR — el fragmento que vive dentro de Conexiones.
//
// Es la pantalla con la que el dueño vincula su número SIN terminal y SIN
// ayuda: abre el panel desde el teléfono, ve el QR, lo escanea con WhatsApp y
// listo. Todo lo demás de este canal es infraestructura; esto es lo único que
// el cliente ve.
//
// Sigue `docs/design-system.md`: htmx en vez de JS propio, tokens de color, sin
// emojis (§6) y el §7 de móvil — 44 px táctiles, piso de 12 px — porque esta
// pantalla se usa desde el teléfono por definición: hay que escanear un código
// con la cámara de ese mismo teléfono.

import type { Env } from "../../env";

/** Lo que devuelve `GET /api/estado` del puente. */
export interface EstadoDelPuente {
  contenedor?: {
    conexion?: string;
    vinculadoComo?: string | null;
    reconexiones?: number;
    mensajesRecibidos?: number;
    ultimoError?: string | null;
  };
  credenciales?: { vinculado?: boolean; credsActualizadaEn?: string | null };
  /**
   * La salud del latido que sostiene el canal.
   *
   * Existe por el fallo del 16-sep-2026: la alarma del Durable Object llevaba
   * horas apagada y esta tarjeta mostraba el canal como si todo estuviera bien.
   * El dueño se enteró del silencio escribiéndole al bot. Un latido vencido
   * tiene que verse AQUÍ, antes que allá.
   */
  latido?: {
    ultimoEn?: string | null;
    vencido?: boolean;
    desconectadoSeguidos?: number;
    reiniciosForzados?: number;
    ultimaConexionVista?: string | null;
    ultimoFallo?: string | null;
  };
  error?: string;
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/**
 * Traduce el estado técnico a algo que el dueño entienda.
 *
 * "cerrada" o "esperando-qr" no significan nada para quien solo quiere que su
 * WhatsApp conteste. El tono es de usted, como el resto de la atención.
 */
export function enCastellano(conexion: string | undefined): {
  titulo: string;
  detalle: string;
  color: "ok" | "warn" | "bad" | "dim";
} {
  switch (conexion) {
    case "conectada":
      return {
        titulo: "Conectado",
        detalle: "Su número está atendiendo. No hace falta hacer nada más.",
        color: "ok",
      };
    case "esperando-qr":
      return {
        titulo: "Esperando el código",
        detalle: "Escanee el código de abajo con WhatsApp para vincular su número.",
        color: "warn",
      };
    case "desvinculada":
      return {
        titulo: "Sin vincular",
        detalle: "El número se desvinculó. Escanee un código nuevo para volver a conectarlo.",
        color: "dim",
      };
    case "cerrada":
      return {
        titulo: "Reconectando",
        detalle: "Se perdió la conexión y se está restableciendo sola. Suele tardar menos de un minuto.",
        color: "warn",
      };
    case "arrancando":
      return { titulo: "Iniciando", detalle: "Levantando el servicio…", color: "dim" };
    default:
      return {
        titulo: "Sin respuesta",
        detalle: "No se pudo consultar el servicio. Vuelva a intentar en un momento.",
        color: "bad",
      };
  }
}

/**
 * "hace 40 segundos", "hace 3 minutos". Para que el dueño pueda juzgar si el
 * servicio se está revisando solo sin tener que leer una marca de tiempo ISO.
 */
export function haceCuanto(iso: string | null | undefined, ahora: number): string | null {
  if (!iso) return null;
  const cuando = Date.parse(iso);
  if (Number.isNaN(cuando)) return null;
  const segundos = Math.max(0, Math.round((ahora - cuando) / 1000));
  if (segundos < 60) return `hace ${segundos} segundo${segundos === 1 ? "" : "s"}`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? "" : "s"}`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

const COLOR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", dim: "var(--dim)" };

/**
 * El fragmento que htmx recarga cada 5 s. Devuelve HTML, no una página: se
 * inyecta dentro de la tarjeta de Conexiones.
 */
export function renderWhatsappQrPanel(
  estado: EstadoDelPuente | null,
  qr: string | null,
): string {
  if (!estado || estado.error) {
    return `<div class="text-[12px]" style="color:var(--bad)">
      No se pudo hablar con el servicio de WhatsApp.${estado?.error ? ` <span class="font-mono">${esc(estado.error)}</span>` : ""}
    </div>`;
  }

  const conexion = estado.contenedor?.conexion;
  const { titulo, detalle, color } = enCastellano(conexion);
  const vinculadoComo = estado.contenedor?.vinculadoComo ?? null;

  // El QR solo se muestra si de verdad hace falta. Servirlo cuando ya está
  // conectado sería un riesgo: cualquiera con el panel abierto podría vincular
  // OTRO teléfono al mismo bot.
  const bloqueQr =
    qr && conexion !== "conectada"
      ? `<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">
           <img src="${esc(qr)}" alt="Código QR para vincular WhatsApp"
                style="width:100%;max-width:280px;height:auto;border-radius:12px;background:#fff;padding:12px">
           <ol class="text-dim text-[12px]" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px">
             <li>Abra WhatsApp en el teléfono del negocio.</li>
             <li>Vaya a <strong>Dispositivos vinculados</strong>.</li>
             <li>Toque <strong>Vincular un dispositivo</strong> y apunte al código.</li>
           </ol>
         </div>`
      : "";

  const numero = vinculadoComo
    ? `<div class="text-dim text-[12px]">Número vinculado: <span class="font-mono text-cream">${esc(
        vinculadoComo.split(":")[0] ?? vinculadoComo,
      )}</span></div>`
    : "";

  const recibidos = estado.contenedor?.mensajesRecibidos ?? 0;
  const actividad =
    conexion === "conectada"
      ? `<div class="text-dim text-[12px]">Mensajes recibidos desde el último reinicio: <span class="text-cream">${recibidos}</span></div>`
      : "";

  // El latido, a la vista. Cuando está vencido NO se disimula: es la diferencia
  // entre "el canal se cayó y se está recuperando solo" y "nadie está cuidando
  // este canal", y esa diferencia es justo la que el 16-sep-2026 no se pudo ver.
  const revision = haceCuanto(estado.latido?.ultimoEn, Date.now());
  const latido = estado.latido?.vencido
    ? `<div class="text-[12px]" style="color:var(--bad)">
         El servicio de vigilancia dejó de revisar la conexión${revision ? ` (última revisión ${esc(revision)})` : ""}.
         Toque <strong>Reiniciar el servicio</strong> para volver a ponerlo en marcha.
       </div>`
    : revision
      ? `<div class="text-dim text-[12px]">Conexión revisada ${esc(revision)}.</div>`
      : "";

  // El error técnico va detrás de un <details>: al dueño no le sirve, pero a
  // quien venga a ayudarle le ahorra la cacería. Esconderlo del todo fue un
  // error que ya cometimos durante el piloto.
  const error = estado.contenedor?.ultimoError
    ? `<details class="text-[12px]" style="color:var(--dim)">
         <summary style="cursor:pointer;min-height:44px;display:flex;align-items:center">Detalle técnico</summary>
         <div class="font-mono text-[12px]" style="word-break:break-word;color:var(--warn)">${esc(
           estado.contenedor.ultimoError,
         )}</div>
       </details>`
    : "";

  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <span style="font-size:12px;letter-spacing:.14em;color:${COLOR[color]};border:1px solid ${COLOR[color]};padding:3px 10px;border-radius:999px;font-weight:700">${esc(titulo.toUpperCase())}</span>
      </div>
      <p class="text-dim text-[12.5px]" style="margin:0">${esc(detalle)}</p>
      ${numero}
      ${actividad}
      ${latido}
      ${bloqueQr}
      ${error}
      <div class="row-wrap" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:2px">
        <button type="button"
                hx-post="/admin/whatsapp-qr/reiniciar"
                hx-target="#wa-qr-panel" hx-swap="innerHTML"
                class="text-[13px]"
                style="min-height:44px;padding:0 16px;border:1px solid var(--line);background:none;color:var(--cream);border-radius:999px;cursor:pointer">
          Reiniciar el servicio
        </button>
        ${
          conexion === "conectada"
            ? `<button type="button"
                  hx-post="/admin/whatsapp-qr/desvincular"
                  hx-confirm="¿Desvincular el número? El bot dejará de contestar por WhatsApp hasta que escanee un código nuevo."
                  hx-target="#wa-qr-panel" hx-swap="innerHTML"
                  class="text-[13px]"
                  style="min-height:44px;padding:0 16px;border:1px solid var(--bad);background:none;color:var(--bad);border-radius:999px;cursor:pointer">
            Desvincular
          </button>`
            : ""
        }
      </div>
    </div>`;
}

/** La tarjeta completa, con el contenedor que htmx recarga sola. */
export function renderWhatsappQrCard(env: Env): string {
  if (!env.WA_PUENTE_URL || !env.WA_TOKEN) {
    return `<div class="text-[12px]" style="color:var(--bad)">
      Falta configurar: <span class="font-mono">${!env.WA_PUENTE_URL ? "WA_PUENTE_URL" : ""}${
        !env.WA_PUENTE_URL && !env.WA_TOKEN ? ", " : ""
      }${!env.WA_TOKEN ? "WA_TOKEN" : ""}</span>
    </div>`;
  }
  return `<div id="wa-qr-panel"
               hx-get="/admin/whatsapp-qr/estado"
               hx-trigger="load, every 5s"
               hx-swap="innerHTML">
            <p class="text-dim text-[12px]" style="margin:0">Consultando…</p>
          </div>`;
}
