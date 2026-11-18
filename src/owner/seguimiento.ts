// El seguimiento a clientas, manejado desde el Telegram de la dueña.
//
// La regla de a quién se le escribe, cuándo y qué es COMPORTAMIENTO: la cambia
// ella, sin desplegar nada y sin tocar la base de conocimiento. El 28-sep-2026
// le pidió a la consola «ya no le des más seguimiento a los clientes», la
// consola lo guardó como documento de la base de conocimiento y contestó «el
// bot lo usa desde ya». El cron que manda los seguimientos nunca lee esa base:
// siguió escribiendo. Ahora la orden llega a donde se decide (los ajustes de
// src/followup/ajustes.ts), y lo que la consola dice que hizo, lo hizo.
//
//   · /seguimiento — cómo está; /seguimiento apagar · prender.
//   · /compro #ref — esta clienta ya compró (y el botón «✅ Compró» del aviso).
//   · Con sus palabras: «que el de recompra salga a los 20 días» → propuesta
//     con botón; nada cambia hasta que lo toca.

import { tool } from "ai";
import { z } from "zod";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import {
  cargarAjustes,
  comoTiempo,
  describirAjustes,
  guardarAjustes,
  type CambioDeAjustes,
} from "../followup/ajustes";
import { desmarcarCompra, marcarCompra, ultimaCompra } from "../followup/compras";
import { buscarConversaciones, crearAccion, nombreDe, nuevoGrupo, refCorta } from "./acciones";
import type { Contexto, ExtensionDeConsola, Respuesta } from "./tipos";

const DIA = 86_400_000;

