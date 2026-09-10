#!/usr/bin/env tsx
/**
 * Audita la D1 EN VIVO contra la verdad del repo. Solo lee, nunca escribe.
 *
 * Existe porque los tests de test/babycaleb/ vigilan los archivos del repo, y
 * los archivos del repo no son lo que el bot lee: el bot lee D1. Entre los dos
 * hay un paso manual —aplicar el .sql, guardar en el panel— y todo lo que
 * depende de que alguien se acuerde, algún día no se hace.
 *
 * Contesta tres preguntas, en orden de qué tan callado es el daño:
 *
 *   1. ¿Hay algo en `settings` que le esté ganando al catálogo? Un
 *      system_prompt_override anula el bloque <fuentes_de_verdad> entero; un
 *      business_context viejo mete precios en el prompt de cada turno.
 *   2. ¿Los precios de `catalog_items` son los del documento de la dueña?
 *   3. ¿Hay documentos escritos desde /admin/kb que compitan con member/kb/?
 *      Esos no están en git: nadie los revisa y nadie ve el diff.
 *
 *   pnpm auditar
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTOS, DESCATALOGADOS, AJUSTES } from "../test/babycaleb/verdad-del-cliente";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ok = (s: string) => console.log(`  ✓ ${s}`);
const mal = (s: string) => console.log(`  ✗ ${s}`);
const ojo = (s: string) => console.log(`  ⚠ ${s}`);

let problemas = 0;
let avisos = 0;

function nombreDeLaBase(): string {
  const toml = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");
  const m = toml.match(/^\s*database_name\s*=\s*["']([^"']+)["']/m);
  if (!m) {
    console.error("✗ No encontré 'database_name' en wrangler.toml.");
    process.exit(1);
  }
  return m[1];
}

/** Corre una consulta contra la D1 remota y devuelve las filas. */
function consultar<T>(db: string, sql: string): T[] {
  const r = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  // Los avisos de wrangler llevan códigos de color ANSI, y un código ANSI
  // EMPIEZA por "\x1b[". Buscar el JSON con indexOf("[") agarraba ese corchete
  // y el parseo moría. Se limpian antes de mirar nada.
  const limpiar = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, "");
  const stdout = limpiar(r.stdout ?? "");
  const salida = `${stdout}\n${limpiar(r.stderr ?? "")}`;

  if (r.status !== 0) {
    if (
      /not authenticated|Please run .?wrangler login|CLOUDFLARE_API_TOKEN|non-interactive environment|Authentication error|\b10000\b/i.test(
        salida,
      )
    ) {
      console.error("");
      console.error("✗ Wrangler no está autenticado contra Cloudflare.");
      console.error("");
      console.error("  Opción A — token de API (funciona sin navegador, ideal para");
      console.error("  sesiones remotas). Cree uno en:");
      console.error("      https://dash.cloudflare.com/profile/api-tokens");
      console.error("  con permisos de cuenta: D1:Edit · Workers Scripts:Edit ·");
      console.error("  Vectorize:Edit · Account Settings:Read. Luego expórtelo:");
      console.error("      export CLOUDFLARE_API_TOKEN=...");
      console.error("      export CLOUDFLARE_ACCOUNT_ID=...");
      console.error("");
      console.error("  Opción B — en su computadora, con navegador: wrangler login");
      console.error("");
      console.error("  NO pegue el token en el chat. Va como variable de entorno.");
      process.exit(2);
    }
    console.error(`✗ La consulta falló:\n${salida.trim().slice(0, 800)}`);
    process.exit(1);
  }

  // wrangler mezcla avisos con el JSON. Se prueba cada corchete de apertura
  // hasta que uno parsee: más terco que adivinar dónde empieza, y no se rompe
  // si mañana wrangler agrega otra línea de aviso.
  for (let i = stdout.indexOf("["); i !== -1; i = stdout.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(stdout.slice(i));
      if (Array.isArray(parsed)) return (parsed[0]?.results ?? []) as T[];
    } catch {
      /* ese corchete no era: se sigue buscando */
    }
  }
  console.error(`✗ No pude interpretar la respuesta de wrangler:\n${stdout.slice(0, 800)}`);
  process.exit(1);
}

const db = nombreDeLaBase();
console.log(`\nAuditoría de la verdad — base "${db}" (solo lectura)\n`);

// ── 1. settings: lo que se inyecta en el prompt de cada turno ──────────────
console.log("1 · Ajustes que le pueden ganar al catálogo");
const settings = Object.fromEntries(
  consultar<{ key: string; value: string }>(db, "SELECT key, value FROM settings").map((r) => [
    r.key,
    r.value ?? "",
  ]),
);

