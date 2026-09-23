// WhatsApp por QR — el canal que habla con el puente `juancitoads-bot-wa`.
//
// A diferencia de los demás canales, el bot NO habla con el proveedor: habla
// con un Worker puente que sostiene un contenedor con Baileys, que es quien
// mantiene el WebSocket con WhatsApp. El protocolo de WhatsApp Web no tiene
// webhooks — si nadie sostiene el socket, los mensajes no llegan — y un Worker
// no vive tanto.
//
// El puente vive aparte a propósito: si su imagen no construye, el que no se
// despliega es el puente y el bot sigue publicándose.
//
// Este canal es ALTERNO. Baileys no es oficial y WhatsApp puede banear el
// número vinculado, así que la Cloud API (`/webhooks/whatsapp`) se queda
// conectada: si el QR cae, el bot no se queda mudo.

import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";
import type { RespuestaDelTelefono } from "../takeover";
import { guardarMedia, urlDeMedia } from "../media/almacen";

/** Lo que el puente manda en `POST /webhooks/whatsapp-qr`. */
interface EntranteDelPuente {
  de: string | null;
  nombre: string | null;
  texto: string | null;
  tipo: string | null;
  recibidoEn: number;
  /**
   * La nota de voz o la imagen, en base64. La descarga el contenedor en el
   * momento (Baileys no deja una URL para después). No viene si el mensaje es
   * solo texto, ni si el contenedor no pudo descargarla — entonces `tipo` dice
   * qué era.
   */
  media?: { clase: "audio" | "imagen"; mime: string; base64: string } | null;
}

/** Lo que se le dice al bot cuando el archivo no llegó: mejor que un mensaje vacío. */
const SIN_ARCHIVO: Record<string, string> = {
  audioMessage: "(la clienta mandó una nota de voz, pero no se pudo descargar)",
  imageMessage: "(la clienta mandó una imagen, pero no se pudo descargar)",
  videoMessage: "(la clienta mandó un video)",
  documentMessage: "(la clienta mandó un documento)",
  documentWithCaptionMessage: "(la clienta mandó un documento)",
  stickerMessage: "(la clienta mandó un sticker)",
  locationMessage: "(la clienta mandó una ubicación)",
  contactMessage: "(la clienta mandó un contacto)",
};

/**
 * El JID de WhatsApp incluye el sufijo del servidor: `521555…@s.whatsapp.net`,
 * o `…@lid` en los grupos modernos. Se guarda el JID COMPLETO como
 * `channelUserId` porque es lo que hay que devolverle al puente para responder
 * — quitarle el sufijo obligaría a adivinarlo al contestar, y el de `@lid` no
 * se puede reconstruir.
 */
export function esJidDeGrupo(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export const whatsappQrAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const cuerpo = (await request.json()) as EntranteDelPuente;
    const jid = cuerpo.de ?? "";
    if (!jid) throw new Error("El puente mandó un mensaje sin remitente.");

    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    const media = cuerpo.media;
    if (media?.base64) {
      try {
        const id = await guardarMedia(env, new Uint8Array(Buffer.from(media.base64, "base64")), media.mime);
        const url = await urlDeMedia(env, id);
        if (media.clase === "audio") audioUrl = url;
        else imageUrl = url;
      } catch (e) {
        console.error("[whatsapp-qr] no se pudo guardar el archivo:", e);
      }
    }
    let text = cuerpo.texto?.trim() || undefined;
    if (!text && !audioUrl && !imageUrl && cuerpo.tipo && SIN_ARCHIVO[cuerpo.tipo]) text = SIN_ARCHIVO[cuerpo.tipo];

    return {
      channel: "whatsapp-qr",
      channelUserId: jid,
      displayName: cuerpo.nombre ?? undefined,
      text,
      audioUrl,
      imageUrl,
      // Los mensajes propios (`key.fromMe`) NO llegan por aquí: el puente los
      // manda a /webhooks/whatsapp-qr/propio, que pausa la conversación. Lo
      // que llega a esta ruta siempre lo escribió la clienta.
      isOwnerMessage: false,
      receivedAt: cuerpo.recibidoEn ?? Date.now(),
      rawPayload: cuerpo,
    };
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const token = env.WA_TOKEN;
    if (!token) throw new Error("Falta WA_TOKEN");
    if (!env.PUENTE_WA && !env.WA_PUENTE_URL) {
      throw new Error("Falta el binding PUENTE_WA o WA_PUENTE_URL");
    }

    // Por SERVICE BINDING cuando existe. Cloudflare rechaza con error 1042 que
    // un Worker llame a otro Worker de la MISMA cuenta por su URL pública, y el
    // bot y su puente viven siempre en la misma cuenta.
    //
    // El puente manda los chunks en una sola llamada y los espacia desde allá:
    // el retraso entre mensajes tiene que correr donde vive el socket, no aquí,
    // o el Worker se quedaría esperando sin trabajar y pagando por ello.
    const destino = env.PUENTE_WA
      ? "https://puente-wa/api/enviar"
      : `${env.WA_PUENTE_URL!.replace(/\/$/, "")}/api/enviar`;

    const peticion = new Request(destino, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wa-token-b64": btoa(String.fromCharCode(...new TextEncoder().encode(token))),
      },
      body: JSON.stringify({
        para: reply.channelUserId,
        chunks: reply.chunks,
        esperaMs: reply.interChunkDelayMs ?? 1000,
      }),
    });

    const r = env.PUENTE_WA ? await env.PUENTE_WA.fetch(peticion) : await fetch(peticion);

    if (!r.ok) {
      // Se lanza a propósito: que el fallo se vea en los logs y en la salud del
      // bot en vez de que la respuesta se pierda en silencio.
      throw new Error(`puente /api/enviar → ${r.status} ${await r.text().catch(() => "")}`);
    }
  },
};

/**
 * Lo que el puente manda en `POST /webhooks/whatsapp-qr/propio`: un mensaje
 * que salió del NÚMERO del negocio pero no lo mandó el bot — la dueña contestó
 * desde el teléfono, o desde WhatsApp Web en su computadora.
 *
 * Va por una ruta aparte y no con una marca dentro de la de entrantes a
 * propósito: un bot desplegado antes que este cambio no conoce la marca, y
 * trataría el texto de la dueña como si fuera de la clienta — le contestaría a
 * su propia dueña. Una ruta que no existe devuelve 404, y el puente lo anota.
 */
export function parseRespuestaPropia(cuerpo: unknown): RespuestaDelTelefono {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const jids = Array.isArray(c.jids) ? c.jids.filter((j): j is string => typeof j === "string") : [];
  if (jids.length === 0) throw new Error("El puente mandó un mensaje propio sin chat.");
  const enviadoEn = Number(c.enviadoEn);
  return {
    jids,
    texto: typeof c.texto === "string" ? c.texto : null,
    tipo: typeof c.tipo === "string" ? c.tipo : null,
    enviadoEn: Number.isFinite(enviadoEn) && enviadoEn > 0 ? enviadoEn : Date.now(),
  };
}
