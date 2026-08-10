// Dashboard shell: a fixed 248px sidebar (grouped navigation) + a live-status
// topbar, wrapping each tab's server-rendered body. Brand theme ("Juancito
// Ads"): deep navy + neon blue, headings in Inter over Hanken Grotesk body
// copy, with JetBrains Mono reserved for data. Design tokens are exposed both
// as CSS custom properties (for inline styles) and mapped to Tailwind color
// names (for utility classes) — see docs/design-system.md, the contract every
// view follows.
//
// The layout() API is unchanged: views keep their own activeTab id; the group,
// breadcrumb and page title are derived here.

import type { Env } from "../../env";
import { isPro, PRO_ONLY_TABS } from "../../config";
import { getNiche } from "../../niches";
import type { NichePack } from "../../niches";

const UPGRADE_URL = "/admin/upgrade";

/** Escapa texto que viene de la configuración antes de meterlo en el HTML. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

interface Item {
  id: string;
  label: string;
  href: string;
  icon: string; // lucide icon name
}

interface Section {
  label: string;
  items: Item[];
}

// Navigation model. The item ids + hrefs are load-bearing (views and tests
// depend on them) — do not rename them. Icons are lucide names.
const NAV: Section[] = [
  {
    label: "Inicio",
    items: [{ id: "overview", label: "Resumen", href: "/admin/overview", icon: "layout-dashboard" }],
  },
  {
    label: "Bandeja",
    items: [
      { id: "conversations", label: "Conversaciones", href: "/admin/conversations", icon: "messages-square" },
      { id: "leads", label: "Leads", href: "/admin/leads", icon: "user-plus" },
      { id: "tickets", label: "Tickets", href: "/admin/tickets", icon: "life-buoy" },
      { id: "campanas", label: "Campañas", href: "/admin/campanas", icon: "megaphone" },
    ],
  },
  {
    label: "Mi Agente",
    items: [
      { id: "agente", label: "Flujo", href: "/admin/agente", icon: "workflow" },
      { id: "kb", label: "Conocimiento", href: "/admin/kb", icon: "book-open" },
      { id: "mejoras", label: "Mejoras", href: "/admin/mejoras", icon: "sparkles" },
      { id: "conexiones", label: "Conexiones", href: "/admin/conexiones", icon: "plug-zap" },
      { id: "config", label: "Configuración", href: "/admin/config", icon: "sliders-horizontal" },
    ],
  },
  {
    label: "Análisis",
    items: [
      { id: "insights", label: "Insights", href: "/admin/insights", icon: "scan-eye" },
      { id: "stats", label: "Estadísticas", href: "/admin/stats", icon: "bar-chart-3" },
      { id: "costs", label: "Costos", href: "/admin/costs", icon: "receipt" },
    ],
  },
];

// <head> assets: fonts, Tailwind CDN + token config, lucide, htmx.
const HEAD_ASSETS = `
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="icon" href="/favicon-192.png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            bg: "#050D1F",
            panel: "#0A1628",
            panel2: "#0F1E33",
            raise: "#16294A",
            line: "#16294A",
            linelit: "#1B3A6B",
            accent: { DEFAULT: "#1E90FF", soft: "rgba(30,144,255,.12)" },
            accent2: "#F5A623",
            onaccent: "#050D1F",
            cream: "#F4F8FF",
            muted: "#A0B4CC",
            dim: "#6B819B",
            ok: "#57c98a",
            info: "#35c4de",
            warn: "#f2cc3f",
            bad: "#f4364c",
            violet: "#b49bf0",
          },
          fontFamily: {
            display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
            sans: ["'Hanken Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
            mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
          },
        },
      },
    };
  </script>
  <script src="https://unpkg.com/lucide@latest"></script>`;

// Global stylesheet: design tokens, base type/scroll, the reusable component
// classes from the mockups (buttons, rows, cards, chips, canvas nodes), the
// modal/toast/range classes existing views already depend on, and the scanline
// overlay. All motion collapses under prefers-reduced-motion.
const GLOBAL_STYLE = `
<style>
  /* Paleta de marca Juancito Ads (ver PAGINA-JUANCITO-ADS/src/styles/global.css).
     Los valores de identidad —fondo, azul neón, naranja y el gris de texto—
     son los del sitio tal cual; las superficies intermedias son el equivalente
     SÓLIDO del blanco translúcido que el sitio superpone, porque en el panel
     las capas se apilan (sidebar + tarjeta + modal) y la translucidez se
     ensucia. Los colores semánticos NO salen de la marca: una paleta de tres
     colores no puede expresar ocho estados. Ver §1 y §3 de
     docs/design-system.md. */
  :root{
    --bg:#050D1F; --panel:#0A1628; --panel2:#0F1E33; --raise:#16294A;
    --line:#16294A; --linelit:#1B3A6B;
    --accent:#1E90FF; --accent-2:#F5A623; --accent-soft:rgba(30,144,255,.12);
    /* Texto sobre relleno de acento. El azul neón de la marca es luminoso: el
       azul marino encima contrasta 5.9:1, el blanco solo 3.2:1. */
    --on-accent:#050D1F;
    --cream:#F4F8FF; --muted:#A0B4CC; --dim:#6B819B;
    --ok:#57c98a; --info:#35c4de; --warn:#f2cc3f; --bad:#f4364c; --violet:#b49bf0;
    /* legacy aliases kept so mockup-derived snippets keep working */
    --border:#16294A; --border-lit:#1B3A6B; --green:#57c98a; --blue:#35c4de; --red:#f4364c;
    --font-display:Inter,ui-sans-serif,system-ui,sans-serif;
    --font-body:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;
    --font-mono:'JetBrains Mono',ui-monospace,monospace;
  }
  *{box-sizing:border-box}
  /* Las dos tipografías de la marca, repartidas igual que en el sitio: Inter
     para titulares y cifras (--font-display), Hanken Grotesk para el texto
     corrido. La monoespaciada se queda solo para datos —IDs, importes,
     fragmentos de código— vía .font-mono o --font-mono. */
  html,body{margin:0;padding:0;background:var(--bg);color:var(--cream);
    font-family:var(--font-body);-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-decoration:none}
  a:hover{color:var(--accent-2)}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:var(--linelit);border-radius:999px}
  ::-webkit-scrollbar-thumb:hover{background:var(--accent)}
  input,textarea,select{font-family:inherit}
  input::placeholder,textarea::placeholder{color:var(--dim)}
  input[type="range"]{accent-color:var(--accent);height:4px}
  /* Anillo de foco de la marca. Antes cada control dependía del que pinta el
     navegador, que sobre fondo negro casi no se ve. */
  :focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}

  /* ---- FORMA ----
     La marca es de píldoras y bordes suaves; el panel venía de un estilo
     brutalista (radio 0 + sombras duras desplazadas). Estas reglas cambian el
     lenguaje de forma en un solo sitio, sin tocar las vistas: se enganchan a
     las clases que el sistema de diseño ya obliga a usar. */
  /* Tarjeta = superficie de panel + borde. Todas las vistas la escriben así. */
  .bg-panel.border-line,.bg-panel2.border-line,.modal-card,.tkcard,.cfgcard{border-radius:14px}
  /* Que las filas internas se recorten contra la esquina redondeada. */
  .bg-panel.border-line,.bg-panel2.border-line{overflow:hidden}
  /* Controles: píldora para lo que se pulsa, radio suave para lo que se llena. */
  .bigbtn,.ghostbtn,.chip,.subtab,.live-pill,.toast{border-radius:999px}
  input,textarea,select{border-radius:10px}
  .node,.node-card{border-radius:12px}

  /* keyframes */
  @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
  @keyframes ring{0%{box-shadow:0 0 0 0 rgba(87,201,138,.5)}100%{box-shadow:0 0 0 8px rgba(87,201,138,0)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes popIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastOut{to{opacity:0;transform:translateY(8px);visibility:hidden}}

  /* La clase .scanlines sigue existiendo —el <body> y algunas vistas la
     escriben— pero ya no dibuja nada: el barrido de monitor viejo contradice
     la marca. Se deja vacía en vez de borrarla para no tocar 14 vistas. */
  .scanlines::after{content:none}

  /* sidebar nav */
  .navlink{border-radius:10px}
  .navlink:hover{background:var(--panel2);color:var(--cream)}
  .navlink:hover [data-lucide]{color:var(--accent)}

  /* Entrada + botones. La sombra ya no se desplaza: la marca levanta el
     elemento y lo acompaña con un halo difuso del acento. */
  .card{animation:rise .4s cubic-bezier(.16,1,.3,1) both}
  .bigbtn{transition:transform .2s ease,box-shadow .25s ease,background .2s ease}
  .bigbtn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(30,144,255,.35)}
  .bigbtn:active{transform:translateY(0);box-shadow:0 3px 10px rgba(30,144,255,.28)}
  .ghostbtn{transition:border-color .2s ease,color .2s ease,background .2s ease}
  .ghostbtn:hover{border-color:var(--accent);color:var(--cream);background:var(--accent-soft)}
  .glow{text-shadow:0 0 22px var(--accent-soft),0 0 40px rgba(30,144,255,.10)}

  /* list / table rows + interactive bits reused across views */
  .convrow:hover{background:var(--panel2)}
  .convrow:hover .arr{opacity:1;transform:translateX(0)}
  .leadrow:hover{background:var(--panel2)}
  .datarow:hover{background:var(--panel2)}
  .kbrow:hover{background:var(--panel2)}
  .kbrow:hover .kbedit{border-color:var(--accent);color:var(--accent)}
  .tkcard{transition:transform .12s ease,border-color .12s ease}
  .tkcard:hover{border-color:var(--linelit);transform:translateY(-1px)}
  .subtab{transition:all .12s ease;cursor:pointer}
  .subtab:hover{color:var(--cream)}
  .chip:hover{border-color:var(--accent);color:var(--accent)}
  .cfgcard{transition:all .12s ease;cursor:pointer}
  .cfgcard:hover{border-color:var(--linelit)}
  .bar{transition:transform .5s cubic-bezier(.16,1,.3,1)}
  .bargrp:hover .bar{background:var(--accent) !important}

  /* flow-canvas node (mockup ".node") + the existing views' ".node-card" */
  .node{transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;cursor:pointer}
  .node:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 10px 28px rgba(0,0,0,.5)}
  .node-card{transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
  .node-card:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 10px 28px rgba(0,0,0,.5)}

  /* modal + toast (class names kept from prior layout for existing views) */
  .modal-backdrop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
    padding:1rem;background:rgba(5,13,31,.72);backdrop-filter:blur(6px);animation:fadeIn .15s ease-out}
  .modal-card{background:var(--panel);border:1px solid var(--linelit);box-shadow:0 24px 64px rgba(0,0,0,.6);
    animation:popIn .18s cubic-bezier(.16,1,.3,1);transform-origin:center}
  .toast{background:var(--panel);border:1px solid var(--linelit);color:var(--cream);box-shadow:0 14px 40px rgba(0,0,0,.55);
    animation:toastIn .25s cubic-bezier(.16,1,.3,1),toastOut .3s ease-in 2.4s forwards}

  /* app shell */
  .shell{min-height:100vh;display:grid;grid-template-columns:248px 1fr;background:var(--bg)}
  .sb{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .sb-nav{padding:14px 12px;display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
  .sb-sec{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;padding:14px 10px 6px}
  .live-pill{display:flex;align-items:center;gap:9px;background:var(--panel);border:1px solid var(--line);padding:8px 13px}

  @media (max-width:767px){
    .shell{grid-template-columns:1fr}
    .sb{position:sticky;top:0;height:auto;flex-direction:row;align-items:center;border-right:none;border-bottom:1px solid var(--line);overflow-x:auto}
    .sb-brand{flex:none;border-bottom:none !important;border-right:1px solid var(--line)}
    .sb-nav{flex-direction:row;align-items:center;gap:4px;padding:8px 10px;overflow-y:visible;overflow-x:auto}
    .sb-sec{display:none}
    .sb-foot{display:none}
    /* En movil la cabecera va apretada: el boton de salir se queda solo con
       el icono, que sigue siendo objetivo tactil suficiente. */
    .logout-label{display:none}
    .navlink{border-left:none !important;white-space:nowrap;border-bottom:2px solid transparent}
  }

  @media (prefers-reduced-motion:reduce){
    .card,.toast,.modal-backdrop,.modal-card{animation:none}
    .bigbtn,.ghostbtn,.convrow,.leadrow,.datarow,.kbrow,.tkcard,.subtab,.chip,.cfgcard,.node,.node-card,.bar,.navlink{transition:none}
    .bigbtn:hover,.node:hover,.node-card:hover,.tkcard:hover{transform:none}
    .animate-pulse,[style*="animation"]{animation:none !important}
  }
</style>`;

// Re-run lucide after every htmx swap (fragments bring fresh icons) and close
// any open modal with Escape.
const GLOBAL_SCRIPT = `
<script>
  function drawIcons(){ if (window.lucide) window.lucide.createIcons(); }
  document.addEventListener("DOMContentLoaded", drawIcons);
  // lucide's unpkg script may resolve after DOMContentLoaded — retry briefly.
  (function(){ var n=0; var t=setInterval(function(){ if(window.lucide){drawIcons();clearInterval(t);} if(++n>25) clearInterval(t); },120); })();
  document.body.addEventListener("htmx:afterSwap", drawIcons);
  document.body.addEventListener("htmx:oobAfterSwap", drawIcons);
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") {
      var root = document.getElementById("modal-root");
      if (root) root.innerHTML = "";
    }
  });
