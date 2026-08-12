import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo, disponibilidadDe } from "../../src/db/catalog";
import { SUCURSALES } from "../../src/catalog/validation";

let repo: CatalogRepo;
let db: Db;

const [BOD1, BOD2, BOD3] = SUCURSALES;

const guardar = (over: Parameters<CatalogRepo["saveProduct"]>[0] | Record<string, never> = {}) =>
  repo.saveProduct({
    code: "NAT-M",
    name: "Pañal Nateen Talla M",
    costPrice: 3200,
    salePrice: 5000,
    active: true,
    stock: [
      { branch: BOD1, stockQty: 10 },
      { branch: BOD2, stockQty: 4 },
    ],
    ...(over as object),
  } as Parameters<CatalogRepo["saveProduct"]>[0]);

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  repo = new CatalogRepo(db);
});

describe("CatalogRepo", () => {
  it("guarda una fila por bodega y las agrupa en un solo producto", async () => {
    await guardar();
    const p = await repo.getForAdmin("NAT-M");
    expect(p).not.toBeNull();
    expect(p!.stock).toHaveLength(2);
    expect(p!.stockTotal).toBe(14);
    expect(p!.salePrice).toBe(5000);
  });

  it("el precio y el nombre quedan iguales en todas las bodegas", async () => {
    await guardar();
    const filas = await db.all<{ sale_price: number; name: string }>(
      "SELECT sale_price, name FROM catalog_items WHERE code = ?",
      ["NAT-M"],
    );
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.sale_price)).size).toBe(1);
    expect(new Set(filas.map((f) => f.name)).size).toBe(1);
  });

  it("volver a guardar reemplaza las bodegas, no las acumula", async () => {
    await guardar();
    await guardar({ stock: [{ branch: BOD3, stockQty: 7 }] } as never);
    const p = await repo.getForAdmin("NAT-M");
    expect(p!.stock).toEqual([{ branch: BOD3, stockQty: 7 }]);
    expect(p!.stockTotal).toBe(7);
  });

  it("search encuentra por nombre y por código", async () => {
    await guardar();
    expect(await repo.search("nateen")).toHaveLength(1);
    expect(await repo.search("NAT-M")).toHaveLength(1);
    expect(await repo.search("fular")).toHaveLength(0);
  });

  it("search NUNCA devuelve el costo — el bot no lo puede ver", async () => {
    await guardar();
    const [p] = await repo.search("nateen");
    expect(p.costPrice).toBeNull();
    // Y el panel sí lo ve, sobre el mismo dato.
    expect((await repo.getForAdmin("NAT-M"))!.costPrice).toBe(3200);
  });

  it("search ignora los inactivos; el panel los sigue viendo", async () => {
    await guardar({ active: false } as never);
    expect(await repo.search("nateen")).toHaveLength(0);
    expect(await repo.listAllForAdmin()).toHaveLength(1);
  });

  it("setActive prende y apaga el producto entero", async () => {
    await guardar();
    await repo.setActive("NAT-M", false);
    expect(await repo.search("nateen")).toHaveLength(0);
    await repo.setActive("NAT-M", true);
    expect(await repo.search("nateen")).toHaveLength(1);
  });

  it("delete se lleva todas las bodegas del producto", async () => {
    await guardar();
    await repo.delete("NAT-M");
    expect(await repo.getForAdmin("NAT-M")).toBeNull();
    expect(await repo.allCodes()).toEqual([]);
  });

  it("la disponibilidad sale de la suma de bodegas", async () => {
    // Ninguna bodega llega sola al umbral, pero sumadas sí: hay producto.
    await guardar({ stock: [{ branch: BOD1, stockQty: 3 }, { branch: BOD2, stockQty: 4 }] } as never);
    expect(disponibilidadDe((await repo.getForAdmin("NAT-M"))!)).toBe("disponible");

    await guardar({ stock: [{ branch: BOD1, stockQty: 2 }] } as never);
    expect(disponibilidadDe((await repo.getForAdmin("NAT-M"))!)).toBe("pocas");

    await guardar({ stock: [{ branch: BOD1, stockQty: 0 }] } as never);
    expect(disponibilidadDe((await repo.getForAdmin("NAT-M"))!)).toBe("agotado");
  });

  it("dos productos distintos no se mezclan", async () => {
    await guardar();
    await guardar({ code: "NAT-XXL", name: "Pañal Nateen Talla XXL", salePrice: 4500 } as never);
    const todos = await repo.listAllForAdmin();
    expect(todos.map((p) => p.code).sort()).toEqual(["NAT-M", "NAT-XXL"]);
  });
});
