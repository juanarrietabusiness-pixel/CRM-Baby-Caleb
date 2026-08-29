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
import tokens from "./tokens.json";

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
      { id: "catalogo", label: "Catálogo", href: "/admin/catalogo", icon: "package" },
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

// <head> assets.
//
// Ni Tailwind, ni htmx, ni los iconos se bajan ya de un CDN.
// `cdn.tailwindcss.com` no era una hoja de estilos sino el compilador de
// Tailwind: entraba sin `defer`, bloqueaba el primer pintado y generaba el CSS
// en el teléfono en cada carga. `public/admin.css` sale de `pnpm css:build` y
// `public/icons.svg` de `pnpm icons:build`; los sirve el propio Worker.
//
// htmx queda fijado a una versión concreta y servido local, con `defer` porque
// ninguna vista toca el global `htmx`.
const HEAD_ASSETS = `
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="icon" href="/favicon-192.png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/admin.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="/htmx.min.js" defer></script>`;

/**
 * El bloque `:root` con los tokens, generado desde `tokens.json`.
 *
 * Los valores no se escriben aquí ni en la config de Tailwind: los dos leen el
 * mismo JSON. Cuando vivían por separado se desincronizaban, y en este panel
 * eso costó dos colores por debajo del mínimo de contraste.
 *
 * `vars` son tokens que solo usa el CSS (degradados, sombras, variantes
 * suaves); Tailwind no los necesita. Los alias `--border` / `--green` / … se
 * mantienen porque hay fragmentos heredados de los mockups que todavía los
 * escriben. No añadas más.
 */
function rootVars(): string {
  const c: Record<string, string> = tokens.colors;
  const extra: Record<string, string> = tokens.vars ?? {};
  const decl = [...Object.entries(c), ...Object.entries(extra)].map(([k, v]) => `--${k}:${v}`);
  const alias = [
    `--border:${c.line}`,
    `--border-lit:${c.linelit}`,
    `--green:${c.ok}`,
    `--blue:${c.info}`,
    `--red:${c.bad}`,
  ];
  const fonts = Object.entries(tokens.fonts).map(([k, v]) => `--font-${k}:${v}`);
  return `:root{${[...decl, ...alias, ...fonts].join(";")}}`;
}

