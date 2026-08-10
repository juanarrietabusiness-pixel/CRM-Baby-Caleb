import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";

// Guardrail de abuso decidido por el LLM: complementa al filtro determinístico
// de mensajes repetidos (src/spam.ts). Aquí caen los casos que requieren
// criterio — insultos, spam que varía el texto, otro bot del otro lado.
export function snoozeUserTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Manda esta conversación a DESCANSAR (cooldown): el bot ignorará todos sus mensajes por los minutos indicados (default 60). Úsala cuando el usuario esté insultando o siendo abusivo, mande spam sin sentido una y otra vez, claramente sea otro bot automatizado, o esté usando al bot como un ChatGPT gratis (varias preguntas seguidas que no tienen nada que ver con el negocio: tareas, recetas, cultura general, código random). Antes de usarla manda UNA última respuesta breve y amable (en el caso ChatGPT: invítalo a la comunidad si le interesa aprender de IA y usa unos 120 minutos); después de llamarla, no digas nada más.",
    inputSchema: z.object({
      minutes: z.number().int().min(15).max(1440).default(60),
      reason: z
        .string()
        .describe("Motivo corto: insultos | spam | bot | uso_chatgpt | otro (con 2-3 palabras de contexto)"),
    }),
    execute: async ({ minutes, reason }) => {
      const convId = getConversationId();
      if (!convId) return { error: "no_conversation" as const };
      const convs = new ConversationsRepo(new Db(env.DB));
      const until = Date.now() + minutes * 60_000;
      await convs.setPausedUntil(convId, until);
      console.warn(`[snoozeUser] conv ${convId} en cooldown ${minutes}min — ${reason}`);
      return { snoozedUntil: until, minutes, reason };
    },
  });
}
