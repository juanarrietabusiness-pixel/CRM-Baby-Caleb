// La difusión, manejada desde el Telegram de la dueña.
//
//   · Con sus palabras: «¿cuántas preguntaron por los Dany Baby en dos meses?»
//     → contarPorTema. «Mándales este mensaje» → proponerDifusion, con el
//     conteo, el ritmo y el botón ▶️; no sale nada hasta que lo toca.
//   · /difusion — cómo va, con ⏸ Pausar / ▶️ Seguir / 🛑 Terminar.
//
// El envío lo hace el cron (src/difusion/difusion.ts), no este archivo.

import { tool } from "ai";
import { z } from "zod";
import { cargarAjustes, type AjustesSeguimiento } from "../followup/ajustes";
import {
  buscarPorTema,
  cambiarEstado,
  conteo,
  crearBorrador,
  diasQueFaltan,
  difusionEnCurso,
  difusionPorId,
  limpiarPalabras,
  porCorrida,
  resumenDeAudiencia,
  POR_DIA_MAXIMO,
  POR_DIA_POR_DEFECTO,
  type Difusion,
} from "../difusion/difusion";
import { crearAccion, nombreDe, nuevoGrupo, personalizar } from "./acciones";
import type { Contexto, ExtensionDeConsola, Respuesta } from "./tipos";

/** Así empieza la propuesta: un «sí» justo después de ella la empieza (consola.ts). */
export const INICIO_DE_DIFUSION = "📣 Difusión lista";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** «de lunes a viernes, de 8:00 a 18:00». */
export function horarioEnPalabras(aj: Pick<AjustesSeguimiento, "dias" | "horaDesde" | "horaHasta">): string {
  const d = [...aj.dias].sort((a, b) => a - b);
  const seguidos = d.length > 1 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const dias =
    d.length === 7 ? "todos los días" : seguidos ? `de ${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}` : d.map((x) => DIAS[x]).join(", ");
  return `${dias}, de ${aj.horaDesde}:00 a ${aj.horaHasta}:00`;
}

async function estadoDeDifusion(ctx: Contexto): Promise<Respuesta> {
  const d = await difusionEnCurso(ctx.env);
  if (!d) return { texto: "📣 No hay ninguna difusión en marcha." };
  const c = await conteo(ctx.env, d.id);
  const aj = await cargarAjustes(ctx.env);
  const lineas = [
    `📣 Difusión «${d.tema}» — ${d.estado === "activa" ? "en marcha" : "⏸ en pausa"}`,
    `• Ya les llegó: ${c.enviados}`,
    `• Faltan: ${c.pendientes}${c.pendientes ? ` (unos ${diasQueFaltan(c.pendientes, d.por_dia)} días a ${d.por_dia} por día)` : ""}`,
    c.saltados ? `• Quedaron fuera: ${c.saltados} (dijeron que no les interesa o las atendía una persona)` : "",
    c.errores ? `• No salió por el canal: ${c.errores}` : "",
    d.estado === "activa" ? `Sale ${horarioEnPalabras(aj)}.` : "",
  ].filter(Boolean);
  const grupo = nuevoGrupo();
  return {
    texto: lineas.join("\n"),
    teclado:
      d.estado === "activa"
        ? [[{ texto: "⏸ Pausar", data: await crearAccion(ctx.env, "difusionPausar", { id: d.id, grupo }) }]]
        : [
            [
              { texto: "▶️ Seguir", data: await crearAccion(ctx.env, "difusionSeguir", { id: d.id, grupo }) },
              { texto: "🛑 Terminar", data: await crearAccion(ctx.env, "difusionTerminar", { id: d.id, grupo }) },
            ],
          ],
  };
}

/** Por qué un botón de la difusión no hizo nada. */
async function porQueNo(ctx: Contexto, id: string): Promise<string> {
  const d = await difusionPorId(ctx.env, id);
  if (!d) return "No encontré esa difusión.";
  const otra = await difusionEnCurso(ctx.env);
  if (otra && otra.id !== d.id) return `Ya hay otra difusión ${otra.estado === "activa" ? "en marcha" : "en pausa"} («${otra.tema}»). Una a la vez: vea /difusion.`;
  const como: Record<Difusion["estado"], string> = {
    borrador: "todavía no empezó",
    activa: "ya está en marcha",
    pausada: "está en pausa",
    terminada: "ya terminó",
    descartada: "se descartó",
  };
  return `Ese botón ya no aplica: la difusión ${como[d.estado]}.`;
}

