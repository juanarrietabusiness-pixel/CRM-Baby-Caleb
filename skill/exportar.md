---
name: exportar
description: Exporta a archivos los datos del bot que son del miembro — sus leads (prospectos capturados) y/o sus conversaciones y transcripciones — a CSV (y JSON opcional), leyendo la base de datos en solo lectura y dejando los archivos listos para abrir en Excel o Google Sheets o guardar como respaldo. Tus datos son tuyos — esto es portabilidad, sin candado de nivel. El miembro NO programa; tú corres los comandos. Actívalo con "/exportar", "exporta mis leads", "descarga las conversaciones", "saca mis datos", "backup de leads", "respaldo de datos", "exportar a csv", "bájame los prospectos", "quiero mis datos en un archivo".
---

# Exportar — llévate tus datos (leads y conversaciones)

Eres el encargado de la **portabilidad de datos** del chatbot del miembro. Él NO programa:
**tú corres todos los comandos** y le entregas **archivos que puede abrir, guardar y llevarse**
(Excel, Google Sheets, o un respaldo en su compu). El principio es simple: **los datos son
del miembro y él tiene todo el derecho a sacarlos cuando quiera.** El protagonista es el
**archivo entregado** (sus leads, sus conversaciones), nunca el código ni el SQL.

El bot guarda todo en una base de datos en Cloudflare (`juancitoads_db`). Tú la consultas,
armas los archivos y se los entregas. **Solo lectura: este skill NUNCA borra ni modifica nada.**
Esta función vive **en el nivel gratis y en el de pago** — es sobre propiedad de datos, así que
**no hay candado de nivel**. Solo te adaptas a lo que EXISTA: si es un bot Starter no habrá
leads (esa tabla estará vacía), así que exportas conversaciones y mensajes; si es Pro y captura
prospectos, agregas los leads.

> Si en vez de un volcado crudo el miembro quiere un **informe mensual narrado** para pasárselo
> a su cliente ("cómo le fue al bot"), ese es otro skill: **/reporte**. Este de aquí es el
> **respaldo crudo** de sus datos en CSV/JSON.

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión (no toques nada)
1. Confirma que estás en la carpeta del bot: deben existir `package.json` y `wrangler.toml`.
   Si no, **detente y dilo** — no adivines la carpeta.
2. Detecta el **nivel** solo para saber qué esperar (NO para bloquear nada): mira `BOT_TIER`
   en `wrangler.toml` o el campo `tier:` en `member/config.local.ts` (`'free'` | `'pro'`). En
   Starter la tabla de leads casi siempre está vacía; en Pro puede tener prospectos. Esto solo
   ajusta lo que le ofreces, **no impide exportar**.
3. Descubre **qué tablas existen de verdad** (no asumas). Corre:
   ```
   wrangler d1 execute juancitoads_db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
   ```
   En todo bot habrá `conversations`, `messages`, `tickets`. La tabla `leads` existe siempre
   pero puede estar **vacía**.
4. `wrangler` necesita estar conectado a Cloudflare. Si un comando da error de acceso, dile:
   *"Necesito conectar Cloudflare una vez. Escribe `! pnpm wrangler login` y sigue los pasos."*
   No inventes credenciales ni pegues tokens en el chat.
5. Pregúntale **qué quiere exportar** (una pregunta a la vez, en su idioma):
   - **Leads / prospectos** — los contactos que el bot capturó (nombre, contacto, intención…).
   - **Conversaciones** — la lista de clientes que le escribieron (canal, nombre, última vez).
   - **Mensajes / transcripciones** — el historial completo de chat (puede ser grande).
   - **Todo** — los tres.
6. Pregúntale el **periodo**: por defecto **todo el historial** (respaldo completo). Si prefiere
   "el último mes", "mayo", o un rango, ajústalo. Confírmale en 2 líneas qué vas a sacar (qué
   datos, qué periodo, cuántas filas aprox si ya lo sabes) y **espera su "ok"** antes de generar
   archivos.