// Global stylesheet: design tokens, base type/scroll, the reusable component
// classes from the mockups (buttons, rows, cards, chips, canvas nodes), the
// modal/toast/range classes existing views already depend on, and the scanline
// overlay. All motion collapses under prefers-reduced-motion.
const GLOBAL_STYLE = `
<style>
  /* Paleta de marca Juancito Ads. Los valores salen de tokens.json — ver
     rootVars(). El azul neón de la marca es luminoso: sobre el relleno de
     acento va el azul marino (5.9:1), no el blanco (3.2:1). Los colores
     semánticos NO salen de la marca: tres colores no expresan ocho estados.
     Ver §1 y §3 de docs/design-system.md. */
  ${rootVars()}
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
  @keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}

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
  .shell{min-height:100dvh;display:grid;grid-template-columns:248px 1fr;background:var(--bg)}
  .sb{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;position:sticky;top:0;height:100dvh}
  .sb-nav{padding:14px 12px;display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
  .sb-sec{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;padding:14px 10px 6px}
  .live-pill{display:flex;align-items:center;gap:9px;background:var(--panel);border:1px solid var(--line);padding:8px 13px}

  /* Solo texto para lector de pantalla. */
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
    clip-path:inset(50%);white-space:nowrap;border:0}
  /* "Saltar al contenido": primer elemento enfocable de la página. Sin él, para
     llegar al cuerpo con el teclado hay que pasar por las trece pestañas. */
  .skip{position:absolute;left:8px;top:-60px;z-index:100;background:var(--accent);
    color:var(--on-accent);padding:12px 18px;border-radius:0 0 10px 10px;font-weight:700;
    font-size:14px;transition:top .12s ease}
  .skip:focus{top:0;color:var(--on-accent)}

  /* Piezas que solo existen en un tamaño.
     OJO: quien lleve .m-only NO debe traer la propiedad display en su atributo
     style — un
     style en línea gana a esta clase y el elemento se cuela en escritorio. Si
     necesita flex, se lo da una regla propia dentro del bloque de móvil. */
  .m-only{display:none}
  .inbox-back{display:none}
  /* Tabla → tarjeta (§7f). En escritorio el envoltorio de cada celda
     desaparece con display:contents, así que la rejilla sigue viendo las
     celdas como hijas directas y nada cambia. En móvil se vuelve bloque y saca
     su etiqueta con ::before. */
  .cell{display:contents}
  /* Contenedor de desplazamiento lateral */
  .m-only{display:none}
  /* Contenedor de desplazamiento lateral con aviso de que hay más a la derecha.
     Las vistas lo usan en vez de escribir overflow-x a mano. */
  .scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch;
    -webkit-mask-image:linear-gradient(90deg,#000 90%,transparent 100%);
    mask-image:linear-gradient(90deg,#000 90%,transparent 100%)}
  .scroll-x::-webkit-scrollbar{height:0}

  /* ---------- MÓVIL ----------
     Ver docs/design-system.md §7, que es el contrato. Nada de aquí toca el
     escritorio: todo vive bajo el breakpoint. */
  @media (max-width:767px){
    .m-only{display:revert}
    .d-only{display:none !important}
    /* Los que necesitan flex, con su propia regla en vez de un style en línea. */
    .drawer-toggle,.inbox-back{display:flex;align-items:center;justify-content:center}

    .shell{grid-template-columns:1fr}

    /* La barra lateral se vuelve cajón: fuera de pantalla hasta que se abre.
       Es el MISMO elemento que en escritorio — un solo <nav> en el documento,
       para que un lector de pantalla no encuentre la navegación dos veces. */
    .sb{position:fixed;top:0;left:0;bottom:0;height:100dvh;width:min(290px,86vw);
      z-index:70;border-right:1px solid var(--line);flex-direction:column;
      transform:translateX(-100%);visibility:hidden;
      transition:transform .22s cubic-bezier(.16,1,.3,1),visibility 0s linear .22s;
      box-shadow:14px 0 44px rgba(0,0,0,.45);padding-top:env(safe-area-inset-top)}
    /* Cerrado, el cajón sigue en el documento: sin visibility:hidden sus
       enlaces se pueden tabular a ciegas fuera de pantalla. */
    body.drawer-open .sb{transform:none;visibility:visible;
      transition:transform .22s cubic-bezier(.16,1,.3,1),visibility 0s}
    .sb-scrim{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);
      opacity:0;pointer-events:none;transition:opacity .22s ease}
    body.drawer-open .sb-scrim{opacity:1;pointer-events:auto}
    body.drawer-open{overflow:hidden}

    .sb-sec{font-size:12px;padding:16px 10px 7px}
    .navlink{min-height:44px;border-left:none !important;border-radius:11px;
      padding-left:12px;padding-right:12px}

    /* Cabecera: fuera la miga de pan y el titular de escritorio. */
    .topbar{padding:0 6px 0 4px !important;height:56px;gap:4px !important}
    .crumb{display:none}
    /* El titular trae el tamaño en un style en línea, que gana a una regla
       normal — de ahí el !important. 22 px en una cabecera de 56 px deja el
       texto pegado a los bordes. */
    .topbar h1{font-size:17px !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .live-pill{border:none;background:none;padding:0 8px;gap:0}
    .live-pill .live-label{display:none}

    /* Una palabra larga —una etiqueta en mayúsculas con letter-spacing, un
       nombre de variable, una URL— puede empujar una rejilla más allá del ancho
       de la pantalla: el tamaño mínimo de una celda es el de su palabra más
       larga. Con anywhere esa palabra puede partirse, así que deja de mandar
       sobre el ancho. break-word no sirve aquí: parte el texto pero no cambia
       el tamaño mínimo, que es justo lo que causa el desborde. */
    body{overflow-wrap:anywhere}

    main{padding:14px !important;padding-bottom:calc(72px + env(safe-area-inset-bottom)) !important}

    /* Barra inferior: los cuatro destinos que se usan de verdad desde el
       teléfono. El resto vive en el cajón. */
    .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;
      background:var(--panel);border-top:1px solid var(--line);
      padding-bottom:env(safe-area-inset-bottom)}
    .tabbar a,.tabbar button{flex:1;min-height:56px;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:3px;color:var(--dim);
      font-family:var(--font-display);font-size:12px;font-weight:600;position:relative;
      padding:6px 2px;background:none;border:none;cursor:pointer}
    .tabbar span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tabbar a.on{color:var(--accent)}
    .tabbar a.on::before{content:"";position:absolute;top:0;left:50%;
      transform:translateX(-50%);width:34px;height:2px;background:var(--accent);
      border-radius:0 0 3px 3px}

    /* Un <summary> con varias insignias de ancho fijo aplasta el texto flexible
       hasta cero, y con overflow-wrap:anywhere eso deja el nombre partido letra
       a letra en una columna de 506 px de alto. Que envuelva: el nombre se
       queda con la primera línea y las insignias bajan. */
    /* ---- Fila que envuelve, con el hijo flexible en su propia línea ----
       El mismo fallo ha salido tres veces en este trabajo: una fila flex donde
       los hermanos de ancho fijo aplastan al hijo flexible. En el <summary> del
       catálogo dejó el nombre en 0 px, partido letra a letra; en el compositor
       del chat dejó el campo de respuesta en 90 px de los 336 de la fila.
       Envolver solo no basta —el hijo sigue compitiendo por la primera línea—,
       hay que darle la línea entera.
       Se pide con .row-wrap en la fila y .row-grow en el hijo que debe crecer.
       Los <summary> lo llevan de oficio: siempre tienen esa forma. */
    .row-wrap,details > summary{flex-wrap:wrap}
    .row-wrap > .row-grow,
    details > summary > [style*="flex:1"]{flex:1 0 100% !important}

    /* ---- Modales como hoja ----
       Un cuadro centrado con márgenes es un gesto de ratón. En el teléfono la
       hoja sube desde abajo, donde está el pulgar, y puede ocupar casi toda la
       altura porque no compite con nada. */
    .modal-backdrop{padding:0 !important;align-items:flex-end !important}
    .modal-card{width:100% !important;max-width:none !important;
      max-height:92dvh !important;border-radius:18px 18px 0 0 !important;
      animation:sheetUp .22s cubic-bezier(.16,1,.3,1) !important;
      padding-bottom:env(safe-area-inset-bottom)}
    .node-row:hover,.node-row:focus-visible{background:var(--panel2)}

    /* ---- Gráficas fluidas (§7g) ----
       La gráfica de mensajes por día llevaba min-width:480px dentro de una
       tarjeta de 362: el dato de hoy —el número que uno viene a mirar— quedaba
       fuera de pantalla, detrás de un scroll lateral que nadie descubre.
       Ahora se estira. preserveAspectRatio="none" deja que se aplaste sin
       recortar; el trazo se compensa con vector-effect para que no se deforme. */
    .chart{height:120px}
    .chart polyline,.chart path{vector-effect:non-scaling-stroke}
    /* El funnel: la etiqueta fija de 120 px no cabe con la barra y la cifra. */
    .funnel-row{grid-template-columns:1fr auto !important;gap:4px 10px !important}
    .funnel-row > :nth-child(2){grid-column:1 / -1;order:3}
    /* El mapa de horas sí se desplaza de lado: son 24 columnas, no hay forma
       honesta de meterlas en 362 px. Al menos avisa de que sigue. */
    .heatmap{margin-bottom:2px}

    /* Lo mismo para las tablas de verdad (el catálogo). Aquí no sirve el truco
       de display:contents: una <table> necesita que cada parte cambie de rol.
       Cada <td> lleva su etiqueta en data-label y se lee como par
       etiqueta/valor; la <thead> sobra porque cada fila ya se explica sola. */
    table.tablecards,table.tablecards tbody,table.tablecards tr,table.tablecards td{display:block}
    table.tablecards thead{display:none}
    table.tablecards{border-spacing:0}
    table.tablecards tr{border:1px solid var(--line) !important;border-radius:12px;
      padding:6px 12px;margin-bottom:10px;background:var(--panel2)}
    table.tablecards td{display:flex !important;justify-content:space-between;gap:14px;
      padding:6px 0 !important;text-align:left !important;border:none}
    table.tablecards td + td{border-top:1px solid var(--line)}
    table.tablecards td::before{content:attr(data-label);color:var(--dim);
      font-weight:600;flex:none;font-family:var(--font-display)}

    /* ---- Tablas → tarjetas (§7f) ----
       Una rejilla con min-width en píxeles es una barra de scroll lateral con
       pasos de más: en Leads eran 640 px de mínimo sobre una pantalla de 390.
       Debajo del breakpoint cada fila se vuelve una tarjeta con pares
       etiqueta/valor. Mismo dato, dos formas. */
    .datagrid{min-width:0 !important}
    .datagrid-head{display:none !important}
    .datarow-cards{display:flex !important;flex-direction:column;align-items:stretch !important;
      gap:10px !important;grid-template-columns:none !important;padding:14px !important}
    .cell{display:block;min-width:0}
    /* La etiqueta va atada al atributo, no a la posición: la columna que hace
       de titular no es siempre la primera (en Leads la primera es la fecha).
       Una columna con data-label="" es la identificadora: sin etiqueta y con
       peso de titular. */
    .cell:not([data-label=""])::before{content:attr(data-label);display:block;
      font-size:12px;color:var(--dim);margin-bottom:3px;
      font-family:var(--font-display);font-weight:600}
    .cell[data-label=""]{font-size:16px;font-weight:700;order:-1}

    /* ---- La bandeja: una columna a la vez ----
       En escritorio son dos paneles, lista y conversación, dentro de una caja
       de altura fija. En el teléfono eso dejaba los dos apilados dentro de la
       misma caja: unos 240 px para cada uno, con el campo de respuesta al
       fondo del todo. Aquí se muestra uno u otro, y cuál depende de si la URL
       trae una conversación abierta (?c=…) — que es información que el
       servidor ya tiene, así que no hace falta tocar rutas ni hx-*. */
    .inbox{height:auto !important;min-height:0 !important;border:none !important;
      background:transparent !important;display:block !important}
    .inbox.sel .inbox-list{display:none}
    .inbox:not(.sel) .inbox-thread{display:none}
    .inbox-list{border-right:none !important;border:1px solid var(--line);border-radius:14px;overflow:hidden}

    /* Con la conversación abierta, la columna ocupa lo que queda de pantalla y
       el campo de respuesta se queda abajo. La resta es de piezas que controla
       este mismo archivo: 56 px de cabecera y los 14+14 de padding de <main>. */
    .inbox.sel{height:calc(100dvh - 56px - 28px) !important;
      display:flex !important;flex-direction:column;border:1px solid var(--line) !important;
      border-radius:14px;overflow:hidden;background:var(--panel) !important}
    .inbox.sel .inbox-thread{flex:1;min-height:0;display:flex;flex-direction:column}
    .inbox-search{width:100%;margin-left:0 !important;min-width:0 !important}
    /* Con la conversación abierta, los filtros y el buscador son de la lista,
       no del hilo. Apartarlos deja la caja justo debajo de la cabecera, que es
       lo que hace que la resta de altura de abajo cuadre. */
    body.thread-open .inbox-filters{display:none}
    body.thread-open .tabbar{display:none}
    body.thread-open main{padding-bottom:14px !important}

    /* Objetivos táctiles: §7c. */
    .chip,.subtab,.bigbtn,.ghostbtn,.tap{min-height:44px}
    .chip,.subtab{display:inline-flex;align-items:center}

    /* Piso de tipografía: §7b.
       El panel se escribió con densidad de escritorio y quedaron 179
       declaraciones por debajo de 12 px, algunas a 8. A la distancia de un
       brazo eso no es texto, es textura. Esto las sube todas de golpe, tanto
       las clases de Tailwind como los atributos style en línea, que son la
       mayoría y no
       se pueden alcanzar de otra forma.
       La fase que reescriba cada vista irá quitando la necesidad de esto; hasta
       entonces es el piso, y conviene que siga estando cuando ya no haga falta. */
    [style*="font-size:8"],[style*="font-size:9"],
    [style*="font-size:10"],[style*="font-size:11"],
    .text-\\[8px\\],.text-\\[8\\.5px\\],.text-\\[9px\\],.text-\\[9\\.5px\\],
    .text-\\[10px\\],.text-\\[10\\.5px\\],.text-\\[11px\\],.text-\\[11\\.5px\\]{font-size:12px !important}

    /* Campos a 16 px: por debajo, Safari en iPhone hace zoom al enfocar y deja
       la página descuadrada. §7b — no es una preferencia. */
    /* El !important y el selector con [style] no son adorno: casi todos los
       campos traen el tamaño en un atributo style en línea, que gana a
       cualquier regla normal de la hoja. Y hay que pesar más que el piso de
       12 px de arriba, que si no los dejaría justo por debajo del umbral. */
    input,textarea,select,button,
    input[style],textarea[style],select[style],button[style]{font-size:16px !important}
    input,textarea,select{min-height:44px}
    textarea{min-height:64px}
    /* El campo de respuesta arranca en dos líneas (rows="2"), pero su texto de
       ayuda ocupa tres a 16 px y quedaba cortado a media palabra. En em, no en
       píxeles: si algún día cambia el tamaño de letra, la caja lo sigue. */
    #reply-text{min-height:6.2em}
  }

  @media (prefers-reduced-motion:reduce){
    .card,.toast,.modal-backdrop,.modal-card{animation:none !important}
    .bigbtn,.ghostbtn,.convrow,.leadrow,.datarow,.kbrow,.tkcard,.subtab,.chip,.cfgcard,.node,.node-card,.bar,.navlink{transition:none}
    .bigbtn:hover,.node:hover,.node-card:hover,.tkcard:hover{transform:none}
    .animate-pulse,[style*="animation"]{animation:none !important}
  }
</style>`;

