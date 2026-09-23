import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

export function captureLeadTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Captura un lead (cliente interesado) para que el dueño venda después. Guarda en D1 + opcionalmente exporta a Google Sheets / Notion / Airtable.",
    inputSchema: z.object({
      name: z.string().optional().describe("Nombre del cliente"),
      contact: z.string().optional().describe("Teléfono o email"),
      intent: z.string().describe("Qué quiere el cliente, en 1-2 frases"),
      notes: z.string().optional(),
    }),
    execute: async ({ name, contact, intent, notes }) => {
      const convId = getConversationId();
      const leads = new LeadsRepo(new Db(env.DB));
      const leadId = await leads.create({
        conversationId: convId,
        name,
        contact,
        channelUserId: null,
        intent,
        notes,
      });

      // Optional external export — Pro-tier feature, skipped if no creds
      // (Implementation deferred to Task 7.4 — adds Google Sheets export)

      // Una interesada que deja sus datos es una venta a punto de cerrarse, y
      // el lead quedaba en el panel sin que nadie se enterara. Se avisa al
      // Telegram del dueño (si está vinculado), con los botones de siempre.
      // Nunca bloquea la respuesta a la clienta.
      try {
        const { avisarAlDueno } = await import("../owner/avisos");
        const { avisoReciente } = await import("../owner/acciones");
        // El bot suele capturar en dos pasos (primero el nombre, después el
        // correo): un aviso por conversación cada media hora basta.
        if (convId && (await avisoReciente(env, convId, 30 * 60_000))) {
          return { leadId, message: "Lead capturado." };
        }
        await avisarAlDueno(env, {
          titulo: "🛍 Interesada",
          cuerpo: [intent, name && `Nombre: ${name}`, contact && `Contacto: ${contact}`, notes && `Nota: ${notes}`]
            .filter(Boolean)
            .join("\n"),
          conversationId: convId,
        });
      } catch (e) {
        console.warn("[captureLead] no se pudo avisar al dueño:", e);
      }

      return { leadId, message: "Lead capturado." };
    },
  });
}
