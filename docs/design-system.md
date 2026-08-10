# CRM - PanaClaw Admin — Design System

Brand theme (PanaClaw deep-black + flash-orange) for the bot admin dashboard. This is the **contract**
for every view under `src/admin/views/`. The shell (`layout.ts`) already loads
the fonts, Tailwind config, tokens, lucide, htmx, the scanline overlay and all
the component classes below. Views only render the **body** — write it to match
this system.

Stack reminder: no build step. Views are TS template strings → HTML, styled with
**Tailwind CDN utilities** (mapped to the tokens below) and/or inline
`style="…"` using the CSS variables. htmx 2 drives interactivity.

---

## 1. Tokens

Every token exists twice: a **CSS variable** (for `style="…"`) and a **Tailwind
color** (for `class="…"`). Use whichever fits; they resolve to the same hex.

| CSS var | Tailwind | Hex | Use |
|---|---|---|---|
| `--bg` | `bg-bg` | `#100101` | page background (already on `<body>`) — brand deep-black |
| `--panel` | `bg-panel` | `#190a0a` | card / panel surface |
| `--panel2` | `bg-panel2` | `#221010` | nested surface, row hover, inputs-on-panel |
| `--raise` | `bg-raise` | `#2c1818` | raised chips / avatars |
| `--line` | `border-line` | `#2e1c1c` | default border / divider |
| `--linelit` | `border-linelit` | `#4a3333` | lit border, hard-shadow color |
| `--accent` | `text-accent` `bg-accent` `border-accent` | `#ff5100` | primary accent — brand flash-orange |
| `--accent-soft` | `bg-accent-soft` | `rgba(255,81,0,.12)` | accent wash / active bg |
| `--accent-2` | `text-accent2` | `#ff8a4c` | secondary accent (light orange): AI/insights |
| `--on-accent` | `text-onaccent` | `#100101` | **text on an accent fill** — brand black on orange |
| `--cream` | `text-cream` | `#fff7f7` | primary text — brand soft-white |
| `--muted` | `text-muted` | `#bababa` | secondary text — brand studio-gray |
| `--dim` | `text-dim` | `#857a7a` | tertiary text, labels, captions |
| `--ok` | `text-ok` `border-ok` | `#57c98a` | success / green (resolved, online) |
| `--info` | `text-info` `border-info` | `#6e9be8` | info / blue (WhatsApp, escalated) |
| `--warn` | `text-warn` `border-warn` | `#e8b430` | warning / amber (needs attention, not an error) |
| `--bad` | `text-bad` `border-bad` | `#f4364c` | danger / red (angry, handoff, errors) |
| `--violet` | `text-violet` | `#b49bf0` | model/memory accents in the flow canvas |

Buttons on `--accent` use `var(--on-accent)` — the brand's deep-black on
orange. It **is** a token now; never write the hex.

**Where the palette comes from.** Identity colours (`--bg`, `--cream`,
`--muted`, `--accent`, `--on-accent`) are the PanaClaw brand values, taken
verbatim from the marketing site's `src/styles/global.css`. Surfaces
(`--panel`, `--panel2`, `--raise`, `--line`, `--linelit`) are the **solid**
equivalents of the translucent white the site layers over black — the panel
stacks surfaces (sidebar → card → modal) and translucency muddies when stacked.

**Semantic colours are deliberately not brand colours.** The brand is four
colours; a dashboard needs eight states. `--ok`, `--info`, `--warn`, `--bad`
and `--violet` are tuned to sit on the warm black without competing with the
orange. In particular `--bad` is a crimson (`#f4364c`), **not** the brand's
`signal-red`: at badge size a brand-red would be indistinguishable from the
accent, and "error" would stop reading as error. Do not "correct" these to
brand values.

Legacy aliases (`--border`, `--border-lit`, `--green`, `--blue`, `--red`) are
still defined so pasted mockup snippets don't break, but **prefer the names in
the table above** in new code.

---

---

## 1b. Whose brand is this?

The panel is **PanaClaw's**, the way a Shopify store's admin carries Shopify's
logo even though the store belongs to someone else. Keep the split straight when
adding anything to the shell:

