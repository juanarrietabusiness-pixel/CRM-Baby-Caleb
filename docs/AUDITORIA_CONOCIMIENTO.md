# Auditoría: lo que llega por GitHub contra lo que se carga desde el panel

> Pregunta de la agencia (23-sep-2026): *lo que se mergea en GitHub y se despliega
> con Actions es el ADN del CRM, pero el CRM también tiene funciones de
> conocimiento en el panel. ¿Pueden entrar en conflicto? ¿Cuál funciona mejor?
> ¿Hacen lo mismo?*
>
> Respuesta corta: **sí entraban en conflicto, en silencio, y ya pasó en
> producción.** No hacen exactamente lo mismo: cada dato tiene que tener UN
> solo dueño. Abajo está qué se encontró en la base en vivo, qué se arregló, y la
> regla para no volver a caer.

Datos tomados de la D1 de producción (`juancitoads-bot-db`) y del último
despliegue (run 31 de *Deploy*, 17-sep-2026), por el MCP de Cloudflare, solo
lectura.

---

## 1. Las dos puertas y lo que cada una alimenta

| Capa | Puerta GitHub (git → Actions) | Puerta panel (/admin → D1) | ¿Cuál gana hoy? |
|---|---|---|---|
| Base de conocimiento (`searchKb`) | `member/kb/*.md` → el deploy reindexa Vectorize | `/admin/kb` → tabla `kb_docs` → **el mismo índice** | Conviven en el mismo índice. Ninguna gana: el bot puede leer las dos. |
| Contexto del negocio (va en el prompt) | `member/config.local.ts` | `/admin/config` → `settings.business_context` | **El panel**, si tiene algo. |
| Prompt entero | el generado (`src/system-prompt.ts`) | `settings.system_prompt_override` | **El panel**, y lo reemplaza TODO. |
| Reglas extra | — | `settings.custom_instructions` (nuevo) | Se suman al generado. No compiten. |
| Lecciones aprendidas | — | flywheel → `settings.learned_lessons` | Solo panel (con aprobación). |
| Precio y existencias | — (prohibido en git) | `catalog_items` (panel **y ahora Telegram**) | Solo D1. Un dueño. |
| Memoria por clienta | — | `customer_facts` (lo escribe el analista nocturno) | Solo D1. |

**La trampa de fondo:** las capas que van *dentro del prompt* (contexto,
override, lecciones) el modelo las lee **antes** de decidir si consulta una
herramienta. Por eso un dato viejo en el panel le gana al repo sin que nada
falle: el deploy sale verde, las pruebas pasan, y el bot dice otra cosa.

---

## 2. Lo que se encontró en la base en vivo

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | `system_prompt_override` = *"- Cuando un humano responda por whatsapp el bot se pone en pausa en ese chat"*, guardado el 17-sep 14:27 UTC desde **Config → "Instrucciones personalizadas"**. Ese campo decía "reglas especiales" y en realidad **reemplazaba el prompt entero**: sin catálogo obligatorio, sin contexto del negocio, sin trato de usted. Es la causa del ✗ de la auditoría. | Crítica | **Arreglado en código.** Config ahora escribe `custom_instructions`, que se *suma*. Si queda un override guardado, Config lo muestra en rojo con dos botones: *Convertirlo en instrucción adicional* o *Borrarlo*. Falta tocar uno de los dos (ver §5). |
| 2 | `bot_paused = 1` desde el mismo 17-sep 14:27. El bot no contesta desde entonces; los mensajes de las clientas quedaban en el buffer del Durable Object, **fuera de D1 e invisibles en el panel**. | Crítica | Arreglado en código: en pausa, los mensajes se guardan en D1 y se ven en el panel; al despausar, lo acumulado de días **no** se contesta de golpe. Despausar es decisión del dueño (ver §5). |
| 3 | `llm_api_key` guardada con un valor que **no es una llave de IA** (11 caracteres; parece una contraseña que el navegador autocompletó en el campo). Con el bot despausado, cada respuesta habría sido "Algo falló de mi lado". | Crítica (latente) | Arreglado: el bot ignora una llave que no tiene forma de llave, el formulario rechaza guardarla y el navegador ya no la autocompleta. **Hay que borrarla igual**: es una contraseña en texto plano en la base. |
| 4 | `business_context` en D1 es una **copia idéntica** de `member/config.local.ts` (se congeló al guardar Config, que pre-llena el campo con el del repo). Hoy dicen lo mismo; el próximo merge a ese archivo **no le llegaría al bot**. | Alta (latente) | Arreglado: una copia igual al repo se guarda vacía (= "use la del repo"). La auditoría avisa si vuelve a pasar. |
| 5 | `tone = "cálido y cercano"` cuando el documento de la dueña pide *"cálido y servicial, tratando siempre de usted"*. Lo pisó el mismo guardado: la tarjeta de tono marcaba la primera opción cuando el valor guardado no era ninguna. | Media | Arreglado: un valor propio aparece como tarjeta *Personalizado* y no se pisa. Hay que volver a poner el tono del documento (§5). |
| 6 | `customer_facts`: *"pagó abono de $5 por Yappy"* (conversación de prueba). La auditoría lo marcaba ✗ por tener un `$`. | Falso positivo | Arreglado: la auditoría distingue un **pago** de la clienta (historia útil) de un **precio de producto** (se congela). El analista ya no guarda precios. |
| 7 | 3 lecciones pendientes en *Mejoras*. Una —*"si hay errores técnicos, ofrece contacto directo"*— **contradice** la regla del contexto: *"NUNCA ofrezca los canales para quitarse una conversación de encima: use handoffHuman"*. | Media | Pendiente de la dueña: **rechazar** esa. La de *"solicita confirmación del dueño ANTES de responder"* es ambigua (el bot no puede esperar una respuesta): rechazarla o reescribirla como "escala con handoffHuman". La de *"si repite el mensaje, no repitas la respuesta"* se puede aprobar. |
| 8 | `kb_docs` vacía: **toda** la base de conocimiento viene de `member/kb/`. Vectorize al día: el deploy del 17-sep indexó 21 fragmentos y purgó 5 documentos retirados. | OK | — |
| 9 | Catálogo: precios = documento de la dueña. NAT-L y NAT-XXL con stock 0 en las tres bodegas (el bot los ofrece como agotados). | Aviso | Dato del negocio, no de código. |