> Nota técnica (úsala, no la expliques al miembro): todas las fechas se guardan en
> **milisegundos** (`Date.now()`). Para "últimos 30 días" el filtro es
> `created_at >= (strftime('%s','now') - 30*86400) * 1000`; para "todo el historial" **quita el
> `WHERE`**. Para leer una fecha en humano usa `datetime(<columna>/1000,'unixepoch')`. Si
> `wrangler` no está en PATH, antepón `pnpm` → `pnpm wrangler d1 execute ...`. Sin `--remote`
> consultas la base local de dev (vacía) — siempre `--remote`.

## PASO 1 — Saca los datos (consultas de solo lectura)
Corre solo las consultas de lo que pidió. Agrega **`--json`** para que la salida sea fácil de
volcar a un archivo (si tu `wrangler` no soporta `--json`, corre el mismo comando sin él y lee la
tabla de resultados). Sustituye `<DESDE>` por el inicio del periodo en ms, o **quita el `WHERE`
completo** si eligió "todo el historial". **Cuenta primero** para saber si hay algo que exportar.

**Leads / prospectos** (Pro y solo si hay filas):
```
wrangler d1 execute juancitoads_db --remote --command "SELECT COUNT(*) AS total FROM leads;"
wrangler d1 execute juancitoads_db --remote --json --command "SELECT id, name, contact, channel_user_id, intent, status, notes, exported_to, external_id, metadata, datetime(created_at/1000,'unixepoch') AS creado, datetime(updated_at/1000,'unixepoch') AS actualizado FROM leads WHERE created_at >= <DESDE> ORDER BY created_at DESC;"
```
La columna `metadata` trae los campos propios del giro en formato JSON (ej. reservación
`{fecha,hora,personas}`, inmobiliaria `{presupuesto,zona,operacion}`). Déjala tal cual como una
columna; si el miembro quiere esos campos en columnas separadas, puedes sacarlos con
`json_extract(metadata,'$.zona')` (cambia `zona` por el campo real del giro).

**Conversaciones** (lista de clientes; existe en todo bot):
```
wrangler d1 execute juancitoads_db --remote --command "SELECT COUNT(*) AS total FROM conversations;"
wrangler d1 execute juancitoads_db --remote --json --command "SELECT id, channel, channel_user_id, display_name, datetime(started_at/1000,'unixepoch') AS primer_contacto, datetime(last_message_at/1000,'unixepoch') AS ultima_actividad FROM conversations WHERE last_message_at >= <DESDE> ORDER BY last_message_at DESC;"
```

**Mensajes / transcripciones** (historial de chat; puede ser grande — avísale):
```
wrangler d1 execute juancitoads_db --remote --command "SELECT COUNT(*) AS total FROM messages;"
wrangler d1 execute juancitoads_db --remote --json --command "SELECT m.conversation_id, c.channel, c.display_name, m.role, m.content, datetime(m.created_at/1000,'unixepoch') AS fecha FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id WHERE m.created_at >= <DESDE> ORDER BY m.conversation_id, m.created_at;"
```
El campo `role` viene en clave: **tradúcelo en el archivo** — `user`→cliente, `assistant`→bot,
`owner`→dueño, `tool`→sistema. Si son muchísimos mensajes, ofrécele acotar por periodo o exportar
**una sola conversación** filtrando `WHERE m.conversation_id = 'canal:usuario'`.

Lee cada resultado y guárdalo en memoria; **no le pegues el volcado crudo al miembro en el chat**
— eso va en los archivos.

## PASO 2 — Genera los archivos (CSV y JSON opcional)
1. Crea la carpeta `member/exportes/` si no existe. Está **dentro de `member/`**, que es del
   cliente y **no se sobrescribe** cuando se actualiza la plantilla — sus respaldos quedan a salvo.
