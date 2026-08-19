// Páginas legales PÚBLICAS (sin contraseña): privacidad, términos y eliminación
// de datos.
//
// Meta las exige para poner una app en producción (Configuración básica de la
// app → Política de privacidad, Términos del servicio, Eliminación de datos de
// usuario). Viven en el propio Worker, no en un sitio aparte: así comparten
// dominio con el webhook, se publican en el mismo deploy y no hay un segundo
// hosting que mantener.
//
// El texto se arma con los datos del negocio (BUSINESS_NAME, OWNER_EMAIL), así
// que cualquiera que clone el repo obtiene SUS páginas sin editar código.
import type { Env } from "./env";

/** Fecha de la última revisión del TEXTO legal. Súbela al cambiar el contenido. */
export const LEGAL_LAST_UPDATED = "19 de agosto de 2026";

/** Días que tarda el negocio en atender una solicitud de borrado. */
const DELETION_SLA_DAYS = 30;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

interface LegalContext {
  business: string;
  email: string;
  base: string;
}

function context(env: Env): LegalContext {
  return {
    business: env.BUSINESS_NAME?.trim() || env.BOT_NAME?.trim() || "este negocio",
    email: env.OWNER_EMAIL?.trim() || "",
    base: (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, ""),
  };
}

/** Enlace al correo del negocio, o texto plano si no hay correo configurado. */
function mailto(email: string): string {
  return email
    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`
    : "<em>(el negocio aún no publicó un correo de contacto)</em>";
}

/**
 * Envoltorio común: HTML autocontenido, con la identidad de Juancito Ads y sin
 * assets externos salvo las fuentes. Legible en móvil y al imprimir — que es
 * como lo abre el revisor de Meta.
 */
function page(title: string, ctx: LegalContext, bodyHtml: string): string {
  const nav = [
    ["/privacidad", "Privacidad"],
    ["/terminos", "Términos"],
    ["/eliminar-datos", "Eliminar mis datos"],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(ctx.business)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Inter:wght@600;700&display=swap" rel="stylesheet">
<style>
  :root { --bg:#050D1F; --panel:#0A1730; --cream:#F4F8FF; --muted:#9FB3D1; --accent:#1E90FF; --line:rgba(159,179,209,.22); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--cream);
         font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,sans-serif;
         font-size:16px; line-height:1.65; }
  .wrap { max-width:760px; margin:0 auto; padding:48px 22px 80px; }
  h1,h2 { font-family:Inter,system-ui,sans-serif; line-height:1.25; }
  h1 { font-size:29px; font-weight:700; margin:0 0 6px; }
  h2 { font-size:18px; font-weight:600; margin:34px 0 10px; color:var(--cream); }
  p, li { color:var(--muted); }
  li { margin-bottom:7px; }
  a { color:var(--accent); }
  strong { color:var(--cream); font-weight:600; }
  .meta { color:var(--muted); font-size:13.5px; margin:0 0 30px; }
  nav { display:flex; gap:18px; flex-wrap:wrap; font-size:14px;
        border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:30px; }
  .box { background:var(--panel); border:1px solid var(--line);
         border-left:3px solid var(--accent); padding:16px 18px; margin:22px 0; border-radius:2px; }
  .box p:last-child, .box ol:last-child, .box ul:last-child { margin-bottom:0; }
  footer { margin-top:52px; padding-top:18px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
  @media print { body { background:#fff; color:#111; } p,li,.meta,footer { color:#333; } .box { background:#f6f6f6; } }
</style>
</head>
<body>
  <div class="wrap">
    <nav>${nav}</nav>
    <h1>${esc(title)}</h1>
    <p class="meta">${esc(ctx.business)} · Última actualización: ${esc(LEGAL_LAST_UPDATED)}</p>
    ${bodyHtml}
    <footer>${esc(ctx.business)} — ${mailto(ctx.email)}</footer>
  </div>
</body>
</html>`;
}