export const difusion: ExtensionDeConsola = {
  nombre: "difusion",
  ayuda: ["📣 /difusion — cómo va el mensaje a muchas clientas (pausar, seguir)"],
  comandos: {
    difusion: async (ctx) => [await estadoDeDifusion(ctx)],
  },
  acciones: {
    difusionEmpezar: async (ctx, p) => {
      const id = String(p.id);
      if (!(await cambiarEstado(ctx.env, id, "activa"))) return { texto: `❌ ${await porQueNo(ctx, id)}` };
      const aj = await cargarAjustes(ctx.env);
      const d = await difusionPorId(ctx.env, id);
      return {
        texto:
          `▶️ Difusión en marcha. Sale de a poco, ${horarioEnPalabras(aj)}, unas ${d?.por_dia ?? POR_DIA_POR_DEFECTO} por día ` +
          "con 1 a 2 minutos entre cada mensaje. Le aviso cuando termine. Para ver cómo va o pausarla: /difusion",
      };
    },
    difusionDescartar: async (ctx, p) =>
      (await cambiarEstado(ctx.env, String(p.id), "descartada"))
        ? { texto: "❌ Difusión descartada. No salió nada." }
        : { texto: `❌ ${await porQueNo(ctx, String(p.id))}` },
    difusionPausar: async (ctx, p) =>
      (await cambiarEstado(ctx.env, String(p.id), "pausada"))
        ? { texto: "⏸ Difusión en pausa: no sale ninguno más hasta que toque ▶️ Seguir (en /difusion)." }
        : { texto: `❌ ${await porQueNo(ctx, String(p.id))}` },
    difusionSeguir: async (ctx, p) =>
      (await cambiarEstado(ctx.env, String(p.id), "activa"))
        ? { texto: "▶️ La difusión sigue desde donde quedó." }
        : { texto: `❌ ${await porQueNo(ctx, String(p.id))}` },
    difusionTerminar: async (ctx, p) => {
      const id = String(p.id);
      if (!(await cambiarEstado(ctx.env, id, "terminada"))) return { texto: `❌ ${await porQueNo(ctx, id)}` };
      const c = await conteo(ctx.env, id);
      return { texto: `🛑 Difusión terminada. Les llegó a ${c.enviados}; a las ${c.pendientes} que faltaban ya no les sale.` };
    },
  },
  instrucciones: [
    "DIFUSIONES (un mensaje a muchas clientas):",
    "Para saber cuántas clientas preguntaron por algo —un producto, una marca, un tema— usa contarPorTema: lee lo que ELLAS escribieron, hasta 90 días atrás. verInteresadas solo trae los leads anotados (son pocos) y buscarConversacion busca por nombre o número, no por tema: NUNCA los uses para contar quién preguntó por un producto.",
    "Las palabras van como las escribiría una clienta, con sus variantes y errores comunes: para los wipes Dany Baby, por ejemplo, «dany», «danny», «water wipes», «wipes de agua», «toallitas de agua».",
    "Si el jefe quiere mandarle un mensaje a muchas («a todas las que preguntaron por X», o a más de 25), usa proponerDifusion con esas palabras, los días y el texto TAL CUAL él lo dio: no lo reescribas ni le agregues saludo. Si él quiere el nombre de cada una, pon {nombre} donde él diga. Sale de a poco, unas 40 al día y en el horario del seguimiento, para que WhatsApp no bloquee el número. No sale nada hasta que él toque ▶️ Empezar.",
    "Para ver cómo va, pausarla o seguirla: verDifusion (le muestra el estado con los botones).",
  ].join("\n"),
  herramientas: (ctx, salida) => ({
    contarPorTema: tool({
      description:
        "Cuántas clientas escribieron sobre un tema (palabras) en los últimos N días: por canal, a cuántas se les puede escribir y cuántas compraron. Lee lo que escribieron ellas.",
      inputSchema: z.object({
        palabras: z.array(z.string().min(3)).min(1).max(12).describe("Cómo lo escribiría una clienta, con variantes: «dany», «danny», «water wipes»"),
        dias: z.number().int().min(1).max(90).default(60),
      }),
      execute: async ({ palabras, dias }) => resumenDeAudiencia(await buscarPorTema(ctx.env, palabras, dias), palabras, dias),
    }),
    proponerDifusion: tool({
      description:
        "Arma una difusión: UN mensaje para todas las que escribieron sobre un tema en los últimos N días, enviado de a poco (unas 40 al día). Deja fuera sola a quien no se le debe o no se le puede escribir. El jefe la empieza con un botón.",
      inputSchema: z.object({
        palabras: z.array(z.string().min(3)).min(1).max(12),
        dias: z.number().int().min(1).max(90).default(60),
        texto: z.string().min(1).max(1500).describe("El mensaje tal cual lo dio el jefe. {nombre} se cambia por el nombre de cada clienta."),
        porDia: z.number().int().min(5).max(POR_DIA_MAXIMO).optional().describe(`Cuántas por día. Por defecto ${POR_DIA_POR_DEFECTO}.`),
      }),
      execute: async ({ palabras, dias, texto, porDia }) => {
        const enCurso = await difusionEnCurso(ctx.env);
        if (enCurso) {
          return `Ya hay una difusión ${enCurso.estado === "activa" ? "en marcha" : "en pausa"} («${enCurso.tema}»). Una a la vez: muéstrale el estado con verDifusion para que la termine o la deje acabar.`;
        }
        const personas = await buscarPorTema(ctx.env, palabras, dias);
        const si = personas.filter((p) => !p.motivo);
        if (!si.length) return `No queda nadie a quien escribirle. ${resumenDeAudiencia(personas, palabras, dias)}`;
        const ritmo = porDia ?? POR_DIA_POR_DEFECTO;
        const tema = limpiarPalabras(palabras).join(", ");
        const d = await crearBorrador(ctx.env, { texto, tema, porDia: ritmo, conversaciones: si.map((p) => p.conv.id) });
        const aj = await cargarAjustes(ctx.env);
        const grupo = nuevoGrupo();
        const ejemplo = si[0].conv;
        salida.push({
          texto:
            `${INICIO_DE_DIFUSION} — todavía NO sale nada.\n\n${resumenDeAudiencia(personas, palabras, dias)}\n\n` +
            `Saldría a ${si.length}, unas ${d.por_dia} por día (${porCorrida(d.por_dia, aj.horaDesde, aj.horaHasta)} por hora), ` +
            `${horarioEnPalabras(aj)}, con 1 a 2 minutos entre cada mensaje: unos ${diasQueFaltan(si.length, d.por_dia)} días. ` +
            "Si alguna contesta, la atiende el bot; quien diga «no me interesa» queda fuera.\n\n" +
            `Así le llega a ${nombreDe(ejemplo)}:\n«${personalizar(texto, ejemplo)}»\n\n` +
            "Toque ▶️ Empezar o contésteme «sí».",
          teclado: [
            [
              { texto: `▶️ Empezar (${si.length})`, data: await crearAccion(ctx.env, "difusionEmpezar", { id: d.id, grupo }) },
              { texto: "❌ No", data: await crearAccion(ctx.env, "difusionDescartar", { id: d.id, grupo }) },
            ],
          ],
        });
        return "Propuesta enviada con su botón ▶️. Todavía NO salió nada. El jefe ya vio el conteo y el mensaje: no los repitas.";
      },
    }),
    verDifusion: tool({
      description: "Cómo va la difusión en curso, con los botones para pausarla, seguirla o terminarla.",
      inputSchema: z.object({}),
      execute: async () => {
        salida.push(await estadoDeDifusion(ctx));
        return "Le mostré el estado con sus botones. No lo repitas.";
      },
    }),
  }),
};