2. Con las filas que sacaste, **escribe tú el archivo** (no dependas de que el sistema tenga
   programas de conversión instalados). Un archivo por conjunto de datos:
   - `member/exportes/leads-<periodo>-<fecha>.csv`
   - `member/exportes/conversaciones-<periodo>-<fecha>.csv`
   - `member/exportes/mensajes-<periodo>-<fecha>.csv`
   (Ej. de `<periodo>-<fecha>`: `todo-2026-07-15` o `may2026-2026-07-15`.)
3. Reglas del CSV para que abra bien en Excel/Google Sheets:
   - Primera fila = encabezados en español claro (Nombre, Contacto, Intención, Estado, Creado…).
   - Encierra cada valor entre comillas dobles y **duplica** las comillas internas (`"` → `""`).
     Los mensajes traen comas y saltos de línea; el entrecomillado los mantiene en su celda.
   - Guárdalo en **UTF-8**; si sabes que lo abrirá en Excel de escritorio, agrégale el BOM al
     inicio para que los acentos y las ñ no se vean rotos.
4. **JSON opcional**: si el miembro quiere el respaldo también en JSON (más fiel para volver a
   importar a otro sistema), vuelca las mismas filas tal cual a
   `member/exportes/leads-<periodo>-<fecha>.json` (y equivalentes). Pregúntale si lo quiere; por
   defecto entrega solo CSV.
5. **Tablas vacías con honestidad**: si un conjunto trae 0 filas (típico: leads en un bot
   Starter), **no generes un archivo vacío con cara de fracaso**. Díselo claro —
   *"Todavía no hay prospectos capturados, así que no hay nada que exportar de ahí"*— y sigue con
   lo que sí tiene datos.

## PASO 3 — Entrega (rutas + resumen)
- Dale la **ruta absoluta** de cada archivo que creaste y dile con qué abrirlo (Excel, Google
  Sheets, o cualquier hoja de cálculo).
- Pégale en el chat un **resumen de una línea por archivo** con el conteo: ej. *"Leads: 84
  prospectos → `.../member/exportes/leads-todo-2026-07-15.csv`"*, *"Conversaciones: 312 clientes",
  "Mensajes: 5,180 líneas de chat"*.
- Recuérdale que son **sus datos, para que se los lleve o los respalde** — este skill no envió
  nada a ningún lado ni tocó el bot en vivo.

## Reglas de seguridad (no las rompas)
- **Solo lectura.** Únicamente `SELECT`. NUNCA corras `INSERT`, `UPDATE`, `DELETE`, `DROP` ni
  `wrangler d1 execute ... --file=...schema.sql` desde este skill.
- **NUNCA** hagas `deploy` ni `git push` ni commits por tu cuenta. Este skill no toca el bot en
  vivo — solo lee y escribe archivos dentro de `member/exportes/`.
- Pide confirmación antes de **instalar** cualquier cosa o de tocar archivos fuera de
  `member/exportes/`. No edites `src/`, el system prompt ni la base de conocimiento aquí — para
  eso están otros skills.
- **No pegues secretos ni API keys** en el chat ni en los archivos. Los contactos de los leads
  (teléfonos/correos) SÍ van en el CSV porque son datos del miembro que él pidió exportar; pero
  jamás credenciales, tokens del bot ni llaves de Cloudflare.
- **No hay candado de nivel**: esta función corre igual en gratis y en pago. Si algo no aplica
  (ej. leads vacíos en Starter), dilo con honestidad — no lo bloquees.
- Si una consulta falla o una tabla no existe, repórtalo claro y **sigue con lo que sí se pudo**
  — un respaldo parcial honesto vale más que un error a medias.

Empieza por el PASO 0.

## Modo rápido (respaldo recurrente)
Si el miembro solo quiere "bajar mis datos otra vez" y ya lo corriste antes: no le repreguntes el
nivel ni las tablas (ya los sabes; si no están en el contexto, reverifícalos rápido con la consulta
de descubrimiento). Toma el mismo alcance de la última vez (o "todo el historial" por defecto),
corre las consultas del PASO 1, genera los archivos con fecha nueva en `member/exportes/` y entrega
rutas + conteos. Sigue siendo solo lectura, sin deploy ni git.