</script>`;

/**
 * Ícono lucide en línea, para intercalar dentro de una etiqueta de texto.
 *
 * Existe para que las vistas no escriban emojis. Un emoji lo dibuja el sistema
 * operativo: trae su propio color y su propio trazo, se ve distinto en Windows,
 * en Mac y en Android, y ninguno de los tres es el nuestro. Un ícono lucide
 * hereda `currentColor`, así que sigue el token del texto que lo acompaña.
 *
 * El `vertical-align` compensa que el SVG se apoya en la línea base: sin él, el
 * ícono queda un par de píxeles alto respecto a la palabra de al lado.
 *
 * OJO: devuelve HTML. Solo sirve donde la plantilla inyecta crudo — si el
 * destino pasa por `esc()`, el usuario vería la etiqueta `<i>` como texto.
 */
export function ico(name: string, size = 13): string {
  return `<i data-lucide="${name}" width="${size}" height="${size}" style="display:inline-block;vertical-align:-2px;flex:none"></i>`;
}

/**
 * Estado vacío: ícono, una línea que dice qué falta y otra que dice qué hacer.
 *
 * Un panel recién instalado está vacío en casi todas las pestañas, así que esto
 * es lo que más ve un dueño en su primera semana. Una frase suelta centrada en
 * una caja grande se lee como "algo falló"; un ícono y una pista se leen como
 * "todavía no pasa nada, y esto es lo que sigue".
 *
 * `hint` es opcional: si no hay nada útil que sugerir, es mejor no inventarlo.
 */
export function emptyState(icon: string, title: string, hint = ""): string {
  return `<div style="padding:44px 20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:9px">
    <div style="width:42px;height:42px;border-radius:50%;flex:none;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--dim)">
      <i data-lucide="${icon}" width="19" height="19"></i>
    </div>
    <div style="font-size:13.5px;color:var(--muted);font-weight:500">${title}</div>
    ${hint ? `<div style="font-size:12px;color:var(--dim);max-width:46ch;line-height:1.55">${hint}</div>` : ""}
  </div>`;
}

function navItem(item: Item, active: boolean): string {
  const base =
    "display:flex;align-items:center;gap:11px;padding:9px 10px;font-size:13px;";
  const style = active
    ? base + "color:var(--cream);background:var(--accent-soft);border-left:2px solid var(--accent);font-weight:600"
    : base + "color:var(--muted);border-left:2px solid transparent";
  const iconColor = active ? "var(--accent)" : "var(--dim)";
  return `<a href="${item.href}" class="navlink" style="${style}">
    <i data-lucide="${item.icon}" width="17" height="17" style="color:${iconColor}"></i> ${item.label}
  </a>`;
}

// Tier free: los tabs Pro se muestran bloqueados (candado + tag PRO) y llevan a
// la página de upgrade en vez de a la vista real. Se ven, pero invitan a subir.
function navItemLocked(item: Item): string {
  const base =
    "display:flex;align-items:center;gap:11px;padding:9px 10px;font-size:13px;color:var(--dim);border-left:2px solid transparent";
  return `<a href="${UPGRADE_URL}" class="navlink" style="${base}" title="Disponible en Pro">
    <i data-lucide="lock" width="15" height="15" style="color:var(--dim)"></i> ${item.label}
    <span style="margin-left:auto;font-size:8.5px;letter-spacing:.14em;color:var(--accent2);border:1px solid var(--line);padding:1px 5px;border-radius:999px">PRO</span>
  </a>`;
}

// El pack de nicho re-etiqueta el item "leads" (ej. "Leads" → "Reservaciones").
// El id y el href NO cambian (son load-bearing); solo la etiqueta y el ícono.
function applyNiche(item: Item, niche: NichePack | null): Item {
  if (!niche || niche.id === "generico" || item.id !== "leads") return item;
  return { ...item, label: niche.navLabel, icon: niche.navIcon };
}

function sidebar(activeTab: string, pro: boolean, niche: NichePack | null): string {
  const locked = (id: string) => !pro && (PRO_ONLY_TABS as readonly string[]).includes(id);
  const sections = NAV.map((sec) => {
    const hasActive = sec.items.some((i) => i.id === activeTab);
    const labelColor = hasActive ? "var(--accent)" : "var(--dim)";
    const items = sec.items
      .map((raw) => {
        const i = applyNiche(raw, niche);
        return locked(i.id) ? navItemLocked(i) : navItem(i, i.id === activeTab);
      })
      .join("");
    return `<div class="sb-sec" style="color:${labelColor}">${sec.label}</div>${items}`;
  }).join("");

  return `<aside class="sb">
    <div class="sb-brand" style="padding:20px 18px 16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="/logo.png" alt="" width="34" height="34" style="width:34px;height:34px;flex:none;display:block">
        <div style="line-height:1.05">
          <div style="font-family:var(--font-display);font-weight:700;font-size:15px;letter-spacing:-.02em">Juancito Ads</div>
          <div style="font-size:9.5px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase">Panel · ${pro ? "Pro" : "Free"}</div>
        </div>
      </div>
    </div>
    <nav class="sb-nav">${sections}</nav>
    <div class="sb-foot" style="padding:14px;border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line)">
        <div style="width:30px;height:30px;flex:none;border-radius:50%;background:var(--raise);border:1px solid var(--linelit);display:flex;align-items:center;justify-content:center;color:var(--accent)">
          <i data-lucide="bot" width="16" height="16"></i>
        </div>
        <div style="line-height:1.2;overflow:hidden">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;overflow:hidden">Panel del bot</div>
          <div style="font-size:10px;color:var(--dim)">sesión activa</div>
        </div>
      </div>
    </div>
  </aside>`;
}

export function layout(opts: { title: string; activeTab: string; body: string; env?: Env }): string {
  // Tier: si se pasa env, el nav Pro se bloquea para free. Sin env (ej. notFound)
  // se asume Pro para no ocultar nada por accidente.
  const pro = opts.env ? isPro(opts.env) : true;
  const niche = opts.env ? getNiche(opts.env) : null;
  const section = NAV.find((s) => s.items.some((i) => i.id === opts.activeTab)) ?? NAV[0];
  const item = applyNiche(section.items.find((i) => i.id === opts.activeTab) ?? section.items[0], niche);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  ${HEAD_ASSETS}
  ${GLOBAL_STYLE}
</head>
<body class="scanlines">
  <div class="shell">
    ${sidebar(opts.activeTab, pro, niche)}
    <div style="display:flex;flex-direction:column;min-width:0">
      <header style="position:sticky;top:0;z-index:30;background:rgba(5,13,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 26px;display:flex;align-items:center;gap:20px">
        <div style="min-width:0">
          <div style="font-size:10px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase">${section.label} / ${item.label}</div>
          <h1 style="font-family:var(--font-display);font-weight:700;font-size:22px;margin:2px 0 0;letter-spacing:-.02em">${item.label}</h1>
        </div>
        <div id="proj-switcher" style="margin-left:auto"></div>
        <div class="live-pill">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok);animation:pulse 1.8s ease-in-out infinite,ring 2s infinite"></span>
          <span style="font-size:11px;font-weight:600;letter-spacing:.04em">BOT EN LÍNEA</span>
        </div>
        <!-- Con Basic Auth no había forma de cerrar sesión sin cerrar el
             navegador entero. Con la cookie sí, así que aquí está el botón. -->
        <form method="POST" action="/admin/logout" style="flex:none">
          <button class="ghostbtn" type="submit" title="Cerrar sesión"
            style="display:flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 13px;font-size:11.5px;cursor:pointer;font-family:inherit">
            <i data-lucide="log-out" width="14" height="14"></i>
            <span class="logout-label">Salir</span>
          </button>
        </form>
      </header>
      <main style="padding:22px 26px;min-width:0">${opts.body}</main>
    </div>
  </div>
  <div id="modal-root"></div>
  <script>
  // Selector de proyectos: si esta instancia declara PEER_BOTS, el header
  // muestra un dropdown para brincar entre bots (cada uno con su panel).
  fetch('/admin/projects').then(function(r){ return r.ok ? r.json() : null }).then(function(d){
    if (!d || !d.peers || d.peers.length === 0) return;
    var el = document.getElementById('proj-switcher');
    if (!el) return;
    var opts = '<option selected>' + d.current.replace(/</g,'&lt;') + '</option>';
    d.peers.forEach(function(p){
      opts += '<option value="' + p.url.replace(/"/g,'&quot;') + '">' + p.name.replace(/</g,'&lt;') + '</option>';
    });
    // Las comillas simples van con doble barra: este script vive dentro de una
    // plantilla de TypeScript, así que \\' es lo que deja un \' en el JS que
    // llega al navegador. Con una sola barra, la comilla cerraba la cadena y
    // todo este bloque moría con SyntaxError — el selector nunca aparecía.
    el.innerHTML = '<select onchange="if(this.value.indexOf(\\'http\\')===0)window.location=this.value" ' +
      'style="background:rgba(5,13,31,.92);color:var(--cream,#F4F8FF);border:1px solid var(--line);border-radius:8px;' +
      'padding:6px 10px;font-family:\\'JetBrains Mono\\',monospace;font-size:11px;letter-spacing:.04em;cursor:pointer" ' +
      'title="Cambiar de proyecto">' + opts + '</select>';
  }).catch(function(){});
  </script>
  <div id="toast-root" style="position:fixed;bottom:1rem;right:1rem;z-index:60"></div>
  ${GLOBAL_SCRIPT}
</body>
</html>`;
}

