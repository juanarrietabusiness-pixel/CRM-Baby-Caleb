import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";

export function pauseBotTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Pausa el bot para esta conversación por N minutos. El dueño humano tomará el control.",
    inputSchema: z.object({
      minutes: z.number().int().min(5).max(1440).default(60),
      reason: z.string().optional(),
    }),
    execute: async ({ minutes }) => {
      const convId = getConversationId();
      if (!convId) return { error: "no_conversation" as const };
      const convs = new ConversationsRepo(new Db(env.DB));
      const until = Date.now() + minutes * 60_000;
      await convs.setPausedUntil(convId, until);
      return { pausedUntil: until };
    },
  });
}