| Belongs to the business that installed | Belongs to the platform |
|---|---|
| The name — `BUSINESS_NAME`, shown on the login screen | The logo (`/logo.svg`) and the tab icons |
| The bot, its tone, its knowledge base | The palette and the typefaces |
| Conversations, leads, every row of data | The sidebar wordmark ("PanaClaw", hard-coded) |

Practical consequence: `panaclaw update` deliberately overwrites `public/`,
unlike `member/`, which is the business's and is never touched. Don't add
`public/` to the installer's exclude list, and don't wire the logo to a setting
— see `public/README.md` for how far that goes and where it stops.

---

## 2. Typography

- Body / default: **Archivo** (already the `<body>` font, Tailwind `font-sans`
  and `font-display`, or `style="font-family:var(--font-display)"`). It is the
  brand typeface — use it for all prose, labels, headings and buttons.
- **Monospace is for data only**: IDs, amounts, model names, code, counters.
  Opt in with Tailwind `font-mono` or `style="font-family:var(--font-mono)"`
  (JetBrains Mono). Do not set it on running text.

Hierarchy:

| Role | Recipe |
|---|---|
| Page title | shell renders it — **don't repeat it**, see §5 |
| Section heading | `font-display font-semibold text-[15px] text-cream` |
| Big stat number | `font-display font-bold text-[30px] leading-none` (up to `38px` on the overview hero) |
| Body text | `text-[12.5px] text-muted leading-relaxed` |
| Label / caption | `text-[10px] tracking-[.2em] uppercase text-dim` |

---

## 2b. Shape

The brand is pills and soft edges. The panel used to be brutalist (square
corners, hard offset shadows, a CRT scanline overlay); all three are gone.

**You rarely need to write radius or shadow yourself** — `layout.ts` applies
them centrally, hooked onto the classes this contract already requires:

| What | Radius | Where it comes from |
|---|---|---|
| Card / panel | `14px` | any element with `bg-panel`/`bg-panel2` **and** `border-line` |
| Button, chip, sub-tab, toast | `999px` (pill) | `.bigbtn`, `.ghostbtn`, `.chip`, `.subtab`, `.toast` |
| Input / textarea / select | `10px` | element selector |
| Flow-canvas node | `12px` | `.node`, `.node-card` |
| Small badge | `999px` | written inline next to the padding |
| Chat bubble | `14px` with a 4px corner on the speaker's side | written inline |
| Avatar | `50%` | written inline |

So `class="card bg-panel border border-line p-[18px]"` is already a rounded
card — that combination is load-bearing, not decoration. A panel written with a
raw hex background instead of `bg-panel` will **not** get the radius.

Depth is diffuse, never offset. If you need a shadow, use the scale:
`0 6px 18px rgba(0,0,0,.45)` (resting) → `0 10px 28px rgba(0,0,0,.5)` (hover) →
`0 24px 64px rgba(0,0,0,.6)` (modal). Accent glow — `0 8px 24px
rgba(255,81,0,.35)` — is for the primary button's hover only; it loses its
meaning if everything glows.

Focus is handled globally (`:focus-visible` → 2px accent outline). Don't
override it, and never set `outline:none` without a replacement.

---

---

## 2c. Helpers the shell exports

Import them from `./layout` — don't re-implement either one.

### `ico(name, size = 13)` — inline icon inside a label

```ts
`<span>${ico("banknote")} Costo por lead</span>`
```

Use it instead of an emoji. An emoji is drawn by the operating system: it brings
its own colour and its own stroke, looks different on Windows, macOS and
Android, and none of those three is ours. A lucide icon inherits
`currentColor`, so it follows the token of the text beside it.

**It returns HTML**, so it only works where the template injects raw. If the
destination runs through `esc()` — `funnel()`'s labels, for one — the user would
see the `<i>` tag as text. Leave those as plain words.

Typographic marks (`✓ ✕ ⚠ ★ ☆ ●`) are **not** emoji and are fine to type
directly: they render in the current text colour.

### `emptyState(icon, title, hint?)` — the "nothing here yet" block

```ts
emptyState("user-plus", "Aún no hay leads",
  "Cuando el bot capte los datos de un cliente interesado, aparecerá aquí.")
```

