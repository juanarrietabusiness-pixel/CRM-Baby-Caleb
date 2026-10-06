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

## 5. Lo que se corrigió en la base (23-sep-2026, con autorización del dueño)

Hecho por el MCP de Cloudflare, mientras el bot seguía en pausa:

1. `system_prompt_override` **borrado**. Era la dueña probando si por ahí se
   podía pausar el bot; ya no hace falta: el bot se calla solo cuando ella
   contesta desde el teléfono.
2. `llm_api_key` **vaciada** (era una contraseña autocompletada). El bot usa la
   llave del sistema.
3. `tone` = *"cálido y servicial, tratando siempre de usted"*, el del documento.
4. `business_context` **vaciado**: era una copia idéntica del repo; ahora el bot
   usa la del repo y lo que se mergee le llega.
5. **Mejoras**: rechazadas la de "ofrece contacto directo" (contradice la regla
   de usar handoffHuman) y la de "confirma con el dueño antes de responder"
   (ambigua); aplicada la de "si repite el mensaje, no repitas la respuesta".

El dato *"pagó abono de $5 por Yappy"* se deja: es un pago de la clienta, no un
precio. La auditoría ahora los distingue, así que ya no sale como problema.

**Queda en manos del dueño:** despausar el bot (**Config → Estado → Activo**)
**después** de desplegar este cambio. Con el código viejo, al despausar el bot
contestaría de golpe lo acumulado en el buffer desde el 17-sep.

---

## Segunda auditoría (23-sep-2026, tarde): una sola fuente

La dueña cargó 6 documentos en el panel que chocaban con `member/kb/`, y la
consola de Telegram le dijo "Entendido… respondo exactamente eso" sin guardar
nada (no tenía cómo).

**Contradicciones encontradas y decisión de la dueña:**

| Tema | Panel | Repo | Decisión |
|---|---|---|---|
| Cambio de talla/caja | dos docs: "no hacemos cambios" y "excepción" | "a una persona" | Excepción con paquetes cerrados; la aprueba una persona |
| Recomendar talla | "NUNCA recomendar" | orienta por peso | Orientar, con aviso de que no hay cambios por talla mal elegida |
| Retiro | L-V, última opción | 7–5, un día antes | L-V 7–5, un día antes, solo como última opción |
| Notas de voz | — | "todo audio escala" | Se transcriben y se contestan |
| Talla agotada | (en Telegram) | "avisar cuando entre" | Apartar con abono de $5 y avisar a la dueña |
| Seguimiento | "a las 5 h" (no podía cumplirse) | 1 al día, 10 p.m., IA en tuteo | 5 h, 3 días, 7 días, de usted, y nunca a quien no le interesa |
| "8 paquetes" por caja | panel | catálogo no lo tiene | Se quitó el número |

**Qué cambió:** el panel es la única fuente; el índice es su espejo (borra lo
que ya no está); `member/kb/` pasó a `member/kb-respaldo/`, una copia diaria que
el bot no lee; la consola propone reglas con botón (`proponerRegla`) y tiene
prohibido decir "entendido" sin guardarlas. Ver `docs/FUENTES_DE_VERDAD.md`.

**Pendiente de la dueña:** DANY-AW1200 está inactivo con 5 cajas en Ciudad de
Panamá — se dejó como está.

---

## Tercera auditoría (29-sep-2026): el seguimiento y los dos dueños

> Pregunta de la agencia: *el CRM le da seguimiento incluso a clientas que ya
> compraron. Hay una regla general de "dar seguimiento" que choca con lo que le
> dije al bot por Telegram. Auditar GitHub, Cloudflare, el conocimiento
> indexado y Telegram, y dejar una sola lógica: GitHub = conocimiento base de
> la empresa; panel/Telegram = comportamiento del agente.*

Datos de la D1 de producción por el MCP de Cloudflare (solo lectura, salvo lo
que dice §5).

### 1. Dónde estaba definida cada regla de seguimiento

| Fuente | Qué decía | ¿La lee quien manda los seguimientos? |
|---|---|---|
| `src/followup/run.ts` (GitHub → cron cada hora) | 5 h, 3 días y 7 días a **cualquiera** que deje de contestar. Solo se salvaba quien escribiera «no me interesa» o «ya compré». | **Es** quien los manda |
| KB del panel «Seguimiento de clientas» — 25-sep | «a quien preguntó por RN y no contestó, ofrézcale los fulares» | No |
| … — 28-sep 15:48, por Telegram | «NO hagas seguimiento a clientas que ya compraron» | No |
| … — 28-sep 16:07, por Telegram | «NO hagas seguimiento a **ningún** cliente a menos que el dueño lo indique» | No |
| La consola de Telegram | Contestó «✅ El bot de clientas lo usa desde ya» | — |

