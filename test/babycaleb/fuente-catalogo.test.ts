/**
 * El traspaso del catálogo al sistema, y el interruptor que lo hace seguro.
 *
 * El bot está atendiendo clientas AHORA. Cambiar de dónde sale el catálogo es
 * cambiar la fuente de verdad del negocio en caliente, así que lo que estas
 * pruebas vigilan no es que la fuente nueva funcione: es que la vieja SIGA
 * siendo la de siempre mientras nadie decida otra cosa, y que el día que se
 * mueva el interruptor el bot conteste lo mismo.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo } from "../../src/db/catalog";
import { SUCURSALES } from "../../src/catalog/validation";
import { aProducto, fuenteDeCatalogo, type SistemaBinding, type VariantePublica } from "../../src/catalog/fuente";
import type { Env } from "../../src/env";
import { PRODUCTOS } from "./verdad-del-cliente";

const NOMBRE = (code: string) => `Producto ${code}`;

let d1: unknown;
let repo: CatalogRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = await mf.getD1Database("DB");
  repo = new CatalogRepo(new Db(d1 as never));
  for (const p of PRODUCTOS) {
    await repo.saveProduct({
      code: p.code,
      name: NOMBRE(p.code),
      costPrice: 100,
      salePrice: p.precioCents,
      active: true,
      stock: SUCURSALES.map((branch) => ({ branch, stockQty: 10 })),
    });
  }
});

/** Un sistema de mentira que contesta lo mismo que la D1 sembrada. */
function sistemaFalso(sobre: Partial<SistemaBinding> = {}): SistemaBinding {
  const variantes = (cantidad?: number): VariantePublica[] =>
    PRODUCTOS.map((p) => ({
      codigo: p.code,
      slug: p.code.toLowerCase(),
      nombre: NOMBRE(p.code),
      talla: null,
      pesoMinLb: null,
      pesoMaxLb: null,
      unidadesPorCaja: p.porCaja ?? 1,
      precioCents: p.precioCents,
      disponibilidad: "disponible" as const,
      ...(cantidad === undefined
        ? {}
        : {
            pedido:
              cantidad <= 30
                ? { cantidadPedida: cantidad, alcanza: true }
                : { cantidadPedida: cantidad, alcanza: false, maximoDisponible: 30 },
          }),
    }));

  return {
    async buscarCatalogo(q, limite, cantidad) {
      const texto = q.trim().toLowerCase();
      const todas = variantes(cantidad);
      const filtradas =
        texto === ""
          ? todas
          : todas.filter(
              (v) => v.codigo.toLowerCase().includes(texto) || v.nombre.toLowerCase().includes(texto),
            );
      return { ok: true, datos: filtradas.slice(0, limite ?? 20) };
    },
    async listarCatalogo(cantidad) {
      return { ok: true, datos: variantes(cantidad) };
    },
    async cotizarEnvio() {
      return { ok: true, datos: { zona: "Tocumen", tarifaCents: 800, requierePagoTotal: false } };
    },
    ...sobre,
  };
}

const env = (extra: Partial<Env> = {}): Env => ({ DB: d1, ...extra }) as unknown as Env;

describe("el interruptor falla hacia lo conocido", () => {
  it("sin variable, la fuente es la D1 de siempre", () => {
    // Es lo que hace que desplegar este cambio no cambie nada.
    expect(fuenteDeCatalogo(env()).nombre).toBe("d1");
  });

  it('con "d1", la D1', () => {
    expect(fuenteDeCatalogo(env({ CATALOGO_FUENTE: "d1" })).nombre).toBe("d1");
  });

  it('con "sistema" y su binding, el sistema', () => {
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistemaFalso() }));
    expect(f.nombre).toBe("sistema");
  });

  it('con "sistema" pero SIN binding, vuelve a la D1 y avisa', () => {
    // Un bot mudo porque falta un binding es peor que un bot que sigue
    // contestando con el catálogo de ayer. Pero tiene que NOTARSE.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "sistema" }));
    expect(f.nombre).toBe("d1");
    expect(aviso).toHaveBeenCalled();
    expect(String(aviso.mock.calls[0]?.[0])).toContain("sin_binding");
    aviso.mockRestore();
  });

  it("con un valor que nadie entiende, la D1 y avisa", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "postgres" as never }));
    expect(f.nombre).toBe("d1");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe("el bot busca IGUAL con las dos fuentes", () => {
  // Esta es la prueba del traspaso. Si el día que se mueve el interruptor el
  // bot encuentra cosas distintas, lo nota una clienta y no nosotros.
  const consultas = ["NAT-M", "NAT-P-XL", "MOON-FUL", "DANY-AW600"];

  for (const q of consultas) {
    it(`«${q}» encuentra lo mismo`, async () => {
      const porD1 = await fuenteDeCatalogo(env()).search(q);
      const porSistema = await fuenteDeCatalogo(
        env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistemaFalso() }),
      ).search(q);

      expect(porSistema.map((p) => p.code).sort()).toEqual(porD1.map((p) => p.code).sort());
    });
  }

  it("y el precio es el mismo", async () => {
    const porD1 = await fuenteDeCatalogo(env()).search("NAT-M");
    const porSistema = await fuenteDeCatalogo(
      env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistemaFalso() }),
    ).search("NAT-M");

    expect(porSistema[0]?.salePrice).toBe(porD1[0]?.salePrice);
  });
});