---

## 3. ¿Cuál funciona mejor? ¿Hacen lo mismo?

**Para la base de conocimiento hacen lo mismo técnicamente** —las dos terminan
en el mismo índice de Vectorize, y `reindexAll` indexa ambas— **pero no valen
lo mismo:**

| | GitHub (`member/kb/`, `config.local.ts`) | Panel (`/admin/kb`, Config) |
|---|---|---|
| Queda registro de quién cambió qué | Sí (commit, PR, diff) | No |
| Lo revisan las pruebas (`test/babycaleb/`) | Sí: sin precios, sin tuteo, las 14 zonas… | No |
| Llega sin esperar un deploy | No (merge → Actions, ~3 min) | Sí, al instante |
| Se puede deshacer | `git revert` | Solo a mano |
| Lo audita `pnpm auditar` | Indirecto | Sí, directo (lunes y tras cada deploy) |

**Veredicto: GitHub es el dueño de lo permanente; el panel es para lo urgente y
para lo que cambia todos los días.**

- Políticas, tarifas de envío, formas de pago, cuándo escalar → `member/kb/` y merge.
- Contexto del negocio → `member/config.local.ts`. El campo del panel déjelo
  **vacío** salvo una urgencia, y mude la urgencia al repo en cuanto pueda.
- Precio y stock → **solo** el catálogo (panel o Telegram). Nunca en git.
- Reglas extra de conducta → *Instrucciones adicionales* en Config (se suman).
- `system_prompt_override` → no se usa. Es un interruptor de emergencia de la
  pestaña Agente.

---

## 4. Lo que vigila que no vuelva a pasar

- **Pruebas** (`test/babycaleb/`): vigilan los archivos del repo.
- **`pnpm auditar`** (pestaña Actions → *Auditar la verdad*): vigila la base en
  vivo. Desde el 23-sep corre también **después de cada despliegue**, en modo
  informativo, además de la corrida estricta de los lunes. Ahora además avisa:
  - de una llave de IA que no es llave,
  - de un `business_context` que es copia congelada del repo,
  - con la fecha en que se guardó el override o la pausa.
- **Config** muestra en rojo un override guardado, con la salida a un toque.
- **El stock ahora tiene dos escritores** (el editor del catálogo y las ventas o
  devoluciones que se registran por Telegram). Los dos escriben la misma fila
  —sigue habiendo un solo dueño del dato—, y el editor **no guarda** si el
  producto cambió mientras estaba abierto: recarga el stock actual y pide
  revisar. Cada movimiento por Telegram queda en `stock_movements` y se puede
  deshacer.

---

## 5. Lo que queda por hacer en el panel (5 minutos, sin terminal)

Después de que este cambio se despliegue:

1. **/admin → Config**: en el aviso rojo, *Convertirlo en instrucción adicional*
   (o *Borrarlo* — la regla que dice ya no hace falta: el bot se pausa solo
   cuando usted contesta desde el teléfono).
2. **/admin → Config → Modelo de IA**: marcar *Quitar mi API key* y guardar.
3. **/admin → Config → Tono**: en el campo *"…o escríbalo con sus palabras"*,
   poner *"cálido y servicial, tratando siempre de usted"* y guardar.
4. **/admin → Mejoras**: rechazar la lección de "ofrece contacto directo".
5. **/admin → Config → Estado → Activo**, cuando quiera que el bot vuelva a
   contestar.
6. Pestaña Actions → *Auditar la verdad* → *Run workflow*: debería salir en verde.
