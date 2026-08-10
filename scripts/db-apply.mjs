#!/usr/bin/env node
// Aplica el esquema a la D1 de ESTE bot.
//
// El nombre de la base NO puede ir fijo en package.json: el instalador estampa
// uno único por bot en wrangler.toml (panaclaw_<giro>_<uid>_db) para que dos
// bots en la misma cuenta de Cloudflare nunca compartan datos. Un nombre fijo
// aquí apuntaría a una base que no existe — o peor, a la de otro cliente.
//
//   node scripts/db-apply.mjs            → local
//   node scripts/db-apply.mjs --remote   → la D1 de verdad en Cloudflare
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TOML = "wrangler.toml";
const SCHEMA = "src/db/schema.sql";

if (!existsSync(TOML)) {
  console.error(`✗ No encontré ${TOML}. Corre esto dentro de la carpeta del bot.`);
  process.exit(1);
}

const toml = readFileSync(TOML, "utf8");

// El repo se publica como PLANTILLA, con marcadores {{...}} que el instalador
// resuelve. Solo {{BOT_SLUG}} es bloqueante: va en el nombre del worker y del
// bucket de R2, y un bucket con llaves no pasa la validación de wrangler —
// tumba el comando entero con un error que no dice nada útil.
if (toml.includes("{{BOT_SLUG}}")) {
  console.error(`✗ ${TOML} todavía es la plantilla sin configurar.`);
  console.error("");
  console.error("  Opción A (recomendada) — el instalador lo rellena solo:");
  console.error("      node cli/bin/cli.js init");
  console.error("");
  console.error(`  Opción B (manual) — reemplaza {{BOT_SLUG}} en ${TOML} por el nombre`);
  console.error("  de tu bot (minúsculas y guiones) y vuelve a correr esto.");
  process.exit(1);
}

// El resto son etiquetas ({{BOT_NAME}}, {{BUSINESS_NAME}}…): el esquema se
// aplica igual, pero conviene avisar para que no lleguen así al deploy.
const pending = [...new Set(toml.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
if (pending.length) {
  console.warn(`⚠ Sin rellenar todavía en ${TOML}: ${pending.join(", ")}`);
  console.warn("  Se aplica el esquema igual; complétalos antes de desplegar.\n");
}

const match = toml.match(/^\s*database_name\s*=\s*["']([^"']+)["']/m);
if (!match) {
  console.error(`✗ No encontré 'database_name' en ${TOML}.`);
  process.exit(1);
}
const dbName = match[1];

const remote = process.argv.includes("--remote");
const args = ["d1", "execute", dbName, `--file=${SCHEMA}`, ...(remote ? ["--remote"] : ["--local"])];

console.log(`→ wrangler ${args.join(" ")}`);
const res = spawnSync("wrangler", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(res.status ?? 1);
