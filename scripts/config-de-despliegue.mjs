/**
 * Arma la configuración con la que se despliega ESTE bot.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * `wrangler.toml` es la plantilla de Juancito Ads: lo mismo despliega el bot de
 * Baby Caleb que el de cualquier otro cliente. Pero Baby Caleb tiene un sistema
 * detrás —el Worker del panel administrativo— y los demás no.
 *
 * La conexión entre dos Workers se declara en la configuración, y la
 * documentación de Cloudflare es explícita: un Worker que declara una conexión
 * a otro que NO existe **no se despliega**. O sea que escribir esa conexión en
 * `wrangler.toml` rompería el despliegue de todos los demás bots.
 *
 * La salida obvia —un bloque `[env.babycaleb]`— tampoco sirve: en wrangler las
 * conexiones, las bases y las variables NO se heredan, así que habría que
 * volver a declararlas TODAS dentro del bloque. Una copia de la configuración
 * entera que se queda vieja el día que alguien toque la de arriba y se olvide
 * de la de abajo.
 *
 * LA SALIDA
 *
 * La plantilla se queda limpia y la conexión se declara en `member/`, que es la
 * carpeta de «lo de este negocio» y la que se respeta en cada actualización.
 * Si el archivo no está —el caso de casi todos los bots—, esto no hace
 * absolutamente nada y se despliega con el `wrangler.toml` de siempre.
 *
 * NO CAMBIA LO QUE EL BOT CONTESTA. Deja el cable puesto; el interruptor sigue
 * siendo `CATALOGO_FUENTE`, y mientras diga "d1" el bot lee su propia copia
 * exactamente como hoy.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PLANTILLA = "wrangler.toml";
const DECLARACION = "member/sistema.json";
/** El archivo que se genera. Va en .gitignore: es derivado, no fuente. */
const GENERADO = "wrangler.generado.toml";

/**
 * Qué nombres puede llevar: letras, números y guiones. Nada más.
 *
 * No es paranoia: lo que salga de aquí se pega dentro de un archivo de
 * configuración, y un nombre con una comilla o un salto de línea escribiría
 * claves que nadie puso. Se valida en vez de confiar, y si no cuadra se para
 * con el motivo en vez de desplegar algo raro.
 */
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Devuelve la ruta de la configuración a usar, y si añadió algo.
 *
 * @returns {{ config: string, conSistema: boolean, worker?: string }}
 */
export function configDeDespliegue() {
  if (!existsSync(DECLARACION)) {
    return { config: PLANTILLA, conSistema: false };
  }

  let dicho;
  try {
    dicho = JSON.parse(readFileSync(DECLARACION, "utf8"));
  } catch (e) {
    throw new Error(
      `${DECLARACION} no es un JSON válido (${e instanceof Error ? e.message : e}).\n` +
        "  Si este bot no tiene sistema detrás, borre el archivo y vuelva a desplegar.",
    );
  }

  const worker = String(dicho.worker ?? "");
  const entrypoint = String(dicho.entrypoint ?? "");
  const binding = String(dicho.binding ?? "SISTEMA");

  for (const [clave, valor] of [
    ["worker", worker],
    ["entrypoint", entrypoint],
    ["binding", binding],
  ]) {
    if (!NOMBRE.test(valor)) {
      throw new Error(
        `${DECLARACION}: «${clave}» tiene que ser un nombre simple (letras, números, - y _) y vino «${valor}».`,
      );
    }
  }

  const plantilla = readFileSync(PLANTILLA, "utf8");

  // Si alguien ya la escribió a mano en la plantilla, NO se duplica: dos
  // conexiones con el mismo nombre es un despliegue roto, y el mensaje de
  // wrangler no diría que vinieron de dos sitios distintos.
  if (new RegExp(`^\\s*binding\\s*=\\s*["']${binding}["']`, "m").test(plantilla)) {
    return { config: PLANTILLA, conSistema: true, worker };
  }

  const bloque = [
    "",
    "# ───────────────────────────────────────────────────────────────────────",
    `# AÑADIDO AL DESPLEGAR desde ${DECLARACION}. No edite este archivo:`,
    "# se regenera en cada despliegue y los cambios se pierden.",
    "# ───────────────────────────────────────────────────────────────────────",
    "[[services]]",
    `binding = "${binding}"`,
    `service = "${worker}"`,
    `entrypoint = "${entrypoint}"`,
    "",
  ].join("\n");

  writeFileSync(GENERADO, `${plantilla}${bloque}`);
  return { config: GENERADO, conSistema: true, worker };
}