// Se muestra cuando el bot corre con BOT_TIER="free" y se pide un tab avanzado.
// NO es una página de venta: en Juancito Ads todo viene desbloqueado y no hay nada
// que comprar. Que aparezca significa que el wrangler.toml quedó en "free" —
// así que explica cómo cambiarlo, en vez de mandar a un sitio a pagar.
// Vive dentro del layout para conservar el nav; `feature` es el tab que se pidió.
export function renderUpgrade(env: Env, feature?: string): string {
  const perks = [
    ["scan-eye", "Analista IA", "Resúmenes automáticos de cada conversación: qué querían, objeciones y oportunidad de venta."],
    ["bar-chart-3", "Estadísticas", "Métricas de volumen, retención y desempeño de tu bot en el tiempo."],
    ["receipt", "Costos", "Cuánto gasta tu bot en IA, con tope de presupuesto mensual."],
    ["sparkles", "Mejoras", "El bot detecta huecos en su conocimiento y se mejora solo (flywheel)."],
    ["megaphone", "Campañas", "Manda difusiones y seguimientos por WhatsApp a tus segmentos."],
  ]
    .map(
      ([icon, title, desc]) => `<div style="display:flex;gap:12px;padding:14px;border:1px solid var(--line);background:var(--panel)">
        <i data-lucide="${icon}" width="20" height="20" style="color:var(--accent);flex:none;margin-top:2px"></i>
        <div><div style="font-family:var(--font-display);font-weight:600;font-size:14px;margin-bottom:3px">${title}</div>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.5">${desc}</div></div>
      </div>`,
    )
    .join("");

  const body = `
    <div class="card" style="max-width:720px">
      <div style="border:1px solid var(--linelit);background:var(--panel);box-shadow:0 18px 48px rgba(0,0,0,.55);padding:28px">
        <div style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--accent);color:var(--accent2);font-size:10px;letter-spacing:.16em;padding:4px 10px;text-transform:uppercase">
          <i data-lucide="settings" width="13" height="13"></i> Falta un ajuste
        </div>
        <h2 style="font-family:var(--font-display);font-weight:700;font-size:24px;letter-spacing:-.02em;margin:14px 0 6px">
          ${feature ? `“${feature}” está apagado` : "Hay secciones apagadas"}
        </h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.6;margin:0 0 20px;max-width:560px">
          <b style="color:var(--cream)">Esto no se compra: ya es tuyo.</b> Tu
          <code style="color:var(--accent)">wrangler.toml</code> quedó con
          <code style="color:var(--accent)">BOT_TIER = "free"</code>, que apaga estas secciones:
        </p>
        <div style="display:grid;gap:10px;margin-bottom:22px">${perks}</div>
        <div style="border:1px solid var(--line);background:var(--panel2);padding:16px">
          <div style="font-size:12.5px;color:var(--muted);line-height:1.6;margin-bottom:10px">
            Para encenderlas, cambia esa línea a <code style="color:var(--accent)">BOT_TIER = "pro"</code>
            y vuelve a desplegar. O pídeselo a tu agente: <em>“enciende el panel completo de mi bot”</em>.
          </div>
          <pre style="margin:0;font-size:12px;color:var(--cream);background:var(--bg);border:1px solid var(--line);padding:10px;overflow-x:auto"><code>BOT_TIER = "pro"     # en wrangler.toml
pnpm run deploy</code></pre>
        </div>
      </div>
    </div>`;
  return layout({ title: "Pro", activeTab: "overview", body, env });
}