// Re-run lucide after every htmx swap (fragments bring fresh icons) and close
// any open modal with Escape.
const GLOBAL_SCRIPT = `
<script>
  // Dibuja los iconos. Sustituye cada <i data-lucide="x"> por un <svg> que
  // apunta al sprite de public/icons.svg.
  //
  // Antes esto lo hacía la librería lucide bajada de unpkg sin versión fija:
  // 412 KB para dibujar sesenta y cuatro iconos, y un reintento cada 120 ms
  // porque el script del CDN podía resolverse después del DOM. El sprite pesa
  // 20 KB (4 KB comprimido), se cachea, y esto corre en cuanto hay DOM.
  //
  // La forma del <svg> resultante —clases "lucide lucide-<nombre>", el width y
  // el height del placeholder, y su class y style copiados— es la misma que
  // producía la librería, para que ninguna vista tenga que cambiar.
  var NS = "http://www.w3.org/2000/svg";
  function drawIcons(root) {
    var nodes = (root || document).querySelectorAll("[data-lucide]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute("data-lucide");
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", el.getAttribute("width") || "24");
      svg.setAttribute("height", el.getAttribute("height") || "24");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", ("lucide lucide-" + name + " " + (el.getAttribute("class") || "")).trim());
      var st = el.getAttribute("style");
      if (st) svg.setAttribute("style", st);
      var use = document.createElementNS(NS, "use");
      use.setAttribute("href", "/icons.svg#i-" + name);
      svg.appendChild(use);
      el.parentNode.replaceChild(svg, el);
    }
  }
  document.addEventListener("DOMContentLoaded", function () { drawIcons(); });
  if (document.readyState !== "loading") drawIcons();
  // ---- Que un refresco no te devuelva al final ----
  //
  // El hilo del chat se refresca solo cada 5 segundos reemplazando su contenido
  // entero, y con él el contenedor con scroll. Si habías subido a releer algo,
  // volvías al final cada 5 segundos: en escritorio se nota poco, en un
  // teléfono donde caben tres mensajes hace imposible leer el historial.
  //
  // Cualquier elemento con data-keep-scroll conserva su posición a través del
  // intercambio. Se guarda por su valor, no por su identidad en el DOM, porque
  // después del intercambio el elemento es otro.
  var keptScroll = {};
  document.body.addEventListener("htmx:beforeSwap", function (e) {
    var nodes = (e.target || document).querySelectorAll("[data-keep-scroll]");
    for (var i = 0; i < nodes.length; i++) {
      keptScroll[nodes[i].getAttribute("data-keep-scroll")] = nodes[i].scrollTop;
    }
  });
  document.body.addEventListener("htmx:afterSwap", function (e) {
    var nodes = (e.target || document).querySelectorAll("[data-keep-scroll]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-keep-scroll");
      if (keptScroll[key] !== undefined) nodes[i].scrollTop = keptScroll[key];
    }
  });

  document.body.addEventListener("htmx:afterSwap", function (e) { drawIcons(e.target); });
  document.body.addEventListener("htmx:oobAfterSwap", function (e) { drawIcons(e.target); });
  // ---- El cajón de navegación (móvil) ----
  //
  // Un menú que se abre con un botón solo cuenta como accesible si se puede
  // cerrar y recorrer sin ratón. Eso es: aria-expanded que diga la verdad, el
  // foco dentro mientras está abierto, y Escape. Sin eso, esconder trece
  // pestañas detrás de un botón sería un retroceso respecto a la tira
  // horizontal que había antes, que era incómoda pero no ocultaba nada.
  // §7d del sistema de diseño.
  var drawer = document.getElementById("cajon");
  var scrim = document.querySelector(".sb-scrim");
  var toggles = document.querySelectorAll(".drawer-toggle");
  var lastFocus = null;
  var FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

  function drawerIsMobile() {
    return window.matchMedia("(max-width:767px)").matches;
  }
  function setDrawer(open) {
    document.body.classList.toggle("drawer-open", open);
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open) {
      lastFocus = document.activeElement;
      var first = drawer && drawer.querySelector(FOCUSABLE);
      if (first) first.focus();
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus();
      lastFocus = null;
    }
  }
  for (var t = 0; t < toggles.length; t++) {
    toggles[t].addEventListener("click", function (e) {
      e.preventDefault();
      setDrawer(!document.body.classList.contains("drawer-open"));
    });
  }
  if (scrim) scrim.addEventListener("click", function () { setDrawer(false); });

  // Al pasar a escritorio la barra vuelve a su sitio; dejar la clase puesta
  // bloquearía el scroll del documento sin que nada lo explique.
  window.addEventListener("resize", function () {
    if (!drawerIsMobile() && document.body.classList.contains("drawer-open")) {
      document.body.classList.remove("drawer-open");
      for (var i = 0; i < toggles.length; i++) toggles[i].setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", function(e){
    var open = document.body.classList.contains("drawer-open");
    if (e.key === "Escape") {
      if (open) { setDrawer(false); return; }
      var root = document.getElementById("modal-root");
      if (root) root.innerHTML = "";
      return;
    }
    // Foco atrapado: con el cajón abierto, el tabulador da la vuelta dentro.
    if (e.key === "Tab" && open && drawer) {
      var items = drawer.querySelectorAll(FOCUSABLE);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
  // aria-current: el estado activo se dibujaba solo con color y un borde. Quien
  // navega con lector de pantalla oía catorce enlaces iguales sin saber en cuál
  // estaba. §7i del sistema de diseño.
  return `<a href="${item.href}" class="navlink" style="${style}"${active ? ' aria-current="page"' : ""}>
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
    return `<h2 class="sb-sec" style="color:${labelColor};margin:0;font-weight:600">${sec.label}</h2>${items}`;
  }).join("");

  return `<aside class="sb" id="cajon">
    <div class="sb-brand" style="padding:20px 18px 16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="/logo.png" alt="" width="34" height="34" style="width:34px;height:34px;flex:none;display:block">
        <div style="line-height:1.05">
          <div style="font-family:var(--font-display);font-weight:700;font-size:15px;letter-spacing:-.02em">Juancito Ads</div>
          <div style="font-size:9.5px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase">Panel · ${pro ? "Pro" : "Free"}</div>
        </div>
      </div>
    </div>
    <nav class="sb-nav" aria-label="Secciones del panel">${sections}</nav>
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
      <!-- En móvil la cabecera no tiene sitio para "Salir", así que vive aquí.
           Solo una de las dos copias se ve a la vez: la otra es display:none, o
           sea que tampoco existe para un lector de pantalla. -->
      <form method="POST" action="/admin/logout" class="m-only" style="margin-top:10px">
        <button class="ghostbtn" type="submit"
          style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:11px;font-size:14px;cursor:pointer;font-family:inherit">
          <i data-lucide="log-out" width="15" height="15"></i> Cerrar sesión
        </button>
      </form>
    </div>
  </aside>`;
}

