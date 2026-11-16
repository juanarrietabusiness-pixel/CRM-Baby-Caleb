#!/usr/bin/env tsx
/**
 * EL ENSAYO DEL CAMBIO. Solo lee, nunca escribe, y no toca al bot.
 *
 * Contesta UNA pregunta: **¿qué le diría distinto el bot a una clienta en el
 * instante en que `CATALOGO_FUENTE` pase de "d1" a "sistema"?**
 *
 * POR QUÉ EXISTE
 *
 * El CRM está atendiendo volumen real. El día que se conecte al sistema, el
 * catálogo del bot cambia de base de un deploy para otro: lo que antes sabía
 * lo sabe de otro sitio. Si ese otro sitio no dice exactamente lo mismo, la
 * clienta lo nota a mitad de una conversación — un precio distinto, o un
 * «no tenemos eso» sobre algo que sí se vende.
 *
 * Eso no se puede descubrir el día del cambio. Se descubre antes, aquí.
 *
 * Es el chequeo previo al vuelo: **mientras esto no salga limpio, no se gira
 * el interruptor.** Y se vuelve a correr la mañana del cambio, porque la
 * respuesta caduca: cualquiera de las dos bases pudo moverse.
 *
 * QUÉ MIRA, EN ORDEN DE QUÉ TAN CARO ES EL DAÑO
 *
 *   1. Lo que el bot DEJARÍA de conocer. Es lo peor: le diría a una clienta
 *      que algo no existe cuando está en la bodega y se vende hoy.
 *   2. Los precios que cambiarían. La clienta oye otra cifra.
 *   3. Lo que el bot EMPEZARÍA a ofrecer. No es un daño, pero es una sorpresa
 *      y hay que haberla decidido.
 *   4. Las existencias que no cuadran. Cambia el «hay / no hay».
 *   5. Las bodegas, que en el CRM son una lista escrita a mano.
 *
 * NO compara contra el documento de la dueña: eso ya lo hace `pnpm auditar`,
 * y son dos preguntas distintas. Aquella es «¿la base dice lo que la dueña
 * dijo?»; esta es «¿las dos bases dicen lo mismo entre sí?».
 *
 *   pnpm ensayo
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUCURSALES } from "../src/catalog/validation";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * La base del sistema.
 *
 * Por variable de entorno con un valor por omisión, y no escrita a secas: el
 * nombre lo declara `sistema/wrangler.jsonc` en el OTRO repositorio, así que
 * aquí no hay forma de leerlo. Ponerlo fijo sería una lista que alguien tiene
 * que acordarse de tocar (trampa §8); con la variable, el día que cambie se
 * arregla sin tocar código y el valor por omisión sigue sirviendo hoy.
 */
const DB_SISTEMA = process.env.SISTEMA_DB ?? "babycaleb-db";

const ok = (s: string) => console.log(`  ✓ ${s}`);
const mal = (s: string) => console.log(`  ✗ ${s}`);
const ojo = (s: string) => console.log(`  ⚠ ${s}`);

let problemas = 0;
let avisos = 0;

function nombreDeLaBaseDelCrm(): string {
  const toml = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");
  const m = toml.match(/^\s*database_name\s*=\s*["']([^"']+)["']/m);
  if (!m) {
    console.error("✗ No encontré 'database_name' en wrangler.toml.");
    process.exit(1);
  }
  return m[1] as string;
}

function consultar<T>(db: string, sql: string): T[] {
  const r = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
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
      console.error("  Es el mismo requisito que `pnpm auditar`: exporte");
      console.error("  CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID, o corra");
      console.error("  `wrangler login` en su computadora.");
      console.error("");
      console.error("  NO pegue el token en el chat. Va como variable de entorno.");
      process.exit(2);
    }
    // Un fallo contra la base del SISTEMA se nombra aparte: lo más probable es
    // que el nombre no sea ese, y decir «la consulta falló» mandaría a buscar
    // al sitio equivocado.
    if (db === DB_SISTEMA && /not found|no database|8000007/i.test(salida)) {
      console.error(`✗ No encontré la base del sistema («${db}»).`);
      console.error("  Si se llama de otra forma: SISTEMA_DB=<nombre> pnpm ensayo");
      process.exit(1);
    }
    console.error(`✗ La consulta a «${db}» falló:\n${salida.trim().slice(0, 800)}`);
    process.exit(1);
  }

  for (let i = stdout.indexOf("["); i !== -1; i = stdout.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(stdout.slice(i));
      if (Array.isArray(parsed)) return (parsed[0]?.results ?? []) as T[];
    } catch {
      /* ese corchete no era */
    }
  }
  console.error(`✗ No pude interpretar la respuesta de wrangler:\n${stdout.slice(0, 800)}`);
  process.exit(1);
}

const dinero = (c: number) => `$${(c / 100).toFixed(2)}`;

// ── Lo que sabe cada lado ────────────────────────────────────────────────
interface FilaCrm {
  code: string;
  sale_price: number;
  stock: number;
  activos: number;
}
interface FilaSistema {
  codigo: string;
  precio_cents: number;
  fisico: number;
  publicado: number;
  activo: number;
}

const DB_CRM = nombreDeLaBaseDelCrm();

console.log("");
console.log(`Ensayo del cambio · CRM «${DB_CRM}» contra sistema «${DB_SISTEMA}»`);
console.log("");

/**
 * El CRM guarda UNA FILA POR BODEGA, así que un artículo aparece varias veces.
 * Se suma el stock y se toma el precio, que es el mismo en todas — si no lo
 * fuera, eso ya sería un problema del CRM y lo caza `pnpm auditar`.
 *
 * Solo lo ACTIVO: lo desactivado el bot ya no lo ofrece, así que no cambia
 * nada para la clienta.
 */
