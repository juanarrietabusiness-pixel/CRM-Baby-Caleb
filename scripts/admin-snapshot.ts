#!/usr/bin/env tsx
/**
 * admin-snapshot.ts
 *
 * Renders every `/admin` tab to a standalone HTML file under `.snapshots/`,
 * using an in-memory Miniflare D1 seeded with deterministic demo data.
 *
 * Why this exists
 * ---------------
 * The dashboard is server-rendered HTML with no component tests behind it, so
 * a layout change (mobile work, a token swap, dropping the Tailwind CDN) can
 * silently wreck a tab nobody opened during review. This script gives that work
 * a before/after: run it on `main`, keep the output, run it on the branch and
 * diff. Two ways to read the diff:
 *
 *   - `diff -r` the HTML — catches structural regressions exactly.
 *   - Serve the folder and screenshot it — catches what only the eye catches.
 *     `pnpm snapshot && cd .snapshots && python3 -m http.server` then point a
 *     browser (or Playwright) at each file. The assets the pages reference from
 *     `public/` are copied in next to them, so the pages render offline.
 *
 * The seed is deliberate, not random: fixed names, fixed message bodies, and a
 * clock floored to the current hour (see NOW). Two runs of the same commit
 * inside the same hour produce byte-identical files, so any diff is a real diff.
 *
 * Usage:  pnpm snapshot [--out <dir>]
 */
import { mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTestMiniflare } from "../test/helpers/miniflareSetup";
import { adminApp } from "../src/admin/routes";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
import { LeadsRepo } from "../src/db/leads";
import { TicketsRepo } from "../src/db/tickets";
import { InsightsRepo } from "../src/db/insights";
import { SuggestionsRepo } from "../src/db/suggestions";
import type { Env } from "../src/env";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PASSWORD = "snapshot";

/**
 * The seed clock: the current hour, floored.
 *
 * It has to track real time, not a hardcoded date — several tabs (Estadísticas,
 * Costos, Insights) only count the last 30 days, so a fixed instant makes every
 * chart render empty a month after it was written, and the snapshot stops
 * showing what it is supposed to show.
 *
 * Flooring to the hour keeps it reproducible where it matters: two runs within
 * the same hour produce byte-identical files, so a diff taken during one review
 * session is a real diff. Across hours only the relative time labels move.
 */
const NOW = Math.floor(Date.now() / 3_600_000) * 3_600_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The tabs a snapshot covers, in sidebar order. */
const PAGES: { name: string; path: string }[] = [
  { name: "01-overview", path: "/overview" },
  { name: "02-conversations", path: "/conversations" },
  { name: "03-conversations-thread", path: "/conversations?c=telegram%3A5512" },
  { name: "04-leads", path: "/leads" },
  { name: "05-tickets", path: "/tickets" },
  { name: "06-campanas", path: "/campanas" },
  { name: "07-agente", path: "/agente" },
  { name: "08-kb", path: "/kb" },
  { name: "08b-catalogo", path: "/catalogo" },
  { name: "09-mejoras", path: "/mejoras" },
  { name: "10-conexiones", path: "/conexiones" },
  { name: "11-config", path: "/config" },
  { name: "12-insights", path: "/insights" },
  { name: "13-stats", path: "/stats" },
  { name: "14-costs", path: "/costs" },
  { name: "15-login", path: "/login" },
];

function basicAuth(): Record<string, string> {
  const b64 = Buffer.from(`admin:${PASSWORD}`, "utf-8").toString("base64");
  return { Authorization: `Basic ${b64}` };
}

/**
 * Seeds a small but *representative* business: conversations on three channels,
 * one of them angry, one paused with a human in control, leads in every status,
 * an open ticket, a couple of AI suggestions, and a month of message history so
 * the charts and the cost tab have something to draw.
 */
