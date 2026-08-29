#!/usr/bin/env node
/**
 * build-icons.mjs
 *
 * Genera `public/icons.svg` — un sprite con **solo** los iconos que el panel
 * usa de verdad.
 *
 * Por qué existe
 * -------------
 * El panel cargaba `https://unpkg.com/lucide@latest`: sin versión fija —un día
 * cambian el paquete y el panel cambia solo— y con la librería entera, 412 KB
 * (100 KB comprimidos), para dibujar unos cuarenta y cinco iconos. Además los
 * dibujaba con JavaScript después de cargar, así que en móvil primero se veían
 * los huecos.
 *
 * Cómo sabe qué iconos hacen falta
 * --------------------------------
 * Rastrea `src/` buscando los cuatro sitios donde se nombra un icono:
 * `data-lucide="…"`, `ico("…")`, `icon: "…"` y `navIcon: "…"`. Los dos últimos
 * pescan de más (hay campos `icon:` que no son iconos), así que se descarta
 * todo nombre que no exista en el paquete.
 *
 * Seis sitios escriben el nombre con una plantilla —`data-lucide="${n.icon}"`—
 * y ahí el rastreo no llega. Por eso los nombres que alimentan esas plantillas
 * salen igualmente de literales `icon:` en el propio `src/`, y por eso el
 * verificador de `pnpm icons:verify` abre las páginas y comprueba que ningún
 * `<use>` apunte a un símbolo que no está.
 *
 * El sprite se versiona: `wrangler deploy` sube `public/` sin construir nada.
 *
 * Uso:
 *   pnpm icons:build           regenera public/icons.svg
 *   pnpm icons:build --check   no escribe; sale con 1 si está desfasado
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const ICONS = path.join(ROOT, "node_modules", "lucide-static", "icons");
const OUT = path.join(ROOT, "public", "icons.svg");
const CHECK = process.argv.includes("--check");

/** Todos los .ts bajo src/. */
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Qué se considera un nombre de icono.
 *
 * La primera versión buscaba solo `data-lucide=`, `ico(`, `icon:` y `navIcon:`,
 * y se dejó tres fuera: hay mapas sueltos como
 * `const CHANNEL_ICON = { instagram: "camera", … }` cuya clave no es ninguna de
 * esas palabras. Un icono que falta no rompe la página — deja un hueco — así
 * que el fallo es silencioso, y ese es justo el que no queremos.
 *
 * Así que dentro de las carpetas que dibujan panel se acepta **cualquier
 * literal entre comillas** y se valida contra el paquete: si existe un icono
 * con ese nombre, entra. Sobran unos cuantos (una palabra como "send" o
 * "check" puede ser un texto y no un icono), pero cada símbolo de más son unos
 * 300 bytes y un icono de menos es un hueco en producción. En el resto de
 * `src/` se mantienen los patrones estrictos, porque ahí un literal suelto casi
 * nunca es un icono.
 */
const UI_DIRS = [path.join(SRC, "admin"), path.join(SRC, "niches")];
const STRICT = [
  /data-lucide="([a-z][a-z0-9-]*)"/g,
  /\bico\(\s*"([a-z][a-z0-9-]*)"/g,
  /\bicon:\s*"([a-z][a-z0-9-]*)"/g,
  /\bnavIcon:\s*"([a-z][a-z0-9-]*)"/g,
];
const LOOSE = [/"([a-z][a-z0-9]*(?:-[a-z0-9]+)*)"/g];

const wanted = new Set();
const rejected = new Set();
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf-8");
  const inUi = UI_DIRS.some((d) => file.startsWith(d + path.sep));
  for (const re of inUi ? [...STRICT, ...LOOSE] : STRICT) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (existsSync(path.join(ICONS, `${name}.svg`))) wanted.add(name);
      else if (re !== LOOSE[0]) rejected.add(name);
    }
  }
}

if (wanted.size === 0) {
  console.error("No se encontró ni un icono en src/. Algo va mal en el rastreo.");
  process.exit(1);
}

/** Extrae el contenido de un .svg de lucide-static, sin el <svg> de fuera. */
function symbolFor(name) {
  const raw = readFileSync(path.join(ICONS, `${name}.svg`), "utf-8");
  const open = raw.indexOf(">", raw.indexOf("<svg"));
  const close = raw.lastIndexOf("</svg>");
  const inner = raw
    .slice(open + 1, close)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("");
  return (
    `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`
  );
}

const names = [...wanted].sort();
const fresh =
  `<svg xmlns="http://www.w3.org/2000/svg">` +
  `<!-- Generado por scripts/build-icons.mjs desde lucide-static (ISC). No editar a mano. -->` +
  names.map(symbolFor).join("") +
  `</svg>\n`;

const current = existsSync(OUT) ? readFileSync(OUT, "utf-8") : "";
const kb = (fresh.length / 1024).toFixed(1);

if (CHECK) {
  if (fresh === current) {
    console.log(`public/icons.svg al día (${names.length} iconos, ${kb} KB)`);
    process.exit(0);
  }
  console.error("public/icons.svg está desfasado. Corre `pnpm icons:build` y commitea.");
  process.exit(1);
}

if (fresh === current) {
  console.log(`public/icons.svg sin cambios (${names.length} iconos, ${kb} KB)`);
} else {
  writeFileSync(OUT, fresh, "utf-8");
  console.log(`public/icons.svg escrito: ${names.length} iconos, ${kb} KB`);
}
if (rejected.size > 0) {
  console.log(`  (descartados por no existir en lucide: ${[...rejected].sort().join(", ")})`);
}
