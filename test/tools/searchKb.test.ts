import { describe, it, expect, vi } from "vitest";
import { searchKbTool } from "../../src/tools/searchKb";

describe("searchKbTool", () => {
  it("returns top-k chunks with scores", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "c1", score: 0.91, metadata: { title: "Embebar wall", content: "Pega <div data-tv-wall>...</div>" } },
        { id: "c2", score: 0.78, metadata: { title: "Generar carrusel", content: "Ir a Distribuir..." } },
      ] })) },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "como embebo wall" });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe("Embebar wall");
    expect(result.results[0].score).toBe(0.91);
  });

  /**
   * Esta prueba existe porque el mock de arriba devuelve `metadata` haga lo que
   * haga la llamada real: ignora el segundo argumento de `query`. Con ese mock,
   * el bug más caro de todo el proyecto pasaba en verde.
   *
   * En Vectorize, `returnMetadata` por defecto es "none". Sin pedirlo explícito,
   * `query` devuelve ids y scores sin metadatos, y la tool entregaba ocho
   * fragmentos con title:"" y content:"" — la base de conocimiento entera
   * ilegible para el bot, mientras el catálogo (que lee D1) seguía funcionando.
   *
   * Aquí se verifica CON QUÉ OPCIONES se llama, no qué devuelve el mock.
   */
  it("le pide a Vectorize los metadatos completos, o no hay base de conocimiento", async () => {
    const query = vi.fn(async (_vec: number[], _opts: { topK?: number; returnMetadata?: string }) => ({
      matches: [] as unknown[],
    }));
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      KB: { query },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    await execute({ query: "cuánto es el abono" });

    expect(query).toHaveBeenCalledTimes(1);
    const opciones = query.mock.calls[0][1];
    // "indexed" no sirve: trunca a 64 bytes y no hay índice sobre `content`.
    expect(opciones.returnMetadata).toBe("all");
    expect(opciones.topK).toBe(8);
  });

  /**
   * El otro lado del mismo fallo: si algún día vuelve a llegar un match sin
   * metadatos, que no se cuele como un fragmento vacío y silencioso.
   */
  it("un match sin metadatos no se entrega como fragmento vacío", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "kb-envios#0", score: 0.64 },
        { id: "kb-pagos#1", score: 0.61, metadata: { title: "Pagos", content: "El abono es de $5.00." } },
      ] })) },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "cuánto es el abono" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toContain("$5.00");
  });

  it("returns empty results when KB throws", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) },
      KB: { query: vi.fn(async () => { throw new Error("boom"); }) },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "x" });
    expect(result.error).toBe("transient");
  });
});
