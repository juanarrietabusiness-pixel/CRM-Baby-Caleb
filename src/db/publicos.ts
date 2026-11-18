// Públicos para Meta: la lista de contactos lista para subir a Anuncios.
//
// El export de siempre (`exportLeadsCsv`) sirve para mirar los leads, no para
// Meta: mezcla teléfono y correo en una columna, no normaliza el número y
// deja fuera a quien nunca llegó a ser "lead" formal — entre ellas TODAS las
// de WhatsApp, donde el identificador de la conversación ES el teléfono.
//
// Meta solo puede cruzar a una persona si tiene su TELÉFONO o su CORREO. Un
// identificador de Instagram no le sirve. Por eso aquí:
//   • el teléfono sale en formato internacional (+507…), que es como Meta lo
//     espera;
//   • cada persona aparece UNA vez, aunque haya escrito por dos canales;
//   • y se puede pedir el público segmentado, que es lo que de verdad cambia
//     el rendimiento de una campaña.
import { Db } from "./client";
import type { Env } from "../env";

/** Qué lista se quiere. */
export type Publico = "compradoras" | "interesadas" | "todas";

export interface Contacto {
  telefono: string; // E.164 o ""
  email: string;
  nombre: string;
  canal: string;
  primerContacto: number;
  ultimaActividad: number;
  compro: boolean;
}

/** Prefijo por defecto cuando el número viene sin país. Panamá = 507. */
export const PAIS_POR_DEFECTO = "507";

/**
 * Un teléfono a E.164 (`+50761234567`), o "" si no parece un teléfono.
 *
 * Meta descarta la fila entera si el número no está en ese formato, así que
 * más vale no mandarlo que mandarlo mal.
 */
export function normalizarTelefono(valor: string | null | undefined, pais = PAIS_POR_DEFECTO): string {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return "";
  // Los ids de WhatsApp vienen como 50761234567@s.whatsapp.net
  const sinSufijo = bruto.split("@")[0];
  const digitos = sinSufijo.replace(/\D/g, "");
  if (digitos.length < 7) return "";
  // Demasiado largo para ser un teléfono: suele ser un id de Instagram.
  if (digitos.length > 15) return "";
  if (sinSufijo.trim().startsWith("+")) return `+${digitos}`;
  // Ya trae el país delante.
  if (digitos.startsWith(pais) && digitos.length > pais.length + 6) return `+${digitos}`;
  // Panamá: 8 dígitos (móvil) o 7 (fijo).
  if (digitos.length <= 8) return `+${pais}${digitos}`;
  return `+${digitos}`;
}

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** El correo que haya en el texto del contacto, o "". */
export function extraerEmail(valor: string | null | undefined): string {
  const m = RE_EMAIL.exec(String(valor ?? ""));
  return m ? m[0].toLowerCase() : "";
}

/** Los canales cuyo identificador ES un teléfono. */
const CANAL_ES_TELEFONO = new Set(["whatsapp", "twilio", "whatsapp-qr", "wa-qr"]);

interface FilaConv {
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  started_at: number;
  last_message_at: number;
  lead_name: string | null;
  contact: string | null;
  lead_status: string | null;
  compras: number;
  pagos: number;
}

/**
 * Una fila por persona, con su mejor teléfono y su mejor correo.
 *
 * Se parte de las conversaciones (todas las que escribieron), se le pega su
 * lead si lo tiene, y se marca quién compró con las mismas señales que usa el
 * seguimiento: compra registrada, venta, o ticket de pago.
 */
export async function contactosParaMeta(env: Env, publico: Publico = "todas"): Promise<Contacto[]> {
  const db = new Db(env.DB);
  const filas = await db.all<FilaConv>(
    `SELECT c.channel, c.channel_user_id, c.display_name, c.started_at, c.last_message_at,
            l.name AS lead_name, l.contact, l.status AS lead_status,
            (SELECT COUNT(*) FROM compras p WHERE p.conversation_id = c.id) AS compras,
            (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.category = 'billing') AS pagos
       FROM conversations c
       LEFT JOIN leads l ON l.conversation_id = c.id
      ORDER BY c.last_message_at DESC`,
  );

  // Clave: el teléfono si lo hay, si no el correo, si no canal+id. Así la
  // misma persona por Instagram y por WhatsApp no sale dos veces.
  const porPersona = new Map<string, Contacto>();
  for (const f of filas) {
    const esTel = CANAL_ES_TELEFONO.has(f.channel);
    const telefono =
      normalizarTelefono(f.contact) || (esTel ? normalizarTelefono(f.channel_user_id) : "");
    const email = extraerEmail(f.contact);
    const compro = f.compras > 0 || f.pagos > 0 || f.lead_status === "sold";
    const clave = telefono || email || `${f.channel}:${f.channel_user_id}`;
    const previo = porPersona.get(clave);
    const contacto: Contacto = {
      telefono: telefono || previo?.telefono || "",
      email: email || previo?.email || "",
      nombre: (f.lead_name || f.display_name || previo?.nombre || "").trim(),
      canal: previo ? `${previo.canal}${previo.canal.includes(f.channel) ? "" : `+${f.channel}`}` : f.channel,
      primerContacto: Math.min(f.started_at, previo?.primerContacto ?? f.started_at),
      ultimaActividad: Math.max(f.last_message_at, previo?.ultimaActividad ?? 0),
      // Si compró por un canal, compró: la marca no se pierde al unir.
      compro: compro || previo?.compro || false,
    };
    porPersona.set(clave, contacto);
  }

  let lista = [...porPersona.values()];
  if (publico === "compradoras") lista = lista.filter((c) => c.compro);
  if (publico === "interesadas") lista = lista.filter((c) => !c.compro);
  // Sin teléfono ni correo, Meta no puede cruzarla: ocupa espacio y no sirve.
  return lista.filter((c) => c.telefono || c.email).sort((a, b) => b.ultimaActividad - a.ultimaActividad);
}

const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
const fecha = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/**
 * El CSV tal como lo quiere el cargador de públicos de Meta: `phone` y `email`
 * con esos nombres, y `fn` para el nombre de pila. Las demás columnas Meta las
 * ignora, y sirven para revisar la lista antes de subirla.
 */
export function contactosACsv(contactos: Contacto[]): string {
  const header = "phone,email,fn,canal,primer_contacto,ultima_actividad,compro\n";
  const filas = contactos.map((c) => {
    const nombrePila = c.nombre.split(/\s+/)[0] ?? "";
    return [
      esc(c.telefono),
      esc(c.email),
      esc(nombrePila.toLowerCase()),
      esc(c.canal),
      esc(fecha(c.primerContacto)),
      esc(fecha(c.ultimaActividad)),
      c.compro ? "si" : "no",
    ].join(",");
  });
  return header + filas.join("\n") + (filas.length ? "\n" : "");
}