/**
 * Pantalla de entrada al panel.
 *
 * Es lo primero que ve el dueño —y lo único que ve un desconocido—, así que
 * carga el peso de la marca: el resplandor naranja del sitio, el logo y una
 * sola pregunta. Nada de jerga: no dice "autenticación fallida", dice que esa
 * contraseña no es.
 *
 * El nombre del negocio sale de BUSINESS_NAME, para que quien instala el bot
 * para un cliente vea el nombre del cliente y no el nuestro.
 */
export function loginPage(env?: Env, error?: string): string {
  const business = env?.BUSINESS_NAME?.trim() || env?.BOT_NAME?.trim() || "tu negocio";
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Entrar · ${esc(business)}</title>
  ${HEAD_ASSETS}
  ${GLOBAL_STYLE}
  <style>
    /* Resplandor de la marca: el mismo recurso que usa el hero del sitio.
       Va detrás de todo y no intercepta clics. */
    .login-glow{position:fixed;top:-30vh;left:50%;transform:translateX(-50%);
      width:120vw;max-width:1100px;height:1100px;max-height:120vh;border-radius:50%;
      background:radial-gradient(circle at center,var(--accent) 0%,rgba(245,166,35,.30) 34%,rgba(5,13,31,0) 70%);
      filter:blur(18px);opacity:.42;pointer-events:none;z-index:0}
    .login-card{position:relative;z-index:1;width:100%;max-width:392px;
      background:var(--panel);border:1px solid var(--linelit);border-radius:20px;
      box-shadow:0 28px 80px rgba(0,0,0,.65);padding:34px 30px 30px}
    .login-field{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);
      padding:13px 14px;font-size:14px;outline:none;transition:border-color .2s,background .2s}
    .login-field:focus{border-color:var(--accent);background:rgba(30,144,255,.06)}
    .login-submit{width:100%;background:var(--accent);border:1px solid var(--accent);
      color:var(--on-accent);padding:13px;font-family:var(--font-display);font-weight:700;
      font-size:13.5px;letter-spacing:.04em;cursor:pointer}
    @media (max-width:420px){ .login-card{padding:28px 22px 24px} }
  </style>
