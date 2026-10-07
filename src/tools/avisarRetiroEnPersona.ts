import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { cambiarMetadata } from "../takeover";

/**
 * Cuánto tarda en volver a avisar por la misma conversación. La clienta que
 * insiste en pasar a buscar lo dice cinco veces; la dueña necesita enterarse
 * una, no cinco. Pasado este plazo, si sigue insistiendo, es otro aviso.
 */
export const VENTANA_DEL_AVISO_MS = 12 * 60 * 60 * 1000;

/** La llave de `conversations.metadata` donde queda cuándo se avisó. */
export const LLAVE_AVISO_RETIRO = "retiro_avisado";

const SIGUE = "Sigue con la conversación como si nada: explica con amabilidad que atendemos solo por internet con delivery, ofrécele el envío a su zona y ayúdala a cerrar así. No le digas que avisaste a nadie y no la pases con una persona.";

/**
 * Avisa en silencio a la dueña de que una clienta quiere comprar o retirar en
 * persona (ir a la tienda, a la casa, pedir la ubicación).
 *
 * Es lo contrario de handoffHuman, a propósito (decisión del 7-oct-2026): Baby
 * Caleb vende únicamente online, por delivery. Cuando alguien pretende ir, el
 * bot NO se calla, NO pausa, NO abre ticket y NO dice que pasa la conversación:
 * agota el delivery. Solo le avisa a la dueña, por Telegram, para que ella
 * decida si interviene — y si responde sobre el aviso, el bot se calla solo
 * (src/takeover.ts).
 */
export function avisarRetiroEnPersonaTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Avisa EN SILENCIO a la dueña de que la clienta quiere comprar o retirar en persona " +
      "(ir a la tienda, ir a la casa, pasar a buscar, pedir la dirección o la ubicación). " +
      "NO pausa el bot, NO abre ticket, NO pasa la conversación a nadie: tú sigues atendiendo y " +
      "ofreciendo el delivery. Llámala la primera vez que lo diga; si ya se avisó hace poco no " +
      "repite el aviso. Después de llamarla, no se lo menciones a la clienta.",
    inputSchema: z.object({
      queDijo: z
        .string()
        .max(300)
        .describe("Lo que dijo la clienta, en una frase (por ejemplo: «prefiere pasar a buscar el pedido hoy»)"),
    }),
    execute: async ({ queDijo }) => {
      const convId = getConversationId();
      if (!convId) return { avisada: false, instruccion: SIGUE };

      const db = new Db(env.DB);
      const conv = await new ConversationsRepo(db).getById(convId);
      if (!conv) return { avisada: false, instruccion: SIGUE };

      // Ya se avisó hace poco: la dueña lo sabe. No se repite el aviso.
      let ultimo = 0;
      try {
        const meta = JSON.parse(conv.metadata ?? "{}") as Record<string, unknown>;
        ultimo = Number(meta[LLAVE_AVISO_RETIRO]) || 0;
      } catch {
        /* metadata rota: se trata como si nunca se hubiera avisado */
      }
      if (ultimo && Date.now() - ultimo < VENTANA_DEL_AVISO_MS) {
        return { avisada: true, repetida: true, instruccion: SIGUE };
      }

      // Un aviso nunca rompe la atención: si Telegram no está vinculado o falla,
      // la conversación sigue igual (y se vuelve a intentar en el próximo turno,
      // porque solo se anota cuando el aviso salió).
      try {
        const { avisarAlDueno } = await import("../owner/avisos");
        const salio = await avisarAlDueno(env, {
          titulo: "🏠 Quiere comprar en persona",
          cuerpo: [
            `«${queDijo.trim()}»`,
            "",
            "El bot SIGUE atendiéndola y ofreciéndole el delivery: no se pausó, no se abrió ticket y no se le dijo que se la pasa con una persona.",
            "Si usted decide otra cosa (recibirla, llamarla), responda a este mensaje: lo que escriba le llega a la clienta y el bot se calla en esta conversación.",
          ].join("\n"),
          conversationId: convId,
        });
        if (salio) await cambiarMetadata(db, convId, { [LLAVE_AVISO_RETIRO]: Date.now() });
        return { avisada: salio, instruccion: SIGUE };
      } catch (e) {
        console.warn("[avisarRetiroEnPersona] no se pudo avisar a la dueña:", e);
        return { avisada: false, instruccion: SIGUE };
      }
    },
  });
}
