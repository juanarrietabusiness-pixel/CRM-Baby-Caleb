/**
 * Retirar un documento de conocimiento tiene que retirarlo DEL ÍNDICE.
 *
 * Borrar la fila de kb_docs no borra nada de Vectorize: los vectores viven como
 * dash:<id>#0…#23 y un reindex hace upsert, que nunca borra. Un documento
 * borrado por SQL seguiría contestando para siempre y sin rastro de dónde salió
 * la respuesta, que es la peor forma de estar equivocado: no se puede depurar.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import {
  KbDocsRepo,
  purgeRetiredDocVectors,
  RETIRED_DOC_IDS,
  MAX_CHUNKS,
} from "../../src/kb/docs";

let env: { DB: unknown; KB: { deleteByIds: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }; AI: unknown };
let borrados: string[];

beforeEach(async () => {
  const mf = await createTestMiniflare();
  borrados = [];
  env = {
    DB: await mf.getD1Database("DB"),
    KB: {
      deleteByIds: vi.fn(async (ids: string[]) => { borrados.push(...ids); }),
      upsert: vi.fn(async () => {}),
    },
    AI: { run: vi.fn(async () => ({ data: [[0.1]] })) },
  };
});

describe("member/kb-retirados.json", () => {
  it("lista los cinco documentos que se escribieron desde el panel en agosto", () => {
    expect(RETIRED_DOC_IDS).toEqual([
      "compra-delivery-y-pagos",
      "contacto-y-la-marca",
      "guia-tallas",
      "por-que-hipoalergenicos",
      "productos-y-marcas",
    ]);
  });
});

describe("purgeRetiredDocVectors", () => {
  it("borra TODOS los vectores de cada documento retirado", async () => {
    const r = await purgeRetiredDocVectors(env as never);
    expect(r.purged).toEqual(RETIRED_DOC_IDS);
    // Se borra el rango completo a ciegas porque no se sabe cuántos trozos
    // llegó a tener el documento; borrar un id que no existe es inofensivo.
    expect(borrados).toHaveLength(RETIRED_DOC_IDS.length * MAX_CHUNKS);
    for (const id of RETIRED_DOC_IDS) {
      expect(borrados).toContain(`dash:${id}#0`);
      expect(borrados).toContain(`dash:${id}#${MAX_CHUNKS - 1}`);
    }
  });

  it("es idempotente: correrlo dos veces no rompe nada", async () => {
    await purgeRetiredDocVectors(env as never);
    const r = await purgeRetiredDocVectors(env as never);
    expect(r.purged).toEqual(RETIRED_DOC_IDS);
  });

  it("respeta un documento retirado que alguien VOLVIÓ a crear en el panel", async () => {
    // Si la dueña recrea "guia-tallas" desde /admin/kb, ese documento es
    // deliberado y manda el panel: purgarlo le borraría lo que acaba de escribir.
    await new KbDocsRepo(new Db(env.DB as never)).upsert({
      id: "guia-tallas",
      title: "Guía de tallas",
      content: "La talla se elige por el peso del bebé.",
    });
    const r = await purgeRetiredDocVectors(env as never);
    expect(r.purged).not.toContain("guia-tallas");
    expect(r.purged).toHaveLength(RETIRED_DOC_IDS.length - 1);
    expect(borrados.some((id) => id.startsWith("dash:guia-tallas#"))).toBe(false);
  });

  it("sin documentos retirados no toca el índice", async () => {
    // Guarda para cualquier otro bot que clone la plantilla con la lista vacía.
    const vacio = { ...env, KB: { ...env.KB, deleteByIds: vi.fn() } };
    if (RETIRED_DOC_IDS.length === 0) {
      await purgeRetiredDocVectors(vacio as never);
      expect(vacio.KB.deleteByIds).not.toHaveBeenCalled();
    } else {
      expect(RETIRED_DOC_IDS.length).toBeGreaterThan(0);
    }
  });
});