</head>
<body style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px;overflow-x:hidden">
  <div class="login-glow" aria-hidden="true"></div>
  <form class="login-card" method="POST" action="/admin/login">
    <img src="/logo.png" alt="" width="42" height="42" style="width:42px;height:42px;display:block;margin-bottom:18px">
    <h1 style="font-family:var(--font-display);font-weight:700;font-size:23px;margin:0;letter-spacing:-.02em;line-height:1.15">
      Panel de ${esc(business)}
    </h1>
    <p style="font-size:13px;color:var(--muted);margin:8px 0 22px;line-height:1.5">
      Escribe la contraseña del panel para entrar.
    </p>
    ${
      error
        ? `<div role="alert" style="display:flex;align-items:flex-start;gap:9px;border:1px solid var(--bad);background:rgba(244,54,76,.10);color:var(--bad);border-radius:12px;padding:11px 13px;font-size:12.5px;line-height:1.45;margin-bottom:16px">
             <i data-lucide="triangle-alert" width="15" height="15" style="flex:none;margin-top:1px"></i>
             <span>${esc(error)}</span>
           </div>`
        : ""
    }
    <label for="pw" style="display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:7px">Contraseña</label>
    <input class="login-field" id="pw" name="password" type="password" required autofocus
           autocomplete="current-password" placeholder="••••••••" style="margin-bottom:18px">
    <button class="bigbtn login-submit" type="submit">Entrar</button>
    <p style="font-size:11.5px;color:var(--dim);margin:18px 0 0;line-height:1.5">
      ¿No la recuerdas? Quien instaló el bot la guardó como
      <code style="font-family:var(--font-mono);color:var(--muted)">DASHBOARD_PASSWORD</code>.
    </p>
  </form>
  ${GLOBAL_SCRIPT}
</body>
</html>`;
}