const override = (settings["system_prompt_override"] ?? "").trim();
if (override) {
  mal(
    "Hay un system_prompt_override guardado: REEMPLAZA el prompt entero, incluido\n" +
      "    el bloque <fuentes_de_verdad> que obliga a consultar el catálogo. Bórrelo\n" +
      "    desde /admin (pestaña Agente) salvo que sepa exactamente por qué está ahí.",
  );
  problemas++;
} else ok("Sin system_prompt_override: el bot usa el prompt generado, con sus fuentes de verdad.");

const contexto = (settings["business_context"] ?? "").trim();
if (!contexto) {
  ok("business_context vacío: cae al del repo (member/config.local.ts), que es el bueno.");
} else {
  const precios = PRODUCTOS.map((p) => `$${(p.precioCents / 100).toFixed(0)}`).filter((p) =>
    contexto.includes(p),
  );
  if (precios.length) {
    mal(
      `El business_context guardado en D1 trae precios de producto (${precios.join(", ")}).\n` +
        "    Eso va al prompt en cada turno y le gana al catálogo en silencio. Quítelos\n" +
        "    desde /admin (pestaña Config).",
    );
    problemas++;
  } else if (/Monterrey|Mi Negocio Ejemplo|minegocio/.test(contexto)) {
    mal(
      "El business_context guardado es el de la PLANTILLA (la barbería de ejemplo).\n" +
        "    Bórrelo desde /admin → Config para que caiga al del repo.",
    );
    problemas++;
  } else ok("business_context propio, sin precios de producto dentro.");
}

