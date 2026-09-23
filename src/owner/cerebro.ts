// Lo que el dueño escribe con sus palabras: "¿qué tengo pendiente?", "devuélvele
// la conversación de Ana al bot", "vendí 2 cajas de la M".
//
// Es un asistente INTERNO: habla con el dueño, no con las clientas. Puede leer
// y hacer lo reversible (pausar, devolver al bot). Lo que sale hacia afuera —un
// mensaje a una clienta— o mueve el inventario va como PROPUESTA con botones:
// el dueño confirma con un toque. Un modelo que entiende mal no puede mandar un
// mensaje ni descontar una caja sin que nadie lo vea.

import { generateText, tool } from "ai";
import { z } from "zod";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { devolverAlBot, pausarPorHumano } from "../takeover";
import { buscarConversaciones, crearAccion, nombreDe, nuevoGrupo, refCorta } from "./acciones";
import { textoDePendientes } from "./pendientes";
import { EXTENSIONES } from "./extensiones";
import type { Contexto, Respuesta } from "./tipos";

function instrucciones(ctx: Contexto): string {
  const extra = EXTENSIONES.map((e) => e.instrucciones).filter(Boolean).join("\n");
  return [
    `Eres el asistente interno de ${ctx.env.BUSINESS_NAME}. Hablas con el DUEÑO por Telegram, no con clientas.`,
    "Trátalo de usted, con frases cortas y concretas. Sin saludos largos.",
    "Usa las herramientas para mirar datos reales antes de contestar; nunca inventes pedidos, clientas ni cifras.",
    "Las conversaciones se nombran por el nombre de la clienta o por su referencia corta (#k3f9a).",
    "Puedes devolver una conversación al bot o pausarla directamente: es reversible.",
    "Un mensaje a una clienta NUNCA sale directo: usa proponerMensaje y el dueño lo confirma con un botón.",
    "Si una herramienta devuelve varias conversaciones posibles, pregunta cuál antes de actuar.",
    extra,
    "Si piden algo que no puedes hacer, dilo y sugiere el comando: /ayuda los lista todos.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function unaConversacion(ctx: Contexto, texto: string) {
  const encontradas = await buscarConversaciones(ctx.env, texto, 5);
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

/** Contesta un mensaje libre del dueño. Nunca lanza: si algo falla, lo dice. */
export async function entenderAlDueno(ctx: Contexto, texto: string): Promise<Respuesta[]> {
  const salida: Respuesta[] = [];
  const tools: Record<string, any> = { ...herramientasBase(ctx, salida) };
  for (const e of EXTENSIONES) Object.assign(tools, e.herramientas?.(ctx, salida) ?? {});
  try {
    const { model } = createModel(ctx.env, "fast", await loadLlmOverrides(ctx.env));
    const r = await generateText({
      model,
      system: instrucciones(ctx),
      messages: [{ role: "user", content: texto }],
      tools,
      stopWhen: ({ steps }) => steps.length >= 6,
    });
    const respuesta = r.text.trim();
    return [...(respuesta ? [{ texto: respuesta }] : salida.length ? [] : [{ texto: "Listo." }]), ...salida];
  } catch (e) {
    console.error("[consola] el asistente del dueño falló:", e);
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
