import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { fmtUSD } from "../catalog/validation";
import {
  ZONAS_CIUDAD_PANAMA,
  PANAMA_OESTE,
  CARGO_FERGUSON_CENTS,
  type ZonaEnvio,
} from "../../member/zonas-envio";

/**
 * La tarifa de envío, consultada — no intuida.
 *
 * Antes esto vivía en la base de conocimiento y se buscaba con searchKb, que
 * busca por parecido de redacción. Un tarifario son 50 filas de nombres
 * propios: "Tocumen $8" no se parece a "¿cuánto cuesta el envío a Tocumen?"
 * más que las otras 49 filas. Pasó lo previsible — el bot le dijo a una
 * clienta "no tengo esa tarifa en el sistema" con el dato escrito en la base.
 *
 * Aquí la respuesta es exacta o es "no está en la lista". Nunca aproximada:
 * una tarifa dicha a la ligera es una tarifa que la clienta espera que se
 * respete, y el documento es explícito en que no se estime.
 */

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** ¿La clienta nombró esta zona? Compara el nombre y sus alias, sin tildes. */
function mencionada(texto: string, zona: ZonaEnvio): boolean {
  const t = norm(texto);
  const candidatos = [zona.nombre, ...(zona.alias ?? [])].map(norm);
  // Frontera de palabra para que "Brisas" no coincida dentro de "Brisas del
  // Golf" al revés, y para que "Crisol" no pesque cualquier subcadena.
  return candidatos.some((c) => new RegExp(`(?:^|\\s)${c}(?:\\s|$)`).test(t));
}

export function cotizarEnvioTool(_env: Env) {
  return tool({
    description:
      "La ÚNICA fuente de la tarifa de delivery. ÚSALA SIEMPRE que pregunten cuánto cuesta el envío, " +
      "el delivery o mandar el pedido a un lugar — nunca de memoria y nunca estimando. Pasa la zona tal " +
      "como la escribió la clienta. Si la zona no está en la lista, la tool lo dice: ahí NO inventes un " +
      "precio ni lo calcules por parecido con otra zona, pasa la conversación a una persona con " +
      "handoffHuman. El delivery siempre es aparte del precio del producto.",
    inputSchema: z.object({
      zona: z
        .string()
        .min(2)
        .describe("El lugar que dijo la clienta, tal cual: 'Tocumen', 'costa del este', 'La Chorrera'."),
    }),
    execute: async ({ zona }) => {
      const exacta = ZONAS_CIUDAD_PANAMA.filter((z) => mencionada(zona, z));
      if (exacta.length > 0) {
        // Si el texto nombra dos zonas ("San Francisco o Paitilla"), se
        // devuelven ambas y decide la clienta, en vez de elegir por ella.
        return {
          encontrada: true as const,
          zonas: exacta.map((z) => ({ zona: z.nombre, tarifa: fmtUSD(z.tarifaCents) })),
          nota: "El delivery va aparte del precio del producto.",
        };
      }

      if (PANAMA_OESTE.nombres.some((n) => mencionada(zona, { nombre: n, tarifaCents: 0 }))) {
        return {
          encontrada: false as const,
          zonaReconocida: "Panamá Oeste",
          rango: `${fmtUSD(PANAMA_OESTE.minCents)} a ${fmtUSD(PANAMA_OESTE.maxCents)}`,
          mensaje:
            "Panamá Oeste (Arraiján y La Chorrera) no tiene tarifa fija: va de $3.00 a $6.00 según la " +
            "distancia. NO des un número: pregunta el punto exacto y pasa la conversación a una persona.",
        };
      }

      return {
        encontrada: false as const,
        mensaje:
          "Esa zona no está en el tarifario. NO la calcules por parecido con otra ni des un rango. " +
          "LLAMA A handoffHuman AHORA: dile que confirma el costo del envío con el equipo y que la " +
          "están pasando con una persona. NO le des el WhatsApp, el Instagram ni el correo para que " +
          "escriba por su cuenta — eso deja el pedido sin registrar y nadie del equipo se entera.",
        cargoFergusonSiEsInterior: fmtUSD(CARGO_FERGUSON_CENTS),
        notaInterior:
          "Si la zona es de otra provincia (Colón, Los Santos, Veraguas, Changuinola…), el envío va por " +
          "Ferguson: el motorizado cobra ese cargo por llevarlo, la tarifa de Ferguson la paga la " +
          "clienta al retirar, y hay que pagar la totalidad del producto por adelantado.",
      };
    },
  });
}
