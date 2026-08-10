#!/usr/bin/env node
// juancitoads — instala y actualiza bots de IA con CRM en TU propia infra, en un
// comando. Baja el código desde el repo público en GitHub y lo deja listo para
// que tu agente lo despliegue. Bilingüe (ES/EN).
//
// No hay servidor de licencias ni cuentas: todo el catálogo es abierto y el
// código sale de GitHub. Nada que activar, nada que pagar, nada que caducar.
//
//   npx juancitoads init                 → asistente interactivo
//   npx juancitoads list                 → ver los giros disponibles
//   npx juancitoads install <slug>       → instala un giro directo
//   npx juancitoads update [dir]         → jala la versión nueva conservando member/
//   npx juancitoads doctor [dir]         → diagnostica un bot instalado
//
// Modo no-interactivo (para agentes/CI): pasa --yes y los datos por flags para que no
// se cuelgue esperando un menú. Ej:
//   npx juancitoads init --yes --negocio "Tacos Ana" --que "taquería" --cerebro claude
// Flags de init: --giro --name/--negocio --que --ofrece --horario
//   --ubicacion --telefono --web --pagos --faq --reglas --tono --cerebro
//   --region es-PA|es-419|es-ES|en|pt-BR --lang es|en --yes --no-agent-skill
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// De dónde sale el código del bot: el repo público. Sobreescribible para probar
// un fork o una rama (JUANCITOADS_REPO="miusuario/mi-fork", JUANCITOADS_REF=develop).
const REPO = process.env.JUANCITOADS_REPO || "juanarrietabusiness-pixel/CRM-JuancitoADS";
const REF = process.env.JUANCITOADS_REF || "main";
const TARBALL = (ref = REF) => `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${ref}`;
const REPO_URL = `https://github.com/${REPO}`;
const CFG_DIR = join(homedir(), ".juancitoads");
const CFG_FILE = join(CFG_DIR, "config.json");
const MARKER = ".juancitoads-bot.json";