/**
 * Barra inferior de móvil: los cuatro destinos que un dueño abre de verdad
 * desde el teléfono, más el cajón con todo lo demás.
 *
 * No es una hamburguesa sola a propósito. La tira horizontal que había antes
 * era incómoda pero no escondía nada — un lector de pantalla leía las trece
 * pestañas. Meterlo todo detrás de un botón habría quedado más bonito y menos
 * accesible; así lo frecuente sigue a la vista y solo el resto se guarda.
 * §7d del sistema de diseño.
 */
function tabbar(activeTab: string, niche: NichePack | null): string {
  const leads = applyNiche(
    { id: "leads", label: "Leads", href: "/admin/leads", icon: "user-plus" },
    niche,
  );
  const items: Item[] = [
    { id: "overview", label: "Resumen", href: "/admin/overview", icon: "layout-dashboard" },
    { id: "conversations", label: "Conversaciones", href: "/admin/conversations", icon: "messages-square" },
    leads,
  ];
  const links = items
    .map((i) => {
      const on = i.id === activeTab;
      return `<a href="${i.href}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}>
        <i data-lucide="${i.icon}" width="21" height="21"></i><span>${i.label}</span>
      </a>`;
    })
    .join("");
  return `<nav class="tabbar m-only" aria-label="Principal">
    ${links}
    <button type="button" class="drawer-toggle" aria-expanded="false" aria-controls="cajon">
      <i data-lucide="menu" width="21" height="21"></i><span>Menú</span>
    </button>
  </nav>`;
}