function fecha(env: Contexto["env"], ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("es", {
      timeZone: env.BOT_TIMEZONE || "America/Panama",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

async function unaSola(ctx: Contexto, ref: string): Promise<{ id: string; nombre: string } | { error: string }> {
  if (!ref.trim()) return { error: "Falta a quién. Ejemplo: /compro #k3f9a (las referencias salen en /pendientes)." };
  const r = await buscarConversaciones(ctx.env, ref, 5);
  if (r.length === 1) return { id: r[0].id, nombre: nombreDe(r[0]) };
  if (r.length === 0) return { error: `No encontré "${ref}" entre las conversaciones recientes.` };
  return { error: `Hay varias: ${r.map((c) => `${nombreDe(c)} #${refCorta(c.id)}`).join(" · ")}. Use la #referencia.` };
}

/** Marca la compra y cuenta qué va a pasar con el seguimiento de esa clienta. */
async function comproYAvisa(ctx: Contexto, conversationId: string, nombre: string, nota?: string): Promise<Respuesta> {
  const cuando = await marcarCompra(ctx.env, conversationId, { actor: ctx.actor, nota });
  const aj = await cargarAjustes(ctx.env);
  const recompra = cuando + aj.postcompraDias * DIA;
  return {
    texto:
      `✅ ${nombre}: anotado que ya compró. No le llega seguimiento comercial` +
      (aj.activo
        ? `; el de recompra sale el ${fecha(ctx.env, recompra)} (a los ${aj.postcompraDias} días, en horario).`
        : " (y el seguimiento automático está apagado)."),
    teclado: [[{ texto: "↩️ No compró", data: await crearAccion(ctx.env, "descompro", { conversationId, nombre }) }]],
  };
}

/** El cambio en palabras, para la propuesta. */
function describirCambio(c: CambioDeAjustes): string[] {
  const l: string[] = [];
  if (c.activo !== undefined) l.push(c.activo ? "• Encender el seguimiento automático" : "• Apagar el seguimiento automático (no sale ninguno)");
  if (c.pasosHoras) l.push(`• Interesadas: ${c.pasosHoras.map(comoTiempo).join(", luego ")}`);
  if (c.postcompraDias !== undefined) l.push(`• Quien compró: el de recompra a los ${c.postcompraDias} días`);
  if (c.postcompraRecordatorios !== undefined) {
    l.push(c.postcompraRecordatorios ? "• Después del de recompra, sí siguen los recordatorios" : "• Después del de recompra, nada más");
  }
  if (c.dias) {
    const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    l.push(`• Días: ${c.dias.map((d) => nombres[d]).join(", ")}`);
  }
  if (c.horaDesde !== undefined || c.horaHasta !== undefined) {
    l.push(`• Horario: ${c.horaDesde ?? "(igual)"}:00 a ${c.horaHasta ?? "(igual)"}:00`);
  }
  const textos: [keyof CambioDeAjustes, string][] = [
    ["texto1", "Primer mensaje"],
    ["texto2", "Segundo mensaje"],
    ["texto3", "Tercer mensaje"],
    ["textoRecompra", "Mensaje de recompra"],
  ];
  for (const [k, nombre] of textos) {
    const t = c[k];
    if (typeof t === "string") l.push(t.trim() ? `• ${nombre}: «${t.trim()}»` : `• ${nombre}: volver al de siempre`);
  }
  return l;
}

export const seguimiento: ExtensionDeConsola = {
  nombre: "seguimiento",
  ayuda: [
    "🔁 Seguimiento a clientas",
    "/seguimiento — a quién se le escribe y cuándo (/seguimiento apagar · prender)",
    "/compro #ref — ya compró: sin seguimiento comercial hasta el de recompra",
    "/nocompro #ref — quitar esa marca",
  ],
  comandos: {
    seguimiento: async (ctx, args) => {
      const a = args.trim().toLowerCase();
      if (/^(apagar|apaga|off|detener|parar)$/.test(a)) {
        await guardarAjustes(ctx.env, { activo: false });
        return [{ texto: "⏹ Seguimiento automático APAGADO. No sale ninguno hasta que escriba /seguimiento prender." }];
      }
      if (/^(prender|prende|encender|enciende|on|activar)$/.test(a)) {
        await guardarAjustes(ctx.env, { activo: true });
        return [{ texto: `🔁 Seguimiento automático ENCENDIDO.\n\n${describirAjustes(await cargarAjustes(ctx.env))}` }];
      }
      return [
        {
          texto:
            describirAjustes(await cargarAjustes(ctx.env)) +
            "\n\nPara cambiar algo, dígamelo con sus palabras («que el de recompra salga a los 20 días», «cambie el primer mensaje por…»).",
        },
      ];
    },
    compro: async (ctx, args) => {
      const [ref, ...resto] = args.trim().split(/\s+/);
      const c = await unaSola(ctx, ref ?? "");
      if ("error" in c) return [{ texto: c.error }];
      return [await comproYAvisa(ctx, c.id, c.nombre, resto.join(" ") || undefined)];
    },
    nocompro: async (ctx, args) => {
      const c = await unaSola(ctx, args);
      if ("error" in c) return [{ texto: c.error }];
      const n = await desmarcarCompra(ctx.env, c.id);
      return [{ texto: n ? `↩️ ${c.nombre}: quitada la marca de compra.` : `${c.nombre} no tenía una compra marcada a mano.` }];
    },
  },
  acciones: {
    compro: async (ctx, p) => {
      const id = String(p.conversationId);
      const conv = await new ConversationsRepo(new Db(ctx.env.DB)).getById(id);
      return comproYAvisa(ctx, id, conv ? nombreDe(conv) : "La clienta");
    },
    descompro: async (ctx, p) => {
      await desmarcarCompra(ctx.env, String(p.conversationId));
      return { texto: `↩️ Quitada la marca de compra de ${String(p.nombre ?? "la clienta")}.` };
    },
    ajusteSeguimiento: async (ctx, p) => {
      const error = await guardarAjustes(ctx.env, (p.cambio ?? {}) as CambioDeAjustes);
      if (error) return { texto: `❌ No se guardó: ${error}` };
      return { texto: `✅ Guardado. Así queda:\n\n${describirAjustes(await cargarAjustes(ctx.env))}` };
    },
  },
  botonesDeAviso: async (ctx, conversationId) => [
    { texto: "✅ Compró", data: await crearAccion(ctx.env, "compro", { conversationId }) },
  ],
  instrucciones: [
    "SEGUIMIENTO A CLIENTAS: los mensajes automáticos a las clientas que dejan de contestar NO se enseñan con proponerRegla ni viven en la base de conocimiento: los manda un proceso aparte que solo lee sus AJUSTES.",
    "Si el jefe pregunta cómo funciona o a quién se le escribe, usa verSeguimiento. Si pide cambiar cuándo, a quién, cuántos, el horario, los textos o apagarlo, usa proponerAjusteSeguimiento (el cambio se guarda cuando toca ✅).",
    "Lo que NO es un ajuste y no puedes cambiar: solo se les escribe a interesadas (preguntaron por un producto, precio, talla o envío); nunca a quien dijo que no le interesa; nunca si la última en escribir fue una persona del equipo; y quien compró descansa hasta el de recompra.",
    "Si el jefe dice que una clienta ya compró, pagó o se le entregó, usa marcarCompra: así no le llega seguimiento comercial.",
  ].join("\n"),
  herramientas: (ctx, salida) => ({
    verSeguimiento: tool({
      description: "Cómo está configurado el seguimiento automático a clientas: si está encendido, a quién, cuándo, horario y qué pasa con quien ya compró.",
      inputSchema: z.object({}),
      execute: async () => describirAjustes(await cargarAjustes(ctx.env)),
    }),
    proponerAjusteSeguimiento: tool({
      description:
        "Propone cambiar el seguimiento automático. Solo lo que se pase cambia. Los textos pueden llevar {saludo}, que se cambia por «Buen día» o «Buenas tardes». El jefe confirma con un botón.",
      inputSchema: z.object({
        activo: z.boolean().optional().describe("false = apagarlo (no sale ninguno)"),
        pasosHoras: z
          .array(z.number().min(1).max(1440))
          .min(1)
          .max(5)
          .optional()
          .describe("Horas de espera antes de cada mensaje a una interesada, cada uno desde el anterior. Hoy: [5, 72, 168]"),
        postcompraDias: z.number().int().min(1).max(120).optional().describe("Días después de una compra para el de recompra"),
        postcompraRecordatorios: z.boolean().optional().describe("Si después del de recompra siguen los recordatorios"),
        dias: z.array(z.number().int().min(0).max(6)).min(1).optional().describe("Días de la semana: 0 domingo … 6 sábado"),
        horaDesde: z.number().int().min(0).max(23).optional(),
        horaHasta: z.number().int().min(1).max(24).optional(),
        texto1: z.string().max(1000).optional().describe("Primer mensaje a una interesada (vacío = el de siempre)"),
        texto2: z.string().max(1000).optional(),
        texto3: z.string().max(1000).optional(),
        textoRecompra: z.string().max(1000).optional().describe("Mensaje de recompra a quien ya compró"),
      }),
      execute: async (cambio) => {
        const lineas = describirCambio(cambio);
        if (!lineas.length) return "No hay nada que cambiar en lo que pediste.";
        const grupo = nuevoGrupo();
        salida.push({
          texto: `🔁 ¿Cambio así el seguimiento?\n\n${lineas.join("\n")}`,
          teclado: [
            [
              { texto: "✅ Guardar", data: await crearAccion(ctx.env, "ajusteSeguimiento", { cambio, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "descartar", { grupo }) },
            ],
          ],
        });
        return "Propuesta enviada con botones. Todavía no cambió nada: se guarda cuando toque ✅.";
      },
    }),
    marcarCompra: tool({
      description: "Anota que una clienta ya compró (sin tocar el inventario): deja de recibir seguimiento comercial hasta el de recompra. Reversible.",
      inputSchema: z.object({ conversacion: z.string(), nota: z.string().optional() }),
      execute: async ({ conversacion, nota }) => {
        const c = await unaSola(ctx, conversacion);
        if ("error" in c) return c.error;
        const r = await comproYAvisa(ctx, c.id, c.nombre, nota);
        salida.push(r);
        return `Hecho. Al jefe ya le llegó esto, con el botón para deshacerlo (no lo repitas): ${r.texto}`;
      },
    }),
    verCompra: tool({
      description: "Si una clienta tiene una compra registrada y cuándo.",
      inputSchema: z.object({ conversacion: z.string() }),
      execute: async ({ conversacion }) => {
        const c = await unaSola(ctx, conversacion);
        if ("error" in c) return c.error;
        const p = await ultimaCompra(new Db(ctx.env.DB), c.id);
        return p ? `${c.nombre}: última compra registrada el ${fecha(ctx.env, p)}.` : `${c.nombre}: no tiene compras registradas.`;
      },
    }),
  }),
};
