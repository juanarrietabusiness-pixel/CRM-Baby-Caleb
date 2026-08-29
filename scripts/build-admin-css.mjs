#!/usr/bin/env node
/**
 * build-admin-css.mjs
 *
 * Genera `public/admin.css` — la hoja de estilos del panel — corriendo el CLI
 * oficial de Tailwind sobre `tailwind.config.cjs`.
 *
 * Por qué existe
 * -------------
 * El panel cargaba `https://cdn.tailwindcss.com`, que no es una hoja de
 * estilos: es el compilador de Tailwind corriendo en el navegador. Entraba en
 * el `<head>` sin `defer`, así que bloqueaba el primer pintado, y encima tenía
 * que recorrer el HTML y generar el CSS en el dispositivo, en cada carga. En un
 * escritorio no se nota; en un teléfono de gama media con datos móviles, sí.
 *
 * El resultado se **versiona en el repo** a propósito: `wrangler deploy` sube
 * `public/` tal cual, sin pasos de construcción. Si el CSS no estuviera
 * commiteado, un despliegue desde una máquina sin dependencias instaladas —o
 * desde el workflow de GitHub— publicaría el panel sin estilos.
 *
 * Por eso `predeploy` lo regenera y `--check` existe: en CI, falla si el
 * archivo commiteado no coincide con lo que produce el código actual.
 *
 * Uso:
 *   pnpm css:build          regenera public/admin.css
 *   pnpm css:build --check   no escribe; sale con código 1 si está desfasado
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "admin.css");
const CHECK = process.argv.includes("--check");

const tmp = mkdtempSync(path.join(tmpdir(), "admincss-"));
const staged = path.join(tmp, "admin.css");

try {
  execFileSync(
    "npx",
    [
      "tailwindcss",
      "-c", path.join(ROOT, "tailwind.config.cjs"),
      "-i", path.join(ROOT, "scripts", "admin-css-input.css"),
      "-o", staged,
      "--minify",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (err) {
  console.error("No se pudo generar el CSS del panel.");
  console.error(err.stderr?.toString() ?? err.message);
  process.exit(1);
}

const fresh = readFileSync(staged, "utf-8");
rmSync(tmp, { recursive: true, force: true });

const current = existsSync(OUT) ? readFileSync(OUT, "utf-8") : "";

if (CHECK) {
  if (fresh === current) {
    console.log(`public/admin.css al día (${(fresh.length / 1024).toFixed(1)} KB)`);
    process.exit(0);
  }
  console.error(
    "public/admin.css está desfasado respecto al código.\n" +
      "Corre `pnpm css:build` y commitea el resultado.",
  );
  process.exit(1);
}

if (fresh === current) {
  console.log(`public/admin.css sin cambios (${(fresh.length / 1024).toFixed(1)} KB)`);
} else {
  writeFileSync(OUT, fresh, "utf-8");
  const delta = current ? ` (antes ${(current.length / 1024).toFixed(1)} KB)` : "";
  console.log(`public/admin.css escrito: ${(fresh.length / 1024).toFixed(1)} KB${delta}`);
}
