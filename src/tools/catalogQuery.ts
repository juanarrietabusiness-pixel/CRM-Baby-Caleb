import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { catalog } from "../../member/config.local";

export function catalogQueryTool(_env: Env) {
  return tool({
    description:
      "Busca productos en el catálogo del negocio por nombre o keyword. Devuelve hasta 5 matches con precio.",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    execute: async ({ query }) => {
      const q = query.toLowerCase().trim();
      const matches = catalog
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false) ||
            (p.sku?.toLowerCase() === q),
        )
        .slice(0, 5);
      return { matches };
    },
  });
}
