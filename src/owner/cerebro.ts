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
import { buscarConversaciones, crearAccion, nombreDe, nuevoGrupo, refCorta, conversacionesDeAvisosRecientes } from "./acciones";
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
    "Un mensaje a una clienta NUNCA sale directo: usa proponerMensaje y el dueño lo confirma con un botón.",
    "Si una herramienta devuelve varias conversaciones posibles, pregunta cuál antes de actuar.",
    "Si habla de un cliente justo después de un aviso («respóndele», «dile», «a él»), es el cliente de ESE aviso: la herramienta ya prefiere la conversación del aviso reciente. Antes de proponer, di por qué canal va (WhatsApp QR, WhatsApp oficial, Telegram…).",
    "NUNCA digas que un mensaje se envió, que una conversación se devolvió o se pausó, si no lo hizo una herramienta en ESTE turno o si no aparece en el historial una línea «[botón] …» que lo confirme. Los botones los toca el dueño: «[botón] ✅ Enviado …» significa que YA salió; una propuesta sin esa línea significa que todavía no. Si no estás seguro, dilo.",
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
        "Seguimiento: las conversaciones con actividad en las últimas N horas, con su canal, su estado (en pausa, ticket abierto) y lo último que dijo la clienta.",
      inputSchema: z.object({ horas: z.number().int().min(1).max(24 * 14).default(24) }),
      execute: async ({ horas }) => {
        const r = await ctx.env.DB.prepare(
          `SELECT c.*, (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user'
                          ORDER BY m.created_at DESC LIMIT 1) AS ultimo
             FROM conversations c WHERE c.last_message_at >= ? ORDER BY c.last_message_at DESC LIMIT 25`,
        )
          .bind(Date.now() - horas * 3_600_000)
          .all<Record<string, any>>();
        const filas = r.results ?? [];
        if (!filas.length) return `Nadie escribió en las últimas ${horas} h.`;
        return filas
          .map((c) => {
            const estado = [
              c.paused_until && c.paused_until > Date.now() ? "la atiende una persona" : "",
              c.open_ticket_id ? "ticket abierto" : "",
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
        salida.push({
          texto: `✉️ ¿Le mando esto a ${nombreDe(r.conv)}?\n\n«${texto}»`,
          conversationId: r.conv.id,
          teclado: [
            [
              { texto: "✅ Enviar", data: await crearAccion(ctx.env, "enviar", { conversationId: r.conv.id, texto, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
            ],
          ],
        });
        return "Propuesta enviada con botones.";
      },
    }),
  };
}

/**
 * Contesta lo que el dueño dijo con sus palabras (texto, voz o foto), con lo
 * que se viene hablando. Nunca lanza: si algo falla, lo dice.
 */
export async function entenderAlDueno(ctx: Contexto, entrada: Entrada | string): Promise<Respuesta[]> {
  const e: Entrada = typeof entrada === "string" ? { texto: entrada } : entrada;
  const salida: Respuesta[] = [];
  const tools: Record<string, any> = { ...herramientasBase(ctx, salida) };
  for (const x of EXTENSIONES) Object.assign(tools, x.herramientas?.(ctx, salida) ?? {});

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
    const r = await generateText({
      model,
      system: instrucciones(ctx),
      messages,
      tools,
      stopWhen: ({ steps }) => steps.length >= 8,
    });
    const respuesta = r.text.trim();
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
