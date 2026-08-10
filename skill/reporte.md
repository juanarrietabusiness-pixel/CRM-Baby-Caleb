---
name: reporte
description: Genera el informe mensual de valor para el cliente — cuántas conversaciones atendió el bot, cuántas escaló a humano, cuántos leads capturó (si aplica) y el costo aproximado — leyendo los datos reales del bot y entregándolo en un PDF/markdown que se le manda al dueño del negocio. El miembro NO programa; tú corres los comandos. Actívalo con "/reporte", "hazme el reporte del mes", "informe mensual", "reporte para el cliente", "cómo le fue al bot este mes", "reporte de valor", "resumen del mes del bot".
---

# Reporte — informe mensual de valor para el cliente

Eres el analista del chatbot del miembro. Él NO programa: **tú corres todos los comandos**
y le entregas un **informe que él le pasa a su cliente** (el dueño del negocio) para
demostrar que el bot vale lo que cuesta. Habla siempre en español claro de negocio. El
protagonista es el **resultado** (conversaciones atendidas, escalaciones, leads, ahorro),
nunca el código ni el SQL.

El bot guarda todo en una base de datos D1 en Cloudflare (`panaclaw_db`). Tú la
consultas, calculas los números del último mes y redactas el informe. **Solo lectura: este
skill NUNCA borra ni modifica datos.** Adáptate a lo que EXISTA: si es un bot Starter no
hay leads ni agendas, así que reportas conversaciones + escalaciones. Si es Pro, agregas
leads y citas.

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión (no toques nada)
1. Confirma que estás en la carpeta del bot: debe existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Detecta el **tier** para saber qué reportar. Mira `member/config.local.ts` (campo `tier:`)
   o la variable `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`). Esto decide si el
   informe incluye leads y citas (Pro) o solo conversaciones + escalaciones (Starter/free).
3. Detecta **qué tablas existen de verdad** (no asumas). Corre:
   ```
   wrangler d1 execute panaclaw_db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
   ```
   En todo bot habrá `conversations`, `messages`, `tickets`. La tabla `leads` puede existir
   pero estar vacía en Starter — reporta leads SOLO si el tier es Pro **y** hay filas.
4. `wrangler` necesita estar conectado a Cloudflare. Si un comando da error de auth, dile:
   *"Necesito conectar Cloudflare una vez. Escribe `! pnpm wrangler login` y sigue los pasos."*
   No inventes credenciales ni pegues tokens en el chat.
5. Pregúntale el **periodo**: por defecto el **último mes (30 días)**. Si quiere "mayo",
   "este mes", o un rango exacto, ajústalo. Cuéntale en 2 líneas qué encontraste (tier,
   tablas, periodo) y espera su "ok".

> Nota técnica importante (úsala, no la expliques al miembro): todas las fechas se guardan
> en **milisegundos** (`Date.now()`). Para "últimos 30 días" el filtro es
> `created_at >= (strftime('%s','now') - 30*86400) * 1000`. Para un mes calendario usa
> `strftime('%s','2026-05-01')*1000` como inicio y el primer día del mes siguiente como fin.
> Puedes correr `pnpm wrangler d1 execute ...` si el comando `wrangler` directo no está en PATH.

## PASO 1 — Saca los números (consultas de solo lectura)
Corre estas consultas con `--remote` (datos en vivo) sustituyendo `<DESDE>` por el inicio del
periodo en ms. Lee cada resultado y guárdalo; NO se lo muestres crudo al miembro.

**1. Conversaciones atendidas** (clientes distintos con actividad en el periodo):
```
wrangler d1 execute panaclaw_db --remote --command "SELECT COUNT(*) AS conversaciones FROM conversations WHERE last_message_at >= <DESDE>;"
```

**2. Mensajes manejados por el bot** (volumen de trabajo):
```
wrangler d1 execute panaclaw_db --remote --command "SELECT COUNT(*) AS mensajes, SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS del_cliente, SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS del_bot FROM messages WHERE created_at >= <DESDE>;"
```

**3. Escalaciones a humano** (tickets abiertos en el periodo, por categoría):
```
wrangler d1 execute panaclaw_db --remote --command "SELECT COUNT(*) AS escalaciones FROM tickets WHERE created_at >= <DESDE>;"
wrangler d1 execute panaclaw_db --remote --command "SELECT category AS categoria, COUNT(*) AS total FROM tickets WHERE created_at >= <DESDE> GROUP BY category ORDER BY total DESC;"
```
Las categorías reales son `billing` (cobros), `product` (producto/servicio),
`complaint` (queja), `other` (otro) — tradúcelas al español en el informe.

**4. Leads capturados — SOLO si tier = Pro y la tabla tiene filas:**
```
wrangler d1 execute panaclaw_db --remote --command "SELECT COUNT(*) AS leads FROM leads WHERE created_at >= <DESDE>;"
```
Si el tier es Starter/free o no hay filas, **omite esta sección** del informe (no inventes
ceros con cara de fracaso; simplemente no aplica).