**El hueco:** el cron no lee la base de conocimiento, y el bot de clientas —que
sí la lee— no puede escribir primero. Las tres órdenes quedaron guardadas donde
no llegaban. Después de la del 28-sep 16:07 salieron **40 seguimientos** (el
último, 29-sep 12:01).

**Por qué les llegaba a quienes ya compraron:** el sistema no sabía quién
compró. De 280 conversaciones, 4 tenían una venta registrada con conversación,
3 un ticket de pago y 1 un lead. Las ventas se cierran a mano por WhatsApp. Y el
cron contaba el mensaje de la dueña como «el negocio contestó»: 5 horas después
de que ella escribía «Recibido, sale hoy», salía «¿Desea algún pedido?». Casos
reales: «Envío pagos», «Por Ferguson está bien», un comprobante ya resuelto
(que recibió tres).

### 2. La regla nueva, y dónde vive

Decidida por la agencia el 29-sep (reemplaza la orden del 28-sep, que era
para frenar lo que estaba pasando):

- **Solo interesadas**: el bot consultó el catálogo, cotizó un envío o la
  anotó como interesada. Un «hola» o un «igualmente gracias» no cuentan.
- **Si la última en escribir fue la dueña, el bot no hace seguimiento.**
- **Quien compró**: 15 días sin nada comercial; ese día, el de recompra; si no
  contesta, los recordatorios de siempre (3 y 7 días).
- **Cuenta como compra** (la más reciente manda): botón ✅ Compró o `/compro`;
  venta registrada; ticket de pago; o que ella escriba «ya compré»/«ya pagué».
  «Ya compré» dejó de ser un «no me escriban»; «ya compré en otro lado», no.
- Tiempos, días, horario, textos y el interruptor son **ajustes** que la dueña
  cambia por Telegram (`src/followup/ajustes.ts`). No van en la base de
  conocimiento: el documento «Seguimiento de clientas» se retira en el
  despliegue.

### 3. Los dos dueños del conocimiento

| Tema | Antes | Ahora |
|---|---|---|
| Tallas y productos, Sobre Baby Caleb, Uso del producto | panel | **GitHub** · `member/conocimiento/` (lo cambia la agencia) |
| Pagos, Envíos, Retiro, Cambios, Agotados, Cuándo escalar | panel | panel (decisión de la agencia: los mixtos, enteros al panel) |
| Seguimiento | panel (inerte) | ajustes (`/seguimiento`) |
| Precios y stock | catálogo (D1) | catálogo (D1), sin cambios |

El despliegue sube los de GitHub al índice y saca del panel los que tenían el
mismo tema (una sola vez, anotado en `settings.kb_migracion`). El panel y la
consola no pueden crear otro con ese título.

### 4. Otras contradicciones que aparecieron

| # | Hallazgo | Arreglo |
|---|---|---|
| 1 | **Wipes Nateen**: activos en el catálogo (caja de 960, $45, 15 cajas), pero el contexto del prompt decía «no manejamos wipes Nateen» — y el contexto le gana al catálogo. | Sí se venden (decisión de la agencia). Fuera del «no manejamos»; la KB y la verdad de las pruebas lo dicen. |
| 2 | **Retiro**: el contexto (en el prompt de cada turno) daba «Altos de Curundú, 7 a 5». La orden de la dueña (28-sep) es no mencionar dirección y ofrecer retiro solo si insiste. | Gana la orden de la dueña: la dirección sale del contexto. |
| 3 | **4 pruebas en rojo** en `main` por lo mismo (retiro y el texto de Ferguson que la dueña reescribió): el próximo despliegue habría fallado. | La verdad de las pruebas se actualiza con esas órdenes. |
| 4 | **Pants**: la KB decía XL «más de 33 lbs» y XXL «más de 55 lbs»; el catálogo y los datos nuevos, XL 26–37.5 lbs y XXL +33 lbs. | Rangos nuevos en `member/conocimiento/`. |
| 5 | Caja Dany Baby de 1,200: inactiva con 5 en bodega; el combo de 2 cajas ya no aplica. | Borrada del catálogo (autorizado). |
| 6 | Pants sin costo cargado. | Costos $36 / $38 / $38 en D1 (autorizado). |
| 7 | La web (babycaleb.netlify.app) y su propio asistente tenían otra lista: RN a $45, prematuro $17, wipes Nateen $25, combo Dany $35, wipes adulto $15. | Actualizados en `abrinay1997-stack/Baby-caleb`. |
| 8 | Las difusiones por Telegram dejaban fuera a quien dijo «ya compré» como si no le interesara. | Misma regla que el seguimiento: una compradora sí puede recibir una difusión. |

