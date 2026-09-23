// Lo que manda el bot contra lo que manda una persona desde el teléfono.
//
// Los dos salen del mismo número y los dos le llegan a Baileys como `fromMe`.
// Hasta el 23-sep-2026 el contenedor los tiraba todos, y el bot seguía
// contestando encima de la dueña: los dos le escribían a la misma clienta a la
// vez. Ahora los de una persona se avisan al CRM, que pausa esa conversación.
//
// La diferencia la pone el bot: cada envío lleva un id que se genera ANTES de
// mandarlo y se anota aquí. Tiene que ser antes: Baileys emite el eco de lo
// enviado en el mismo tick en que termina `sendMessage`, y anotar el id que
// devuelve llegaría tarde a su propio eco.
//
// Vive aparte de servidor.mjs para poder probarlo sin abrir un socket.

/** Cuánto se recuerda un envío del bot. El eco llega en milisegundos. */
const RECORDAR_ENVIOS_MS = 60 * 60 * 1000;
const TOPE_DE_ENVIOS = 2000;

/** El registro de ids que mandó el bot. Se poda solo; no crece con los días. */
export function crearRegistroDeEnvios() {
  const enviados = new Map();
  return {
    anotar(id, ahora = Date.now()) {
      enviados.set(id, ahora);
      for (const [k, t] of enviados) {
        if (ahora - t > RECORDAR_ENVIOS_MS || enviados.size > TOPE_DE_ENVIOS) enviados.delete(k);
        else break;
      }
    },
    tiene(id) {
      return enviados.has(id);
    },
    get tamano() {
      return enviados.size;
    },
  };
}

/**
 * Qué cuenta como "una persona escribió": un mensaje con contenido de verdad.
 * No cuentan las reacciones, los borrados, las ediciones ni el resto de
 * mensajes de protocolo — que la dueña le ponga un corazón a un mensaje no es
 * tomar la conversación.
 */
const TIPOS_DE_RESPUESTA = new Set([
  "conversation",
  "extendedTextMessage",
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "documentWithCaptionMessage",
  "stickerMessage",
  "contactMessage",
  "contactsArrayMessage",
  "locationMessage",
]);

/**
 * Cuánto de viejo puede ser un mensaje propio para contar. Al reconectar,
 * WhatsApp entrega (como `append`) lo que la dueña mandó mientras el contenedor
 * estaba caído: eso sí cuenta, si es reciente. Lo de hace horas no pausa nada.
 */
export const RESPUESTA_VIGENTE_MS = 15 * 60 * 1000;

/** El contenido del mensaje, sin las envolturas de "temporal" o "ver una vez". */
function interior(msg) {
  const m = msg?.message ?? {};
  return m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m;
}

export function tipoDe(msg) {
  return (
    Object.keys(interior(msg)).find(
      (k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage",
    ) ?? null
  );
}

export function textoDe(msg) {
  const m = interior(msg);
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    null
  );
}

/** Sin el sufijo de dispositivo: `507…:12@s.whatsapp.net` → `507…@s.whatsapp.net`. */
export function sinDispositivo(jid) {
  if (!jid) return jid;
  const [usuario, servidor] = String(jid).split("@");
  if (!servidor) return jid;
  return `${usuario.split(":")[0]}@${servidor}`;
}

/**
 * ¿Este mensaje propio lo escribió una persona?
 *
 *   msg      — el mensaje tal como lo emite Baileys
 *   enviados — el registro de ids del bot (crearRegistroDeEnvios)
 *   yo       — los jids del propio número (id y lid del socket)
 */
export function esRespuestaDelTelefono(msg, { enviados, yo = [], ahora = Date.now() }) {
  if (!msg?.key?.fromMe) return false;
  const id = msg.key.id;
  if (!id || enviados.tiene(id)) return false;
  const jid = msg.key.remoteJid ?? "";
  // Solo chats uno a uno: ni grupos, ni estados, ni canales.
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) {
    return false;
  }
  // Un mensaje a uno mismo (las notas personales de WhatsApp) no es una clienta.
  const propios = yo.filter(Boolean).map(sinDispositivo);
  if (propios.includes(sinDispositivo(jid))) return false;
  if (!TIPOS_DE_RESPUESTA.has(tipoDe(msg))) return false;
  const ts = Number(msg.messageTimestamp ?? 0) * 1000;
  if (ts && ahora - ts > RESPUESTA_VIGENTE_MS) return false;
  return true;
}
