// Canal OFICIAL de Meta (sin ManyChat): Facebook Messenger + Instagram DMs.
//
// Una sola app de Meta cubre ambos. El webhook (Messenger e Instagram) trae el
// MISMO formato — entry[].messaging[] con sender/message — así que este único
// adaptador sirve para los dos. El envío es la Send API de Meta
// (graph.facebook.com/.../me/messages) con el Page Access Token.
//
// El webhook necesita 2 cosas que ManyChat ocultaba:
//  • GET de verificación (handshake con META_VERIFY_TOKEN) — lo maneja index.ts.
//  • Validar la firma X-Hub-Signature-256 de cada POST — verifyMetaSignature().
import type { ChannelAdapter, IncomingMessage, OutgoingReply, ChannelId } from "./shared";
import type { Env } from "../env";
import { graphVersion, GRAPH_API_VERSION } from "./graph";


interface MetaMessaging {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: { type: string; payload?: { url?: string } }[];
  };
}

interface MetaWebhookBody {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: MetaMessaging[] }[];
}

/**
 * Convierte un webhook de Meta en 0..N mensajes entrantes. Un solo POST puede
 * traer varias entradas y varios eventos; también trae echoes (mensajes que la
 * propia página envió) y recibos de entrega/lectura, que se ignoran.
 */
export function parseMetaEvents(body: MetaWebhookBody): IncomingMessage[] {
  const channel: ChannelId = body.object === "instagram" ? "instagram" : "messenger";
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      // Log SIN datos personales: nunca el texto del cliente ni su id completo
      // (los últimos 4 dígitos bastan para correlacionar un evento en los logs).
      console.log("meta in:", JSON.stringify({
        ch: channel,
        sender: ev.sender?.id ? `…${String(ev.sender.id).slice(-4)}` : undefined,
        echo: m?.is_echo,
        kind: m?.text ? "text" : m?.attachments?.[0]?.type ?? "other",
      }));
      if (!m || m.is_echo) continue; // ignora echoes
      if (m.quick_reply) continue; // tap de botón (quick reply), no es texto para el LLM
      const sender = ev.sender?.id;
      if (!sender) continue;
      const audio = m.attachments?.find((a) => a.type === "audio");
      const image = m.attachments?.find((a) => a.type === "image");
      if (!m.text && !audio && !image) continue; // ignora recibos/postbacks sin contenido
      out.push({
        channel,
        channelUserId: String(sender),
        text: m.text || undefined,
        audioUrl: audio?.payload?.url,
        imageUrl: image?.payload?.url,
        isOwnerMessage: false,
        receivedAt: Date.now(),
        rawPayload: ev,
      });
    }
  }
  return out;
}

/**
 * Por qué se descartó cada evento de un POST, para el diagnóstico del panel.
 *
 * `parseMetaEvents` tira cuatro clases de evento en silencio, y una de ellas
 * —"sin texto ni audio ni imagen"— incluye mensajes de verdad: una respuesta a
 * una historia llega como adjunto `story_mention`, y un producto compartido
 * como `share`. Si eso estuviera pasando, el síntoma sería idéntico al de "no
 * me llegan los DMs", pero la culpa sería nuestra y no de Meta.
 *
 * Cuenta sin guardar nada del cliente: ni texto, ni ids, solo tipos.
 */
export interface ResumenMeta {
  total: number;
  conMensaje: number;
  echo: number;
  quickReply: number;
  sinRemitente: number;
  /** Eventos sin `message`: recibos de entrega y de lectura, reacciones. */
  recibo: number;
  /** Trae mensaje, pero sin texto ni audio ni imagen: aquí viven los perdidos. */
  sinContenido: number;
  /** Tipos de adjunto vistos en los descartados (story_mention, share, …). */
  tipos: string[];
  /**
   * Eventos que Meta puso en `standby` en vez de en `messaging`.
   *
   * Cuando dos apps están suscritas a la misma Página, el protocolo de
   * transferencia de Meta manda los mensajes entrantes SOLO a la receptora
   * principal; las demás los reciben aquí. Los ecos y los recibos llegan
   * igual por `messaging`, así que el síntoma es exactamente este: "salen sí,
   * entran no". No los procesamos —sin control del hilo no se puede
   * responder— pero contarlos dice si es esto lo que pasa.
   */
  standby: number;
  /** Otras llaves de `entry` que no sabemos leer, por si Meta cambia la forma. */
  otrasLlaves: string[];
}

const LLAVES_CONOCIDAS = new Set(["id", "time", "messaging", "standby", "changes"]);

export function resumirMetaEventos(body: MetaWebhookBody): ResumenMeta {
  const r: ResumenMeta = {
    total: 0, conMensaje: 0, echo: 0, quickReply: 0, sinRemitente: 0, recibo: 0, sinContenido: 0, tipos: [],
    standby: 0, otrasLlaves: [],
  };
  const tipos = new Set<string>();
  const otras = new Set<string>();
  for (const entry of (body.entry ?? []) as Record<string, unknown>[]) {
    const enEspera = Array.isArray(entry.standby) ? entry.standby : [];
    r.standby += enEspera.length;
    r.total += enEspera.length; // llegaron: que el conteo no los esconda
    for (const k of Object.keys(entry)) if (!LLAVES_CONOCIDAS.has(k)) otras.add(k);
    for (const ev of ((entry.messaging ?? []) as MetaMessaging[])) {
      r.total++;
      const m = ev.message;
      if (!m) { r.recibo++; continue; }
      if (m.is_echo) { r.echo++; continue; }
      if (m.quick_reply) { r.quickReply++; continue; }
      if (!ev.sender?.id) { r.sinRemitente++; continue; }
      const tieneMedio = m.attachments?.some((a) => a.type === "audio" || a.type === "image");
      if (!m.text && !tieneMedio) {
        r.sinContenido++;
        for (const a of m.attachments ?? []) if (a?.type) tipos.add(a.type);
        continue;
      }
      r.conMensaje++;
    }
  }
  r.tipos = [...tipos];
  r.otrasLlaves = [...otras];
  return r;
}