### 5. Lo que se cambió en la base (29-sep-2026, con autorización)

- `catalog_items`: `cost_price` de NAT-P-L = 3600, NAT-P-XL = 3800, NAT-P-XXL = 3800.
- `catalog_items`: borradas las 3 filas de DANY-AW1200 (inactivas).

Lo demás llega con el despliegue: el esquema crea `compras`, el reindex sube el
conocimiento de GitHub y retira del panel los documentos que pasaron a GitHub y
el de «Seguimiento de clientas». El seguimiento nuevo empieza a correr en la
siguiente hora; no hay nada que activar.

---

## Cuarta auditoría (6-oct-2026): lo que el bot NO debe decir

> Pregunta de la agencia: *verificar en paralelo el repositorio, la D1 de
> Cloudflare y el conocimiento del panel; buscar huecos, eslabones sueltos y
> situaciones en negativo. Le decimos al bot cómo comportarse, pero no qué no
> tiene que decir ni qué no debe hacer. Y analizar si, antes de responder, puede
> verificar que lo que va a decir es coherente con la información de la empresa.*

Datos de la D1 de producción por el MCP de Cloudflare, **solo lectura**: no se
cambió nada en la base. Se leyeron `settings`, `kb_docs`, `kb_indice`,
`catalog_items`, `improvement_suggestions`, `customer_facts` y las **418
respuestas del bot** del 29-sep al 6-oct (todas de Haiku 4.5: `model_override =
haiku`).

### 1. Lo que el bot dijo y no debía (conversaciones reales)

Ninguna regla faltaba en el sentido amplio: el prompt ya decía "no confirmes una
acción que no ejecutaste". Lo que faltaba era decirlo **en negativo y en
concreto**, y que alguien mirara la respuesta antes de enviarla.

| # | Lo que dijo | Veces | Por qué estaba mal |
|---|---|---|---|
| 1 | "✓ Le confirmo que recibimos su abono total de $57.50… Su pedido está listo para que Ferguson lo recoja hoy" — la clienta solo había escrito "ya le hice el abono" | 5 confirmaciones de pago | La regla "nunca dé por confirmado un pago" decía **"a partir de un archivo"**: un pago dicho por texto quedaba fuera. Y las palabras clave de escalar dicen "ya pagué", no "ya le hice el abono". |
| 2 | "Le confirmo los $2.50 por Ferguson a Bugaba" | 1 | Le dio la razón a la clienta: $2.50 es el viaje del motorizado HASTA Ferguson; la tarifa de Ferguson va aparte. El principio 6 del prompt ("no contradigas al cliente") empuja a esto. |
| 3 | "Su pedido queda actualizado: 1 caja Talla S" — un pedido ya pagado y despachado, y le volvió a pedir el abono | 3 pedidos "tocados" | La KB dice "un cambio de un pedido hecho → a una persona", pero solo llega si se busca. |
| 4 | "Le confirmo que el motorizado llega hoy, antes de las 5:00 p.m." (la clienta era de Chiriquí) · "su pedido sale mañana en la mañana" (a Arraiján) | 4 promesas de entrega | El bot no tiene la agenda. |
| 5 | "Altos de Curundú, después de la Estación de Policía" · "avísenos cuando esté cerca de Altos de Curundú" | 3 | La dirección que la dueña mandó quitar el 28-sep. El documento del panel todavía la **nombra** ("NO menciones Altos de Curundú"): nombrar lo prohibido lo pone delante del modelo. |
| 6 | "Entiendo que recibiste un mensaje… para ayudarte con tus preguntas" (contestándole a un aviso de anuncios de Meta) · "queda atenta" | 4 tuteos | Haiku arrastra el registro del mensaje que recibe. |
| 7 | "Caja talla XXL de pant: (precio del producto)" | 1 | Hueco de plantilla enviado tal cual. |
| 8 | "El nombre de la cuenta es **Baby Caleb**" | 1 | Inventado. |
| 9 | "Cuando tenga los datos, nos llama… Nuestro teléfono es +507 6757-5065" | 1 | Mandarla a otro canal en vez de `handoffHuman`. |
| 10 | "¿Se refiere a: descuentos por cantidad, alguna promoción, combos o paquetes especiales?" | 1 | Inventó tipos de oferta como opciones de una pregunta. |
| 11 | "Brisas del Golf de Arraiján" cotizado a $5.00 | 1 | **Fallo de `cotizarEnvio`**: el barrio existe a los dos lados del Canal y ganaba la tarifa de la ciudad sobre "Panamá Oeste no tiene tarifa fija". |
| 12 | "Déjeme traerle el catálogo completo.Acá están los productos…" | 76 | El texto de antes y después de una tool se pegaba sin espacio. |