/** Política de privacidad: qué se recoge, para qué, dónde vive y por cuánto tiempo. */
export function renderPrivacyPolicy(env: Env): string {
  const ctx = context(env);
  const b = esc(ctx.business);
  return page(
    "Política de Privacidad",
    ctx,
    `
    <p>Esta política explica qué datos trata <strong>${b}</strong> cuando escribes a
       nuestro asistente automatizado por WhatsApp u otros canales de mensajería, para qué
       los usamos y cómo puedes pedir que los borremos.</p>

    <h2>1. Quién es responsable de tus datos</h2>
    <p>${b} es el responsable del tratamiento. Para cualquier tema de privacidad puedes
       escribirnos a ${mailto(ctx.email)}.</p>

    <h2>2. Qué datos recogemos</h2>
    <ul>
      <li><strong>Tu identificador en el canal</strong>: el número de teléfono con el que escribes
          por WhatsApp, o tu identificador de usuario en el canal que uses.</li>
      <li><strong>Tu nombre de perfil público</strong>, tal como lo entrega el canal.</li>
      <li><strong>El contenido de los mensajes</strong> que nos envías: texto, imágenes y notas de voz.</li>
      <li><strong>Los datos que nos das voluntariamente</strong> durante la conversación: nombre,
          un contacto alterno, y los detalles de lo que pides (por ejemplo fecha y hora de una cita,
          o el producto que te interesa).</li>
    </ul>
    <p>No pedimos ni necesitamos datos de tarjetas, contraseñas ni documentos de identidad.
       Por favor no los envíes por el chat.</p>

    <h2>3. Para qué los usamos</h2>
    <ul>
      <li>Atender tu conversación y responder tus dudas.</li>
      <li>Registrar tu solicitud (cita, pedido o consulta) para poder darle seguimiento.</li>
      <li>Pasarte con una persona del equipo cuando el asistente no basta.</li>
      <li>Revisar internamente la calidad de las respuestas y mejorarlas.</li>
    </ul>
    <p>No usamos tus datos para publicidad de terceros y <strong>no los vendemos</strong>.</p>

    <h2>4. Con quién se comparten</h2>
    <p>Solo con los proveedores necesarios para que el servicio funcione:</p>
    <ul>
      <li><strong>Meta (WhatsApp)</strong> y el resto de canales de mensajería, que transportan
          los mensajes. Su uso se rige además por las políticas del propio canal.</li>
      <li><strong>Cloudflare</strong>, donde se ejecuta y se almacena el servicio.</li>
      <li><strong>Un proveedor de inteligencia artificial</strong> (Anthropic, OpenAI o xAI, según
          nuestra configuración), que recibe el contenido del mensaje para redactar la respuesta,
          transcribir las notas de voz y describir las imágenes. Se procesa bajo los términos de
          API de cada proveedor.</li>
    </ul>
    <p>También podríamos entregar datos si nos lo exige una autoridad competente.</p>

    <h2>5. Cuánto tiempo los guardamos</h2>
    <ul>
      <li><strong>Mensajes de la conversación: 90 días.</strong> Un proceso automático borra a diario
          todo lo más antiguo.</li>
      <li><strong>Registros de solicitudes</strong> (tu contacto y lo que pediste): se conservan
          mientras sean necesarios para atenderte y para nuestros registros del negocio, o hasta
          que pidas su eliminación.</li>
    </ul>

    <h2>6. Tus derechos</h2>
    <p>Puedes pedirnos en cualquier momento que te digamos qué datos tuyos tenemos, que los
       corrijamos o que los borremos. Escríbenos a ${mailto(ctx.email)} y te respondemos en un
       plazo máximo de ${DELETION_SLA_DAYS} días. En
       <a href="/eliminar-datos">Eliminar mis datos</a> están los pasos exactos.</p>

    <h2>7. Seguridad</h2>
    <p>El servicio corre sobre infraestructura de Cloudflare, con acceso restringido por
       contraseña al panel de administración y comunicación cifrada (HTTPS). Ningún sistema es
       infalible, pero tratamos tus datos con el cuidado que esperarías.</p>

    <h2>8. Menores de edad</h2>
    <p>El servicio está dirigido a personas mayores de edad. Si detectamos que un menor nos
       escribió sin permiso de su madre, padre o tutor, borramos sus datos.</p>

    <h2>9. Cambios</h2>
    <p>Si cambiamos esta política, actualizamos la fecha del encabezado y publicamos la nueva
       versión en esta misma dirección.</p>`,
  );
}