describe("lo que el sistema NO manda, aquí no se inventa", () => {
  const v: VariantePublica = {
    codigo: "NAT-M",
    slug: "nat-m",
    nombre: "Pañal Nateen Talla M",
    talla: "M",
    pesoMinLb: 8,
    pesoMaxLb: 19,
    unidadesPorCaja: 144,
    precioCents: 5000,
    disponibilidad: "pocas",
  };

  it("el costo llega nulo, no en cero", () => {
    // Cero es un costo —y un margen del 100 %—. Nulo es «no lo sé», que es la
    // verdad: el costo no viaja por RPC.
    expect(aProducto(v).costPrice).toBeNull();
  });

  it("«pocas» NO se traduce a un número inventado", () => {
    // Traducir «pocas» a un 3 sería meter una cifra falsa en el sistema, y si
    // ese 3 se usara para decidir si alcanza para 30, el bot prometería
    // mercancía que no hay. `stockTotal` es el MÍNIMO que la etiqueta
    // garantiza, y por eso «pocas» es 1: lo único que se sabe es que queda algo.
    expect(aProducto(v).stockTotal).toBe(1);
    expect(aProducto({ ...v, disponibilidad: "agotado" }).stockTotal).toBe(0);
  });

  it("y la etiqueta vuelve a salir igual, que es para lo que se usa", async () => {
    const { disponibilidadDe } = await import("../../src/db/catalog");
    expect(disponibilidadDe(aProducto(v))).toBe("pocas");
    expect(disponibilidadDe(aProducto({ ...v, disponibilidad: "agotado" }))).toBe("agotado");
    expect(disponibilidadDe(aProducto({ ...v, disponibilidad: "disponible" }))).toBe("disponible");
  });

  it("no viene desglose por bodega: eso es de la dueña", () => {
    expect(aProducto(v).stock).toEqual([]);
  });
});

describe("«¿alcanza para 30?» con el catálogo del sistema", () => {
  it("la respuesta la da el SISTEMA, no se recalcula aquí", async () => {
    // Si se recalculara de `stockTotal` —que vale 5 para «disponible»— el bot
    // diría que no alcanza para 10 habiendo 30. Esto es justo lo que hace que
    // el mínimo garantizado sea seguro.
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistemaFalso() }));
    const [p] = await f.search("NAT-M", 8, 10);
    expect(p?.pedido).toEqual({ cantidadPedida: 10, alcanza: true });
  });

  it("y cuando no alcanza, trae el máximo", async () => {
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistemaFalso() }));
    const [p] = await f.search("NAT-M", 8, 50);
    expect(p?.pedido).toEqual({ cantidadPedida: 50, alcanza: false, maximoDisponible: 30 });
  });
});

describe("si el sistema contesta mal", () => {
  it("se dice, no se finge un catálogo vacío", async () => {
    // Un catálogo vacío hace que el bot diga «no tenemos nada», que es una
    // mentira. Un error hace que el turno falle y se note.
    const roto = sistemaFalso({
      async buscarCatalogo() {
        return { ok: false, codigo: "interno", mensaje: "se cayó" };
      },
    });
    const f = fuenteDeCatalogo(env({ CATALOGO_FUENTE: "sistema", SISTEMA: roto }));
    await expect(f.search("NAT-M")).rejects.toThrow(/el sistema no contestó/);
  });
});