const apagadas = (settings["disabled_tools"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
for (const t of ["catalogQuery", "searchKb", "handoffHuman"]) {
  if (apagadas.includes(t)) {
    mal(`La tool ${t} está APAGADA desde el panel. El bot se queda sin esa fuente.`);
    problemas++;
  }
}
if (!apagadas.some((t) => ["catalogQuery", "searchKb", "handoffHuman"].includes(t)))
  ok("Las tres tools que importan están encendidas.");

const keywords = (settings["escalation_keywords"] ?? "").toLowerCase();
const sobran = AJUSTES.noEscalan.filter((k) => keywords.includes(k.toLowerCase()));
const faltan = AJUSTES.escalan.filter((k) => !keywords.includes(k.toLowerCase()));
if (sobran.length) {
  mal(
    `escalation_keywords manda a escalar cosas que el documento SÍ contesta: ${sobran.join(", ")}.\n` +
      "    Cada una es una conversación que el bot pasa a una persona sin necesidad.",
  );
  problemas++;
}
if (faltan.length) {
  mal(
    `escalation_keywords no cubre disparadores del documento: ${faltan.join(", ")}.\n` +
      "    Los de pago y comprobante son la primera categoría de su lista de escaladas.",
  );
  problemas++;
}
if (!sobran.length && !faltan.length) ok("escalation_keywords coincide con las escaladas del documento.");

const tono = (settings["tone"] ?? "").trim();
if (tono !== AJUSTES.tono) {
  ojo(`El tono dice "${tono}" y el documento pide "${AJUSTES.tono}".`);
  avisos++;
} else ok("El tono es el del documento, con el trato de usted dentro.");

if ((settings["bot_paused"] ?? "") === "1") {
  ojo("El bot está EN PAUSA desde el panel: no está contestando a nadie.");
  avisos++;
}

try {
  const lecciones = JSON.parse(settings["learned_lessons"] ?? "[]") as string[];
  const conPrecio = lecciones.filter((l) => /\$\s?\d/.test(l));
  if (conPrecio.length) {
    ojo(
      `El flywheel aprendió ${conPrecio.length} lección(es) con cifras de dinero dentro.\n` +
        "    Van al prompt en cada turno y no se actualizan cuando cambie el catálogo.\n" +
        `    Revíselas: ${conPrecio.map((l) => `"${l.slice(0, 70)}…"`).join(" · ")}`,
    );
    avisos++;
  } else if (lecciones.length) ok(`${lecciones.length} lección(es) aprendidas, ninguna con precios.`);
} catch {
  ojo("learned_lessons no es un JSON válido; el cargador lo ignora en silencio.");
  avisos++;
}

// ── 2. catalog_items contra el documento de la dueña ──────────────────────
console.log("\n2 · El catálogo en vivo contra el documento de la dueña");
interface FilaCat {
  code: string;
  name: string;
  sale_price: number;
  activos: number;
  stock: number;
}
const enVivo = consultar<FilaCat>(
  db,
  "SELECT code, MIN(name) AS name, MIN(sale_price) AS sale_price, MAX(active) AS activos," +
    " SUM(stock_qty) AS stock FROM catalog_items GROUP BY code ORDER BY code",
);

if (enVivo.length === 0) {
  mal("El catálogo está VACÍO. Aplique src/db/verdad-2026-09.sql y cargue el stock.");
  problemas++;
}

const porCodigo = new Map(enVivo.map((f) => [f.code, f]));
for (const p of PRODUCTOS) {
  const fila = porCodigo.get(p.code);
  if (!fila) {
    mal(`${p.code}: no existe en la base. Falta aplicar src/db/verdad-2026-09.sql.`);
    problemas++;
    continue;
  }
  if (fila.sale_price !== p.precioCents) {
    mal(
      `${p.code}: la base dice $${(fila.sale_price / 100).toFixed(2)} y el documento dice ` +
        `$${(p.precioCents / 100).toFixed(2)}.`,
    );
    problemas++;
  } else if (fila.activos !== 1) {
    ojo(`${p.code}: precio correcto, pero está INACTIVO — el bot no lo ve ni lo ofrece.`);
    avisos++;
  } else if (fila.stock === 0) {
    ojo(`${p.code}: activo con stock en cero — el bot lo ofrece como agotado.`);
    avisos++;
  } else ok(`${p.code}: $${(fila.sale_price / 100).toFixed(2)}, activo, con existencias.`);
}

for (const code of DESCATALOGADOS) {
  if (porCodigo.has(code)) {
    mal(`${code} sigue en la base y el documento lo sacó de circulación.`);
    problemas++;
  }
}
const intrusos = enVivo.filter((f) => !PRODUCTOS.some((p) => p.code === f.code));
for (const f of intrusos) {
  ojo(`${f.code} ("${f.name}") está en la base y no en el documento. ¿Producto nuevo sin registrar?`);
  avisos++;
}

// ── 2b. Borradores del flywheel esperando aprobación ──────────────────────
console.log("\n2b · Sugerencias pendientes en la pestaña Mejoras");
const sugerencias = consultar<{ id: string; title: string; payload: string }>(
  db,
  "SELECT id, title, payload FROM improvement_suggestions WHERE status = 'proposed'",
);
const envenenadas = sugerencias.filter((s) =>
  /barber[íi]a|Monterrey|81 1234 5678|COMPLETA AQU[ÍI]|Av\. Constituci[óo]n/i.test(s.payload),
);
if (envenenadas.length) {
  mal(
    `${envenenadas.length} sugerencia(s) pendientes arrastran el negocio de EJEMPLO de la\n` +
      "    plantilla (la barbería de Monterrey) o traen un [COMPLETA AQUÍ] sin rellenar.\n" +
      "    Están a un clic de entrar a la base de conocimiento desde /admin/mejoras.\n" +
      `    ${envenenadas.map((s) => `"${s.title}"`).join(" · ")}`,
  );
  problemas++;
} else if (sugerencias.length) {
  ojo(`${sugerencias.length} sugerencia(s) pendientes de revisar, ninguna con rastro de la plantilla.`);
  avisos++;
} else ok("Ninguna sugerencia pendiente.");

const factosConPrecio = consultar<{ n: number }>(
  db,
  "SELECT COUNT(*) AS n FROM customer_facts WHERE fact LIKE '%$%'",
);
if ((factosConPrecio[0]?.n ?? 0) > 0) {
  mal(
    `${factosConPrecio[0].n} dato(s) recordados de clientes llevan un precio dentro. Se inyectan\n` +
      "    en la conversación como bloque <cliente> y no se actualizan cuando cambie el catálogo.",
  );
  problemas++;
} else ok("Ningún dato recordado de cliente lleva precios congelados.");

// ── 3. kb_docs del panel contra member/kb/ ────────────────────────────────
console.log("\n3 · Documentos de conocimiento escritos desde el panel");
const docs = consultar<{ id: string; title: string; n: number }>(
  db,
  "SELECT id, title, length(content) AS n FROM kb_docs ORDER BY title",
);
if (docs.length === 0) {
  ok("Ninguno: toda la base de conocimiento viene de member/kb/, que sí está en git.");
} else {
  ojo(
    `Hay ${docs.length} documento(s) escritos desde /admin/kb. No están en git: nadie los\n` +
      "    revisa, nadie ve el diff, y conviven con los de member/kb/ en el mismo índice.\n" +
      "    Si dicen algo permanente, múdelo a member/kb/ y bórrelo del panel.",
  );
  avisos++;
  for (const d of docs) console.log(`      · "${d.title}" (${d.n} caracteres, id ${d.id})`);
}

// ── Cierre ────────────────────────────────────────────────────────────────
console.log("");
if (problemas === 0 && avisos === 0) {
  console.log("✅ La base en vivo dice exactamente lo que dice el documento de la dueña.\n");
} else {
  console.log(`${problemas} problema(s) · ${avisos} aviso(s).`);
  console.log("   Los problemas hacen que el bot diga algo falso. Los avisos, que se calle.\n");
}
process.exit(problemas > 0 ? 1 : 0);
