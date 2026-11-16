import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, rmSync, renameSync } from "node:fs";

import { configDeDespliegue } from "../scripts/config-de-despliegue.mjs";

/**
 * La configuración con la que se despliega ESTE bot.
 *
 * Por qué existe el guion que esto vigila: `wrangler.toml` es la plantilla de
 * Juancito Ads y la mayoría de los bots que salen de ella no tienen un sistema
 * detrás. La documentación de Cloudflare dice que un Worker que declara una
 * conexión a otro que NO existe no se despliega, así que escribirla en la
 * plantilla rompería el despliegue de todos los demás.
 *
 * Lo que se vigila aquí es lo que cuesta caro si falla: que sin el archivo no
 * pase nada (la plantilla sigue sirviendo), que con él quede la conexión bien
 * escrita, y que un nombre raro se pare en vez de escribirse dentro de un
 * archivo de configuración.
 */

const DECLARACION = "member/sistema.json";
const GENERADO = "wrangler.generado.toml";
const GUARDADO = "member/sistema.json.guardado-por-la-prueba";

function sinDeclaracion<T>(hacer: () => T): T {
  const habia = existsSync(DECLARACION);
  if (habia) renameSync(DECLARACION, GUARDADO);
  try {
    return hacer();
  } finally {
    if (habia) renameSync(GUARDADO, DECLARACION);
  }
}

function conDeclaracion<T>(valor: unknown, hacer: () => T): T {
  const habia = existsSync(DECLARACION);
  const antes = habia ? readFileSync(DECLARACION, "utf8") : null;
  writeFileSync(DECLARACION, typeof valor === "string" ? valor : JSON.stringify(valor));
  try {
    return hacer();
  } finally {
    if (antes === null) rmSync(DECLARACION, { force: true });
    else writeFileSync(DECLARACION, antes);
  }
}

afterEach(() => {
  rmSync(GENERADO, { force: true });
});

describe("la configuración del despliegue", () => {
  it("SIN el archivo no hace nada: la plantilla se despliega como siempre", () => {
    // Este es el caso de casi todos los bots de Juancito Ads, y el que no se
    // puede romper: aquí no debe aparecer ninguna conexión a ningún sistema.
    const r = sinDeclaracion(() => configDeDespliegue());
    expect(r.config).toBe("wrangler.toml");
    expect(r.conSistema).toBe(false);
    expect(existsSync(GENERADO)).toBe(false);
  });

  it("CON el archivo deja la conexión escrita, y la plantilla intacta", () => {
    const plantillaAntes = readFileSync("wrangler.toml", "utf8");
    const r = conDeclaracion(
      { worker: "babycaleb-sistema", entrypoint: "SistemaCRM", binding: "SISTEMA" },
      () => configDeDespliegue(),
    );

    expect(r.config).toBe(GENERADO);
    expect(r.conSistema).toBe(true);
    const generado = readFileSync(GENERADO, "utf8");
    expect(generado).toContain("[[services]]");
    expect(generado).toContain('binding = "SISTEMA"');
    expect(generado).toContain('service = "babycaleb-sistema"');
    expect(generado).toContain('entrypoint = "SistemaCRM"');
    // Y lo que ya había sigue entero: esto AÑADE, no reescribe.
    expect(generado.startsWith(plantillaAntes)).toBe(true);
    // La plantilla no se toca: es la que despliega a los demás.
    expect(readFileSync("wrangler.toml", "utf8")).toBe(plantillaAntes);
  });

  it("no duplica la conexión si alguien ya la escribió a mano", () => {
    // Dos conexiones con el mismo nombre es un despliegue roto, y el error de
    // wrangler no diría que vinieron de dos sitios distintos.
    const plantilla = readFileSync("wrangler.toml", "utf8");
    const conBinding = `${plantilla}\n[[services]]\nbinding = "SISTEMA"\nservice = "otro"\n`;
    writeFileSync("wrangler.toml", conBinding);
    try {
      const r = conDeclaracion({ worker: "babycaleb-sistema", entrypoint: "SistemaCRM" }, () =>
        configDeDespliegue(),
      );
      expect(r.config).toBe("wrangler.toml");
      expect(existsSync(GENERADO)).toBe(false);
    } finally {
      writeFileSync("wrangler.toml", plantilla);
    }
  });

  it("un nombre raro se para, en vez de escribirse dentro del archivo", () => {
    // Lo que salga de aquí se pega en un archivo de configuración: un nombre
    // con una comilla o un salto de línea escribiría claves que nadie puso.
    for (const malo of ['otro"\nname = "robado', "con espacio", "", "../otro"]) {
      expect(() =>
        conDeclaracion({ worker: malo, entrypoint: "SistemaCRM" }, () => configDeDespliegue()),
      ).toThrow(/nombre simple/);
    }
  });

  it("un JSON roto dice qué hacer, no solo que falló", () => {
    expect(() => conDeclaracion("{esto no es json", () => configDeDespliegue())).toThrow(
      /borre el archivo/i,
    );
  });

  it("el archivo de verdad de este negocio es válido y apunta al sistema", () => {
    // El contrapeso: sin esto, las pruebas de arriba pasarían igual con un
    // member/sistema.json roto o ausente en el repositorio (trampa §6 del
    // repo del sistema: comprobar que no sale algo que no existe).
    expect(existsSync(DECLARACION)).toBe(true);
    const r = configDeDespliegue();
    expect(r.conSistema).toBe(true);
    expect(r.worker).toBe("babycaleb-sistema");
  });
});