/** El resumen en una línea de español, para la tarjeta de Conexiones. */
export function describirResumen(r: ResumenMeta): string {
  const partes: string[] = [];
  // Primero, porque si aparece explica TODO lo demás.
  if (r.standby) {
    partes.push(
      `${r.standby} en STANDBY (otra app de Meta es la receptora principal de esta Página; por eso entran los ecos y no los mensajes)`,
    );
  }
  if (r.conMensaje) partes.push(`${r.conMensaje} con mensaje`);
  if (r.recibo) partes.push(`${r.recibo} recibo/reacción`);
  if (r.echo) partes.push(`${r.echo} eco de la propia cuenta`);
  if (r.quickReply) partes.push(`${r.quickReply} tap de botón`);
  if (r.sinRemitente) partes.push(`${r.sinRemitente} sin remitente`);
  if (r.sinContenido) {
    partes.push(
      r.tipos.length
        ? `${r.sinContenido} con adjunto que NO procesamos (${r.tipos.join(", ")})`
        : `${r.sinContenido} sin texto ni adjunto`,
    );
  }
  if (r.otrasLlaves.length) partes.push(`llaves que no leemos: ${r.otrasLlaves.join(", ")}`);
  return `${r.total} evento(s): ${partes.join(", ") || "ninguno reconocible"}`;
}

/**
 * Valida la firma HMAC-SHA256 (`X-Hub-Signature-256: sha256=<hex>`) que Meta
 * pone en cada POST, usando el App Secret. Comparación en tiempo constante.
 * Fail-closed: sin firma válida o sin secret → false.
 */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// El token de Instagram Login resuelve `me` al "app-scoped id", que NO es el
// dueño del hilo de mensajes — ese es el `user_id` (el Instagram Business
// Account ID). Enviar como `me` da error "not the thread owner" (subcode
// 2534037). Resolvemos el user_id una vez y lo cacheamos por token.
let igSenderIdCache: { token: string; id: string } | null = null;
async function instagramSenderId(token: string): Promise<string> {
  if (igSenderIdCache?.token === token) return igSenderIdCache.id;
  try {
    const r = await fetch(
      `https://graph.instagram.com/${GRAPH_API_VERSION}/me?fields=user_id&access_token=${encodeURIComponent(token)}`,
    );
    const j = (await r.json()) as { user_id?: string | number };
    const id = j?.user_id ? String(j.user_id) : "me";
    igSenderIdCache = { token, id };
    return id;
  } catch {
    return "me";
  }
}

export const metaAdapter: ChannelAdapter = {
  // Existe por la interfaz ChannelAdapter; el webhook /webhooks/meta usa
  // parseMetaEvents directamente (un POST puede traer varios mensajes).
  async parseIncoming(request: Request, _env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as MetaWebhookBody;
    const [first] = parseMetaEvents(body);
    if (!first) throw new Error("meta webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    // Dos rutas de envío según cómo se conectó Instagram:
    //  • "Instagram API con Instagram Login" (token IGAA…) → graph.instagram.com
    //    + INSTAGRAM_ACCESS_TOKEN.
    //  • Messenger / IG ligado a una Página de Facebook → graph.facebook.com
    //    + META_PAGE_ACCESS_TOKEN.
    const useIG = reply.channel === "instagram" && !!env.INSTAGRAM_ACCESS_TOKEN;
    const base = useIG ? "https://graph.instagram.com" : "https://graph.facebook.com";
    const token = useIG ? env.INSTAGRAM_ACCESS_TOKEN : env.META_PAGE_ACCESS_TOKEN;
    if (!token) {
      throw new Error("Meta: falta INSTAGRAM_ACCESS_TOKEN (IG Login) o META_PAGE_ACCESS_TOKEN (Messenger).");
    }
    // Messenger envía como `me` (la Página). Instagram Login debe enviar como el
    // user_id (dueño del hilo), no como `me` (app-scoped id) → si no, 2534037.
    const node = useIG ? await instagramSenderId(token) : "me";
    const url = `${base}/${graphVersion(env)}/${node}/messages`;
    console.log("meta out:", JSON.stringify({ useIG, node, to: reply.channelUserId }));
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const payload: Record<string, unknown> = {
        recipient: { id: reply.channelUserId },
        message: { text: reply.chunks[i] },
      };
      // `messaging_type` es de Messenger. La Send API de Instagram no lo acepta
      // en NINGUNO de sus dos caminos — ni IG Login, ni IG ligado a una Página
      // (que sale por graph.facebook.com con el Page Access Token, igual que
      // Messenger). Atarlo a `!useIG` lo colaba en ese segundo caso.
      if (reply.channel === "messenger") payload.messaging_type = "RESPONSE";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      // Meta responde 200 con el message_id o un error JSON. No lo tragues: si
      // falla, logéalo con el cuerpo para ver el motivo exacto (permiso, ventana
      // de 24h, recipiente inválido, etc.).
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`meta sendReply ${res.status} ${useIG ? "IG" : "FB"}: ${errBody}`);
      }
    }
  },
};
