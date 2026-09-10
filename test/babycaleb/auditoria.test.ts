/**
 * El script de auditoría, en lo que se puede probar sin Cloudflare enfrente.
 *
 * Lo que se prueba no es la consulta —eso necesita una cuenta real— sino las
 * dos cosas que lo dejarían inservible justo el día que se use: que sepa
 * reconocer "no estás autenticado" para dar la instrucción útil en vez de un
 * volcado, y que sepa encontrar el JSON entre los avisos de colores de
 * wrangler. Un código de color ANSI empieza por ESC y un corchete, así que
 * buscar el JSON por el primer corchete agarraba ese y el parseo moría.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUENTE = readFileSync(resolve(ROOT, "scripts/auditar-verdad.ts"), "utf8");

/** El detector de "falta autenticación", copiado del script. */
const SIN_AUTH =
  /not authenticated|Please run .?wrangler login|CLOUDFLARE_API_TOKEN|non-interactive environment|Authentication error|\b10000\b/i;

/** El buscador de JSON, copiado del script. */
function extraer(stdout: string): unknown[] {
  const limpio = stdout.replace(/\u001b\[[0-9;]*m/g, "");
  for (let i = limpio.indexOf("["); i !== -1; i = limpio.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(limpio.slice(i));
      if (Array.isArray(parsed)) return (parsed[0] as { results?: unknown[] })?.results ?? [];
    } catch {
      /* ese corchete no era: se sigue buscando */
    }
  }
  return [];
}

describe("reconocer que falta autenticación", () => {
  it.each([
    // El mensaje real de wrangler 4.x sin terminal interactiva: es el que sale
    // en esta sesión remota y en GitHub Actions, y el que no reconocíamos.
    "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable",
    "You are not authenticated. Please run `wrangler login`.",
    "Authentication error [code: 10000]",
  ])("reconoce: %s", (mensaje) => {
    expect(SIN_AUTH.test(mensaje)).toBe(true);
  });

  it("no confunde un error de verdad con falta de credenciales", () => {
    expect(SIN_AUTH.test("no such table: catalog_items")).toBe(false);
    expect(SIN_AUTH.test('D1_ERROR: near "SELCT": syntax error')).toBe(false);
  });
});

describe("encontrar el JSON entre los avisos de wrangler", () => {
  const RESPUESTA = '[{"results":[{"code":"NAT-M","sale_price":5000}],"success":true}]';
  const FILA = [{ code: "NAT-M", sale_price: 5000 }];

  it("con códigos de color delante (el caso que rompía el parseo)", () => {
    const aviso = "\u001b[33m WARNING \u001b[0m Proxy environment variables detected";
    expect(extraer(aviso + "\n" + RESPUESTA)).toEqual(FILA);
  });

  it("con líneas de aviso en texto plano delante", () => {
    const aviso = "Cloudflare agent skills are available for: Claude Code.";
    expect(extraer(aviso + "\n" + RESPUESTA)).toEqual(FILA);
  });

  it("con un corchete suelto en un aviso antes del JSON", () => {
    expect(extraer("aviso [no es json] y sigue\n" + RESPUESTA)).toEqual(FILA);
  });

  it("una consulta sin filas devuelve lista vacía, no truena", () => {
    expect(extraer('[{"results":[],"success":true}]')).toEqual([]);
  });

  it("basura sin JSON tampoco truena", () => {
    expect(extraer("todo salió mal [y no hay json]")).toEqual([]);
  });
});

describe("el script no escribe nada", () => {
  it("solo hace SELECT: una auditoría que modifique la base no es una auditoría", () => {
    const comandos = [...FUENTE.matchAll(/consultar<[^>]*>\(\s*\n?\s*db,\s*\n?\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(comandos.length).toBeGreaterThan(0);
    for (const sql of comandos) {
      expect(sql.trim().toUpperCase().startsWith("SELECT"), "no es un SELECT: " + sql).toBe(true);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    }
  });

  it("wrangler se invoca en modo lectura, nunca con --file", () => {
    expect(FUENTE).not.toContain('"--file"');
  });
});