A freshly installed panel is empty on nearly every tab, so this is what an owner
sees most in their first week. A bare sentence centred in a large box reads as
"something broke"; an icon plus a hint reads as "nothing has happened yet, and
here's what's next". Skip `hint` when there's nothing useful to suggest —
inventing one is worse than leaving it out.

---

## 3. Component recipes

Copy these. Sizes are the mockup's; keep them consistent.

### Card / panel
```html
<div class="card bg-panel border border-line p-[18px]"> … </div>
```
`.card` adds the one-shot `rise` entrance animation. Drop it for static panels.

### Primary button
```html
<button class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
  style="background:var(--accent);border:1px solid var(--accent);color:var(--on-accent);padding:11px 16px;display:flex;align-items:center;gap:8px">
  <i data-lucide="check" width="16" height="16"></i> Guardar
</button>
```
`.bigbtn` is a pill (radius comes from the global rule) and handles the hover
lift + accent glow. Don't write a `box-shadow` yourself. Smaller variant:
`padding:8px 16px`.

### Ghost / secondary button
```html
<button class="ghostbtn text-muted cursor-pointer"
  style="background:var(--panel);border:1px solid var(--line);padding:9px 14px;font-size:12.5px;transition:all .12s ease">…</button>
```

### Chip (filter / small action)
```html
<span class="chip text-muted cursor-pointer"
  style="border:1px solid var(--line);padding:5px 12px;font-size:11px;letter-spacing:.05em">Todas · 32</span>
```

### Pill / badge — variants by color
Same shape, swap the color var. Text = border = the variant color.
```html
<!-- accent -->  <span style="font-size:9px;color:var(--accent);border:1px solid var(--accent);padding:1px 6px">Lead</span>
<!-- ok -->      <span style="font-size:9px;color:var(--ok);border:1px solid var(--ok);padding:1px 6px">Resuelta</span>
<!-- warn -->    <span style="font-size:9px;color:var(--warn);border:1px solid var(--warn);padding:1px 6px">Sin resolver</span>
<!-- bad -->     <span style="font-size:9px;color:var(--bad);border:1px solid var(--bad);padding:1px 6px">Handoff</span>
<!-- info -->    <span style="font-size:9px;color:var(--info);border:1px solid var(--info);padding:1px 6px">WA</span>
```
Solid badge (counts): `background:var(--accent);color:var(--on-accent);font-weight:700;padding:1px 6px`.

### Table / list row
Rows sit inside a `bg-panel border border-line` container, separated by
`border-top:1px solid var(--line)`. Add a hover class for interactivity:
```html
<div class="leadrow" style="display:grid;grid-template-columns:110px 1.1fr 1.1fr 1.6fr 130px;gap:12px;padding:13px 18px;border-top:1px solid var(--line);font-size:12.5px;align-items:center;transition:background .12s ease"> … </div>
```
Hover helpers available: `.leadrow`, `.datarow`, `.kbrow`, `.convrow` (all →
`background:var(--panel2)` on hover). Column-header row: `font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)`.

### Input / textarea / select
```html
<input style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
```
Textareas add `resize:vertical`. Placeholders are auto-styled to `--dim`. Range
inputs are auto-accented (`accent-color:var(--accent)`).

### Stat card (big number)
```html
<div class="bg-panel border border-line p-4">
  <div class="font-display font-bold text-[30px] leading-none">142</div>
  <div class="text-[11px] text-muted mt-1">Conversaciones analizadas</div>
  <div class="text-[10px] text-dim mt-0.5">últimos 7 días</div>
</div>
```
Add `border-l-[3px]` in `--accent`/`--ok`/`--bad` to flag the hero metric.

### Progress bar
```html
<div style="height:12px;background:var(--panel2);border:1px solid var(--line);overflow:hidden">
  <div style="width:74%;height:100%;background:var(--accent)"></div>
</div>
```

### Selectable option card (config)
```html
<div class="cfgcard" style="border:1px solid var(--line);background:var(--panel2);padding:14px">…</div>
<!-- selected: border:1px solid var(--accent);background:var(--accent-soft); label + icon in var(--accent) -->
```

### Chat bubble