// `azul` es el acento de la marca (#1E90FF) en 256 colores; cae a cian básico
// en terminales que no los soporten. El resto son estados, no marca.
const C = {
  azul: (s) => `\x1b[38;5;33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

// ── i18n ─────────────────────────────────────────────────────────────────────
const DICT = {
  es: {
    chooseLang: "Idioma / Language",
    tagline: "chatbot de IA con CRM, en tu propia nube",
    availBots: "Bots disponibles:",
    soonBots: "próximamente:",
    locked: (p) => `🔒 requiere ${p}`,
    downloading: (n) => `Bajando ${n}… `,
    installedOk: "Bot instalado",
    nextTitle: "Lo que sigue (tu agente de Claude Code lo hace por ti):",
    step1: (s) => `entra a la carpeta:  cd ${s}`,
    step2: 'pídele a tu agente:  "configura mi chatbot"',
    step2note: "(skill /configurar-mi-chatbot)",
    step3: "conecta tu Cloudflare y tus canales — el agente te guía.",
    step4: "al final: tu panel queda en  →  https://<tu-worker>.workers.dev/admin",
    welcomeTitle: "Bienvenido a Juancito Ads",
    welcomeBody: [
      "Tu bot de IA vivirá en TU Cloudflare, con tus llaves — es tuyo.",
      "El plan: 1) me cuentas de tu negocio aquí · 2) tu agente lo despliega ·",
      "3) lo ves atender clientes desde tu propio panel /admin",
    ],
    updateHint: "Actualiza cuando saquemos mejoras:  npx juancitoads update",
    noInstallable: "No hay ningún giro instalable todavía. Revisa `npx juancitoads list`.",
    installRetry: "Puede ser algo temporal (la red, o el bot publicándose). Espera unos segundos y reintenta el mismo comando.",
    available: "disponible", soon: "próximamente",
    updStillRuns: "Tu bot sigue corriendo en la versión actual; solo no puede actualizar.",
    updUpToDate: "Ya estás en la última versión.",
    updDone: (v) => `Actualizado a v${v}  (tu config y tu KB se conservaron)`,
    updPublish: "Para publicar los cambios, pídele a tu agente:",
    updPublishCmd: '"reinstala dependencias y despliega mi bot"',
    noBotHere: "No encontré un bot instalado aquí. Corre `update` dentro de la carpeta del bot.",
    needSlug: "Falta el bot. Usa `install <slug>` o `list`.",
    commands: "Comandos:",
  },
  en: {
    chooseLang: "Language / Idioma",
    tagline: "AI chatbot + CRM, in your own cloud",
    availBots: "Available bots:",
    soonBots: "coming soon:",
    locked: (p) => `🔒 needs ${p}`,
    downloading: (n) => `Downloading ${n}… `,
    installedOk: "Bot installed",
    nextTitle: "What's next (your Claude Code agent does it for you):",
    step1: (s) => `enter the folder:  cd ${s}`,
    step2: 'ask your agent:  "set up my chatbot"',
    step2note: "(skill /configurar-mi-chatbot)",
    step3: "connect your Cloudflare and channels — the agent guides you.",
    step4: "at the end: your panel lives at  →  https://<your-worker>.workers.dev/admin",
    welcomeTitle: "Welcome to Juancito Ads",
    welcomeBody: [
      "Your AI bot will live in YOUR Cloudflare, with your keys — it's yours.",
      "The plan: 1) tell me about your business here · 2) your agent deploys it ·",
      "3) watch it serve customers from your own /admin panel",
    ],
    updateHint: "Update whenever we ship improvements:  npx juancitoads update",
    noInstallable: "No installable niche yet. Check `npx juancitoads list`.",
    installRetry: "This may be temporary (network, or the bot is publishing). Wait a few seconds and retry the same command.",
    available: "available", soon: "coming soon",
    updStillRuns: "Your bot keeps running on the current version; it just can't update.",
    updUpToDate: "You're on the latest version.",
    updDone: (v) => `Updated to v${v}  (your config and KB were preserved)`,
    updPublish: "To publish the changes, ask your agent:",
    updPublishCmd: '"reinstall dependencies and deploy my bot"',
    noBotHere: "No installed bot found here. Run `update` inside the bot folder.",
    needSlug: "Missing bot. Use `install <slug>` or `list`.",
    commands: "Commands:",
  },
};
let L = "es";
const t = () => DICT[L];

// Región del bot: idioma del panel + moneda + zona horaria con la que arranca.
// Antes el init solo mapeaba a es-MX/en, así que España y Brasil quedaban con
// configuración mexicana (idioma "giro", moneda $, tz CDMX) y había que
// arreglarlo a mano en el panel. `L` (arriba) es aparte: el idioma de ESTA CLI.
// `ui` deriva L; el bot entiende botLang vía localePanel (es-es→España, pt→Brasil).
// Panamá va primero y es el default: es la casa de Juancito Ads y de donde
// vienen sus clientes. `es-419` sigue existiendo para el resto de LATAM, con
// hora de Ciudad de México — que es una hora menos que Panamá, así que no da
// igual cuál se elija en cuanto el bot agenda citas.
const REGIONS = {
  "es-PA":  { botLang: "es-MX", memberLang: "es", currency: "$",  tz: "America/Panama",      ui: "es", label: "Español (Panamá)" },
  "es-419": { botLang: "es-MX", memberLang: "es", currency: "$",  tz: "America/Mexico_City", ui: "es", label: "Español (Latinoamérica)" },
  "es-ES":  { botLang: "es-ES", memberLang: "es", currency: "€",  tz: "Europe/Madrid",       ui: "es", label: "Español (España)" },
  "en":     { botLang: "en",    memberLang: "en", currency: "$",  tz: "America/New_York",    ui: "en", label: "English" },
  "pt-BR":  { botLang: "pt-BR", memberLang: "pt", currency: "R$", tz: "America/Sao_Paulo",   ui: "es", label: "Português (Brasil)" },
};
// Acepta el valor tal cual (es-419) o alias viejos (--lang es/en) y normaliza.
function normRegion(v) {
  const s = String(v || "").toLowerCase().replace("_", "-");
  if (s === "es-pa" || s === "panama" || s === "panamá" || s === "pa") return "es-PA";
  if (s === "es-419" || s === "es-mx" || s === "latam") return "es-419";
  // "es" a secas cae en Panamá, que es el default del CLI.
  if (s === "es") return "es-PA";
  if (s === "es-es" || s === "espana" || s === "españa" || s === "spain") return "es-ES";
  if (s === "en" || s === "english") return "en";
  if (s.startsWith("pt") || s === "brasil" || s === "brazil") return "pt-BR";
  return null;
}
let REGION = "es-PA";

// Modo no-interactivo: cuando el CLI lo corre un AGENTE (Claude Code/Codex) o CI, no hay
// terminal interactiva. `interactive()` es false si no hay TTY o si se pasó --yes/JUANCITOADS_YES.
// En ese modo los menús/preguntas usan el valor de la flag o el default — NUNCA se cuelgan.
let ASSUME_YES = false;
const interactive = () => !!(input.isTTY && output.isTTY) && !ASSUME_YES;

// Cuando el CLI lo corre un AGENTE (Claude/Codex) y falta un dato, un error seco no
// sirve: imprimimos un BRIEFING que le dice al agente qué preguntarle al usuario y cómo
// reintentar. El camino de error ES el protocolo de onboarding del agente.
function agentBriefing(asks, retry) {
  console.log(C.yellow("\n  ── PARA EL AGENTE (Claude Code / Codex) ──  [E-INPUT-REQUIRED]"));
  console.log("  Falta información. Entrevista al usuario EN ESTE ORDEN — UNA pregunta por mensaje,");
  console.log("  espera su respuesta antes de la siguiente:");
  asks.forEach((a, i) => console.log(`   ${i + 1}. ${a}`));
  console.log("  Con sus respuestas, reintenta exactamente así:");
  console.log("  " + C.azul(retry));
  console.log(C.yellow("  ──────────────────────────────────────────────\n"));
}

// Sin licencias, los únicos fallos posibles son de red o de repo.
const REASONS = {
  es: {
    network: "No pude conectar con GitHub. Revisa tu internet e inténtalo de nuevo.",
    repo_not_found: "No encontré el repo o la rama. ¿El repositorio es público?",
    invalid_email: "Ese correo no se ve válido.",
  },
  en: {
    network: "Couldn't reach GitHub. Check your connection and try again.",
    repo_not_found: "Repo or branch not found. Is the repository public?",
    invalid_email: "That email doesn't look valid.",
  },
};
const reason = (r) => (REASONS[L] || REASONS.es)[r] || r;

// ── soporte ──────────────────────────────────────────────────────────────────
// No hay canal comercial: el soporte es el repo.
const supportLine = () =>
  L === "en"
    ? `Stuck? Open an issue → ${REPO_URL}/issues`
    : `¿Atorado? Abre un issue → ${REPO_URL}/issues`;

function loadCfg() { try { return JSON.parse(readFileSync(CFG_FILE, "utf8")); } catch { return {}; } }
function saveCfg(o) { mkdirSync(CFG_DIR, { recursive: true }); writeFileSync(CFG_FILE, JSON.stringify(o, null, 2)); }
// ── banner: la marca en bloques, con las estrellas del logo arriba ───────────
const c256 = (n, s) => `\x1b[38;5;${n}m${s}\x1b[0m`;
const WORDMARK_ART = [
  "     ██╗██╗   ██╗ █████╗ ███╗   ██╗ ██████╗ ██╗████████╗ ██████╗ ",
  "     ██║██║   ██║██╔══██╗████╗  ██║██╔════╝ ██║╚══██╔══╝██╔═══██╗",
  "     ██║██║   ██║███████║██╔██╗ ██║██║      ██║   ██║   ██║   ██║",
  "██   ██║██║   ██║██╔══██║██║╚██╗██║██║      ██║   ██║   ██║   ██║",
  "╚█████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╗ ██║   ██║   ╚██████╔╝",
  " ╚════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ",
];
// Degradado del azul neón de la marca (#1E90FF), de brillante a profundo.
const WORDMARK_GRAD = [45, 39, 33, 32, 26, 25];
// El naranja de la marca, para el "ADS" y las estrellas del logo.
const BRAND_ORANGE = 214;
function forgeSplash() {
  const noColor = process.env.NO_COLOR || process.env.JUANCITOADS_NO_ART;
  if (noColor) { console.log("\n  " + C.b("◇ JUANCITO ADS") + "\n"); return; }
  const out = ["", c256(BRAND_ORANGE, "   · ˚ ✦ ˖ ✧")];
  WORDMARK_ART.forEach((l, i) => out.push("  " + c256(WORDMARK_GRAD[i], l)));
  out.push(c256(25, "   ▂▃▄▅▆▇█ ") + c256(BRAND_ORANGE, "A D S") +
    c256(25, "  ·  tu bot vive en tu nube █▇▆▅▄▃▂"), "");
  console.log(out.join("\n"));
}

function banner() { console.log(C.azul("\n  ◇ Juancito Ads") + C.dim("  ·  " + t().tagline + "\n")); }

// Selector con flechas ↑↓ (estilo Claude CLI). Si no hay TTY (input redirigido,
// CI, pruebas), cae limpio a una lista numerada leída con readline.
// items: [{ label, desc? }]  →  devuelve el índice elegido.
async function select(rl, title, items, opts = {}) {
  const def = Math.min(Math.max(opts.default || 0, 0), Math.max(items.length - 1, 0));
  if (!items.length) return def;
  // Valor pasado por flag (acepta índice 1-based, la `key` o el `label`).
  if (opts.value != null && opts.value !== true) {
    const v = String(opts.value).trim().toLowerCase();
    const byKey = items.findIndex((it) => String(it.key || it.label || "").toLowerCase() === v);
    if (byKey >= 0) return byKey;
    const n = parseInt(v, 10);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return n - 1;
  }
  // No-interactivo (agente/CI/--yes): usa el default. NO se cuelga esperando input.
  if (!interactive()) return def;
  let idx = def;
  const hint = opts.hint || (L === "en" ? "↑/↓ move · enter to select" : "↑/↓ para moverte · enter para elegir");
  emitKeypressEvents(input);
  rl.pause();
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  output.write("\x1b[?25l"); // ocultar cursor
  let count = 0;
  const render = (first) => {
    const lines = [];
    if (title) lines.push(C.b("  " + title));
    items.forEach((it, i) => {
      const on = i === idx;
      const ptr = on ? c256(214, "❯") : " ";
      const lab = on ? c256(214, it.label) : C.dim(it.label);
      lines.push(`  ${ptr} ${lab}${it.desc ? C.dim("   " + it.desc) : ""}`);
    });
    lines.push(C.dim("  " + hint));
    if (!first) output.write(`\x1b[${count}A`);
    output.write("\x1b[0J" + lines.join("\n") + "\n");
    count = lines.length;
  };
  render(true);
  return await new Promise((resolve) => {
    const cleanup = () => {
      input.removeListener("keypress", onKey);
      if (!wasRaw) input.setRawMode(false);
      output.write("\x1b[?25h"); // mostrar cursor
      rl.resume();
    };
    const onKey = (str, key) => {
      key = key || {};
      if (key.name === "up" || key.name === "k") { idx = (idx - 1 + items.length) % items.length; render(false); }
      else if (key.name === "down" || key.name === "j" || key.name === "tab") { idx = (idx + 1) % items.length; render(false); }
      else if (str && /^[1-9]$/.test(str) && Number(str) <= items.length) { idx = Number(str) - 1; render(false); }
      else if (key.name === "return" || key.name === "enter") { cleanup(); resolve(idx); }
      else if (key.ctrl && key.name === "c") { cleanup(); console.log(""); process.exit(130); }
    };
    input.on("keypress", onKey);
  });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// a < b ?  (comparación de versiones tipo 1.0.2)

// ── catálogo y descarga ──────────────────────────────────────────────────────
// El catálogo es estático: los giros son carpetas de src/niches/ en el repo, no
// filas de una base de datos remota. Al agregar un giro nuevo, agrégalo aquí.
const CATALOG = [
  {
    slug: "generico",
    name: "Starter",
    niche: "cualquier negocio",
    status: "available",
    description: "Atiende, responde desde tu base de conocimiento y captura leads. Sirve para cualquier giro.",
    descriptionEn: "Answers from your knowledge base and captures leads. Works for any kind of business.",
  },
];
function catalog() { return CATALOG; }

// La versión del bot es el commit corto del repo: no hay servidor que estampe
// un número, así que el SHA es la única fuente de verdad reproducible.
//
// Primero `git ls-remote`: habla el protocolo git, que NO cuenta contra el
// límite de la API REST (60 req/hora por IP sin autenticar — se agota rápido
// detrás de un NAT corporativo). La API queda de respaldo por si no hay git.
async function repoVersion(ref = REF) {
  try {
    const out = execFileSync("git", ["ls-remote", REPO_URL, `refs/heads/${ref}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000,
    });
    const sha = (out.split(/\s/)[0] || "").trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha.slice(0, 7);
  } catch { /* sin git, o repo inalcanzable → probamos la API */ }
  try {
    const res = await fetchRetry(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`, {
      headers: { Accept: "application/vnd.github.sha", "User-Agent": "juancitoads-cli" },
    }, { ms: 10000, tries: 2 });
    if (!res.ok) return null;   // 403 = rate limit; se degrada a "unknown", no rompe
    const sha = (await res.text()).trim();
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : null;
  } catch { return null; }
}

// Baja el repo como tarball desde GitHub. Sin llaves, sin gating: si el repo es
// público, esto funciona. Retry porque un blip de red o un 5xx transitorio no
// debe verse como fallo duro.
async function download() {
  const res = await fetchRetry(TARBALL(), { headers: { "User-Agent": "juancitoads-cli" } }, { ms: 25000, tries: 3 });
  if (!res.ok) {
    const err = new Error(res.status === 404
      ? `No encontré ${REPO}@${REF} en GitHub. ¿El repo es público y la rama existe?`
      : `GitHub respondió HTTP ${res.status}.`);
    err.code = `http_${res.status}`;
    throw err;
  }
  const version = (await repoVersion()) || "unknown";
  return { buf: Buffer.from(await res.arrayBuffer()), version };
}

// ── extracción ───────────────────────────────────────────────────────────────
function writeMarker(dir, slug, version) {
  writeFileSync(join(dir, MARKER), JSON.stringify({ slug, version, lang: L, updatedAt: new Date().toISOString() }, null, 2));
}

// Nichos conocidos → valor de BOT_NICHE. El slug del bot decide el nicho; si no
// coincide con ninguno, queda "generico".
const NICHE_SLUGS = {
  restaurante: "restaurante",
  inmobiliaria: "inmobiliaria",
  barberia: "barberia",
  salon: "salon",
  "salon-de-belleza": "salon",
  dentista: "dentista",
  clinica: "clinica",
  gimnasio: "gimnasio",
  coach: "coach",
  tienda: "tienda",
  panaderia: "panaderia",
  cafeteria: "cafeteria",
  spa: "spa",
  crm: "crm",
  "crm-ventas": "crm",
  hoteleria: "hoteleria",
};

// Estampa tier, idioma y nicho en el wrangler.toml del bot. Sin licencias, el
// tier siempre entra como "pro": el parámetro se conserva por compatibilidad
// con los tests y llamadas existentes. El slug decide BOT_NICHE (re-etiqueta el
// panel + enciende el playbook del giro).
function stampBotConfig(dir, plan, slug) {
  const wt = join(dir, "wrangler.toml");
  if (!existsSync(wt)) return;
  const tier = plan === "free" ? "free" : "pro";
  const R = REGIONS[REGION] || REGIONS["es-PA"];
  const lang = R.botLang;
  const niche = NICHE_SLUGS[String(slug || "").toLowerCase()] || "generico";
  let s = readFileSync(wt, "utf8");
  // CRÍTICO: resolver TODO {{BOT_SLUG}} a un slug válido ANTES que nada. wrangler
  // parsea el toml completo en CADA comando, y un placeholder
  // en bucket_name rompe su regex de nombre → tumba hasta la autenticación. El
  // slug es alfanumérico-guion (barberia, starter…), siempre válido.
  const safeSlug = String(slug || "bot").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "") || "bot";
  const resId = safeSlug.replace(/-/g, "_"); // válido para nombres de recurso (D1/Vectorize)
  // Sufijo ÚNICO por bot (estable): sin él, dos bots del MISMO giro (o dos
  // "starter" gratis) tomarían el MISMO worker/D1/Vectorize y compartirían/
  // secuestrarían datos y persona — el slug (giro) NO basta. Si el toml ya trae
  // un juancitoads-…-<uid> stampeado (reinstalación en la misma carpeta), se REUSA ese
  // uid; si es el nombre del demo/placeholder, se genera uno nuevo. `update`
  // excluye wrangler.toml, así que el uid persiste entre actualizaciones.
  const existingUid = (s.match(/name\s*=\s*"juancitoads-.+-([a-f0-9]{6})"/) || [])[1];
  const botUid = existingUid || randomUUID().replace(/-/g, "").slice(0, 6);
  s = s.replace(/\{\{BOT_SLUG\}\}/g, safeSlug);
  s = s.replace(/BOT_TIER\s*=\s*"[^"]*"/g, `BOT_TIER = "${tier}"`);
  s = s.replace(/BOT_LANGUAGE\s*=\s*"[^"]*"/g, `BOT_LANGUAGE = "${lang}"`);
  // Zona horaria del negocio. Mismo patrón que BOT_NICHE: si la plantilla es
  // vieja y no trae la línea, se INSERTA en [vars] en vez de perderse — sin
  // ella la agenda de Cal.com cae al default de Ciudad de México.
  if (/BOT_TIMEZONE\s*=\s*"[^"]*"/.test(s)) {
    s = s.replace(/BOT_TIMEZONE\s*=\s*"[^"]*"/g, `BOT_TIMEZONE = "${R.tz}"`);
  } else {
    s = s.replace(/^\[vars\][^\n]*\n/m, (m) => `${m}BOT_TIMEZONE = "${R.tz}"\n`);
  }
  // BOT_NICHE: reemplaza si la línea existe; si el artifact es viejo y NO la trae,
  // la INSERTA en [vars] (si no, el bot corría siempre como 'generico' y perdía el
  // niche pack). Antes esto era replace-only = no-op cuando faltaba la línea.
  if (/BOT_NICHE\s*=\s*"[^"]*"/.test(s)) {
    s = s.replace(/BOT_NICHE\s*=\s*"[^"]*"/g, `BOT_NICHE = "${niche}"`);
  } else {
    s = s.replace(/^\[vars\][^\n]*\n/m, (m) => `${m}BOT_NICHE = "${niche}"\n`);
  }
  // Sanea lo que venga del template demo: el worker del miembro necesita SU propio
  // nombre (no el del demo de Juancito Ads). La URL del panel se conoce hasta desplegar,
  // así que va vacía: el runtime cae a su propio origin cuando está vacía (ver
  // selfOrigin en el template), y el skill la escribe tras el primer deploy.
  s = s.replace(/^name\s*=\s*"[^"]+"/m, `name = "juancitoads-${safeSlug}-${botUid}"`);
  s = s.replace(/DASHBOARD_BASE_URL\s*=\s*"[^"]*"/g, `DASHBOARD_BASE_URL = ""`);
  // La MARCA del demo tampoco es del miembro. stampBrandAndBrain la escribe con
  // el negocio real, pero solo cuando hay datos: en un `install <slug>` sin flags
  // es no-op a propósito (los aterriza el agente en la Fase 2). Sin este reset, el
  // bot recién instalado arrancaría rotulado con el nombre del demo hasta esa fase.
  // Va ANTES que stampBrandAndBrain en todas las rutas de instalación, así que el
  // nombre real, cuando existe, sigue ganando.
  s = s.replace(/BOT_NAME\s*=\s*"[^"]*"/g, `BOT_NAME = "Asistente"`);
  s = s.replace(/BUSINESS_NAME\s*=\s*"[^"]*"/g, `BUSINESS_NAME = "Mi Negocio"`);
  // RECURSOS POR BOT: D1 + Vectorize con el uid ÚNICO del bot (no solo el giro),
  // para que dos bots en la misma cuenta de Cloudflare NUNCA compartan datos ni
  // persona (el settings de D1 manda sobre config.local). Namespaceo por-giro NO
  // basta: dos bots del mismo giro colisionaban y la KB del 2º se mezclaba con la
  // del 1º.
  const dbName = `juancitoads_${resId}_${botUid}_db`;
  const kbName = `juancitoads_${resId}_${botUid}_kb`;
  s = s.replace(/database_name\s*=\s*"[^"]*"/, `database_name = "${dbName}"`);
  s = s.replace(/index_name\s*=\s*"[^"]*"/, `index_name = "${kbName}"`);
  // El database_id del demo NO sirve en la cuenta del miembro: se vuelve placeholder
  // (el skill lo crea con el nombre namespaceado y reemplaza). Solo el primero (main).
  s = s.replace(/database_id\s*=\s*"[^"]*"[^\n]*/, `database_id = "{{D1_DATABASE_ID}}"  # crea tu D1 (wrangler d1 create ${dbName}) y pega aquí su id`);
  // R2 va namespaceado por bot igual que D1 y Vectorize. Antes se normalizaba a un
  // "juancitoads-catalog" compartido: con el bloque [[r2_buckets]] activo (lo está en
  // este repo), dos bots en la misma cuenta de Cloudflare acababan escribiendo su
  // catálogo en el MISMO bucket y mezclando los productos de negocios distintos.
  s = s.replace(/bucket_name\s*=\s*"[^"]*"/, `bucket_name = "juancitoads-catalog-${safeSlug}-${botUid}"`);
  writeFileSync(wt, s);
}
// El tarball de GitHub trae todo bajo una carpeta raíz (<repo>-<ref>/), así que
// siempre extraemos con --strip-components=1. Ojo: los patrones --exclude se
// evalúan contra la ruta ORIGINAL del archivo (antes del strip), de ahí el "*/".
const STRIP = "--strip-components=1";
function extractFresh(buf, slug, version) {
  const dir = join(process.cwd(), slug);
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, ".artifact.tgz");
  writeFileSync(tgz, buf);
  execFileSync("tar", ["-xzf", tgz, "-C", dir, STRIP]);
  rmSync(tgz, { force: true });
  writeMarker(dir, slug, version);
  return dir;
}
// Extrae sobre una instalación existente SIN pisar la config del miembro.
// wrangler.toml TAMBIÉN se preserva: el del repo viene en forma plantilla
// ({{D1_DATABASE_ID}}, sin marca) — pisarlo rompería el siguiente deploy y
// borraría nombre/nicho del miembro.
//
// OJO con la lista de --exclude: `public/` NO está, y NO debe añadirse. Ahí vive
// la marca de la PLATAFORMA (logo y favicons), y que la actualización la pise es
// justo lo que se quiere: el panel es Juancito Ads igual que la administración de una
// tienda Shopify lleva el logo de Shopify. Lo del miembro es su negocio —nombre,
// bot, conversaciones, datos— y eso sí se preserva, vía member/ y wrangler.toml.
// Ver public/README.md.
function extractOver(buf, dir, slug, version) {
  const tgz = join(dir, ".artifact.tgz");
  writeFileSync(tgz, buf);
  execFileSync("tar", ["-xzf", tgz, "-C", dir, STRIP,
    "--exclude=*/member/*.local.ts", "--exclude=*/member/kb", "--exclude=*/wrangler.toml",
    "--exclude=*/.dev.vars", "--exclude=*/.dev.vars.*", "--exclude=*/.env", "--exclude=*/.env.*",
    "--exclude=*/.bot-state.json", "--exclude=*/.bot-setup.json", `--exclude=*/${MARKER}`]);
  rmSync(tgz, { force: true });
  writeMarker(dir, slug, version);
}

// Entrega los archivos DEFAULT nuevos de member/ que el miembro aún NO tenga
// (create-if-missing), SIN pisar los suyos. Hace falta porque extractOver excluye
// member/*.local.ts (preserva la personalización del miembro) — pero un archivo
// NUEVO que el core del bot importa (p. ej. member/tools.local.ts, el punto de
// extensión de tools) DEBE existir o el build truena. El contenido sale del propio
// tarball: una sola fuente de verdad, sin duplicar el default en el CLI.
const MEMBER_DEFAULTS = ["member/tools.local.ts"];
function ensureMemberDefaults(buf, dir) {
  const missing = MEMBER_DEFAULTS.filter((rel) => !existsSync(join(dir, rel)));
  if (missing.length === 0) return;
  const tgz = join(dir, ".artifact-def.tgz");
  writeFileSync(tgz, buf);
  try {
    // Solo extraemos los que NO existen (el filtro existsSync de arriba ya lo
    // garantiza), así que no hay nada que pisar. NADA de --skip-old-files: es un
    // flag solo-GNU y el tar de macOS (BSD) lo rechaza → el update fallaba callado
    // en Mac y el stub nunca se creaba.
    // El "*/" hace juego con la carpeta raíz del tarball de GitHub, igual que en
    // extractOver; el --strip-components la quita al escribir en disco.
    execFileSync("tar", ["-xzf", tgz, "-C", dir, STRIP, ...missing.map((rel) => `*/${rel}`)]);
  } catch { /* si el repo no lo trae, no rompemos el update */ }
  rmSync(tgz, { force: true });
}

// Juancito Ads no tiene planes: todo viene desbloqueado. BOT_TIER sigue existiendo en
// el wrangler.toml porque src/config.ts lo lee, pero aquí siempre se estampa en
// "pro" — no hay licencia que lo degrade ni servidor que lo decida.
function ensureProTier(dir) {
  const wt = join(dir, "wrangler.toml");
  if (!existsSync(wt)) return false;
  const s = readFileSync(wt, "utf8");
  if (!/BOT_TIER\s*=\s*"free"/.test(s)) return false;
  writeFileSync(wt, s.replace(/BOT_TIER\s*=\s*"free"/g, `BOT_TIER = "pro"`));
  return true;
}

function nextSteps(slug, dir, secretName) {
  console.log(C.green(`\n  ✓ ${t().installedOk}`) + C.dim(`  →  ${dir}\n`));
  console.log("  " + t().nextTitle);
  console.log(C.dim("    1.") + `  ${C.azul(t().step1(slug))}`);
  console.log(C.dim("    2.") + `  ${C.azul(t().step2)}  ${C.dim(t().step2note)}`);
  console.log(C.dim("    3.") + `  ${t().step3}`);
  console.log(C.dim("    4.") + `  ${t().step4}`);
  // La API key NUNCA se teclea aquí: va como secreto de Cloudflare al desplegar.
  if (secretName) console.log(C.dim("    5.") + `  ${C.yellow(o().keyStep(secretName))}`);
  console.log("");
  console.log(C.dim("  " + t().updateHint + "\n"));
}

// Sin planes ni licencias: cualquier giro del catálogo se puede instalar.
const canInstall = () => true;

async function chooseLang(rl, cfg) {
  // Ya elegida (flag o corrida previa): respétala y deriva el idioma de la CLI.
  if (cfg.region && REGIONS[cfg.region]) { REGION = cfg.region; L = REGIONS[REGION].ui; return; }
  const keys = ["es-PA", "es-419", "es-ES", "en", "pt-BR"];
  const i = await select(
    rl,
    DICT.es.chooseLang,
    keys.map((k) => ({ label: REGIONS[k].label, desc: `${REGIONS[k].currency} · ${REGIONS[k].botLang}` })),
  );
  REGION = keys[i] ?? "es-PA";
  L = REGIONS[REGION].ui;
  cfg.region = REGION; cfg.lang = L; saveCfg(cfg);
  console.log("");
}

// Menú: instalar bot. Solo se pueden elegir los que el plan permite; los premium
// se muestran bloqueados como upsell.
async function pickBot(bots, userPlan, rl, wantSlug) {
  const avail = bots.filter((b) => b.status === "available");
  const installable = avail.filter((b) => canInstall(userPlan, b));
  const locked = avail.filter((b) => !canInstall(userPlan, b));
  const soon = bots.filter((b) => b.status === "soon");

  if (installable.length === 0) return null;

  // --giro <slug>: elige directo sin menú (acepta alias de NICHE_SLUGS).
  if (wantSlug) {
    const w = String(wantSlug).trim().toLowerCase();
    const wN = NICHE_SLUGS[w];  // alias → nicho canónico (undefined si no existe: NO comparar undefined===undefined)
    const found = installable.find((b) => b.slug === w || NICHE_SLUGS[b.slug] === w || (wN != null && (b.slug === wN || NICHE_SLUGS[b.slug] === wN)));
    if (found) return found;
    console.log("  " + C.red(`No encontré el giro "${wantSlug}" disponible en tu plan.  [E-GIRO-NOT-FOUND]`) + "\n");
    process.exit(1);
  }

  // Muestra primero los bloqueados/próximos como referencia (arriba del selector).
  locked.forEach((b) => {
    console.log(`   ${C.dim("—")}  ${C.dim(b.name)}  ${C.yellow(t().locked(b.min_plan))}`);
  });
  if (soon.length) console.log(C.dim("   " + t().soonBots + " " + soon.map((b) => b.name).join(", ")));
  if (locked.length || soon.length) console.log("");

  if (installable.length === 1) return installable[0];
  // No-interactivo sin --giro: no adivines cuál instalar; pide el flag.
  if (!interactive()) {
    const slugs = installable.map((b) => `${b.slug} (${b.name})`).join(" · ");
    agentBriefing(
      [`¿Qué giro de negocio quiere para su bot? Disponibles con su plan: ${slugs}`],
      "npx juancitoads init --yes --giro <slug>",
    );
    process.exit(1);
  }
  const i = await select(rl, t().availBots, installable.map((b) => ({
    label: b.name, desc: b.niche || b.description || "",
  })));
  return installable[i] || installable[0];
}

// ── onboarding del Bot Starter (genérico) ────────────────────────────────────
// Solo corre para el bot genérico (Starter). Hace ~6 preguntas simples + elige el
// cerebro, y escribe la config real en member/config.local.ts + wrangler.toml, para
// que el bot ya sepa de su negocio apenas se despliega. La API KEY nunca se pide aquí
// (va como secreto de Cloudflare al desplegar) — ver nextSteps.
const ONB = {
  es: {
    prep: "Vamos a preparar tu bot · unas preguntas rápidas (enter = saltar)",
    brainQ: "¿Con qué cerebro (modelo de IA) quieres que piense tu bot?",
    brains: "1. Claude (recomendado)   2. ChatGPT (OpenAI)   3. Grok (xAI)",
    qName: "¿Cómo se llama tu negocio?",
    qWhat: "En una frase, ¿a qué se dedica?",
    qOffer: "¿Qué ofreces? (tus servicios o productos principales, con precios si quieres)",
    qHours: "¿Cuál es tu horario de atención?",
    qLoc: "¿Dónde estás? (dirección o 'en línea')",
    qPhone: "¿Un teléfono/WhatsApp de contacto?",
    qWeb: "¿Tienes sitio web o redes sociales? (pega los links, o enter para saltar)",
    qPagos: "¿Qué métodos de pago aceptas? (efectivo, tarjeta, transferencia…)",
    qFaq: "¿Qué es lo que MÁS te pregunta la gente? (2 o 3 preguntas típicas)",
    qReglas: "¿Algo que el bot NO deba hacer o decir? ¿Y cuándo debe pasarte la conversación a ti?",
    qEmailUse: (e) => `¿Te aviso a ${e} cuando llegue un cliente nuevo? (enter = sí, u otro correo)`,
    qEmail: "¿A qué correo te aviso de nuevos clientes? (enter para saltar)",
    qTone: "¿Cómo quieres que suene?  1) Cercano   2) Formal   3) Divertido",
    tone1: "cercano y amigable, como hablarle a un conocido",
    tone2: "formal y profesional, claro y respetuoso",
    tone3: "relajado y divertido, con chispa pero sin perder claridad",
    done: "Config lista · tu bot ya sabe de tu negocio",
    keyStep: (name) => `al desplegar, tu agente pone tu API key (segura, oculta):  ${name}`,
  },
  en: {
    prep: "Let's set up your bot · a few quick questions (enter = skip)",
    brainQ: "Which brain (AI model) should your bot think with?",
    brains: "1. Claude (recommended)   2. ChatGPT (OpenAI)   3. Grok (xAI)",
    qName: "What's your business called?",
    qWhat: "In one line, what does it do?",
    qOffer: "What do you offer? (main services or products, with prices if you like)",
    qHours: "What are your hours?",
    qLoc: "Where are you? (address or 'online')",
    qPhone: "A phone/WhatsApp contact?",
    qWeb: "Do you have a website or social profiles? (paste links, or enter to skip)",
    qPagos: "Which payment methods do you accept? (cash, card, transfer…)",
    qFaq: "What do people ask you the MOST? (2-3 typical questions)",
    qReglas: "Anything the bot should NOT do or say? And when should it hand the chat to you?",
    qEmailUse: (e) => `Notify you at ${e} when a new customer comes in? (enter = yes, or another email)`,
    qEmail: "Which email should I notify about new customers? (enter to skip)",
    qTone: "How should it sound?  1) Friendly   2) Formal   3) Playful",
    tone1: "friendly and warm, like talking to someone you know",
    tone2: "formal and professional, clear and respectful",
    tone3: "relaxed and playful, with spark but still clear",
    done: "Config ready · your bot already knows your business",
    keyStep: (name) => `on deploy, your agent sets your API key (secure, hidden):  ${name}`,
  },
};
const o = () => ONB[L] || ONB.es;

// Opción → proveedor + nombre del secret de Cloudflare (la key va ahí, nunca aquí).
const BRAINS = {
  "1": { provider: "anthropic", secret: "ANTHROPIC_API_KEY" },
  "2": { provider: "openai", secret: "OPENAI_API_KEY" },
  "3": { provider: "xai", secret: "XAI_API_KEY" },
};

async function chooseBrain(rl, flags = {}) {
  // normaliza sinónimos de --cerebro: anthropic→claude, openai→chatgpt, xai→grok
  const raw = String(flags.cerebro || flags.brain || "").trim().toLowerCase();
  const val = { anthropic: "claude", openai: "chatgpt", gpt: "chatgpt", chatgpt: "chatgpt", xai: "grok", grok: "grok", claude: "claude" }[raw] || raw || null;
  const i = await select(rl, o().brainQ, [
    { key: "claude", label: "Claude", desc: L === "en" ? "recommended" : "recomendado" },
    { key: "chatgpt", label: "ChatGPT", desc: "OpenAI" },
    { key: "grok", label: "Grok", desc: "xAI" },
  ], { value: val });
  return BRAINS[String(i + 1)] || BRAINS["1"];
}

async function ask(rl, q, val) {
  if (val != null && val !== true) return String(val).trim();
  if (!interactive()) return "";   // no-interactivo: salta (enter = saltar); no se cuelga
  return (await rl.question("\n  " + C.b(q) + "\n  " + C.azul("› "))).trim();
}

async function starterOnboarding(rl, licenseEmail, flags = {}) {
  console.log("\n  " + C.dim(o().prep));
  const businessName = await ask(rl, o().qName, flags.negocio || flags.nombre);
  const what = await ask(rl, o().qWhat, flags.que);
  const offer = await ask(rl, o().qOffer, flags.ofrece);
  const hours = await ask(rl, o().qHours, flags.horario);
  const location = await ask(rl, o().qLoc, flags.ubicacion);
  const phone = await ask(rl, o().qPhone, flags.telefono);
  const web = await ask(rl, o().qWeb, flags.web || flags.redes);
  const pagos = await ask(rl, o().qPagos, flags.pagos);
  const faq = await ask(rl, o().qFaq, flags.faq);
  const reglas = await ask(rl, o().qReglas, flags.reglas);

  // Correo de contacto: se usa el de la licencia SIN preguntar (decisión de producto).
  // --avisos no queda como opt-out silencioso.
  let email = "";
  const base = ((flags.email || licenseEmail || "") + "").trim().toLowerCase();
  if (EMAIL_RE.test(base)) {
    email = ["no", "n", "false"].includes(String(flags.avisos ?? "").trim().toLowerCase()) ? "" : base;
  } else if (interactive()) {
    const a = await ask(rl, o().qEmail);
    if (EMAIL_RE.test(a)) email = a.toLowerCase();
  }
  const tv = { cercano: "cercano", friendly: "cercano", formal: "formal", divertido: "divertido", playful: "divertido" }[String(flags.tono || "").trim().toLowerCase()] || null;
  const ti = await select(rl, L === "en" ? "How should it sound?" : "¿Cómo quieres que suene?", [
    { key: "cercano", label: L === "en" ? "Friendly" : "Cercano", desc: L === "en" ? "warm, close" : "cálido y cercano" },
    { key: "formal", label: "Formal", desc: L === "en" ? "professional" : "profesional" },
    { key: "divertido", label: L === "en" ? "Playful" : "Divertido", desc: L === "en" ? "with spark" : "con chispa" },
  ], { value: tv });
  const tone = ti === 1 ? o().tone2 : ti === 2 ? o().tone3 : o().tone1;
  return { businessName, what, offer, hours, location, phone, web, pagos, faq, reglas, email, tone };
}

// Genera el contenido de member/config.local.ts a partir de las respuestas. Cada
// valor se embebe con JSON.stringify (seguro ante comillas/acentos/saltos de línea).
function renderMemberConfig({ businessName, botName, lang, tier, email, what, offer, hours, location, phone, tone, web, pagos, faq, reglas }) {
  // Idioma/moneda/tz salen de la región elegida en el init. `lang` (parámetro)
  // se conserva por compatibilidad pero la fuente es REGION.
  const R = REGIONS[REGION] || REGIONS["es-PA"];
  const cf = {};
  if (what) cf.queHacemos = what;
  if (offer) cf.ofrecemos = offer;
  if (tone) cf.tono = tone;
  if (web) cf.sitioWebYRedes = web;
  if (faq) cf.preguntasFrecuentes = faq;
  if (reglas) cf.reglasYEscalacion = reglas;
  const j = (v) => JSON.stringify(v ?? "");
  return `// member/config.local.ts — generado por \`juancitoads init\`. Edítalo cuando quieras.
// NUNCA se sobrescribe al actualizar el bot.

export const memberConfig = {
  businessName: ${j(businessName)},
  botName: ${j(botName)},
  language: ${j(R.memberLang)} as "es" | "en" | "pt",
  tier: ${j(tier === "free" ? "free" : "pro")} as "free" | "pro",
  // Copia de referencia de la zona horaria. La que el bot USA de verdad es
  // BOT_TIMEZONE en wrangler.toml: si la cambias, cámbiala en los dos sitios.
  timezone: ${j(R.tz)},
  // Moneda con la que hablas de precios ($ | € | R$). Por ahora es solo una
  // nota para ti y para tu agente: el bot toma los precios de businessConfig y
  // de tu base de conocimiento tal como los escribas.
  currency: ${j(R.currency)},
  contactEmail: ${j(email)},
};
export type MemberConfig = typeof memberConfig;

export const businessConfig = {
  hours: ${j(hours)},
  services: [] as { name: string; price: number }[],
  location: ${j(location)},
  paymentMethods: ${JSON.stringify((pagos || "").split(/[,;·]+/).map((s) => s.trim()).filter(Boolean))} as string[],
  contactPhone: ${j(phone)},
  customFields: ${JSON.stringify(cf, null, 2)} as Record<string, string>,
};

export const catalog: { name: string; price: number; description?: string; sku?: string }[] = [];
`;
}

// Estampa marca (BOT_NAME/BUSINESS_NAME) y cerebro (LLM_PROVIDER) en wrangler.toml.
function stampBrandAndBrain(dir, { botName, businessName, provider }) {
  const wt = join(dir, "wrangler.toml");
  if (!existsSync(wt)) return;
  let s = readFileSync(wt, "utf8");
  if (botName) s = s.replace(/BOT_NAME\s*=\s*"[^"]*"/g, `BOT_NAME = "${String(botName).replace(/"/g, "'")}"`);
  if (businessName) s = s.replace(/BUSINESS_NAME\s*=\s*"[^"]*"/g, `BUSINESS_NAME = "${String(businessName).replace(/"/g, "'")}"`);
  // normaliza cualquier LLM_PROVIDER existente al elegido…
  s = s.replace(/LLM_PROVIDER\s*=\s*"[^"]*"/g, `LLM_PROVIDER = "${provider}"`);
  // …y asegura que el bloque principal [vars] lo tenga (antes de [env.mc] si existe).
  const mainPart = s.split(/^\[env\.mc\]/m)[0];
  if (!/LLM_PROVIDER\s*=/.test(mainPart)) {
    // Insertar DESPUÉS de la línea completa de BOT_TIER (con su comentario), no en medio.
    s = s.replace(/^(BOT_TIER\s*=.*)$/m, `$1\nLLM_PROVIDER = "${provider}"`);
  }
  writeFileSync(wt, s);
}

// Escribe la config del Starter (member/config.local.ts + wrangler.toml).
function writeStarterConfig(dir, answers, tier, provider) {
  const botName = answers.businessName ? `Asistente de ${answers.businessName}` : "Asistente";
  if (existsSync(join(dir, "member"))) {
    writeFileSync(
      join(dir, "member", "config.local.ts"),
      renderMemberConfig({
        businessName: answers.businessName, botName, lang: L, tier, email: answers.email,
        what: answers.what, offer: answers.offer, hours: answers.hours,
        location: answers.location, phone: answers.phone, tone: answers.tone,
        web: answers.web, pagos: answers.pagos, faq: answers.faq, reglas: answers.reglas,
      }),
    );
  }
  stampBrandAndBrain(dir, { botName, businessName: answers.businessName, provider });
  return botName;
}

// Honra flags de negocio en instalaciones de GIRO (install <slug> / init --giro):
// si el usuario pasó --negocio/--name/--que/etc, estámpalos (BOT_NAME/BUSINESS_NAME
// + member/config.local.ts) en vez de ignorarlos. No-op si no vinieron flags — ahí
// los aterriza el agente en la Fase 2 del skill. Devuelve true si escribió algo.
function applyBusinessFlags(dir, flags = {}, tier = "pro") {
  const businessName = String(flags.negocio || flags.nombre || flags.name || "").trim();
  const hasBiz = businessName || flags.que || flags.ofrece || flags.horario ||
    flags.ubicacion || flags.telefono || flags.web || flags.redes || flags.pagos ||
    flags.faq || flags.reglas || flags.tono;
  if (!hasBiz) return false;
  const provider = { claude: "anthropic", anthropic: "anthropic", chatgpt: "openai", openai: "openai", gpt: "openai", grok: "xai", xai: "xai" }[String(flags.cerebro || flags.brain || "").trim().toLowerCase()] || "anthropic";
  const tone = { cercano: "cercano", friendly: "cercano", formal: "formal", divertido: "divertido", playful: "divertido" }[String(flags.tono || "").trim().toLowerCase()] || "";
  const botName = businessName ? (L === "en" ? `${businessName} Assistant` : `Asistente de ${businessName}`) : "Asistente";
  if (existsSync(join(dir, "member"))) {
    writeFileSync(join(dir, "member", "config.local.ts"), renderMemberConfig({
      businessName, botName, lang: L, tier, email: "",
      what: flags.que, offer: flags.ofrece, hours: flags.horario,
      location: flags.ubicacion, phone: flags.telefono, tone,
      web: flags.web || flags.redes, pagos: flags.pagos, faq: flags.faq, reglas: flags.reglas,
    }));
  }
  stampBrandAndBrain(dir, { botName, businessName, provider });
  return true;
}

// Aviso post-install: si quedan placeholders {{BOT_NAME}}/{{BUSINESS_NAME}} sin
// resolver (giro sin flags de negocio), recuérdale al agente llenarlos ANTES del
// deploy (el preflight de wrangler bloquea el deploy si no).
function warnIfPlaceholders(dir) {
  try {
    const s = readFileSync(join(dir, "wrangler.toml"), "utf8");
    if (/\{\{(BOT_NAME|BUSINESS_NAME)\}\}/.test(s)) {
      console.log(C.dim(L === "en"
        ? "  ⚠ Fill the business/bot name in member/config.local.ts + wrangler.toml before deploy (skill Fase 2)."
        : "  ⚠ Llena el nombre del negocio/bot en member/config.local.ts + wrangler.toml antes del deploy (Fase 2 del skill)."));
    }
  } catch {}
}

// ── comandos ─────────────────────────────────────────────────────────────────
const AGENT_SKILL = "---\nname: juancitoads\ndescription: Guía para usar CRM - Juancito Ads con el CLI `juancitoads` — instalar, configurar, desplegar y operar chatbots de IA con CRM en la Cloudflare del usuario. Actívala cuando el usuario quiera \"instalar Juancito Ads\", \"montar/crear un chatbot\", \"actualizar mi bot\", \"diagnosticar mi bot\", \"cambiar el idioma o la moneda de mi bot\", \"pausar un chat\", o mencione juancitoads.\n---\n\n# Juancito Ads — instalar y operar chatbots con el CLI `juancitoads`\n\nEres el asistente que maneja Juancito Ads POR el usuario. La persona probablemente **no programa**\ny casi nunca verá la terminal: **tú corres los comandos y tú haces las preguntas en el chat**.\nREGLA DE ORO: **una pregunta por mensaje** — espera la respuesta antes de la siguiente.\n\n## Qué es Juancito Ads\nUn chatbot de IA con CRM que vive en la **cuenta de Cloudflare del usuario**, con **sus llaves**.\nEl bot y sus datos son del usuario. Es **gratis y open source**: no hay licencias, cuentas,\nplanes ni servidor central — el código sale de GitHub y todo viene desbloqueado.\nTú NO eres el chatbot: tú eres quien lo construye.\n\n## El CLI (córrelo tú, siempre con flags)\n- `npx juancitoads init` — instala un bot. **Punto de partida.**\n- `npx juancitoads list` — giros disponibles.\n- `npx juancitoads install <slug>` — instala un giro directo.\n- `npx juancitoads update` — actualiza conservando la config del usuario (`member/`).\n- `npx juancitoads doctor` — diagnostica un bot instalado.\n- `npx juancitoads ayuda` — dónde pedir ayuda.\n\n## Guion de instalación (en ORDEN, una pregunta por mensaje)\nEl asistente interactivo del CLI es para humanos en terminal; tú NO puedes navegar sus\nmenús. Tu flujo: **entrevistar por pasos → correr UN comando con todo por flags**.\n\n**Paso 0 · Explica ANTES de correr un solo comando (y espera su \"sí\").** La persona casi\nnunca \"ve\" lo que haces; dale el mapa primero, corto y sin tecnicismos:\n> \"Antes de empezar te explico rápido: te voy a **armar un chatbot de IA** para tu negocio,\n> gratis. Va a **vivir en TU propia cuenta de Cloudflare** (la casa del bot, a tu nombre —\n> gratis para empezar, ~$5 USD/mes cuando ya tengas clientes escribiéndole). El **cerebro**\n> lo pone tu proveedor de IA favorito (Claude, ChatGPT o Grok) con tu llave — ahí pagas solo\n> lo que piensa, ~$1–2 USD/mes; tu llave se guarda cifrada en TU Cloudflare, yo nunca la veo.\n> **Yo corro todos los comandos por ti** — tú solo vas a crear **dos cuentas** (Cloudflare y\n> tu proveedor de IA, te llevo pasito a pasito) y, al final, conectar tu canal\n> (WhatsApp, Telegram o el chat en tu propia página web). En menos de un día está\n> listo. ¿Le entramos?\"\n\nEspera su \"sí\" ANTES de correr `juancitoads init`. Si pregunta por costos, dónde vive el bot o\nqué necesita, respóndele desde aquí — no avances hasta que esté tranquilo. (El `init` solo\nBAJA el código, no toca Cloudflare; las cuentas y el deploy entran después, en la Fase 1.)\n\n**Paso 0.5 · Verifica que tenga las herramientas (y si falta, instálalo TÚ).** Antes de correr\n`juancitoads init`, revisa que existan las dos herramientas base. Si algo falta, díselo en corto\n(\"te falta X, te lo instalo, ~1 min ¿va?\") e **instálalo tú** — no lo mandes a pelearse con\ninstaladores. Detecta el sistema con `uname` (Darwin=macOS, Linux) o asume Windows.\n\n- **Node.js ≥18** (lo necesita `npx`): corre `node -v`. Si falta o es viejo:\n  - macOS con Homebrew: `brew install node`. Sin Homebrew → instala nvm y Node:\n    `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`, reinicia\n    la terminal y `nvm install --lts`.\n  - Linux: mismo nvm (no pide sudo) → `nvm install --lts`.\n  - Windows: `winget install OpenJS.NodeJS.LTS`.\n- **pnpm** (lo necesita el deploy en la Fase 1): corre `pnpm -v`. Si falta, lo más limpio es\n  `corepack enable pnpm` (viene con Node); si no jala, `npm i -g pnpm`.\n- `tar` y `git` ya vienen en macOS/Linux/Windows moderno — normalmente no hay que tocar nada.\n\nInstala lo que falte, **verifica de nuevo** (`node -v`, `pnpm -v`) y solo entonces sigue al Paso 1.\nSi de plano no hay forma de instalar Node por terminal, mándalo a nodejs.org a bajar el\ninstalador y espera a que confirme.\n\n**Paso 1 · Corre el init.** Ya con su \"sí\": no hay licencias ni cuentas que crear, así que\ndi \"te armo tu bot ahorita mismo\" y corre `init` directo.\n\n**Paso 1.5 · País/idioma**: si el negocio NO es de México/LATAM, pregúntale de qué país es y pásalo con `--region` (España→`es-ES` €, Brasil→`pt-BR` R$, inglés→`en`). Así arranca con su idioma, moneda y zona horaria. Por defecto (LATAM) es `es-419`.\n\n**Paso 2 · El negocio** — una por una:\nnombre del negocio → a qué se dedica → qué ofrece (servicios/productos CON precios) →\nhorario → ubicación → teléfono/WhatsApp → sitio web o redes (si tiene — **anota bien la\ndirección de su página: con ella le pones el chat en su propio sitio**) → métodos de pago →\n\"¿qué es lo que MÁS te pregunta la gente?\" (2-3 típicas) → \"¿algo que el bot NO deba hacer\no decir? ¿cuándo debe pasarte la conversación a ti?\" → tono (cercano/formal/divertido) →\ncerebro (claude/chatgpt/grok).\n\nCon todo, corre UN solo comando. Ejemplo:\n`npx juancitoads init --yes --negocio \"Tacos Ana\" --que \"taquería\" --ofrece \"tacos $25, aguas $20\" --horario \"L-S 9-20\" --ubicacion \"Centro\" --telefono \"555…\" --web \"instagram.com/tacosana\" --pagos \"efectivo, tarjeta\" --faq \"¿hacen envíos?, ¿hay vegetariano?\" --reglas \"no prometer descuentos; pasar a humano si piden factura\" --tono cercano --cerebro claude`\n\nFlags de `init`: `--giro` `--email` `--name`/`--negocio` `--que` `--ofrece`\n`--horario` `--ubicacion` `--telefono` `--web` `--pagos` `--faq` `--reglas`\n`--tono cercano|formal|divertido` `--cerebro claude|chatgpt|grok` `--region es-419|es-ES|en|pt-BR` (idioma+moneda+zona horaria; alias viejo `--lang es|en`) `--yes` `--no-agent-skill`.\n\nSi el CLI imprime un bloque **\"PARA EL AGENTE\"**, síguelo tal cual: haz las preguntas en el\norden que lista (una por mensaje) y reintenta con las flags que indica. Nunca dejes el comando\ncolgado. (La primera corrida instala/actualiza esta guía en ~/.claude/skills/juancitoads/.)\n\n## Después de descargar el bot (síguelo EN ORDEN)\n1. `cd <slug>` (la carpeta creada).\n1.5 **Reconfirma en corto ANTES de crear cuentas / desplegar.** Ya diste el mapa en el Paso 0;\n   aquí solo recuérdalo brevemente: \"ahora sí voy a crear tu Cloudflare y a desplegar tu bot —\n   ¿listo?\". Dato útil que puedes agregar: una vez construido, tu bot **NO consume tokens de\n   Claude Code jamás** — atiende solo con tu llave de IA (~$1–2/mes); Claude Code solo gasta\n   cuando le pidas cambios. Si quiere verlo en imagen, ábrele el diagrama:\n   `open como-funciona.html` — NO generes uno nuevo.\n2. **LEE el `CLAUDE.md` de esa carpeta** y sigue `/configurar-mi-chatbot` (en `skill/`; si no está\n   registrado, abre `skill/configurar-mi-chatbot.md`). Sus 4 fases: (1) plataforma — Cloudflare +\n   API key como secreto + deploy, (2) negocio — entrevista y base de conocimiento; **si\n   `member/config.local.ts` ya trae datos del init, NO los vuelvas a preguntar: confírmalos y\n   completa solo los huecos**, (3) conexiones — canales uno por uno (se ponen VERDES en el panel); **si tiene página web,\n   ofrécele ese canal: es el más fácil de todos — sin tokens, sin verificación, solo pegar un\n   `<script>` en su sitio**. (4) prueba final con mensaje real.\n3. Cuando el deploy salga bien, dale la URL de su panel: `https://<worker>.workers.dev/admin`.\n\n## Después de instalar: los comandos del bot\nEl bot trae sus propios skills en `skill/` (su `CLAUDE.md` los lista):\n`/configurar-mi-chatbot`, `/actualizar-mi-bot`, `/reporte`, `/exportar` y `/contribuir`.\nTodo viene desbloqueado: no hay features de pago ni tiers que activar.\n\n## Cambiar idioma o moneda de un bot (ya instalado)\nEl bot maneja 4 idiomas de panel/sistema: **es-419** (LATAM), **es-ES** (España), **en**, **pt-BR** (Brasil), más **espejo** (contesta en el idioma de cada cliente). Se cambian SIN redesplegar, por settings en su D1 — igual que el panel, efecto inmediato:\n- **Idioma**: `wrangler d1 execute <DB> --remote --command \"INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('bot_language','<valor>',<ahora_ms>)\"` — valor: `es-419|es-ES|en|pt-BR|espejo`.\n- **Moneda** (símbolo de precios): el mismo comando con `('bot_currency','<símbolo>',…)` — `$` | `€` | `R$`.\n- **Volver al default** del wrangler.toml: usa valor vacío `''`.\n\n`<DB>` = la D1 del bot (está en su `wrangler.toml`). `<ahora_ms>` = `$(( $(date +%s) * 1000 ))`. El dueño también puede hacerlo en el panel → **Configuración**. **Si no te dice a qué idioma o moneda, PREGÚNTASELO** — no lo adivines por el país. Tras cambiarlo, confírmale que el bot y el panel ya están en el nuevo idioma. Si te pide un idioma que NO está en la lista (p. ej. francés), dile con claridad cuáles hay disponibles y ofrécele **espejo** si lo que quiere es que el bot se adapte a cada cliente.\n\n## El cerebro del bot (modelo) — súbelo si toma pedidos\nEl bot elige el modelo por turno (**Equilibrado** por default: barato para lo simple, sube solo al inteligente en lo difícil). Un bot que **toma pedidos, agenda citas o reserva mesas** hace un flujo de varios pasos (\"un dato a la vez\"); con esas tools activas ya arranca en el inteligente. Pero si el dueño reporta que el bot **junta todo en un mensaje** o **no respeta los pasos** de su prompt, el fix es fijar el cerebro en **Máximo**:\n- Panel → **Configuración** → \"Cerebro del bot\" → **Máximo**. O por D1: `wrangler d1 execute <DB> --remote --command \"INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('model_override','sonnet',<ahora_ms>)\"` — valor: `sonnet` (Máximo) | `auto` (Equilibrado) | `haiku` (Económico).\n\nDiagnóstico clave para no confundir al dueño: **NO es que \"no se aplicaron sus cambios\"** — su prompt SÍ llegó al bot (lo ves en que ya usa su tono, su menú, sus reglas). Lo que falla es que el modelo barato no aguanta un flujo de tantos pasos y lo aplasta. Máximo lo respeta (cuesta un poco más por mensaje). Sugiere también borrar el historial del chat de prueba.\n\n## Reglas de seguridad (NO las rompas)\n- **API keys/tokens (claro pero flexible):** lo ideal es que el usuario las pegue en SU terminal (`wrangler secret put`), no en el chat — avísale de ese flujo antes. Pero si de todos modos te la pega en el chat, NO la rechaces: dale una advertencia corta (mejor en la terminal, en el chat queda en el historial) y tú mismo la guardas como secreto de Cloudflare (`wrangler secret put`, pásala por stdin). Nunca la imprimas de vuelta ni la dejes en archivos del repo.\n- **NO** hagas `git push`, commit ni `deploy` sin que el usuario confirme.\n- `member/` es del usuario; no la borres — se conserva en cada actualización.\n- **Un bot = sus propios recursos.** Cada bot tiene su PROPIO D1 y su PROPIO índice Vectorize, con un nombre ÚNICO por bot en wrangler.toml (juancitoads_<slug>_<uid>_db / _kb — el <uid> evita que dos bots choquen y mezclen datos). NUNCA reuses el D1 ni el índice de otro bot: heredaría su persona y sus datos. Un 2º bot en la misma cuenta SIEMPRE crea recursos NUEVOS (nueva D1, nuevo Vectorize, nuevo worker); el skill `/configurar-mi-chatbot` crea el recurso con el nombre que trae el wrangler.toml (ya único) y verifica que no exista antes.\n- Si algo falla: `npx juancitoads doctor` y reporta claro y en simple.\n\n## Soporte (cuando tú no puedas resolverlo)\nSi `doctor` no lo arregla, abre un issue en https://github.com/juanarrietabusiness-pixel/CRM-JuancitoADS/issues\ncon (1) qué falló, (2) la salida de `npx juancitoads doctor` y (3) el sistema operativo y `node -v`.\nTambién puedes correr `npx juancitoads ayuda`.\n\nDocumentación completa: https://github.com/juanarrietabusiness-pixel/CRM-JuancitoADS#readme";

// Instala una guía para el AGENTE del miembro (Claude Code) que le enseña a usar el CLI
// juancitoads y el flujo completo. Se escribe en ~/.claude/skills/juancitoads/SKILL.md. Idempotente;
// opt-out con --no-agent-skill o JUANCITOADS_NO_AGENT_SKILL. Nunca rompe el init si falla.
function installAgentSkill(flags = {}) {
  if ((flags && flags["no-agent-skill"]) || process.env.JUANCITOADS_NO_AGENT_SKILL) return;
  try {
    const dir = join(homedir(), ".claude", "skills", "juancitoads");
    const file = join(dir, "SKILL.md");
    const existed = existsSync(file);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, AGENT_SKILL);
    if (!existed) console.log(C.dim("  \u270e guía de Juancito Ads instalada para tu agente  \u2192  ~/.claude/skills/juancitoads/"));
  } catch { /* no romper el flujo por esto */ }
}

async function cmdInit(flags = {}) {
  const cfg = loadCfg();
  ASSUME_YES = !!(flags.yes || process.env.JUANCITOADS_YES);
  // --region (nuevo) o --lang (alias viejo) fijan la región del bot. Con --yes
  // sin ninguno, cae al default LATAM en vez de abrir el menú interactivo.
  const regFlag = normRegion(flags.region || flags.lang);
  if (regFlag) cfg.region = regFlag;
  else if (ASSUME_YES && !cfg.region) cfg.region = "es-PA";
  if (flags.lang && DICT[flags.lang]) cfg.lang = flags.lang;
  if (cfg.region && REGIONS[cfg.region]) { REGION = cfg.region; L = REGIONS[REGION].ui; }
  else if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  forgeSplash();   // ilustración de juancitoads
  installAgentSkill(flags);
  const rl = createInterface({ input, output });
  try {
    await chooseLang(rl, cfg);
    console.log(C.dim("  " + t().tagline + "\n"));

    // Sin licencias: no hay nada que canjear, validar ni reclamar. Se pasa
    // directo a elegir el giro y bajar el código desde GitHub. El correo, si lo
    // dan, se usa solo como destinatario de avisos del bot (handoff).
    const licenseEmail = (() => {
      const e = String(flags.email || "").trim().toLowerCase();
      return EMAIL_RE.test(e) ? e : null;
    })();

    const bot = await pickBot(catalog(), "pro", rl, (flags.giro || flags.slug || "").toString().trim().toLowerCase());
    if (!bot) { console.log(C.yellow("  " + t().noInstallable) + "\n"); return; }
    process.stdout.write(C.dim(`\n  ${t().downloading(bot.name)}`));
    const { buf, version } = await download();
    console.log(C.green("✓") + C.dim(` ${(buf.length / 1024).toFixed(0)} KB · ${version}`));
    const dir = extractFresh(buf, bot.slug, version);
    stampBotConfig(dir, "pro", bot.slug);
    ensureProTier(dir);

    // Bienvenida con contexto ANTES de las preguntas: qué es Juancito Ads, dónde vive el
    // bot y que al final aparece en su dashboard.
    console.log("\n  " + C.azul("◇ ") + C.b(t().welcomeTitle));
    for (const l of t().welcomeBody) console.log("  " + C.dim(l));

    // Onboarding guiado del Starter: elige cerebro + preguntas de negocio → config
    // real. Solo para el bot genérico; los nichos los aterriza el agente con su plantilla.
    let secretName = null;
    if ((NICHE_SLUGS[bot.slug] || "generico") === "generico") {
      const brain = await chooseBrain(rl, flags);
      const answers = await starterOnboarding(rl, licenseEmail, flags);
      writeStarterConfig(dir, answers, "pro", brain.provider);
      secretName = brain.secret;
      console.log(C.green("\n  ✓ ") + C.dim(o().done));
      if (!interactive() && !answers.businessName) {
        console.log(C.yellow("\n  ── PARA EL AGENTE ──  el negocio quedó SIN configurar."));
        console.log("  Entrevista al usuario en el chat (nombre del negocio, a qué se dedica, qué ofrece,");
        console.log("  horario, ubicación, teléfono, tono) y vuelca sus respuestas siguiendo");
        console.log("  skill/configurar-mi-chatbot (FASE 2) dentro de la carpeta del bot.");
      }
    } else {
      // Giro: si el usuario pasó flags de negocio (--negocio/--que/…), hónralas aquí
      // (antes se ignoraban); si no, el agente las aterriza en la Fase 2 del skill.
      applyBusinessFlags(dir, flags, "pro");
      warnIfPlaceholders(dir);
    }
    nextSteps(bot.slug, dir, secretName);
  } catch (e) { console.log("\n  " + C.red("✗ " + (e.message || e)) + "\n"); process.exit(1); }
  finally { rl.close(); }
}

async function cmdList() {
  const cfg = loadCfg(); if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  banner();
  for (const b of catalog()) {
    const tag = b.status === "available" ? C.green(t().available) : C.dim(t().soon);
    console.log(`  ${C.b(b.slug.padEnd(18))} ${C.dim((b.niche || "").padEnd(24))} ${tag}`);
    console.log(`  ${C.dim((L === "en" ? b.descriptionEn : b.description) || "")}\n`);
  }
  console.log(C.dim(`  Todos los giros son gratis y abiertos → ${REPO_URL}\n`));
}

async function cmdInstall(slug, flags) {
  const cfg = loadCfg();
  ASSUME_YES = !!(flags.yes || process.env.JUANCITOADS_YES);
  if (flags.lang && DICT[flags.lang]) { cfg.lang = flags.lang; }
  if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  banner();
  installAgentSkill(flags);
  if (!slug) { console.log("  " + C.red(t().needSlug) + "\n"); process.exit(1); }
  if (!catalog().some((b) => b.slug === slug)) {
    console.log("  " + C.red(`No conozco el giro "${slug}".`));
    console.log(C.dim(`  Míralos con: npx juancitoads list\n`));
    process.exit(1);
  }
  process.stdout.write(C.dim(`  ${t().downloading(slug)}`));
  try {
    const { buf, version } = await download();
    console.log(C.green("✓") + C.dim(` ${(buf.length / 1024).toFixed(0)} KB · ${version}`));
    const dir = extractFresh(buf, slug, version);
    stampBotConfig(dir, "pro", slug);
    applyBusinessFlags(dir, flags, "pro");
    ensureProTier(dir);
    warnIfPlaceholders(dir);
    nextSteps(slug, dir);
  } catch (e) {
    console.log(C.red("✗"));
    console.log("  " + C.red(e.message || e));
    console.log(C.dim("  " + t().installRetry) + "\n");
    process.exit(1);
  }
}

function resolveBotDir(arg) {
  if (arg && existsSync(join(arg, MARKER))) return arg;
  if (existsSync(join(process.cwd(), MARKER))) return process.cwd();
  for (const e of readdirSync(process.cwd())) {
    try { if (statSync(join(process.cwd(), e)).isDirectory() && existsSync(join(process.cwd(), e, MARKER))) return join(process.cwd(), e); } catch {}
  }
  return null;
}

async function cmdUpdate(dirArg, flags) {
  const cfg = loadCfg(); if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  banner();
  const dir = resolveBotDir(dirArg);
  if (!dir) { console.log("  " + C.red(t().noBotHere) + "\n"); process.exit(1); }
  const marker = JSON.parse(readFileSync(join(dir, MARKER), "utf8"));
  if (marker.lang && DICT[marker.lang]) L = marker.lang;   // respeta el idioma con que se instaló

  // La versión es el commit del repo, no un semver de un servidor: comparar con
  // No hay semver que comparar. Si el SHA es el mismo, ya está al día.
  process.stdout.write(C.dim("  Buscando cambios… "));
  const latest = await repoVersion();
  if (!latest) {
    console.log(C.yellow("⚠"));
    console.log("  " + C.yellow("No pude consultar GitHub."));
    console.log(C.dim("  " + t().updStillRuns));
    console.log(C.dim("  " + supportLine() + "\n"));
    process.exit(1);
  }
  console.log(C.green("✓"));
  console.log(C.dim(`  Instalado: ${marker.version}  ·  último: ${latest}`));
  if (marker.version === latest && !flags.force) {
    console.log(C.green("\n  ✓ " + t().updUpToDate + "\n"));
    return;
  }

  process.stdout.write(C.dim(`\n  ${t().downloading(latest)}`));
  const { buf, version } = await download();
  console.log(C.green("✓") + C.dim(` ${(buf.length / 1024).toFixed(0)} KB`));
  extractOver(buf, dir, marker.slug, version);
  ensureMemberDefaults(buf, dir); // entrega defaults nuevos de member/ sin pisar los del miembro
  console.log(C.green(`\n  ✓ ${t().updDone(version)}\n`));
  console.log("  " + t().updPublish);
  console.log(C.dim("    ") + C.azul(t().updPublishCmd) + C.dim("  (pnpm install && pnpm deploy)\n"));
}

// doctor — diagnostica el bot instalado: config local, versión, licencia y si el
// worker responde. Uso recurrente: corre `npx juancitoads doctor` cuando algo falle.
async function cmdDoctor(dirArg, flags) {
  const cfg = loadCfg(); if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  banner();
  const ok = (m) => console.log("  " + C.green("✓") + " " + m);
  const warn = (m, hint) => { console.log("  " + C.yellow("⚠") + " " + m); if (hint) console.log("    " + C.dim(hint)); };
  const bad = (m, hint) => { console.log("  " + C.red("✗") + " " + m); if (hint) console.log("    " + C.dim(hint)); };
  let problems = 0;

  const dir = resolveBotDir(dirArg);
  if (!dir) { bad("No encontré un bot aquí.", "Corre esto dentro de la carpeta de tu bot, o pásala: juancitoads doctor <carpeta>"); process.exit(1); }
  ok(`Bot encontrado en ${C.azul(dir)}`);

  // 1) marcador de instalación
  let marker = {};
  try { marker = JSON.parse(readFileSync(join(dir, MARKER), "utf8")); ok(`Instalado: ${C.azul(marker.slug)} v${marker.version}`); }
  catch { bad("Marcador de instalación ilegible.", `Falta o está corrupto ${MARKER}`); problems++; }

  // 2) archivos clave
  const has = (f) => existsSync(join(dir, f));
  if (has("wrangler.toml")) ok("wrangler.toml presente"); else { bad("Falta wrangler.toml", "Sin él no se puede desplegar el bot."); problems++; }
  if (has("package.json")) ok("package.json presente"); else { warn("Falta package.json"); problems++; }
  if (has("node_modules")) ok("Dependencias instaladas"); else warn("Dependencias sin instalar", "Corre: pnpm install");
  if (has(join("member", "config.local.ts"))) ok("Negocio configurado (member/config.local.ts)"); else warn("El negocio aún no está configurado", "Corre el onboarding: juancitoads init");

  // 3) config del wrangler.toml (BOT_NAME / BOT_NICHE / URL del panel)
  let wt = "";
  try { wt = readFileSync(join(dir, "wrangler.toml"), "utf8"); } catch {}
  const val = (k) => { const m = wt.match(new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']*)`, "m")); return m ? m[1] : null; };
  const botName = val("BOT_NAME"), botNiche = val("BOT_NICHE"), baseUrl = val("DASHBOARD_BASE_URL");
  if (botName) ok(`Nombre del negocio: ${C.azul(botName)}`); else warn("BOT_NAME sin definir", "El bot no sabe cómo se llama tu negocio.");
  if (botNiche) ok(`Giro (nicho): ${C.azul(botNiche)}`); else warn("BOT_NICHE sin definir", "El panel usará el genérico en vez del de tu giro.");

  // 4) versión vs repo (el SHA del commit es la versión)
  try {
    const latest = await repoVersion();
    if (latest && marker.version) {
      if (marker.version !== latest) warn(`Hay una versión nueva: ${latest} (tienes ${marker.version})`, "Actualiza: npx juancitoads update");
      else ok("Estás en la última versión");
    }
  } catch { warn("No pude consultar GitHub (¿sin internet?)"); }

  // 6) ¿el worker responde?
  if (baseUrl) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(baseUrl.replace(/\/$/, "") + "/admin/overview", { signal: ctrl.signal });
      clearTimeout(to);
      if (r.status === 200 || r.status === 401) ok(`El bot responde en línea (${baseUrl})`);
      else warn(`El bot respondió con HTTP ${r.status}`, "Revisa el último deploy.");
    } catch { warn("El bot no respondió", `¿Ya desplegaste? pnpm deploy · URL: ${baseUrl}`); }
  } else warn("Sin DASHBOARD_BASE_URL", "No pude probar si el bot está en línea; se llena al desplegar.");

  // 7) WhatsApp Cloud API — opt-in (pega a la Graph API de Meta, más lento). El
  // agente del onboarding pasa token/phone-id/verify-token por flags: son los que
  // acaba de setear como secrets, y los secrets de Cloudflare son write-only.
  if (flags.whatsapp) problems += await doctorWhatsApp(dir, flags, baseUrl);

  console.log("");
  if (problems === 0) console.log("  " + C.green("Todo en orden. Tu bot está sano.") + "\n");
  else console.log("  " + C.yellow(`${problems} cosa(s) que revisar arriba.`) + "\n");
}

// ── doctor --whatsapp: diagnóstico de la conexión de WhatsApp Cloud API ─────
// Los secrets de Cloudflare son write-only (no se pueden leer con wrangler), así
// que la PRESENCIA se checa con `wrangler secret list` (solo nombres) y los
// VALORES para golpear la Graph API los pasa el agente por flags —los tiene a
// mano porque los acaba de setear en el onboarding—: --token --phone-id
// --verify-token --waba-id (opcional) --url (opcional, cae a DASHBOARD_BASE_URL).
// Si falta un flag para un check puntual, ese check se marca "no evaluado" en
// vez de tumbar todo el diagnóstico.
const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

function fmtUnixDate(sec) {
  try { return new Date(sec * 1000).toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" }); }
  catch { return String(sec); }
}

async function graphGet(path, token, ms = 8000) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetchTimeout(`${GRAPH_API_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`, {}, ms);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

// Traduce errores comunes de la Graph API (ej. 190 = token inválido/vencido).
function graphErrMsg(body) {
  const e = body && body.error;
  if (!e) return "";
  if (e.code === 190) return "token inválido o vencido (error 190)";
  return `${e.message || "error de la Graph API"}${e.code != null ? ` (código ${e.code})` : ""}`;
}

async function doctorWhatsApp(dir, flags, fallbackUrl) {
  const ok = (m) => console.log("  " + C.green("✓") + " " + m);
  const warn = (m, hint) => { console.log("  " + C.yellow("⚠") + " " + m); if (hint) console.log("    " + C.dim(hint)); };
  const bad = (m, hint) => { console.log("  " + C.red("✗") + " " + m); if (hint) console.log("    " + C.dim(hint)); };
  const skip = (m, flagsNeeded) => console.log("  " + C.dim(`○ ${m}: no evaluado — pásame --${flagsNeeded}`));
  let problems = 0;

  console.log("\n  " + C.b("WhatsApp Cloud API"));

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const token = str(flags.token);
  const phoneId = str(flags["phone-id"]);
  const verifyToken = str(flags["verify-token"]);
  let wabaId = str(flags["waba-id"]);
  const workerUrl = normalizeWorkerUrl(str(flags.url) || fallbackUrl || "");

  // 1) estado del número
  if (token && phoneId) {
    try {
      const { status, body } = await graphGet(
        `/${phoneId}?fields=display_phone_number,verified_name,code_verification_status,platform_type,status,name_status,messaging_limit_tier`,
        token,
      );
      if (status === 200 && !body.error) {
        if (body.status === "CONNECTED" && body.code_verification_status === "VERIFIED") {
          ok(`Número conectado: ${C.azul(body.display_phone_number || phoneId)} (${body.verified_name || "sin nombre verificado"}) · tier de mensajería: ${body.messaging_limit_tier || "?"}`);
        } else {
          warn(`Número ${body.display_phone_number || phoneId}: status=${body.status || "?"} · verificación=${body.code_verification_status || "?"}`,
            "Revisa el número en Meta Business Manager → WhatsApp Manager → Números de teléfono.");
          problems++;
        }
      } else { bad("Estado del número: la Graph API respondió con error", graphErrMsg(body) || `HTTP ${status}`); problems++; }
    } catch { bad("Estado del número: no pude contactar la Graph API", "Revisa tu conexión a internet o que el --phone-id sea correcto."); problems++; }
  } else skip("Estado del número", "token y --phone-id");

  // WABA ID: --waba-id, o inferido del número si la Graph API lo trae (best-effort).
  if (!wabaId && token && phoneId) {
    try {
      const { status, body } = await graphGet(`/${phoneId}?fields=whatsapp_business_account`, token);
      if (status === 200 && body.whatsapp_business_account?.id) wabaId = body.whatsapp_business_account.id;
    } catch { /* silencioso: es solo un intento extra de inferencia */ }
  }

  // 2) suscripción al webhook
  if (token && wabaId) {
    try {
      const { status, body } = await graphGet(`/${wabaId}/subscribed_apps`, token);
      if (status === 200 && !body.error) {
        const apps = Array.isArray(body.data) ? body.data : [];
        if (apps.length > 0) ok(`Webhook suscrito (${apps.length} app${apps.length === 1 ? "" : "s"} suscrita${apps.length === 1 ? "" : "s"} a esta WABA)`);
        else { bad("Sin apps suscritas al webhook de esta WABA", "No van a llegar mensajes. Suscribe el campo `messages`: Meta → WhatsApp → Configuración → Webhooks → Suscribir."); problems++; }
      } else { bad("Suscripción al webhook: la Graph API respondió con error", graphErrMsg(body) || `HTTP ${status}`); problems++; }
    } catch { bad("Suscripción al webhook: no pude contactar la Graph API", "Revisa tu conexión a internet."); problems++; }
  } else skip("Suscripción al webhook", "waba-id (o token + phone-id para inferirla)");

  // 3) números de la WABA — ¿el phone-id configurado sigue existiendo ahí?
  if (token && wabaId && phoneId) {
    try {
      const { status, body } = await graphGet(`/${wabaId}/phone_numbers`, token);
      if (status === 200 && !body.error) {
        const ids = (Array.isArray(body.data) ? body.data : []).map((p) => p.id);
        if (ids.includes(phoneId)) ok(`El número configurado (${phoneId}) sí pertenece a esta WABA`);
        else {
          bad("El WHATSAPP_PHONE_NUMBER_ID configurado no está en esta WABA",
            "El bot apunta a un número que ya no existe o cambió. Regrábalo: npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID");
          problems++;
        }
      } else { bad("Números de la WABA: la Graph API respondió con error", graphErrMsg(body) || `HTTP ${status}`); problems++; }
    } catch { bad("Números de la WABA: no pude contactar la Graph API", "Revisa tu conexión a internet."); problems++; }
  } else skip("Números de la WABA", "waba-id y --phone-id (o token + phone-id para inferir la waba)");

  // 4) vigencia del token — el check más importante: uno temporal mata el bot solo.
  if (token) {
    try {
      const { status, body } = await graphGet(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
      const data = body && body.data;
      if (status === 200 && data && !body.error) {
        const expiresAt = data.expires_at;
        const scopes = Array.isArray(data.scopes) ? data.scopes : [];
        const missingScopes = ["whatsapp_business_management", "whatsapp_business_messaging"].filter((s) => !scopes.includes(s));
        if (expiresAt === 0) ok(`Token permanente (System User) · tipo=${data.type || "?"}`);
        else if (typeof expiresAt === "number") {
          warn(`Token TEMPORAL — expira el ${fmtUnixDate(expiresAt)}`,
            "El bot dejará de responder cuando expire. Genera uno de System User (FASE F de la guía de conexión).");
          problems++;
        } else { warn("No pude determinar la vigencia del token (respuesta sin expires_at)", "Vuelve a correr el check; si persiste, regenera el token."); problems++; }
        if (data.type && data.type !== "SYSTEM_USER") {
          warn(`Tipo de token: ${data.type} (se espera SYSTEM_USER en producción)`, "Usa un token de System User, no uno de usuario personal — se revoca solo si cambias tu password.");
          problems++;
        }
        if (missingScopes.length) { warn(`Al token le faltan permisos: ${missingScopes.join(", ")}`, "Regenera el token incluyendo esos scopes."); problems++; }
      } else { bad("Vigencia del token: la Graph API respondió con error", graphErrMsg(body) || `HTTP ${status}`); problems++; }
    } catch { bad("Vigencia del token: no pude contactar la Graph API", "Revisa tu conexión a internet."); problems++; }
  } else skip("Vigencia del token", "token");

  // 5) handshake del webhook propio (no depende de Meta, sí de tu Worker)
  if (workerUrl && verifyToken) {
    try {
      const r = await fetchTimeout(
        `${workerUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=ping`,
        {}, 8000,
      );
      const text = (await r.text().catch(() => "")).trim();
      if (r.status === 200 && text === "ping") ok("Handshake del webhook: tu worker responde bien al challenge de Meta");
      else {
        bad(`Handshake del webhook: HTTP ${r.status}${text ? ` · respondió "${text.slice(0, 60)}"` : " · sin cuerpo"}`,
          "Revisa que WHATSAPP_VERIFY_TOKEN en el worker sea EXACTAMENTE el mismo --verify-token, y que la ruta /webhooks/whatsapp exista. " +
          "Logs en vivo: npx wrangler tail (nota macOS: no existe `timeout` por default — corre wrangler tail en segundo plano y mátalo con kill, o instala coreutils para tener `gtimeout`).");
        problems++;
      }
    } catch { bad("Handshake del webhook: tu worker no respondió", `¿Ya desplegaste? URL probada: ${workerUrl}`); problems++; }
  } else skip("Handshake del webhook", "url y --verify-token");

  // 6) presencia de los 4 secrets — vía `wrangler secret list` (solo nombres; los
  // valores son write-only y no se pueden leer).
  try {
    const out = execFileSync("npx", ["wrangler", "secret", "list"], {
      cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, shell: process.platform === "win32",
    }).toString();
    let names = [];
    try { names = JSON.parse(out).map((s) => s.name); } catch { names = out.match(/[A-Z][A-Z0-9_]+/g) || []; }
    const required = [
      { name: "WHATSAPP_PHONE_NUMBER_ID" },
      { name: "WHATSAPP_ACCESS_TOKEN" },
      { name: "WHATSAPP_VERIFY_TOKEN", fallback: "META_VERIFY_TOKEN" },
      { name: "WHATSAPP_APP_SECRET", fallback: "META_APP_SECRET" },
    ];
    for (const { name, fallback } of required) {
      const present = names.includes(name) ? name : (fallback && names.includes(fallback) ? fallback : null);
      if (present) ok(`Secret presente: ${C.azul(present)}`);
      else { bad(`Falta el secret ${name}${fallback ? ` (o ${fallback})` : ""}`, `Ponlo: npx wrangler secret put ${name}`); problems++; }
    }
  } catch {
    bad("No pude listar los secrets con wrangler", "¿Estás dentro de la carpeta del bot y wrangler está autenticado? Corre: npx wrangler secret list");
    problems++;
  }

  return problems;
}
// Acepta la URL del worker como la pegue el usuario (con o sin esquema, con o
// sin barra final) y la deja canónica. Solo https: un worker nunca es http.
function normalizeWorkerUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+$/, "");
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
}

async function fetchTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(to); }
}

// Reintenta llamadas al control plane ante transitorios (red caída, timeout, 5xx)
// con backoff corto. NO reintenta 4xx: son deterministas (plan, licencia, etc.).
async function fetchRetry(url, opts = {}, { ms = 8000, tries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchTimeout(url, opts, ms);
      if (res.status < 500) return res; // respuesta final (2xx/3xx/4xx)
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  throw lastErr || new Error("network");
}

function parseFlags(args) {
  const flags = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      // flag booleano si no hay valor o el siguiente token es otra flag (ej. --yes, --no-agent-skill)
      if (next === undefined || next.startsWith("--")) { flags[key] = true; }
      else { flags[key] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

// Se ejecuta como CLI solo cuando se invoca directo (npx juancitoads / node cli.js), no
// cuando se importa para pruebas (ahí solo se exponen las funciones puras de abajo).
// Robusto ante symlinks: npx expone el bin como enlace "juancitoads" (no "cli.js"), así
// que comparamos la ruta REAL (realpath) contra este módulo, con respaldo por nombre.
const IS_MAIN = (() => {
  const argv1 = process.argv[1] || "";
  try {
    if (realpathSync(argv1) === fileURLToPath(import.meta.url)) return true;
  } catch { /* argv1 raro o inexistente */ }
  const base = argv1.replace(/\\/g, "/").split("/").pop() || "";
  return base === "cli.js" || base === "juancitoads";
})();
// ── panel de ayuda / soporte ─────────────────────────────────────────────────
// No hay soporte comercial ni licencias que arreglar: todo pasa por el repo.
function cmdAyuda() {
  const cfg = loadCfg(); if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
  banner();
  const en = L === "en";
  console.log("  " + C.b(en ? "🆘 Juancito Ads help & support" : "🆘 Ayuda y soporte de Juancito Ads") + "\n");
  console.log("  " + C.azul(en ? "📚 Docs & guides" : "📚 Guías y docs") + "     " + REPO_URL + "#readme");
  console.log("  " + C.azul(en ? "💬 Questions" : "💬 Preguntas") + "         " + REPO_URL + "/discussions");
  console.log("  " + C.azul(en ? "🐛 Bugs & ideas" : "🐛 Bugs e ideas") + "      " + REPO_URL + "/issues\n");
  console.log("  " + C.b(en ? "When you open an issue, include:" : "Cuando abras un issue, incluye:"));
  console.log("   1. " + (en ? "Which command failed and what you expected" : "Qué comando falló y qué esperabas"));
  console.log("   2. " + C.azul("npx juancitoads doctor") + (en ? " output (run it inside the bot folder)" : " (córrelo en la carpeta del bot)"));
  console.log("   3. " + (en ? "Your OS and `node -v`" : "Tu sistema operativo y `node -v`") + "\n");
  console.log(C.dim(en
    ? "  Juancito Ads is free and self-hosted: there are no licenses, accounts or plans.\n"
    : "  Juancito Ads es gratis y self-hosted: no hay licencias, cuentas ni planes.\n"));
}

if (IS_MAIN) {
  const [cmd, ...args] = process.argv.slice(2);
  const { flags, rest } = parseFlags(args);
  (async () => {
    if (cmd === "list") return cmdList();
    if (cmd === "install") return cmdInstall(rest[0], flags);
    if (cmd === "update") return cmdUpdate(rest[0], flags);
    if (cmd === "doctor") return cmdDoctor(rest[0], flags);
    if (cmd === "ayuda" || cmd === "soporte" || cmd === "help") return cmdAyuda();
    if (cmd === "init") return cmdInit(flags);
    // sin comando (o comando desconocido) → ayuda
    const cfg = loadCfg(); if (cfg.lang && DICT[cfg.lang]) L = cfg.lang;
    banner();
    console.log("  " + t().commands + "  " + C.azul("init") + "  " + C.azul("list") + "  " + C.azul("install <slug>") + "  " + C.azul("update") + "  " + C.azul("doctor") + "  " + C.azul("ayuda") + "\n");
    console.log(C.dim("  Flags de init (modo no-interactivo, para agentes):"));
    console.log(C.dim("    --yes  --giro <slug>  --name/--negocio  --que --ofrece --horario --ubicacion"));
    console.log(C.dim("    --telefono --web --pagos --faq --reglas"));
    console.log(C.dim("    --tono cercano|formal|divertido  --cerebro claude|chatgpt|grok"));
    console.log(C.dim("    --region es-PA|es-419|es-ES|en|pt-BR   (alias viejo: --lang es|en)"));
    console.log(C.dim("  Flags de update: --force  (reinstala aunque ya estés en el último commit)"));
    console.log(C.dim("  Flags de doctor --whatsapp: --url https://…  --token <ACCESS_TOKEN>  --phone-id <ID>  --verify-token <TOKEN>  --waba-id <ID> (opcional)\n"));
    console.log(C.dim(`  Código: ${REPO_URL}\n`));
  })();
}

// Exports para pruebas (no afectan el uso como CLI).
export { renderMemberConfig, stampBrandAndBrain, writeStarterConfig, select, forgeSplash, installAgentSkill, parseFlags, starterOnboarding, stampBotConfig, applyBusinessFlags, catalog, ensureProTier };
