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
- **El panel también se usa desde el teléfono.** Antes de tocar `src/admin/views/`, lee
  `docs/design-system.md` — el §7 (Móvil y accesibilidad) es contrato: 16 px en campos,
  44 px táctiles, piso de 12 px en texto, nada de `min-width` en píxeles ni `100vh`.
  `pnpm snapshot` rinde las pestañas a `.snapshots/` para comparar antes y después.

## Mapa rápido

- `src/index.ts` — webhooks de canales (Telegram, WhatsApp, Meta…).
- `src/agent.ts` — el Durable Object que piensa y responde (buffer + tools).
- `src/llm/provider.ts` — el cerebro (Anthropic / OpenAI / xAI, con llave propia).
- `src/admin/` — el panel (`/admin`): Resumen, Conversaciones, Conexiones, Config, KB, Catálogo, Costos.
- `src/tools/` — searchKb, handoffHuman, pauseBot, captureLead, scheduleAppointment, catalogQuery.
- `src/db/catalog.ts` + `src/catalog/validation.ts` — el catálogo (D1, tabla `catalog_items`):
  código, nombre, costo, venta, stock y bodega. El costo **nunca** sale hacia el bot y la
  cantidad exacta de stock tampoco — ver `docs/PLAN_CATALOGO_BABY_CALEB.md`.
- `member/kb/` — la base de conocimiento versionada (políticas, tarifas de envío, pagos,
  uso del producto, cuándo escalar). `pnpm kb:reindex` la vuelca a `scripts/kb-fixtures.json`.
- `src/niches/` — el "niche pack" genérico (Starter). Personaliza tono/columnas del panel.
- `puente-wa/` — el canal **WhatsApp por código QR**: un Worker aparte
  (`juancitoads-bot-wa`) con un contenedor que sostiene el WebSocket de Baileys.
  Se despliega con su propio workflow (`puente-wa.yml`), NO con el del bot: si su
  imagen no construye, el que no sale es el puente y el bot se sigue publicando.
  Es un canal **alterno** — no es la API oficial y WhatsApp puede banear el
  número, así que la Cloud API se queda conectada. Ver `docs/conectar-whatsapp-qr.md`
  (para el dueño), `docs/plan-whatsapp-qr.md` (el procedimiento) y
  `docs/bitacora-whatsapp-qr.md` (**lee esto antes de diagnosticar**: qué se
  rompió, por qué, y cómo se consiguen los logs sin terminal).
  **Un contenedor sano no toma la imagen nueva**: `puente-wa.yml` lo reinicia solo
  al terminar (sale solo cuando un merge cambia `puente-wa/`). Si ese paso avisa
  que no pudo, se reinicia desde el panel.
- `src/takeover.ts` — cuando una persona contesta (panel, teléfono del WhatsApp
  por QR o Telegram) el bot se calla en esa conversación. Un solo sitio para las
  tres puertas; el plazo sale de Config.
- `src/owner/` — la **consola del dueño por Telegram**: avisos con botones que se
  pueden responder, comandos (`/pendientes`, `/venta`, `/devolucion`…) y un
  asistente interno. El vínculo es un enlace del panel, sin terminal. Ver
  `docs/consola-del-dueno.md`. El inventario es una extensión
  (`src/owner/inventario.ts`); cada movimiento queda en `stock_movements`.
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

## Un dato, un solo dueño

**Antes de escribir cualquier dato del negocio, lea `docs/FUENTES_DE_VERDAD.md`.** Es
corto y es contrato. En resumen: el precio, la existencia y la cantidad por caja viven
SOLO en `catalog_items` (D1) y el bot los ve solo con `catalogQuery`; las políticas, las
tarifas de envío y las formas de pago viven SOLO en `member/kb/` y las ve con `searchKb`;
el trato y los límites duros viven en `member/config.local.ts`.

Nunca escriba un precio de producto en `member/kb/` ni en `member/config.local.ts`. Lo que
va al `<business_context>` se inyecta entero en el prompt en cada turno, así que el modelo
lo lee **antes** de decidir si consulta el catálogo: un precio ahí le gana a D1 en silencio.
Hay tests en `test/babycaleb/` que fallan si esa regla se rompe. Y como los tests
vigilan los archivos pero el bot lee D1, **`pnpm auditar`** compara la base en vivo
contra el documento de la dueña (solo lectura). El dueño de este bot **no usa la
terminal**: la auditoría también corre desde la pestaña Actions ("Auditar la verdad"),
y el despliegue entero —pruebas, esquema, Worker, reindexado de la base de
conocimiento y la auditoría en modo informativo— lo hace
`.github/workflows/deploy.yml` con cada merge a `main`. Lo que se carga desde el
panel contra lo que llega por GitHub: `docs/AUDITORIA_CONOCIMIENTO.md`.
No le indiques comandos de terminal como único camino.

La verdad del negocio es el documento de la dueña (**PREGUNTAS_BABY_CALEB_usted.docx**,
2026-09), transcrito en `test/babycaleb/verdad-del-cliente.ts`. Cuando llegue un documento
nuevo: se corrige ahí primero, y los tests que se pongan rojos son los sitios del repo que
hay que tocar. El bot habla de **usted**, siempre — el tuteo es del marketing de la
agencia, no de la atención.

## Estado del proyecto

Todo viene desbloqueado: no hay tiers, licencias ni features de pago. El repo trae un solo
giro (`generico`), que sirve para cualquier negocio; los giros verticales con panel a la
medida están en el roadmap del README.

Derivado de [CRM - PanaClaw](https://github.com/abrinay1997-stack/CRM-PANACLAW), que a su
vez deriva de [Forja](https://github.com/santmun/forja) (ambos MIT) — los avisos de
copyright originales se conservan en `LICENSE`, como exigen esas licencias. **No los
quites al editar ese archivo.**