async function seed(db: Db): Promise<void> {
  const convs = new ConversationsRepo(db);
  const msgs = new MessagesRepo(db);
  const leads = new LeadsRepo(db);
  const tickets = new TicketsRepo(db);
  const insights = new InsightsRepo(db);
  const suggestions = new SuggestionsRepo(db);

  const people: { channel: string; id: string; name: string; ago: number }[] = [
    { channel: "telegram", id: "5512", name: "María Fernanda Ruiz", ago: 12 * MIN },
    { channel: "whatsapp", id: "573001", name: "Carlos Restrepo", ago: 55 * MIN },
    { channel: "instagram", id: "ig_88", name: "Valentina Ocampo", ago: 3 * HOUR },
    { channel: "whatsapp", id: "573002", name: "Jorge Andrés Peña", ago: 6 * HOUR },
    { channel: "telegram", id: "5590", name: "Luisa Mendoza", ago: 20 * HOUR },
    { channel: "messenger", id: "fb_31", name: "Diego Barrera", ago: 2 * DAY },
  ];

  const turns: [string, string][][] = [
    [
      ["user", "Buenas, ¿todavía tienen disponibilidad para esta semana?"],
      ["assistant", "¡Hola María! Sí, tenemos cupos el jueves y el viernes en la mañana. ¿Cuál te sirve?"],
      ["user", "El jueves temprano estaría perfecto."],
      ["assistant", "Listo, te aparto el jueves a las 8:00 a. m. ¿Me confirmas tu número para el recordatorio?"],
    ],
    [
      ["user", "¿Cuánto me sale el servicio completo?"],
      ["assistant", "El servicio completo está en $180.000 e incluye la revisión y el informe. ¿Te paso el detalle?"],
      ["user", "Sí porfa, y si hay algún descuento por dos."],
    ],
    [
      ["user", "Llevo tres días esperando respuesta y nadie me contesta 🙄"],
      ["assistant", "Lamento la demora, Valentina. Ya marqué tu caso como urgente y una persona del equipo te escribe hoy."],
    ],
    [
      ["user", "Necesito factura a nombre de la empresa."],
      ["assistant", "Claro que sí. Pásame el NIT y la razón social y la dejamos lista."],
      ["user", "NIT 900.123.456-7, Distribuciones Peña S.A.S."],
    ],
    [
      ["user", "¿Abren los sábados?"],
      ["assistant", "Sí, los sábados atendemos de 9:00 a. m. a 1:00 p. m."],
    ],
    [
      ["user", "Gracias, quedé muy contento con la atención 👏"],
      ["assistant", "¡Qué bueno leer eso, Diego! Aquí estamos para lo que necesites."],
    ],
  ];

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const conv = await convs.getOrCreate(p.channel, p.id, p.name);
    const thread = turns[i];
    for (let t = 0; t < thread.length; t++) {
      const [role, text] = thread[t];
      const at = NOW - p.ago + t * 90_000;
      await msgs.append(
        conv.id,
        role as "user" | "assistant",
        text,
        role === "assistant"
          ? {
              createdAt: at,
              modelUsed: "claude-haiku-4-5-20251001",
              inputTokens: 900 + t * 120,
              outputTokens: 70 + t * 15,
              cachedInputTokens: 400,
              toolCalls: t === 1 ? [{ toolName: "searchKb", input: { query: "precios" } }] : undefined,
            }
          : { createdAt: at },
      );
    }
    await db.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [
      NOW - p.ago + thread.length * 90_000,
      conv.id,
    ]);
  }

  // One conversation paused: the owner took over. Exercises the takeover UI.
  await db.run("UPDATE conversations SET paused_until = ? WHERE id = ?", [
    NOW + 2 * HOUR,
    "instagram:ig_88",
  ]);

  // A month of traffic behind the charts, tapering toward today.
  const filler = await convs.getOrCreate("whatsapp", "hist", "Histórico");
  for (let d = 30; d >= 1; d--) {
    const perDay = 3 + ((d * 7) % 9);
    for (let n = 0; n < perDay; n++) {
      const at = NOW - d * DAY + n * 25 * MIN;
      await msgs.append(filler.id, "user", `Consulta ${d}-${n}`, { createdAt: at });
      await msgs.append(filler.id, "assistant", `Respuesta ${d}-${n}`, {
        createdAt: at + 40_000,
        modelUsed: "claude-haiku-4-5-20251001",
        inputTokens: 1100,
        outputTokens: 95,
        cachedInputTokens: 600,
      });
    }
  }

  await leads.create({
    conversationId: "telegram:5512",
    channelUserId: "5512",
    name: "María Fernanda Ruiz",
    contact: "+57 310 555 0142",
    intent: "Agendar servicio completo",
    notes: "Quiere el jueves a las 8:00 a. m. Confirmó por Telegram.",
  });
  await leads.create({
    conversationId: "whatsapp:573001",
    channelUserId: "573001",
    name: "Carlos Restrepo",
    contact: "+57 300 555 0199",
    intent: "Cotización servicio x2",
    notes: "Pidió descuento por dos unidades.",
  });
  await leads.create({
    conversationId: "whatsapp:573002",
    channelUserId: "573002",
    name: "Jorge Andrés Peña",
    contact: "compras@distribucionespena.co",
    intent: "Facturación empresarial",
    notes: "NIT 900.123.456-7 · Distribuciones Peña S.A.S.",
  });
  await db.run("UPDATE leads SET status = 'sold' WHERE contact = ?", ["+57 310 555 0142"]);
  await db.run("UPDATE leads SET status = 'contacted' WHERE contact = ?", ["+57 300 555 0199"]);

  await tickets.create({
    conversationId: "instagram:ig_88",
    category: "demora",
    summary: "Cliente lleva tres días sin respuesta y pide hablar con una persona.",
    transcript: "Llevo tres días esperando respuesta y nadie me contesta",
  });

  await insights.upsert({
    conversationId: "instagram:ig_88",
    analyzedAt: NOW - 2 * HOUR,
    sentiment: "frustrated",
    resolution: "escalated",
    botScore: 2,
    topics: ["demora", "atención humana"],
    summary: "Reclamo por demora en la respuesta. Se escaló a una persona del equipo.",
    missedKb: "¿Cuál es el tiempo de respuesta prometido?",
    saleOpportunity: false,
  });
  await insights.upsert({
    conversationId: "telegram:5512",
    analyzedAt: NOW - 10 * MIN,
    sentiment: "positive",
    resolution: "resolved",
    botScore: 5,
    topics: ["agendamiento", "disponibilidad"],
    summary: "Agendó servicio completo para el jueves. El bot resolvió sin ayuda.",
    missedKb: null,
    saleOpportunity: true,
  });

  await suggestions.createIfNew({
    kind: "kb_entry",
    fingerprint: "tiempo-de-respuesta",
    title: "Falta el tiempo de respuesta prometido en la base de conocimiento",
    payload: { question: "¿En cuánto tiempo responden?" },
    evidence: "3 clientes preguntaron lo mismo en la última semana.",
  });
  await suggestions.createIfNew({
    kind: "kb_entry",
    fingerprint: "horario-sabado",
    title: "Confirmar el horario del sábado en la base de conocimiento",
    payload: { question: "¿Abren los sábados?" },
    evidence: "El bot respondió de memoria, sin una fuente que lo respalde.",
  });

  // El catálogo, para que esa pestaña no se rinda vacía. Dos productos en dos
  // bodegas cada uno: es lo mínimo que hace visible la tabla de existencias.
  const items = [
    ["NAT-RN", "Pañal Natural recién nacido", 480, 990, 42, "Bodega Ciudad de Panamá"],
    ["NAT-RN", "Pañal Natural recién nacido", 480, 990, 6, "Bodega Panamá Oeste"],
    ["MOON-FUL", "Body Moon manga larga", 1250, 2490, 18, "Bodega Ciudad de Panamá"],
    ["MOON-FUL", "Body Moon manga larga", 1250, 2490, 0, "Bodega Panamá Oeste"],
  ] as const;
  for (const [code, name, cost, sale, stock, branch] of items) {
    await db.run(
      `INSERT INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [code, name, cost, sale, stock, branch, NOW],
    );
  }
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const outDir = outFlag !== -1 ? path.resolve(process.argv[outFlag + 1]) : path.join(ROOT, ".snapshots");

  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as unknown as D1Database;
  const db = new Db(d1);
  await seed(db);

  const env = {
    DB: d1,
    BOT_NAME: "Baby Caleb",
    BUSINESS_NAME: "Baby Caleb",
    BOT_LANGUAGE: "es-419",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // The pages link /logo.svg, /favicon.svg… — served from public/ in production.
  // Copying them next to the snapshots makes the folder self-contained.
  const pub = path.join(ROOT, "public");
  if (existsSync(pub)) cpSync(pub, outDir, { recursive: true });

  let failures = 0;
  for (const page of PAGES) {
    const res = await adminApp.request(page.path, { headers: basicAuth() }, env);
    const html = await res.text();
    if (res.status !== 200) {
      console.error(`  ✗ ${page.name.padEnd(26)} HTTP ${res.status}`);
      failures++;
      continue;
    }
    writeFileSync(path.join(outDir, `${page.name}.html`), html, "utf-8");
    console.log(`  ✓ ${page.name.padEnd(26)} ${String(html.length).padStart(7)} bytes`);
  }

  await mf.dispose();

  console.log(`\n${PAGES.length - failures}/${PAGES.length} páginas en ${path.relative(ROOT, outDir)}/`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
