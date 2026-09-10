/**
 * El catálogo que se carga en D1 dice lo mismo que el documento de la dueña.
 *
 * Este test lee los .sql tal como se aplican a Cloudflare y los compara contra
 * test/babycaleb/verdad-del-cliente.ts. Existe porque el fallo que importa aquí
 * no es un crash: es que el bot cotice $45 donde son $50 y nadie se entere
 * hasta que una clienta reclame.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTOS, DESCATALOGADOS } from "./verdad-del-cliente";
import { SUCURSALES } from "../../src/catalog/validation";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED = readFileSync(resolve(ROOT, "src/db/seed-catalog.sql"), "utf8");
const MIGRACION = readFileSync(resolve(ROOT, "src/db/verdad-2026-09.sql"), "utf8");

interface FilaSeed {
  code: string;
  name: string;
  cost: string;
  sale: number;
  stock: number;
  branch: string;
  active: number;
}

/** Extrae las filas del INSERT del seed. */
function filasDelSeed(sql: string): FilaSeed[] {
  const re =
    /\(\s*'([^']+)',\s*'((?:[^']|'')*)',\s*(NULL|\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*(\d+),/g;
  const out: FilaSeed[] = [];
  for (const m of sql.matchAll(re)) {
    out.push({
      code: m[1],
      name: m[2].replace(/''/g, "'"),
      cost: m[3],
      sale: Number(m[4]),
      stock: Number(m[5]),
      branch: m[6],
      active: Number(m[7]),
    });
  }
  return out;
}

const filas = filasDelSeed(SEED);
const porCodigo = new Map<string, FilaSeed[]>();
for (const f of filas) porCodigo.set(f.code, [...(porCodigo.get(f.code) ?? []), f]);

describe("seed-catalog.sql — el catálogo dice lo que dice la dueña", () => {
  it("carga exactamente los productos del documento, ni uno más", () => {
    expect([...porCodigo.keys()].sort()).toEqual(PRODUCTOS.map((p) => p.code).sort());
  });

  it.each(PRODUCTOS)("$code: el precio de venta es el del documento", (producto) => {
    const suyas = porCodigo.get(producto.code);
    expect(suyas, `falta ${producto.code} en el seed`).toBeDefined();
    for (const fila of suyas!) expect(fila.sale).toBe(producto.precioCents);
  });

  it.each(PRODUCTOS)("$code: el nombre lleva la talla y la cantidad por caja", (producto) => {
    const nombre = porCodigo.get(producto.code)![0].name;
    for (const trozo of producto.nombreContiene) expect(nombre).toContain(trozo);
    if (producto.porCaja !== undefined) {
      // La cantidad por caja va en el NOMBRE del producto, no en la base de
      // conocimiento: así catalogQuery contesta "cuánto trae y cuánto vale" de
      // una sola llamada y ese dato no puede desfasarse entre las dos fuentes.
      expect(nombre.replace(/,/g, "")).toContain(String(producto.porCaja));
    }
  });

  it("no queda rastro de lo que el documento sacó de circulación", () => {
    for (const code of DESCATALOGADOS) {
      expect(SEED).not.toContain(`'${code}'`);
    }
  });

  it("el precio y el nombre son iguales en las tres bodegas", () => {
    // Si una bodega tuviera otro precio, el bot cotizaría distinto según de
    // cuál leyera. saveProduct() ya impone esta regla; el seed también.
    for (const [code, suyas] of porCodigo) {
      expect(new Set(suyas.map((f) => f.sale)).size, `${code} tiene precios distintos`).toBe(1);
      expect(new Set(suyas.map((f) => f.name)).size, `${code} tiene nombres distintos`).toBe(1);
      expect(new Set(suyas.map((f) => f.branch)).size, `${code} repite bodega`).toBe(suyas.length);
    }
  });

  it("todas las bodegas son de la lista cerrada", () => {
    for (const f of filas) expect(SUCURSALES).toContain(f.branch as (typeof SUCURSALES)[number]);
  });

  it("todo entra inactivo y en cero: un activo sin stock le dice agotado a todo el mundo", () => {
    for (const f of filas) {
      expect(f.active).toBe(0);
      expect(f.stock).toBe(0);
    }
  });

  it("los costos que el documento no trae quedan en NULL, no inventados", () => {
    const sinCostoConocido = ["NAT-P-L", "NAT-P-XL", "NAT-P-XXL", "DANY-AW1200", "DANY-AW600", "MOON-FUL"];
    for (const code of sinCostoConocido) {
      expect(porCodigo.get(code)![0].cost, `${code} tiene un costo inventado`).toBe("NULL");
    }
  });

  it("ningún precio de venta queda por debajo del costo", () => {
    for (const f of filas) {
      if (f.cost !== "NULL") expect(f.sale).toBeGreaterThan(Number(f.cost));
    }
  });
});

describe("verdad-2026-09.sql — corregir sin borrar el stock cargado", () => {
  it("no borra la tabla entera: para eso está el seed", () => {
    expect(MIGRACION).not.toMatch(/DELETE\s+FROM\s+catalog_items\s*;/i);
  });

  it("es idempotente: los productos nuevos entran con INSERT OR IGNORE", () => {
    expect(MIGRACION).toContain("INSERT OR IGNORE INTO catalog_items");
  });

  it("da de baja lo descatalogado", () => {
    for (const code of DESCATALOGADOS) {
      expect(MIGRACION).toContain(`DELETE FROM catalog_items WHERE code = '${code}'`);
    }
  });

  it("deja los mismos precios que el seed, producto por producto", () => {
    // El seed y la migración son dos caminos a la misma base. Si divergen, la
    // base queda distinta según cuál se haya corrido, que es exactamente el
    // tipo de desfase que este trabajo vino a cerrar.
    for (const producto of PRODUCTOS) {
      const update = MIGRACION.match(
        new RegExp(`UPDATE catalog_items SET name = '([^']*)', sale_price = (\\d+)[^;]*WHERE code = '${producto.code}'`),
      );
      const insert = MIGRACION.match(
        new RegExp(`\\(\\s*'${producto.code}',\\s*'((?:[^']|'')*)',\\s*(?:NULL|\\d+),\\s*(\\d+),`),
      );
      const encontrado = update ?? insert;
      expect(encontrado, `${producto.code} no aparece en la migración`).not.toBeNull();
      expect(Number(encontrado![2])).toBe(producto.precioCents);
      expect(encontrado![1]).toBe(porCodigo.get(producto.code)![0].name.replace(/'/g, "''"));
    }
  });
});
