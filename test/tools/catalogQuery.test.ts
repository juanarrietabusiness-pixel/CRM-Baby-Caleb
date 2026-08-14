import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo } from "../../src/db/catalog";
import { catalogQueryTool } from "../../src/tools/catalogQuery";
import { SUCURSALES } from "../../src/catalog/validation";
import type { Env } from "../../src/env";

let env: Env;
let repo: CatalogRepo;

type Pedido = { cantidadPedida: number; alcanza: boolean; maximoDisponible?: number };

type Resultado = {
  matches: Array<{
    codigo: string;
    nombre: string;
    precio: string;
    disponibilidad: string;
    bodegas: string[];
    pedido?: Pedido;
  }>;
  mensaje?: string;
  catalogoCompleto?: Resultado["matches"];
};

const correr = (query: string) =>
  catalogQueryTool(env).execute!({ query }, {} as any) as Promise<Resultado>;

/** Como la llama el bot cuando la clienta pidió una cantidad concreta. */
const correrPidiendo = (query: string, cantidad: number) =>
  catalogQueryTool(env).execute!({ query, cantidad }, {} as any) as Promise<Resultado>;

/** Como la llama el bot ante "¿qué tienen?" — sin término de búsqueda. */
const correrGeneral = () =>
  catalogQueryTool(env).execute!({}, {} as any) as Promise<Resultado>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1 } as unknown as Env;
  repo = new CatalogRepo(new Db(d1 as any));

  await repo.saveProduct({
    code: "NAT-XXL",
    name: "Pañal Nateen Talla XXL (+55 lbs)",
    costPrice: 2920,
    salePrice: 4500,
    active: true,
    stock: [
      { branch: SUCURSALES[0], stockQty: 12 },
      { branch: SUCURSALES[1], stockQty: 0 },
    ],
  });
});

describe("catalogQueryTool", () => {
  it("encuentra por nombre y devuelve el precio formateado", async () => {
    const r = await correr("pañal");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].nombre).toContain("XXL");
    expect(r.matches[0].precio).toBe("$45.00");
  });

  it("encuentra por código", async () => {
    expect((await correr("NAT-XXL")).matches).toHaveLength(1);
  });

  it("NUNCA devuelve el costo ni la cantidad exacta de stock", async () => {
    const r = await correr("pañal");
    const crudo = JSON.stringify(r);
    // 2920 es el costo y 12 el inventario: ninguno puede llegar al modelo.
    expect(crudo).not.toContain("2920");
    expect(crudo).not.toContain("29.20");
    expect(Object.keys(r.matches[0])).not.toContain("costPrice");
    expect(Object.keys(r.matches[0])).not.toContain("stock");
  });

  it("traduce el inventario a una etiqueta, no a un número", async () => {
    expect((await correr("pañal")).matches[0].disponibilidad).toBe("disponible");

    await repo.saveProduct({
      code: "NAT-XXL",
      name: "Pañal Nateen Talla XXL (+55 lbs)",
      costPrice: 2920,
      salePrice: 4500,
      active: true,
      stock: [{ branch: SUCURSALES[0], stockQty: 2 }],
    });
    expect((await correr("pañal")).matches[0].disponibilidad).toBe("pocas");

    await repo.saveProduct({
      code: "NAT-XXL",
      name: "Pañal Nateen Talla XXL (+55 lbs)",
      costPrice: 2920,
      salePrice: 4500,
      active: true,
      stock: [{ branch: SUCURSALES[0], stockQty: 0 }],
    });
    expect((await correr("pañal")).matches[0].disponibilidad).toBe("agotado");
  });

  it("solo lista las bodegas que sí tienen existencias", async () => {
    const r = await correr("pañal");
    expect(r.matches[0].bodegas).toEqual([SUCURSALES[0]]);
  });

  it("no devuelve productos inactivos", async () => {
    await repo.setActive("NAT-XXL", false);
    const r = await correr("pañal");
    expect(r.matches).toHaveLength(0);
  });

  it("sin coincidencias ofrece el catálogo completo en vez de una lista vacía", async () => {
    const r = await correr("bicicleta");
    expect(r.matches).toHaveLength(0);
    expect(r.catalogoCompleto).toHaveLength(1);
    expect(r.mensaje).toContain("lo que sí hay");
  });

  it("con el catálogo vacío le dice al bot que escale, no que improvise", async () => {
    await repo.delete("NAT-XXL");
    const r = await correr("pañal");
    expect(r.matches).toHaveLength(0);
    expect(r.catalogoCompleto).toHaveLength(0);
    expect(r.mensaje).toContain("No inventes precios");
  });

  // "¿Qué tienen disponible?" — el hueco por el que el bot llegó a ofrecer
  // "cremas y lociones", productos que no existen: no tenía forma de listar.
  describe("pregunta general (sin query)", () => {
    it("devuelve el catálogo completo en vez de dejar al bot improvisando", async () => {
      const r = await correrGeneral();
      expect(r.catalogoCompleto).toHaveLength(1);
      expect(r.catalogoCompleto![0].nombre).toContain("XXL");
    });

    it("con el catálogo vacío manda a escalar", async () => {
      await repo.delete("NAT-XXL");
      const r = await correrGeneral();
      expect(r.catalogoCompleto).toHaveLength(0);
      expect(r.mensaje).toContain("No inventes precios");
    });
  });

  // Venta por volumen: "necesito 30 cajas" con 12 en bodega.
  describe("cantidad pedida", () => {
    it("sin cantidad no incluye nada del pedido", async () => {
      expect((await correr("pañal")).matches[0].pedido).toBeUndefined();
    });

    it("si alcanza, lo confirma SIN soltar el número de inventario", async () => {
      const r = await correrPidiendo("pañal", 10);
      expect(r.matches[0].pedido).toEqual({ cantidadPedida: 10, alcanza: true });
      expect(JSON.stringify(r)).not.toContain("12");
    });

    it("si no alcanza, da el máximo que sí se puede prometer", async () => {
      const r = await correrPidiendo("pañal", 30);
      expect(r.matches[0].pedido).toEqual({
        cantidadPedida: 30,
        alcanza: false,
        maximoDisponible: 12,
      });
    });

    it("suma las bodegas: el delivery sale de un inventario solo", async () => {
      await repo.saveProduct({
        code: "NAT-XXL",
        name: "Pañal Nateen Talla XXL (+55 lbs)",
        costPrice: 2920,
        salePrice: 4500,
        active: true,
        stock: [
          { branch: SUCURSALES[0], stockQty: 15 },
          { branch: SUCURSALES[1], stockQty: 10 },
        ],
      });
      expect((await correrPidiendo("pañal", 25)).matches[0].pedido).toEqual({
        cantidadPedida: 25,
        alcanza: true,
      });
      expect((await correrPidiendo("pañal", 26)).matches[0].pedido).toEqual({
        cantidadPedida: 26,
        alcanza: false,
        maximoDisponible: 25,
      });
    });

    it("agotado: no alcanza y el máximo es cero", async () => {
      await repo.saveProduct({
        code: "NAT-XXL",
        name: "Pañal Nateen Talla XXL (+55 lbs)",
        costPrice: 2920,
        salePrice: 4500,
        active: true,
        stock: [{ branch: SUCURSALES[0], stockQty: 0 }],
      });
      const r = await correrPidiendo("pañal", 30);
      expect(r.matches[0].disponibilidad).toBe("agotado");
      expect(r.matches[0].pedido).toEqual({
        cantidadPedida: 30,
        alcanza: false,
        maximoDisponible: 0,
      });
    });
  });
});
