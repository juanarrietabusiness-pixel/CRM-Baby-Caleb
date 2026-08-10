import type { Env } from "../env";
import { isPro } from "../config";
import { searchKbTool } from "./searchKb";
import { handoffHumanTool } from "./handoffHuman";
import { pauseBotTool } from "./pauseBot";
import { snoozeUserTool } from "./snoozeUser";
import { captureLeadTool } from "./captureLead";
import { scheduleAppointmentTool } from "./scheduleAppointment";
import { catalogQueryTool } from "./catalogQuery";

export interface ToolContext {
  env: Env;
  getConversationId: () => string | null;
}

export function buildTools(ctx: ToolContext) {
  // Free tier base set. captureLead va aquí a propósito: el bot Starter (free)
  // captura prospectos — es el valor central de un bot de ventas. Lo Pro son las
  // tools más avanzadas por nicho (agendar citas, consultar catálogo/inventario).
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId),
  };

  // Pro tier additions
  if (isPro(ctx.env)) {
    tools.scheduleAppointment = scheduleAppointmentTool(ctx.env, ctx.getConversationId);
    tools.catalogQuery = catalogQueryTool(ctx.env);
  }

  return tools;
}