```html
<!-- del cliente (izquierda) -->
<div style="…;border-radius:14px 14px 14px 4px;padding:10px 14px">…</div>
<!-- del bot / del dueño (derecha) -->
<div style="…;border-radius:14px 14px 4px 14px;padding:10px 14px">…</div>
```

The small corner points at whoever is speaking — that's what makes it read as
a speech bubble instead of a box. Bubbles don't use `bg-panel`, so the global
radius rule doesn't reach them; write it inline.

### Flow-canvas node
Use `.node` (canvas radiography) or `.node-card` — both get the lift + hard
shadow on hover. Container: `background:var(--panel2);border:1px solid var(--linelit)`.

---

## 4. Global classes provided by the shell

These are defined in `layout.ts` — **do not redefine them**, just use the class:

- Motion / buttons: `.card`, `.bigbtn`, `.ghostbtn`, `.glow`, `.bar` / `.bargrp`
- Rows / interactive: `.convrow` (+`.arr`), `.leadrow`, `.datarow`, `.kbrow`
  (+`.kbedit`), `.tkcard`, `.subtab`, `.chip`, `.cfgcard`, `.navlink`
- Canvas: `.node`, `.node-card`
- Overlays (already wired to existing views): **`.modal-backdrop`**,
  **`.modal-card`**, **`.toast`** — keep using these exact names.
- `.scanlines` is still on `<body>` and on some views, but it **draws nothing**
  now — the CRT overlay contradicted the brand. The class is kept as a no-op so
  the 14 views didn't have to change; don't add it to anything new.
- Keyframes available: `blink`, `pulse`, `ring`, `rise`, `fadeIn`, `popIn`,
  `toastIn`, `toastOut`. All motion collapses under `prefers-reduced-motion`.

Mount points: `#modal-root` (put modal markup here; Escape clears it) and
`#toast-root` (fixed bottom-right, `z-60`).

lucide icons: write `<i data-lucide="name" width="16" height="16"></i>`. The
shell calls `lucide.createIcons()` on load **and after every htmx swap /
oob-swap**, so fragments you return over htmx get their icons drawn — no extra
script needed in the fragment.

---

## 5. Page header — owned by the shell

The shell renders, for every page, a sticky topbar with the **breadcrumb
(`Sección / Tab`) + the page `<h1>` + the "BOT EN LÍNEA" pill**, derived from
`activeTab`. Your view body starts **below** that.

- **Do not render your own top-level page title** (`<h1>`/`<h2>` naming the tab)
  or your own "bot online" indicator — the shell already shows both.
- Start the body with content (filters, stats, the sub-tab strip if the tab has
  sub-views, cards…). Section-level headings inside the body are fine.
- `<main>` already has `padding:22px 26px`. Add vertical rhythm with a flex
  column + gap or margins; don't re-pad the outer edge.

Sidebar nav icons (already in the shell, listed so you don't duplicate them):
`overview` layout-dashboard · `conversations` messages-square · `leads`
user-plus · `tickets` life-buoy · `agente` workflow · `kb` book-open · `mejoras`
sparkles · `config` sliders-horizontal · `insights` scan-eye · `stats`
bar-chart-3 · `costs` receipt.

---

## 6. PROHIBIDO

- ❌ **No emojis in the UI.** Use `ico()` (§2c). Typographic marks are fine.
- ❌ No light-theme colors: no `bg-white`, `bg-stone-50`, `text-stone-*`,
  `bg-cyan-*`, `text-cyan-*`, `shadow-sm/md`, `rounded-2xl`, or any pale
  surface. This theme is dark + rounded (see §4).
- ❌ Don't invent new colors — use the tokens in §1 only.
- ❌ Don't touch htmx attributes (`hx-*`), element `id`s, route paths, or form
  field `name`s. Restyle markup, don't rewire it.
- ❌ Don't change visible text strings / labels (tests and users depend on them):
  keep the Spanish labels, tab names, status strings like `🟢 bot activo`,
  emojis, tool names, etc.
- ❌ Don't redefine the global classes or re-add the page title / online pill
  (§4, §5).
- ❌ Don't add heavy client JS — htmx + the shell's lucide re-init is the model.
- ❌ Don't restyle `layout.ts` (shared shell) — only your view file.