const delCrm = consultar<FilaCrm>(
  DB_CRM,
  `SELECT code, MAX(sale_price) AS sale_price, SUM(stock_qty) AS stock,
          SUM(active) AS activos
     FROM catalog_items GROUP BY code HAVING activos > 0 ORDER BY code`,
);

/**
 * Del sistema, lo que el bot podría ver: publicado y activo. Un artículo que
 * el sistema tiene sin publicar NO lo va a ofrecer, así que para esta
 * comparación es como si no existiera.
 */
const delSistema = consultar<FilaSistema>(
  DB_SISTEMA,
  `SELECT v.codigo, v.precio_cents, v.publicado, v.activo,
          COALESCE((SELECT SUM(e.fisico) FROM existencias e WHERE e.codigo = v.codigo), 0) AS fisico
     FROM variantes v
     JOIN productos p ON p.id = v.producto_id
    WHERE v.activo = 1 AND v.publicado = 1 AND p.activo = 1
    ORDER BY v.codigo`,
);

const porCodigoCrm = new Map(delCrm.map((f) => [f.code, f]));
const porCodigoSis = new Map(delSistema.map((f) => [f.codigo, f]));

console.log(`  El bot conoce hoy ${delCrm.length} artículo(s); el sistema publica ${delSistema.length}.`);
console.log("");

// ── 1 · Lo que el bot DEJARÍA de conocer ─────────────────────────────────
const sePierden = delCrm.filter((f) => !porCodigoSis.has(f.code));
if (sePierden.length === 0) {
  ok("No se pierde ningún artículo: el sistema publica todo lo que el bot ofrece.");
} else {
  mal(
    `El bot DEJARÍA de conocer ${sePierden.length} artículo(s). A una clienta que los\n` +
      "    pregunte le diría que no existen:",
  );
  for (const f of sePierden) {
    console.log(`      · ${f.code} — ${dinero(f.sale_price)}, ${f.stock} en bodega`);
  }
  problemas++;
}

// ── 2 · Los precios que cambiarían ───────────────────────────────────────
const precios = delCrm
  .map((f) => ({ f, s: porCodigoSis.get(f.code) }))
  .filter((x) => x.s !== undefined && x.s.precio_cents !== x.f.sale_price);
if (precios.length === 0) {
  ok("Ningún precio cambia.");
} else {
  mal(`${precios.length} precio(s) cambiarían de un deploy para otro:`);
  for (const { f, s } of precios) {
    console.log(`      · ${f.code} — el bot dice ${dinero(f.sale_price)} y diría ${dinero(s!.precio_cents)}`);
  }
  problemas++;
}

// ── 3 · Lo que el bot EMPEZARÍA a ofrecer ────────────────────────────────
const aparecen = delSistema.filter((f) => !porCodigoCrm.has(f.codigo));
if (aparecen.length === 0) {
  ok("No aparece ningún artículo nuevo.");
} else {
  ojo(`El bot EMPEZARÍA a ofrecer ${aparecen.length} artículo(s). No es un daño, pero decídalo:`);
  for (const f of aparecen) console.log(`      · ${f.codigo} — ${dinero(f.precio_cents)}`);
  avisos++;
}

// ── 4 · El «hay / no hay» ────────────────────────────────────────────────
const existencias = delCrm
  .map((f) => ({ f, s: porCodigoSis.get(f.code) }))
  .filter((x) => x.s !== undefined && (x.f.stock > 0) !== (x.s.fisico > 0));
if (existencias.length === 0) {
  ok("El «hay / no hay» coincide en todo.");
} else {
  mal(`${existencias.length} artículo(s) cambiarían de disponible a agotado o al revés:`);
  for (const { f, s } of existencias) {
    const antes = f.stock > 0 ? `hay (${f.stock})` : "agotado";
    const despues = s!.fisico > 0 ? `hay (${s!.fisico})` : "agotado";
    console.log(`      · ${f.code} — el bot dice «${antes}» y diría «${despues}»`);
  }
  problemas++;
}

// ── 5 · Las bodegas ──────────────────────────────────────────────────────
const bodegas = consultar<{ nombre: string }>(
  DB_SISTEMA,
  "SELECT nombre FROM bodegas WHERE activa = 1 ORDER BY nombre",
);
const enSistema = new Set(bodegas.map((b) => b.nombre));
const faltan = SUCURSALES.filter((s) => !enSistema.has(s));
const sobran = bodegas.map((b) => b.nombre).filter((n) => !SUCURSALES.includes(n as never));
if (faltan.length === 0 && sobran.length === 0) {
  ok(`Las ${bodegas.length} bodegas coinciden con la lista del CRM.`);
} else {
  ojo("Las bodegas del CRM están escritas a mano en src/catalog/validation.ts y no coinciden:");
  for (const n of faltan) console.log(`      · «${n}» está en el CRM y no en el sistema`);
  for (const n of sobran) console.log(`      · «${n}» está en el sistema y no en el CRM`);
  avisos++;
}

// ── Cierre ───────────────────────────────────────────────────────────────
console.log("");
if (problemas === 0 && avisos === 0) {
  console.log("✅ El cambio sería INVISIBLE para las clientas. Se puede girar el interruptor.\n");
} else if (problemas === 0) {
  console.log(`⚠ ${avisos} aviso(s). Nada se rompe, pero hay sorpresas que conviene decidir antes.\n`);
} else {
  console.log(`✗ ${problemas} problema(s) · ${avisos} aviso(s).`);
  console.log("   MIENTRAS HAYA PROBLEMAS, NO SE GIRA EL INTERRUPTOR: una clienta lo notaría");
  console.log("   a mitad de una conversación.\n");
}
process.exit(problemas > 0 ? 1 : 0);