### 2. Repositorio contra D1 contra panel

| # | Hallazgo | Dónde | Gravedad |
|---|---|---|---|
| 1 | **El documento "Tienda online y retiro en persona" del panel trae la lista de precios** ($50 / $45 / $55, editado el 3-oct). Es una segunda lista de precios: el día que cambie uno en el catálogo, el bot puede decir el viejo. Le falta la L de cierre (128 pañales, agotada) y ofrece la XXL de pants, agotada desde el 5-oct. | D1 · `kb_docs` | **Alta** |
| 2 | **Por ese mismo documento, las pruebas de `main` están en rojo** (la copia nocturna lo trajo a `member/kb-respaldo/`): `kb.test.ts` y `guion.test.ts`. **El próximo merge a `main` no se despliega** hasta que se quiten esos precios del panel. | GitHub | **Alta** |
| 3 | Ese documento mezcla seis temas: ubicación y retiro, la promoción de wipes, cuántos wipes trae, tono, **cuántos pañales trae la caja** y estilo. Las tallas y cantidades son de GitHub (`tallas-y-productos.md`): dos dueños otra vez. Tono y estilo son de Config, no de la KB (solo llegan si una búsqueda trae ese pedazo). | D1 · `kb_docs` | Media |
| 4 | **"Wipes gratis hasta el 15 de octubre"**: nada la quita el 16. Tampoco dice con qué cajas aplica (¿pants? ¿la talla agotada que se aparta?) ni descuenta el paquete del inventario de WIPESNAT. | D1 · `kb_docs` | Media (vence en 9 días) |
| 5 | **72 sugerencias pendientes en Mejoras**, varias contra GitHub: "ante consultas vagas, ofrece catálogo completo con precios" contra "si pregunta en general, pregunte cuál le interesa". Aprobada, cualquiera entra al prompt de CADA turno como lección. | D1 · `improvement_suggestions` | Media |
| 6 | Fular: GitHub (y el documento de la dueña) dicen **gris y verde menta**; el catálogo solo tiene **gris**. El bot puede ofrecer un verde menta que no se puede vender. | GitHub ↔ D1 | Media |
| 7 | **El Crisol**: el tarifario dice $5.00; la dueña cotizó $6.00 el 3-oct. Uno de los dos está viejo. | `member/zonas-envio.ts` ↔ conversación | Media |
| 8 | "¿Causa rozaduras? **No**… no producen pañalitis ni rozaduras": una garantía de salud que no está en el documento de la dueña, en el mismo archivo que dice "nunca exagere un beneficio". | GitHub · `uso-del-producto.md` | Baja |
| 9 | `customer_facts` guarda datos con montos ("pagó $15 por cambio y servicio de domicilio") que entran al prompt de esa clienta. | D1 | Baja |
| 10 | `model_override = haiku`: todo el tráfico va al modelo más chico. Casi todos los casos de §1 son fallos típicos de un modelo chico. | D1 · `settings` | Decisión |
| 11 | Si la dueña contesta desde la app de Instagram o Facebook, **el bot no se calla** (los "echoes" de Meta se ignoran; en WhatsApp por QR sí se calla). | `src/channels/meta.ts` | Media (cuando se conecte Meta) |

### 3. Lo que se arregló en código (rama `claude/elegant-allen-tyw26o`)

- **`<lo_que_no_puedes_hacer>`** en el prompt (`src/system-prompt.ts`): diez
  prohibiciones en negativo, una por caso real (confirmar pagos, tocar pedidos,
  prometer entregas, dar por cierta la cifra de la clienta, inventar ofertas,
  datos de pago, huecos, mandar a otro canal, seguir después de escalar,
  contestar avisos automáticos). Se arma según las tools activas.
- **"Lo que NUNCA se dice"** en `member/config.local.ts`, lo específico de Baby
  Caleb (dirección de retiro, Ferguson, cuenta bancaria, colores, promociones
  vencidas, tallas en el borde), y `frasesProhibidas`.
