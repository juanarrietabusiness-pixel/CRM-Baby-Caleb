/**
 * Para cada pregunta real del documento: ¿el bot tiene de dónde sacarla, y de
 * UNA sola fuente?
 *
 * No mide cómo redacta —eso lo decide el modelo y se comprueba con el bot en
 * vivo—. Mide las dos cosas que sí son deterministas y que son las que hacen
 * que una respuesta salga mal:
 *
 *   · Que el dato exista en la fuente que le corresponde (si no, el bot se
 *     queda corto o improvisa).
 *   · Que NO exista también en otra (si no, el bot puede contestar sin
 *     consultar la tool, con una copia que se quedó vieja).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { CatalogRepo } from "../../src/db/catalog";
import { catalogQueryTool } from "../../src/tools/catalogQuery";
import { SUCURSALES } from "../../src/catalog/validation";
import { GUION } from "./guion-del-documento";
import { PRODUCTOS } from "./verdad-del-cliente";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KB_DIR = resolve(ROOT, "member/kb");

/**
 * Todo el texto indexable, con el espacio normalizado: el ancho de columna del
 * .md no es un dato, y el modelo de embeddings ve la frase, no dónde parte la
 * línea. Las comparaciones van sin distinguir mayúsculas por la misma razón —
 * "No se venden paquetes sueltos" al empezar una frase es el mismo hecho.
 */
const KB = readdirSync(KB_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => readFileSync(resolve(KB_DIR, f), "utf8"))
  .join("\n\n")
  .replace(/\s+/g, " ");

const porFuente = (f: string) => GUION.filter((c) => c.fuente === f);

describe("el guion del documento está completo", () => {
  it("no hay ids repetidos", () => {
    const ids = GUION.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cubre las tres fuentes", () => {
    for (const f of ["kb", "catalogo", "escalada"]) {
      expect(porFuente(f).length, `sin casos de tipo ${f}`).toBeGreaterThan(0);
    }
  });
});

describe("preguntas que contesta la base de conocimiento", () => {
  it.each(porFuente("kb"))("$id — $pregunta", (caso) => {
    const kb = KB.toLowerCase();
    for (const dato of caso.debeContener) {
      expect(kb, `falta "${dato}" para contestar "${caso.pregunta}"`).toContain(
        dato.toLowerCase(),
      );
    }
    for (const prohibido of caso.noDebeContener ?? []) {
      expect(kb).not.toContain(prohibido.toLowerCase());
    }
  });
});

describe("preguntas que contesta el catálogo, y SOLO el catálogo", () => {
  let env: { DB: unknown };

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    env = { DB: d1 };
    const repo = new CatalogRepo(new Db(d1 as never));
    for (const p of PRODUCTOS) {
      await repo.saveProduct({
        code: p.code,
        name: `${p.code} ${p.nombreContiene.join(" ")} ${p.porCaja ?? ""}`.trim(),
        costPrice: null,
        salePrice: p.precioCents,
        active: true,
        stock: SUCURSALES.map((branch) => ({ branch, stockQty: 10 })),
      });
    }
  });

  it("la talla M devuelve su precio y su cantidad por caja", async () => {
    const tool = catalogQueryTool(env as never);
    const r = (await (tool as never as { execute: Function }).execute({ query: "M" })) as {
      matches: Array<{ codigo: string; precio: string; nombre: string }>;
    };
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].codigo).toBe("NAT-M");
    expect(r.matches[0].precio).toBe("$50.00");
    expect(r.matches[0].nombre).toContain("144");
  });

  it("ese precio y esa cantidad NO están en la base de conocimiento", () => {
    // Si estuvieran, el bot podría contestar sin llamar la tool y quedarse con
    // una copia vieja el día que la dueña cambie el precio en el panel.
    for (const caso of porFuente("catalogo")) {
      for (const dato of caso.debeContener) {
        expect(
          KB.toLowerCase(),
          `"${dato}" está duplicado en el KB (le toca al catálogo)`,
        ).not.toContain(dato.toLowerCase());
      }
    }
  });
});

describe("preguntas que el bot NO contesta: pasan con una persona", () => {
  it.each(porFuente("escalada"))("$id — $pregunta", (caso) => {
    for (const dato of caso.debeContener) {
      expect(KB.toLowerCase(), `falta "${dato}" en las reglas de escalada`).toContain(
        dato.toLowerCase(),
      );
    }
  });

  it("ninguna escalada intenta resolverse con un dato del catálogo", () => {
    // "¿a qué cuenta deposito?" se escala; no se contesta con un número.
    expect(KB).toMatch(/número de cuenta no lo da el bot|piden un número de cuenta, pase/i);
  });
});

describe("la base de conocimiento no afirma qué hay disponible", () => {
  it("delega la existencia en el catálogo, que es quien la sabe", () => {
    // Un producto inactivo o sin stock no lo ve catalogQuery. Si el KB
    // asegurara que existe, el bot recibiría dos respuestas opuestas en el
    // mismo turno: el texto diciendo que sí y la tool diciendo que no.
    expect(KB).toMatch(/qué hay hoy lo\s+dice el catálogo/i);
    expect(KB).toMatch(/No confirme existencias desde\s+aquí/i);
  });

  it("no promete existencias con frases cerradas", () => {
    const promesas = [
      /tenemos todas las tallas disponibles/i,
      /siempre hay stock/i,
      /todas las tallas están disponibles/i,
    ];
    for (const p of promesas) expect(KB).not.toMatch(p);
  });
});
