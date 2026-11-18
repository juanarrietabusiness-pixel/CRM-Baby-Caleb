import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

export interface SearchKbResult {
  title: string;
  content: string;
  score: number;
}

/**
 * Esta tool decía en su descripción: "Si top-1 score < 0.7 no hay match útil —
 * escala". No era un filtro del código, era una INSTRUCCIÓN al modelo, y un
 * umbral inventado: bge-m3 puntúa una pregunta en español contra un párrafo
 * que la contesta típicamente entre 0.5 y 0.7. O sea, se le estaba pidiendo al
 * bot que descartara respuestas correctas y escalara igual.
 *
 * Se vio en producción: una clienta preguntó el envío a Tocumen —que está en la
 * base de conocimiento a $8— y el bot contestó "no tengo esa tarifa en el
 * sistema". El dato estaba; el umbral lo tapó.
 *
 * Ahora no se le da ningún número mágico: se le dice que lea el contenido y
 * decida por lo que dice, no por el parecido de redacción.
 */
export function searchKbTool(env: Env) {
  return tool({
    description:
      "Busca en la base de conocimiento del negocio: políticas, envíos, pagos, uso del producto, " +
      "cuándo pasar con una persona. Devuelve los fragmentos más parecidos, ordenados. " +
      "LEE EL CONTENIDO antes de decidir: el `score` mide parecido de REDACCIÓN, no si la respuesta " +
      "está ahí. Un fragmento con score bajo puede contener el dato exacto que te piden — úsalo igual. " +
      "Solo di que no tienes el dato cuando hayas leído los fragmentos y ninguno conteste la pregunta.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Pregunta o tema a buscar"),
    }),
    execute: async ({ query }) => {
      try {
        const embedding = await env.AI.run("@cf/baai/bge-m3", {
          text: query,
        });
        const vec = (embedding as any).data?.[0];
        if (!Array.isArray(vec)) {
          return { error: "transient" as const, message: "embedding shape unexpected" };
        }
        // topK 8 y no 5: la base de conocimiento se trocea en ~1,200 caracteres,
        // así que una respuesta puede caer en el trozo vecino al que más se
        // parece a la pregunta. Traer tres más cuesta nada y evita el fallo
        // silencioso de que el dato exista y el bot conteste que no lo tiene.
        //
        // returnMetadata: "all" NO es opcional. En Vectorize el valor por
        // defecto es "none": sin esta línea, `query` devuelve los ocho ids con
        // su score y NINGÚN metadato, así que el `.map()` de abajo producía
        // title: "" y content: "" ocho veces. La base de conocimiento entera
        // era ilegible en tiempo de ejecución: el bot llamaba la tool, recibía
        // ocho cadenas vacías y contestaba "no tengo ese dato" sobre cosas que
        // sí están escritas. Explica por qué el catálogo (que lee D1) siempre
        // funcionó y el resto del negocio no.
        //
        // Tiene que ser "all" y no "indexed": el contenido llega a ~1,200
        // caracteres y los metadatos indexados se truncan a 64 bytes; además
        // no hay ningún índice de metadatos creado sobre `content`.
        const matches = await env.KB.query(vec, { topK: 8, returnMetadata: "all" });
        const results: SearchKbResult[] = (matches.matches ?? [])
          .map((m: any) => ({
            title: (m.metadata?.title as string) ?? "",
            content: (m.metadata?.content as string) ?? "",
            score: m.score ?? 0,
          }))
          // Un fragmento sin contenido no es una respuesta vacía: es un fallo de
          // recuperación disfrazado. Entregárselo al modelo lo empuja a decir
          // "no tengo ese dato" con toda seguridad. Mejor que no lo vea.
          .filter((r: SearchKbResult) => r.content.trim() !== "");
        return { results };
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
