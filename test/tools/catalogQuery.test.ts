import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo } from "../../src/db/catalog";
import { catalogQueryTool } from "../../src/tools/catalogQuery";
import { SUCURSALES } from "../../src/catalog/validation";
import type { Env } from "../../src/env";

let env: Env;
let repo: CatalogRepo;

type Resultado = {
  matches: Array<{
    codigo: string;
    nombre: string;
    precio: string;
    disponibilidad: string;
    bodegas: string[];
  }>;
  mensaje?: string;
  catalogoCompleto?: Resultado["matches"];
};

const correr = (query: string) =>
  catalogQueryTool(env).execute!({ query }, {} as any) as Promise<Resultado>;

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
});