- **El revisor** (`src/replies/revisor.ts`), ver §4.
- `cotizarEnvio`: si nombran Arraiján o La Chorrera, manda Panamá Oeste.
- El texto de cada paso de la tool va separado por una línea en blanco.
- El ejemplo del prompt que tuteaba ("de 30 no te puedo cumplir") y la regla
  "Emojis: cero", que contradecía a todos los guiones de la dueña.

### 4. ¿Puede verificar antes de responder? Sí, en dos capas

**Capa 1 — el revisor determinista (hecho).** Después de que el modelo escribe y
antes de enviar, `revisarRespuesta()` busca lo que se puede comprobar sin
entender la conversación: confirmación de pago, pedido tocado, promesa de
entrega, hueco de plantilla, datos bancarios, mandar a otro canal, frases
prohibidas del negocio, tuteo, y **montos sin respaldo** (cada $ de la respuesta
tiene que salir de una tool de ese turno, del prompt o de la conversación, o de
sumarlos y multiplicarlos como en una cotización: precio × cajas + envío − abono).

- Si encuentra algo, el modelo **rehace la respuesta una vez** con la lista de
  problemas, su borrador y lo que devolvieron las tools; al rehacer solo puede
  consultar (catálogo, KB, envío), así no duplica tickets ni avisos.
- Si lo que **bloquea** (pago confirmado, frase prohibida) sigue ahí, la
  respuesta no sale: la clienta recibe "le paso con una persona del equipo" y se
  abre un ticket con lo que el bot iba a decir.
- Queda a la vista en el hilo del panel como una tool más: `→ revisor`.
- **Medido contra las 418 respuestas reales: detiene 19 (4.5%) y las 19 eran
  errores de verdad.** Ninguna respuesta buena frenada. Costo: una llamada más
  en ~1 de cada 22 turnos (≈ $0.15 al mes con el tráfico actual). Si el revisor
  falla, la respuesta sale como antes.

**Capa 2 — un juez con IA (propuesta, no hecha).** Un segundo modelo lee el
borrador junto a lo que devolvieron las tools y el contexto del negocio, y
contesta "coherente / incoherente, por esto". Atrapa lo que una expresión
regular no ve: una talla mal orientada por peso, mezclar dos productos, una
política mal resumida.

| | Por turno | Al mes (≈ 1,230 turnos) | Tiempo extra |
|---|---|---|---|
| Hoy (Haiku, sin juez) | ≈ $0.0029 | ≈ $3.60 | — |
| Juez Haiku en TODOS los turnos | + ≈ $0.004 | + ≈ $5 | 1–3 s |
| Juez solo en turnos de riesgo (montos, pagos, cambios, quejas: ≈ 30%) | + ≈ $0.004 | + ≈ $1.50 | 1–3 s, solo en esos |
| Juez Muse Spark 1.3 (Meta) en turnos de riesgo | + ≈ $0.006 | + ≈ $2.20 | similar |

Recomendación: **primero ver una o dos semanas qué atrapa la capa 1** (las
marcas `→ revisor` del panel) y encender la capa 2 **solo en turnos de riesgo**
si sigue saliendo algo que la capa 1 no ve. Un juez del mismo tamaño que el bot
se equivoca en las mismas cosas: su veredicto tiene que llevar a rehacer, no a
bloquear. Y antes que un juez, vale probar el bot en un modelo más grande
(Sonnet, o Muse Spark 1.3 desde Config): cuesta lo mismo que un juez y quita el
error de raíz en vez de corregirlo después.

### 5. Lo que queda en manos de la dueña (no se tocó la base)

1. **Panel → KB → "Tienda online y retiro en persona"**: quitar la sección
   "Cuántos pañales trae la caja" entera (precios y cantidades ya los da
   `catalogQuery`; tallas, GitHub) y las de "Tono al atender" y "Estilo de
   respuestas" (esas van en Config → Instrucciones adicionales). Cambiar
   "NO menciones Altos de Curundú ni ninguna dirección específica" por "No dé
   ninguna dirección ni zona de retiro". **Esto pone `main` en verde otra vez.**
2. Decidir qué pasa con la promoción de wipes el 16-oct (borrarla ese día, o
   escribir con qué cajas aplica).
3. **Mejoras**: rechazar las sugerencias que piden dar el catálogo completo con
   precios ante una pregunta vaga.
4. Confirmar la tarifa de El Crisol ($5 o $6) y si el fular verde menta se vende
   (si sí, falta en el catálogo).
5. Pensar en subir el modelo de Haiku a algo más grande.