export function layout(opts: {
  title: string;
  activeTab: string;
  body: string;
  env?: Env;
  /**
   * Clase extra en el <body>. Existe para que una vista pueda decirle al
   * armazón algo que solo ella sabe. Hoy la usa la bandeja: con una
   * conversación abierta en el teléfono, el sitio de abajo lo necesita el campo
   * de respuesta, así que la barra inferior se aparta.
   */
  bodyClass?: string;
}): string {
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${opts.title}</title>
  ${HEAD_ASSETS}
  ${GLOBAL_STYLE}
</head>
<body class="scanlines${opts.bodyClass ? ` ${opts.bodyClass}` : ""}">
  <a href="#main" class="skip">Saltar al contenido</a>
  <div class="shell">
    <div class="sb-scrim m-only"></div>
    ${sidebar(opts.activeTab, pro, niche)}
    <div style="display:flex;flex-direction:column;min-width:0">
      <header class="topbar" style="position:sticky;top:0;z-index:30;background:rgba(5,13,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 26px;display:flex;align-items:center;gap:20px">
        <button type="button" class="drawer-toggle m-only tap" aria-expanded="false" aria-controls="cajon"
          style="width:44px;height:44px;flex:none;border:none;background:none;color:var(--muted);align-items:center;justify-content:center;cursor:pointer;border-radius:11px">
          <i data-lucide="menu" width="23" height="23"></i>
          <span class="sr-only">Abrir el menú</span>
        </button>
        <div style="min-width:0">
          <div class="crumb" style="font-size:10px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase">${section.label} / ${item.label}</div>
          <h1 style="font-family:var(--font-display);font-weight:700;font-size:22px;margin:2px 0 0;letter-spacing:-.02em">${item.label}</h1>
        </div>
        <div id="proj-switcher" class="d-only" style="margin-left:auto"></div>
        <div class="live-pill" style="margin-left:auto">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok);animation:pulse 1.8s ease-in-out infinite,ring 2s infinite"></span>
          <span style="font-size:11px;font-weight:600;letter-spacing:.04em" class="live-label">BOT EN LÍNEA</span>
          <span class="sr-only">El bot está en línea</span>
        </div>
        <!-- Con Basic Auth no había forma de cerrar sesión sin cerrar el
             navegador entero. Con la cookie sí, así que aquí está el botón. -->
        <form method="POST" action="/admin/logout" class="d-only" style="flex:none">
          <button class="ghostbtn" type="submit" title="Cerrar sesión"
            style="display:flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 13px;font-size:11.5px;cursor:pointer;font-family:inherit">
            <i data-lucide="log-out" width="14" height="14"></i>
            <span class="logout-label">Salir</span>
          </button>
        </form>
      </header>
      <main id="main" tabindex="-1" style="padding:22px 26px;min-width:0;outline:none">${opts.body}</main>
      ${tabbar(opts.activeTab, niche)}
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
