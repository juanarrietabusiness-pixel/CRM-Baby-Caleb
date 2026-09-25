// Lo que el dueño escribe con sus palabras —o dice en una nota de voz, o manda
// en una foto—: "¿qué tengo pendiente?", "devuélvele la conversación de Ana al
// bot", "vendí 2 cajas de la M".
//
// Quien habla aquí es el JEFE, no una clienta: el canal es interno, para dar
// seguimiento, trazabilidad, logística, inventario y ajustes. Y recuerda lo que
// se habló (src/owner/memoria.ts): "¿y de la M?" se entiende por lo anterior.
//
// Es un asistente INTERNO: habla con el dueño, no con las clientas. Puede leer
// y hacer lo reversible (pausar, devolver al bot). Lo que sale hacia afuera —un
// mensaje a una clienta— o mueve el inventario va como PROPUESTA con botones:
// el dueño confirma con un toque. Un modelo que entiende mal no puede mandar un
// mensaje ni descontar una caja sin que nadie lo vea.

import { generateText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { devolverAlBot, pausarPorHumano } from "../takeover";
import {
  buscarConversaciones,
  conversacionesDeAvisosRecientes,
  crearAccion,
  motivoParaNoEscribir,
  nombreDe,
  nuevoGrupo,
  personalizar,
  refCorta,
} from "./acciones";
import { textoDePendientes } from "./pendientes";
import { EXTENSIONES } from "./extensiones";
import { comoMensajes, historial } from "./memoria";
import { CHANNEL_LABELS } from "../channels/labels";
import { KbDocsRepo, type KbDoc } from "../kb/docs";
import type { Contexto, Respuesta } from "./tipos";

const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** El documento por su título, sin importar tildes ni mayúsculas. */
export function buscarDoc(docs: KbDoc[], titulo: string): KbDoc | null {
  const t = sinTildes(titulo);
  return docs.find((d) => sinTildes(d.title) === t) ?? docs.find((d) => sinTildes(d.title).includes(t)) ?? null;
}

/** Lo que llega del dueño: texto (o la transcripción de su nota de voz) y quizá una foto. */
export interface Entrada {
  texto: string;
  /** Vino por nota de voz: la transcripción puede traer errores de oído. */
  porVoz?: boolean;
  imagen?: { bytes: Uint8Array; mime: string };
  /** Contexto extra: p. ej. que responde sobre el aviso de una conversación. */
  pista?: string;
}

function ahoraEnElNegocio(env: Contexto["env"]): string {
  try {
    return new Date().toLocaleString("es", {
      timeZone: env.BOT_TIMEZONE || "America/Panama",
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    return new Date().toISOString();
  }
}

function instrucciones(ctx: Contexto): string {
  const extra = EXTENSIONES.map((e) => e.instrucciones).filter(Boolean).join("\n");
  return [
    `Eres el asistente interno de ${ctx.env.BUSINESS_NAME}. Por este chat de Telegram te habla SIEMPRE el DUEÑO, el jefe de la empresa — nunca una clienta.`,
    "Este canal es interno: seguimiento de clientas, trazabilidad, logística, inventario, ajustes y la operación del bot. Todo lo que te diga es una consulta o una instrucción del jefe sobre el negocio.",
    `Ahora es ${ahoraEnElNegocio(ctx.env)}.`,
    "Trátalo de usted, con frases cortas y concretas. Sin saludos largos ni relleno.",
    "Tienes la conversación reciente con él: úsala. Si dice «la misma», «esa», «dile que sí» o «¿y la M?», resuélvelo con lo que se habló antes; pregunta solo si de verdad es ambiguo.",
    "Si su mensaje viene de una nota de voz, la transcripción puede traer palabras mal oídas (nombres, códigos, tallas): interpreta con sentido común y confirma lo que mueva dinero o inventario.",
    "Si manda una foto (una lista, una factura de proveedor, un comprobante, un producto), léela y úsala para lo que pida.",
    "Usa las herramientas para mirar datos reales antes de contestar; nunca inventes pedidos, clientas ni cifras.",
    "Las conversaciones se nombran por el nombre de la clienta o por su referencia corta (#k3f9a).",
    "Puedes devolver una conversación al bot o pausarla directamente: es reversible.",
    "Tú NO puedes mandarle nada a un cliente. Lo único que puedes es PROPONER: proponerMensaje (a uno) o proponerMensajeAVarios (a varios). La propuesta le llega al dueño con el botón ✅ Enviar; el mensaje sale cuando lo toca o contesta «sí» (eso lo hace el sistema, no tú).",
    "Si el dueño pide que se le diga algo a un cliente («respóndale», «dígale que…», «avísele»), llama proponerMensaje DE UNA con el texto redactado: no preguntes antes «¿quiere que se lo mande?» — la propuesta con su botón ya es esa pregunta. Redacta el mensaje para el cliente, de usted y en el tono del negocio.",
    "Si pide escribirle a un grupo («a los que escribieron hoy», «a los de ayer», «a los interesados de la semana»), primero míralos con verClientesRecientes o verInteresados y luego usa proponerMensajeAVarios con sus referencias (#…). Puedes poner {nombre} en el texto y se cambia por el nombre de cada uno. La herramienta deja fuera sola a quien dijo que no le interesa y a quien ya no se le puede escribir: dile al dueño a quiénes dejó fuera.",
    "Si una herramienta devuelve varias conversaciones posibles, pregunta cuál antes de actuar.",
    "Si habla de un cliente justo después de un aviso («respóndale», «dígale», «a él»), es el cliente de ESE aviso: la herramienta ya prefiere la conversación del aviso reciente. El canal lo dice la propuesta: no lo adivines ni lo escribas tú.",
    "NUNCA digas que un mensaje se envió, que salió o que le llegó al cliente: tú nunca envías. Tampoco que una conversación se devolvió o se pausó si no lo hizo una herramienta en ESTE turno. Las líneas del historial que empiezan con «[hecho]» las escribe el sistema cuando algo de verdad pasó; tú nunca escribas «[hecho]» ni «[botón]», ni imites esas líneas.",
    "Cuando alguien le escribe al cliente (el dueño con un botón o desde el panel), el bot se calla en esa conversación una hora y luego vuelve solo. Un envío a varios no calla al bot: si un cliente contesta, el bot lo atiende.",
    extra,
    "Dónde vive cada dato: precios y stock en el Catálogo (el stock sí lo mueves tú, con propuestas); políticas, envíos, pagos y cómo contestar en la base de conocimiento del panel; el tono en Config.",
    "TÚ NO HABLAS CON CLIENTAS y no cambias al bot de clientas por tu cuenta. Si el dueño te da una instrucción para las clientas («si preguntan X, responde Y», «ya no hacemos Z»), eso es enseñarle al bot: mira primero la base con verBaseDeConocimiento, y usa proponerRegla para proponer el texto y el documento donde va. Si contradice algo que ya dice un documento, pásalo en `reemplazar` para que no queden dos reglas. El dueño lo guarda con un botón.",
    "NUNCA digas «entendido, respondo eso», «ya lo aprendí» ni nada parecido si no usaste proponerRegla: sin el botón no cambia nada y la clienta seguiría recibiendo la respuesta vieja. Los precios no se enseñan así: van en el Catálogo.",
    "Si piden algo que no puedes hacer, dilo y sugiere el comando: /ayuda los lista todos.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function unaConversacion(ctx: Contexto, texto: string) {
  const encontradas = await buscarConversaciones(ctx.env, texto, 5);
  // La del aviso reciente manda sobre otra del mismo cliente por otro canal.
  // El 24-sep-2026 "respóndele a Brian de 62272025" encontró por el número una
  // conversación VIEJA de Brian por el WhatsApp oficial, y el mensaje salió por
  // ahí en vez de por el WhatsApp QR del aviso que la dueña estaba mirando.
  const avisadas = await conversacionesDeAvisosRecientes(ctx.env, ctx.chatId).catch(() => []);
  const mismoCliente = (a: { display_name: string | null }, b: { display_name: string | null }) =>
    !!a.display_name && a.display_name.trim().toLowerCase() === (b.display_name ?? "").trim().toLowerCase();
  const delAviso = avisadas.find(
    (a) => encontradas.some((c) => c.id === a.id) || encontradas.some((c) => mismoCliente(a, c)),
  );
  if (delAviso) return { conv: delAviso };
  if (encontradas.length === 1) return { conv: encontradas[0] };
  if (encontradas.length === 0) return { error: `No encontré ninguna conversación reciente para "${texto}".` };
  return {
    error:
      "Hay varias posibles: " +
      encontradas.map((c) => `${nombreDe(c)} (#${refCorta(c.id)})`).join("; ") +
      ". ¿Cuál?",
  };
}

/** Cómo se escribe la propuesta: el «sí» también vale, así no hay que buscar el botón. */
const COMO_CONFIRMAR = "Toque ✅ Enviar o contésteme «sí» (nota de voz también vale).";

function herramientasBase(ctx: Contexto, salida: Respuesta[]) {
  return {
    verBaseDeConocimiento: tool({
      description:
        "Lo que el bot de clientas sabe: los documentos de la base de conocimiento del panel. Sin título, la lista; con título, el texto de ese documento.",
      inputSchema: z.object({ titulo: z.string().default("") }),
      execute: async ({ titulo }) => {
        const docs = await new KbDocsRepo(new Db(ctx.env.DB)).list();
        if (!titulo.trim()) return docs.map((d) => `· ${d.title}`).join("\n") || "La base está vacía.";
        const d = buscarDoc(docs, titulo);
        return d ? `${d.title}\n\n${d.content}` : `No hay un documento «${titulo}». Existen:\n${docs.map((x) => `· ${x.title}`).join("\n")}`;
      },
    }),
    proponerRegla: tool({
      description:
        "Propone enseñarle algo al bot de clientas: agrega (o reemplaza) un texto en un documento de la base de conocimiento. El dueño lo guarda con un botón; hasta entonces no cambia nada.",
      inputSchema: z.object({
        documento: z.string().describe("Título del documento donde va (uno existente, o uno nuevo)"),
        texto: z.string().min(1).max(3000).describe("La regla, de usted, como la debe seguir el bot"),
        reemplazar: z.string().optional().describe("Texto exacto del documento que esta regla reemplaza, si contradice algo"),
      }),
      execute: async ({ documento, texto, reemplazar }) => {
        const docs = await new KbDocsRepo(new Db(ctx.env.DB)).list();
        const d = buscarDoc(docs, documento);
        if (reemplazar && (!d || !d.content.includes(reemplazar))) {
          return "Ese texto a reemplazar no está tal cual en el documento. Léelo con verBaseDeConocimiento y copia el pedazo exacto.";
        }
        const grupo = nuevoGrupo();
        const titulo = d?.title ?? documento.trim();
        salida.push({
          texto:
            `📚 ¿Le enseño esto al bot? Va en «${titulo}»${d ? "" : " (documento nuevo)"}:\n\n«${texto}»` +
            (reemplazar ? `\n\nY quita esto, que lo contradice:\n«${reemplazar}»` : ""),
          teclado: [
            [
              { texto: "✅ Guardar", data: await crearAccion(ctx.env, "regla", { docId: d?.id ?? null, titulo, texto, reemplazar: reemplazar ?? null, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
            ],
          ],
        });
        return "Propuesta enviada con botones. Dile que se guarda al tocar ✅ — todavía no cambió nada.";
      },
    }),
    verClientesRecientes: tool({
      description:
        "Seguimiento: las conversaciones con actividad entre hace `horas` y hace `hastaHoras` (0 = ahora), con su referencia (#…), su canal, su estado (en pausa, ticket abierto, no quiere que le escriban) y lo último que dijo el cliente. «Hoy» = desde la medianoche del negocio; «ayer» = horas hasta 48 y hastaHoras hasta la medianoche de hoy.",
      inputSchema: z.object({
        horas: z.number().int().min(1).max(24 * 14).default(24),
        hastaHoras: z.number().int().min(0).max(24 * 14).default(0),
      }),
      execute: async ({ horas, hastaHoras }) => {
        const r = await ctx.env.DB.prepare(
          `SELECT c.*, (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user'
                          ORDER BY m.created_at DESC LIMIT 1) AS ultimo
             FROM conversations c WHERE c.last_message_at >= ? AND c.last_message_at <= ?
            ORDER BY c.last_message_at DESC LIMIT 40`,
        )
          .bind(Date.now() - horas * 3_600_000, Date.now() - hastaHoras * 3_600_000)
          .all<Record<string, any>>();
        const filas = r.results ?? [];
        if (!filas.length) return `Nadie escribió en ese rango (${horas} h hasta ${hastaHoras} h atrás).`;
        const motivos = new Map<string, string | null>();
        for (const c of filas) motivos.set(c.id, await motivoParaNoEscribir(ctx.env, c as any).catch(() => null));
        return filas
          .map((c) => {
            const estado = [
              c.paused_until && c.paused_until > Date.now() ? "la atiende una persona" : "",
              c.open_ticket_id ? "ticket abierto" : "",
              motivos.get(c.id) ? `no se le escribe: ${motivos.get(c.id)}` : "",
            ].filter(Boolean);
            const ultimo = String(c.ultimo ?? "").replace(/\s+/g, " ").slice(0, 140);
            return `${nombreDe(c as any)} · #${refCorta(c.id)} · ${CHANNEL_LABELS[c.channel] ?? c.channel}${estado.length ? ` · ${estado.join(", ")}` : ""}${ultimo ? `\n  «${ultimo}»` : ""}`;
          })
          .join("\n");
      },
    }),
    verInteresadas: tool({
      description: "Seguimiento: las clientas que el bot anotó con intención de compra en los últimos N días (nombre, contacto, qué quería, estado).",
      inputSchema: z.object({ dias: z.number().int().min(1).max(90).default(7) }),
      execute: async ({ dias }) => {
        const r = await ctx.env.DB.prepare(
          "SELECT name, contact, intent, notes, status, created_at FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT 25",
        )
          .bind(Date.now() - dias * 86_400_000)
          .all<Record<string, any>>();
        const filas = r.results ?? [];
        if (!filas.length) return `Ninguna en los últimos ${dias} días.`;
        return filas
          .map((l) => `${l.name ?? "(sin nombre)"} · ${l.contact ?? "sin contacto"} · ${l.intent}${l.notes ? ` · ${String(l.notes).slice(0, 120)}` : ""} · ${l.status ?? "new"}`)
          .join("\n");
      },
    }),
    verPendientes: tool({
      description: "Tickets abiertos y conversaciones que una persona está atendiendo (bot en pausa).",
      inputSchema: z.object({}),
      execute: async () => textoDePendientes(ctx.env),
    }),
    buscarConversacion: tool({
      description: "Busca conversaciones recientes por nombre de la clienta, número o referencia (#abcde).",
      inputSchema: z.object({ texto: z.string() }),
      execute: async ({ texto }) => {
        const r = await buscarConversaciones(ctx.env, texto, 5);
        return r.length
          ? r.map((c) => `${nombreDe(c)} · #${refCorta(c.id)}${c.paused_until && c.paused_until > Date.now() ? " · en pausa" : ""}`).join("\n")
          : "Ninguna.";
      },
    }),
    leerConversacion: tool({
      description: "Los últimos mensajes de una conversación.",
      inputSchema: z.object({ conversacion: z.string() }),
      execute: async ({ conversacion }) => {
        const r = await unaConversacion(ctx, conversacion);
        if (!r.conv) return r.error;
        const msgs = await new MessagesRepo(new Db(ctx.env.DB)).lastN(r.conv.id, 15);
        const quien = { user: "Clienta", assistant: "Bot", owner: "Equipo", tool: "Sistema" } as const;
        return `${nombreDe(r.conv)}\n` + msgs.map((m) => `${quien[m.role]}: ${m.content}`).join("\n");
      },
    }),
    devolverAlBot: tool({
      description: "Devuelve una conversación al bot (quita la pausa y cierra sus tickets).",
      inputSchema: z.object({ conversacion: z.string(), nota: z.string().optional() }),
      execute: async ({ conversacion, nota }) => {
        const r = await unaConversacion(ctx, conversacion);
        if (!r.conv) return r.error;
        const { ticketsCerrados } = await devolverAlBot(ctx.env, r.conv.id, { nota, quien: "telegram" });
        return `Listo: ${nombreDe(r.conv)} vuelve al bot${ticketsCerrados ? ` (${ticketsCerrados} ticket cerrado)` : ""}.`;
      },
    }),
    pausarConversacion: tool({
      description: "Pausa el bot en una conversación para que la atienda una persona.",
      inputSchema: z.object({ conversacion: z.string() }),
      execute: async ({ conversacion }) => {
        const r = await unaConversacion(ctx, conversacion);
        if (!r.conv) return r.error;
        await pausarPorHumano(ctx.env, r.conv.id, "telegram");
        return `Bot en pausa en ${nombreDe(r.conv)}.`;
      },
    }),
    proponerMensaje: tool({
      description: "Propone un mensaje para una clienta. El dueño lo confirma con un botón antes de que salga.",
      inputSchema: z.object({ conversacion: z.string(), texto: z.string().min(1).max(1500) }),
      execute: async ({ conversacion, texto }) => {
        const r = await unaConversacion(ctx, conversacion);
        if (!r.conv) return r.error;
        const grupo = nuevoGrupo();
        // Sin conversationId a propósito: esta propuesta no es un aviso. Si el
        // dueño le contesta «sí» con "Responder", es la confirmación, no un
        // texto para el cliente.
        salida.push({
          texto: `✉️ ¿Le mando esto a ${nombreDe(r.conv)}?\n\n«${texto}»\n\n${COMO_CONFIRMAR}`,
          teclado: [
            [
              { texto: "✅ Enviar", data: await crearAccion(ctx.env, "enviar", { conversationId: r.conv.id, texto, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
            ],
          ],
        });
        return `Propuesta lista para ${nombreDe(r.conv)}: le llegó al dueño con el botón. Todavía NO se envió nada.`;
      },
    }),
    proponerMensajeAVarios: tool({
      description:
        "Propone UN mensaje para varios clientes (referencias #… de verClientesRecientes o verInteresados). {nombre} se cambia por el nombre de cada uno. Deja fuera sola a quien no se le debe o no se le puede escribir. El dueño lo confirma con un botón.",
      inputSchema: z.object({
        conversaciones: z.array(z.string()).min(1).max(25),
        texto: z.string().min(1).max(1000),
      }),
      execute: async ({ conversaciones, texto }) => {
        const destinos: { conversationId: string; texto: string }[] = [];
        const nombres: string[] = [];
        const fuera: string[] = [];
        const vistos = new Set<string>();
        for (const ref of conversaciones) {
          const [conv, ...otras] = await buscarConversaciones(ctx.env, ref, 2);
          if (!conv || otras.length) {
            fuera.push(`${ref} (${conv ? "hay varias con ese nombre: usa la #referencia" : "no la encontré"})`);
            continue;
          }
          if (vistos.has(conv.id)) continue;
          vistos.add(conv.id);
          const motivo = await motivoParaNoEscribir(ctx.env, conv);
          if (motivo) {
            fuera.push(`${nombreDe(conv)} (${motivo})`);
            continue;
          }
          destinos.push({ conversationId: conv.id, texto: personalizar(texto, conv) });
          nombres.push(nombreDe(conv));
        }
        if (!destinos.length) return `No queda nadie a quien escribirle. Fuera: ${fuera.join("; ") || "—"}.`;
        const grupo = nuevoGrupo();
        salida.push({
          texto:
            `✉️ ¿Le mando esto a ${destinos.length === 1 ? "1 cliente" : `${destinos.length} clientes`}?\n\n«${texto}»\n\n` +
            nombres.map((n) => `• ${n}`).join("\n") +
            (fuera.length ? `\n\nNo van: ${fuera.join("; ")}.` : "") +
            `\n\n${COMO_CONFIRMAR}`,
          teclado: [
            [
              { texto: `✅ Enviar a ${destinos.length}`, data: await crearAccion(ctx.env, "enviarVarios", { destinos, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
            ],
          ],
        });
        return `Propuesta lista para ${destinos.length}${fuera.length ? `; fuera: ${fuera.join("; ")}` : ""}. Todavía NO se envió nada.`;
      },
    }),
  };
}

/** Lo que el asistente puede decir que PASÓ solo si una herramienta lo hizo en el turno. */
const DICE_QUE_ENVIO =
  /(✅[^\n]{0,20}enviad|\bmensaje (enviado|entregado|sali[oó])|\benviad[oa]s? (a|al|para) (?!ti\b)|\b(qued[oó]|fue|est[aá]|ya) enviad|\b(le|lo|la|se lo|se la) (mand[eé]|envi[eé])\b|\bya (le )?(sali[oó]|lleg[oó])\b|\bte lleg[oó] en whatsapp)/i;
const DICE_QUE_DEVOLVIO = /\b(devolv[ií]|ya (est[aá]|qued[oó]) devuelt[ao])\b/i;
const DICE_QUE_PAUSO = /\b(paus[eé]|(lo|la) dej[eé] en pausa)\b/i;
const LINEA_DEL_SISTEMA = /^\s*\[(hecho|bot[oó]n)[^\]]*\].*$/gim;

/**
 * La respuesta del asistente, sin lo que dice que pasó y no pasó.
 *
 * El 24-sep-2026, dos veces: el dueño pidió responderle a un cliente, el
 * asistente contestó "✅ Mensaje enviado a Brian" y no había salido nada —ni
 * siquiera se había llamado a proponerMensaje—. Imitaba las líneas «[botón] ✅
 * Enviado …» que la memoria guarda cuando el dueño toca un botón. Un «no te
 * inventes envíos» en el prompt no bastó: esto lo revisa en el código.
 *
 * Devuelve null si el texto afirma algo que no hizo ninguna herramienta.
 */
export function sinAccionesFingidas(texto: string, hechas: Set<string>): string | null {
  const limpio = texto.replace(LINEA_DEL_SISTEMA, "").replace(/\n{3,}/g, "\n\n").trim();
  // Enviar, el asistente no envía NUNCA: cualquier "enviado" es falso.
  if (DICE_QUE_ENVIO.test(limpio)) return null;
  if (DICE_QUE_DEVOLVIO.test(limpio) && !hechas.has("devolverAlBot")) return null;
  if (DICE_QUE_PAUSO.test(limpio) && !hechas.has("pausarConversacion")) return null;
  return limpio;
}

/** Envuelve las herramientas para saber cuáles corrieron de verdad en el turno. */
function conRegistro(tools: Record<string, any>, hechas: Set<string>): Record<string, any> {
  const salida: Record<string, any> = {};
  for (const [nombre, t] of Object.entries(tools)) {
    salida[nombre] =
      typeof t?.execute === "function"
        ? {
            ...t,
            execute: async (...args: unknown[]) => {
              const r = await t.execute(...args);
              hechas.add(nombre);
              return r;
            },
          }
        : t;
  }
  return salida;
}

/**
 * Contesta lo que el dueño dijo con sus palabras (texto, voz o foto), con lo
 * que se viene hablando. Nunca lanza: si algo falla, lo dice.
 */
export async function entenderAlDueno(ctx: Contexto, entrada: Entrada | string): Promise<Respuesta[]> {
  const e: Entrada = typeof entrada === "string" ? { texto: entrada } : entrada;
  const salida: Respuesta[] = [];
  const hechas = new Set<string>();
  const todas: Record<string, any> = { ...herramientasBase(ctx, salida) };
  for (const x of EXTENSIONES) Object.assign(todas, x.herramientas?.(ctx, salida) ?? {});
  const tools = conRegistro(todas, hechas);

  // Lo anterior, sin el mensaje de ahora (la consola lo anota antes de llamar aquí).
  const antes = await historial(ctx.env, ctx.chatId);
  if (antes.length && antes[antes.length - 1].rol === "dueno") antes.pop();
  const messages: ModelMessage[] = comoMensajes(antes);

  const texto =
    [e.pista ? `[${e.pista}]` : "", e.porVoz ? `(nota de voz) ${e.texto}` : e.texto].filter(Boolean).join("\n") ||
    "(sin texto)";
  messages.push(
    e.imagen
      ? {
          role: "user",
          content: [
            { type: "image", image: e.imagen.bytes, mediaType: e.imagen.mime },
            { type: "text", text: texto },
          ],
        }
      : { role: "user", content: texto },
  );
  // Si lo anterior terminaba en el dueño (una respuesta que no salió), se juntan.
  if (messages.length >= 2 && messages[messages.length - 2].role === "user") {
    const previo = messages.splice(messages.length - 2, 1)[0];
    const ultimo = messages[messages.length - 1];
    if (typeof ultimo.content === "string") ultimo.content = `${previo.content}\n\n${ultimo.content}`;
  }

  try {
    // El modelo bueno, no el barato: el dueño escribe poco y cada mensaje suyo
    // mueve inventario o dinero. Con voz y memoria, entender bien importa más.
    const { model } = createModel(ctx.env, "smart", await loadLlmOverrides(ctx.env));
    const pensar = (system: string) =>
      generateText({ model, system, messages, tools, stopWhen: ({ steps }) => steps.length >= 8 });
    let r = await pensar(instrucciones(ctx));
    let respuesta = sinAccionesFingidas(r.text.trim(), hechas);
    const propuso = () => salida.some((x) => x.teclado);
    if (respuesta === null && !propuso()) {
      // Dijo que hizo algo que no hizo. Una vuelta más, con el error señalado:
      // casi siempre es que quería mandar un mensaje y no llamó a la herramienta.
      console.error("[consola] el asistente afirmó una acción que no hizo — se le corrige:", r.text.slice(0, 200));
      r = await pensar(
        instrucciones(ctx) +
          "\n\nCORRECCIÓN: en tu respuesta anterior dijiste que algo se envió o se hizo, y ninguna herramienta lo hizo. " +
          "Si el dueño quiere que se le diga algo a un cliente, llama AHORA a proponerMensaje (o proponerMensajeAVarios). " +
          "Si falta saber a quién, pregúntalo. No digas que algo se envió.",
      );
      respuesta = sinAccionesFingidas(r.text.trim(), hechas);
    }
    if (respuesta === null) {
      respuesta = propuso()
        ? "Le dejé la propuesta abajo. Todavía no salió nada: toque ✅ Enviar o contésteme «sí»."
        : "⚠️ Ojo: no le he enviado nada a nadie. Dígame a quién y qué le digo, y se lo dejo listo con el botón ✅ Enviar.";
    }
    return [...(respuesta ? [{ texto: respuesta }] : salida.length ? [] : [{ texto: "Listo." }]), ...salida];
  } catch (err) {
    console.error("[consola] el asistente del dueño falló:", err);
    return [
      {
        texto:
          "No pude procesar eso ahora (falló la IA). Los comandos siguen funcionando: /pendientes, /ayuda" +
          (salida.length ? "" : "."),
      },
      ...salida,
    ];
  }
}
