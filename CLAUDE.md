# Juancito Ads — instrucciones para Claude Code

Este repo es **Juancito Ads**, un chatbot de soporte con IA open source: un Worker de
Cloudflare (Hono + Vercel AI SDK + D1 + Vectorize + R2) con panel de administración
en `/admin`. Quien lo clona probablemente **no sabe programar** — tú corres todo por él.

## Instalación (si no existe `.bot-state.json`)

Sigue el skill **`/configurar-mi-chatbot`** (en `skill/`; si no está registrado, abre
el archivo directo). Son 4 fases y el orden no se negocia:

1. **TU PLATAFORMA** — provisiona Cloudflare (D1/Vectorize/R2), guarda la API key del
   cerebro + `DASHBOARD_PASSWORD`, y despliega. Al terminar, su panel vive en
   `https://<worker>.workers.dev/admin`.
2. **TU CHATBOT** — negocio, tareas, idioma y base de conocimiento.
3. **TUS CONEXIONES** — canales uno por uno (Telegram, WhatsApp, Meta…) desde `/admin`.
4. **PRUEBA FINAL** — mensaje real + resumen sin badges rojos.

Antes de la Fase 1: verifica que existan **Node ≥18** y **pnpm** (`corepack enable pnpm`
si falta), y explícale al usuario cómo funciona y cuánto cuesta — vive en SU cuenta de
Cloudflare (~gratis, ~$5/mes con tráfico) y el cerebro es su propia llave de IA (~$1–2/mes).

## Reglas

- **Habla en español sencillo (LATAM)**, una pregunta a la vez.
- **Nunca pegues tokens/keys en el chat** — siempre `wrangler secret put`.
- **No toques `member/`** más allá de lo que indican los skills (ahí viven los datos del
  negocio del usuario; se respetan en cada actualización).
- Package manager: **pnpm** — `pnpm dev`, `pnpm run deploy`, `pnpm typecheck`, `pnpm test`,
  `pnpm db:apply:remote`. Corre `pnpm test` antes de cualquier deploy si tocaste `src/`.

## Mapa rápido

- `src/index.ts` — webhooks de canales (Telegram, WhatsApp, Meta…).
- `src/agent.ts` — el Durable Object que piensa y responde (buffer + tools).
- `src/llm/provider.ts` — el cerebro (Anthropic / OpenAI / xAI, con llave propia).
- `src/admin/` — el panel (`/admin`): Resumen, Conversaciones, Conexiones, Config, KB, Catálogo, Costos.
- `src/tools/` — searchKb, handoffHuman, pauseBot, captureLead, scheduleAppointment, catalogQuery.
- `src/db/catalog.ts` + `src/catalog/validation.ts` — el catálogo (D1, tabla `catalog_items`):
  código, nombre, costo, venta, stock y bodega. El costo **nunca** sale hacia el bot y la
  cantidad exacta de stock tampoco — ver `docs/PLAN_CATALOGO_BABY_CALEB.md`.
- `src/niches/` — el "niche pack" genérico (Starter). Personaliza tono/columnas del panel.
- `skill/` — asistentes para el usuario.

## Skills disponibles

- `/configurar-mi-chatbot` — instalación de cero (las 4 fases).
- `/modo-agencia` — un bot por cliente en TU Cloudflare: alta, padrón y límites.
- `/reporte` — informe mensual de valor para el cliente.
- `/exportar` — exporta leads y conversaciones (CSV/JSON).
- `/actualizar-mi-bot` — trae la última versión conservando tu config.
- `/contribuir` — abre issues o manda PRs al repo.

## La marca del panel

El panel `/admin` lleva la identidad de Juancito Ads: azul marino `#050D1F`, azul neón
`#1E90FF`, naranja `#F5A623`, titulares en Inter y texto en Hanken Grotesk — los mismos
valores del sitio (`PAGINA-JUANCITO-ADS/src/styles/global.css`). **`docs/design-system.md`
es el contrato**: léelo antes de tocar cualquier archivo de `src/admin/views/`, y no
inventes colores fuera de sus tokens.

Los iconos de `public/` se regeneran del logo del sitio con
`node scripts/brand-icons.mjs <ruta-al-logo.png>` — no los edites a mano.

## Estado del proyecto

Todo viene desbloqueado: no hay tiers, licencias ni features de pago. El repo trae un solo
giro (`generico`), que sirve para cualquier negocio; los giros verticales con panel a la
medida están en el roadmap del README.

Derivado de [CRM - PanaClaw](https://github.com/abrinay1997-stack/CRM-PANACLAW), que a su
vez deriva de [Forja](https://github.com/santmun/forja) (ambos MIT) — los avisos de
copyright originales se conservan en `LICENSE`, como exigen esas licencias. **No los
quites al editar ese archivo.**