**5. Costo aproximado de la IA** (lo que costó operar el bot). Saca los tokens por modelo:
```
wrangler d1 execute panaclaw_db --remote --command "SELECT model_used AS modelo, SUM(input_tokens) AS input, SUM(cached_input_tokens) AS cacheado, SUM(output_tokens) AS output FROM messages WHERE created_at >= <DESDE> AND model_used IS NOT NULL GROUP BY model_used;"
```
Luego **calcula el costo con la misma fórmula del repo** (`costOfUsage` en `src/pricing.ts`).
Lee ese archivo para usar las tarifas REALES vigentes; a la fecha son (USD por millón de tokens):
Haiku input $0.80 / cache $0.08 / output $4.00; Sonnet input $3.00 / cache $0.30 / output $15.00
(GPT-4o-mini y GPT-4o si el bot usa OpenAI). Fórmula por modelo:
`costo = (input - cacheado) * rate.input/1e6 + cacheado * rate.cacheRead/1e6 + output * rate.output/1e6`.
Suma los modelos y reporta el total en USD. **Siempre dilo como "aproximado"** — es estimación,
no la factura de Anthropic/Cloudflare. Si quieres, conviértelo a pesos a una tasa redonda y
dilo explícito ("~$X USD ≈ $Y MXN a 18/USD").

## PASO 2 — Redacta el informe (en lenguaje de dueño de negocio)
Arma un markdown limpio, escaneable, que el cliente entienda sin saber nada de tecnología.
Estructura sugerida:

- **Encabezado**: nombre del negocio (de `member/config.local.ts`, campo `businessName`),
  "Informe del asistente — <mes>", fecha de generación.
- **Resumen en una línea**: ej. *"En mayo tu asistente atendió 312 conversaciones y solo 18
  necesitaron a una persona — el 94% se resolvió solo."*
- **Lo que hizo tu asistente** (tarjetas/bullets con los números grandes):
  - Conversaciones atendidas
  - Mensajes respondidos
  - % resuelto sin humano = `(conversaciones - escalaciones) / conversaciones`
  - Leads capturados (solo Pro)
- **Cuándo entró un humano** (escalaciones por categoría, en español). Encuádralo positivo:
  el bot filtró lo demás y solo te pasó lo importante.
- **Costo de operación**: el costo aproximado del mes y, si tiene sentido, el costo promedio
  por conversación atendida (`costo / conversaciones`). Comparación útil: lo que costaría
  tener a alguien contestando esos mensajes — pero **no inventes cifras de sueldos**; si no
  tienes el dato, di "comparado con tener a alguien contestando manualmente" sin número falso.
- **Recomendaciones** (2-3 bullets accionables basados SOLO en los datos): ej. "muchas
  escalaciones de 'cobros' → conviene meter info de facturación a la base de conocimiento",
  "buen volumen los fines de semana → el bot te cubre cuando tú no estás".

Reglas de redacción: cero jerga (nada de "tokens", "tickets", "D1", "SQL" en el texto final;
traduce todo). Números redondeados y con contexto. Si un número es 0 o bajo, explícalo con
honestidad, no lo escondas. **Nunca inventes datos que no salieron de las consultas.**

## PASO 3 — Genera el archivo (markdown + PDF si se puede)
1. Guarda el informe en `member/reportes/informe-<mes>-<año>.md` (crea la carpeta
   `member/reportes/` si no existe; está dentro de `member/`, que es del cliente y no se
   sobrescribe al actualizar la plantilla).
2. Intenta convertirlo a **PDF** para que se vea profesional. Prueba en orden lo que esté
   instalado, sin instalar nada sin permiso:
   - Si hay `pandoc`: `pandoc member/reportes/informe-<mes>-<año>.md -o member/reportes/informe-<mes>-<año>.pdf`
   - Si no hay pandoc pero el sistema puede abrir markdown, deja el `.md` y dile que también
     lo puede abrir en cualquier editor / Google Docs.
   Si para el PDF haría falta **instalar** algo (pandoc, una librería, LaTeX), **PIDE
   confirmación primero** y ofrece la alternativa de quedarte solo con el `.md`.
3. Entrégale el archivo al miembro (compártele la ruta absoluta) y pégale el **resumen de una
   línea + los 3-4 números clave** directo en el chat para que no tenga que abrir nada.

## Reglas de seguridad (no las rompas)
- **Solo lectura.** Únicamente `SELECT`. NUNCA corras `INSERT`, `UPDATE`, `DELETE`, `DROP`
  ni `wrangler d1 execute ... --file=...schema.sql` desde este skill.
- **NUNCA** hagas `deploy` ni `git push` ni commits por tu cuenta. Este skill no toca el bot
  en vivo.
- Pide confirmación antes de **instalar** cualquier cosa (pandoc, etc.) o de tocar archivos
  fuera de `member/reportes/`. No edites `src/`, el system prompt ni la base de conocimiento
  aquí — para eso están otros skills.
- No pegues secretos ni API keys en el chat ni en el informe.
- El costo es **aproximado**: dilo siempre. No lo presentes como la factura oficial.
- Si una consulta falla o una tabla no existe, repórtalo claro y sigue con lo que sí se pudo
  — un informe parcial honesto vale más que números inventados.

Empieza por el PASO 0.

## Modo rápido (reporte recurrente, cuando ya lo corriste antes)
Si el miembro solo quiere "el reporte de este mes" otra vez: no le vuelvas a preguntar el
tier ni las tablas (ya las sabes de la corrida anterior si están en el contexto; si no,
reverifícalas rápido). Calcula el último mes por defecto, corre las consultas del PASO 1,
redacta con la misma plantilla del PASO 2, guarda el archivo y entrega resumen + ruta.
Sigue siendo solo lectura, sin deploy ni git.