/** Términos del servicio: qué es el asistente, qué no es, y cómo usarlo. */
export function renderTerms(env: Env): string {
  const ctx = context(env);
  const b = esc(ctx.business);
  return page(
    "Términos del Servicio",
    ctx,
    `
    <p>Al escribirle a nuestro asistente automatizado aceptas estos términos. Si no estás de
       acuerdo, por favor contáctanos por otro medio.</p>

    <h2>1. Qué es este servicio</h2>
    <p>Es un asistente automatizado de <strong>${b}</strong> que atiende por WhatsApp y otros
       canales de mensajería: responde preguntas frecuentes, toma tus datos para una solicitud
       y te pasa con una persona del equipo cuando hace falta. Es gratuito para ti; solo aplican
       los costos de datos de tu operador.</p>

    <h2>2. Estás hablando con un asistente automático</h2>
    <div class="box">
      <p>Las respuestas las genera un sistema de inteligencia artificial y <strong>pueden contener
         errores</strong>. Precios, disponibilidad, horarios y cualquier compromiso quedan sujetos a
         confirmación por parte de una persona de ${b}. Lo que diga el asistente no constituye una
         oferta en firme.</p>
    </div>

    <h2>3. No es un canal de emergencias</h2>
    <p>El asistente no atiende urgencias médicas, de seguridad ni de ningún otro tipo, y puede
       tardar o no estar disponible. Ante una emergencia llama a los servicios de tu localidad.</p>

    <h2>4. Uso aceptable</h2>
    <p>Al usar el servicio te comprometes a no:</p>
    <ul>
      <li>Enviar contenido ilegal, ofensivo o que vulnere derechos de terceros.</li>
      <li>Hacerte pasar por otra persona ni enviar datos de terceros sin su permiso.</li>
      <li>Intentar vulnerar, saturar o manipular el sistema.</li>
      <li>Usarlo para enviar publicidad o mensajes masivos no solicitados.</li>
    </ul>
    <p>Podemos dejar de atender a quien incumpla estos términos.</p>

    <h2>5. Disponibilidad</h2>
    <p>Hacemos lo posible por mantener el servicio activo, pero puede interrumpirse por
       mantenimiento o por fallas de los proveedores de los que depende. No garantizamos
       disponibilidad ininterrumpida.</p>

    <h2>6. Responsabilidad</h2>
    <p>${b} no se hace responsable de daños derivados de decisiones tomadas únicamente con base en
       una respuesta del asistente sin confirmarla con una persona del equipo. Nada de lo aquí
       escrito limita los derechos que la ley te reconoce como consumidor.</p>

    <h2>7. Privacidad</h2>
    <p>El tratamiento de tus datos se rige por nuestra
       <a href="/privacidad">Política de Privacidad</a>.</p>

    <h2>8. Cambios</h2>
    <p>Podemos actualizar estos términos; la versión vigente es siempre la publicada en esta
       dirección, con su fecha de actualización.</p>

    <h2>9. Contacto</h2>
    <p>Para cualquier duda sobre estos términos: ${mailto(ctx.email)}.</p>`,
  );
}

/** Instrucciones de eliminación de datos (Meta las pide como URL propia). */
export function renderDataDeletion(env: Env): string {
  const ctx = context(env);
  const b = esc(ctx.business);
  return page(
    "Cómo eliminar mis datos",
    ctx,
    `
    <p>Puedes pedirle a <strong>${b}</strong> que borre todo lo que guardamos de ti. Es gratis y no
       necesitas dar explicaciones.</p>

    <h2>Cómo pedirlo</h2>
    <div class="box">
      <ol>
        <li>Escribe un correo a ${mailto(ctx.email)}.</li>
        <li>Pon en el asunto: <strong>Eliminar mis datos</strong>.</li>
        <li>Incluye el <strong>número de teléfono con el que nos escribiste por WhatsApp</strong>
            (o tu usuario del canal que hayas usado). Lo necesitamos para encontrar tu
            conversación y para no borrar la de otra persona.</li>
      </ol>
    </div>
    <p>También puedes pedirlo por el mismo chat: dile al asistente que quieres hablar con una
       persona y que deseas eliminar tus datos, y alguien del equipo lo tramitará.</p>

    <h2>Qué borramos</h2>
    <ul>
      <li>El historial de mensajes de tu conversación (texto, imágenes y notas de voz).</li>
      <li>Tu nombre, tu número y cualquier contacto que nos hayas dado.</li>
      <li>Los registros de solicitudes (citas, pedidos o consultas) asociados a ti.</li>
    </ul>

    <h2>Qué puede quedar</h2>
    <p>Podemos conservar lo mínimo que exija la ley — por ejemplo un comprobante de una venta ya
       facturada — y datos estadísticos que ya no permiten identificarte.</p>

    <h2>Cuánto tarda</h2>
    <p>Lo atendemos en un máximo de <strong>${DELETION_SLA_DAYS} días</strong> y te confirmamos por
       el mismo medio cuando esté hecho. Ten en cuenta que, sin necesidad de pedirlo, el historial
       de mensajes se borra solo a los <strong>90 días</strong>.</p>

    <h2>Eliminar la conversación de tu lado</h2>
    <p>Borrar el chat en tu propio teléfono solo lo elimina de tu dispositivo: para que lo
       borremos de nuestros sistemas hay que hacer la solicitud de arriba.</p>

    <p>Más detalle en nuestra <a href="/privacidad">Política de Privacidad</a>.</p>`,
  );
}
