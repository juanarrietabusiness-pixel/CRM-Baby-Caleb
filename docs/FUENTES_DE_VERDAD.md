# Fuentes de verdad — quién sabe qué, y quién no

> Este documento contesta una pregunta concreta: *cuando el bot dice un precio,
> ¿de dónde salió?* Y la de al lado, que es la que duele: *si dice uno
> equivocado, ¿dónde lo arreglo para que no vuelva?*

La verdad del negocio es el documento de la dueña,
**PREGUNTAS_BABY_CALEB_usted.docx** (Yulilka Godoy, 2026-09). Donde ese
documento contradiga al ADN de la agencia, a este repo o a lo que haya cargado
en el panel, **manda el documento**.

---

## 1. Las cinco capas que el bot lee

Cada turno, el bot arma su cabeza con esto, en este orden:

| # | Capa | Dónde vive | Quién la escribe |
|---|---|---|---|
| 1 | `system_prompt_override` | D1 · `settings` | el panel, **solo** pestaña Agente |
| 2 | `<business_context>` | D1 · `settings.business_context`, y si está vacío, `member/config.local.ts` | el panel, pestaña Config · o el repo |
| 3 | Lecciones aprendidas | D1 · `settings.learned_lessons` | el flywheel, solo |
| 3b | Instrucciones adicionales | D1 · `settings.custom_instructions` | el panel, pestaña Config — se **suman**, no reemplazan |
| 4 | Catálogo | D1 · tabla `catalog_items` | el panel, pestaña Catálogo |
| 5 | Base de conocimiento | Vectorize, espejo de dos dueños sin temas en común | **conocimiento base** (tallas, productos, quiénes somos, uso): GitHub, `member/conocimiento/` · **comportamiento** (pagos, envíos, retiro, cambios, agotados, cuándo escalar): el panel, pestaña KB, o el botón ✅ de la consola de Telegram |
| — | Seguimiento a clientas | D1 · `settings.seguimiento_*` + tabla `compras` | la dueña por Telegram (`/seguimiento`, `/compro`, o con sus palabras). **No** es una capa del prompt: lo lee el cron de `src/followup/run.ts` |

Las capas 1 a 3 van **enteras dentro del system prompt, en cada turno**. Las
capas 4 y 5 solo llegan al modelo si él decide llamar una tool.

**Esa asimetría es la causa de casi todos los desfases.** Un precio escrito en
la capa 2 lo lee el modelo *antes* de decidir si consulta el catálogo, así que
le gana a la capa 4 sin que nadie se entere y sin que nada falle. Por eso la
regla no es "trate de no duplicar", es la de la sección siguiente.

### La capa 1 es un interruptor de emergencia

`system_prompt_override` **reemplaza el prompt entero**, incluido el bloque
`<fuentes_de_verdad>` que obliga a consultar el catálogo.

> **Pasó el 17-sep-2026.** La pestaña Config tenía un campo "Instrucciones
> personalizadas" —"reglas especiales"— que escribía esta llave. La dueña puso
> ahí una línea para que el bot se pausara cuando ella contestara por WhatsApp,
> y esa línea pasó a ser el prompt entero. Desde el 23-sep ese campo se llama
> *Instrucciones adicionales* y escribe `custom_instructions`, que se suma al
> prompt generado; Config ya no toca el override, y si hay uno guardado lo
> muestra en rojo con la salida a un toque. Ver `docs/AUDITORIA_CONOCIMIENTO.md`. Si alguien pega un
prompt propio en la pestaña Agente, el bot pierde esa disciplina completa. Está
bien que exista, pero es lo primero que hay que mirar cuando el bot empiece a
contestar raro. La pestaña Agente lo indica: dice *"prompt personalizado"* en
vez de *"prompt automático"*.

---

## 2. La regla: un dato, un solo dueño

| Dato | Vive en | El bot lo obtiene | Nunca se escribe en |
|---|---|---|---|
| Qué productos existen | `catalog_items` | `catalogQuery` | KB, contexto, prompt |
| Precio de venta | `catalog_items` | `catalogQuery` | KB, contexto, prompt |
| Cuántos pañales trae la caja | el **nombre** del producto en `catalog_items` | `catalogQuery` | KB |
| Si hay o no hay | `catalog_items` | `catalogQuery` (etiqueta, no número) | ningún lado |
| Costo interno | `catalog_items.cost_price` | **nunca** — no sale de la base | ningún lado |
| Rangos de peso por talla | GitHub · `member/conocimiento/tallas-y-productos.md` | `searchKb` | catálogo, panel |
| Tarifas de delivery por zona | tool `cotizarEnvio` (reglas en KB «Envíos y delivery») | `cotizarEnvio` | catálogo |
| Formas de pago, abono mínimo | panel · KB «Pagos, abonos y facturación» | `searchKb` | catálogo |
| Qué es cada producto, quiénes somos, uso del producto | GitHub · `member/conocimiento/` | `searchKb` | panel |
| Cambios, retiro, agotados, pagos, envíos | panel · KB (un documento por tema) | `searchKb` | GitHub |
| A quién se le hace seguimiento, cuándo, y qué pasa con quien compró | D1 · `settings.seguimiento_*` (Telegram: `/seguimiento`) | nadie: lo lee el cron | KB, contexto, prompt |
| Quién ya compró | D1 · `compras` + ventas de `stock_movements` + tickets de pago | el cron del seguimiento | — |
| Cuándo escalar | panel · KB «Cuándo pasar la conversación a una persona» + prompt | `searchKb` / `handoffHuman` | — |
| Trato (usted), qué no se maneja | `member/config.local.ts` | va en el prompt | catálogo |

Dos consecuencias prácticas:

- **En la base de conocimiento no hay precios de producto.** Están prohibidos y hay un
  test que falla si aparecen (`test/babycaleb/kb.test.ts`). Si el precio
  estuviera en los dos sitios, el del KB se quedaría congelado el día que la
  dueña cambie el del panel, y el bot podría contestar sin llamar la tool.
- **En `member/config.local.ts` tampoco.** Por eso `businessConfig.services`
  va vacío: si tuviera algo, `renderBusinessContext()` lo imprimiría como
  "Servicios y precios: …" dentro del prompt.

La cantidad por caja va en el **nombre** del producto (`Pañal Nateen Talla M de
cierre — caja de 144 (8–19 lbs / 4–9 kg)`) justamente para que no tenga que
vivir además en el KB. Una sola llamada a `catalogQuery` contesta "cuánto trae
y cuánto vale", y esos dos datos no se pueden desfasar porque son la misma fila.

---

## 3. El precio del producto y la tarifa del envío no son lo mismo

Es la distinción que más se enredaba. El bloque `<fuentes_de_verdad>` del
prompt exigía llamar `catalogQuery` *"antes de decir un precio"*, pero el
tarifario de delivery vive en el KB y no tiene forma de salir del catálogo —un
envío no tiene existencias—. El bot quedaba entre inventar la tarifa o negarse
a darla.

Ahora el prompt lo dice explícito:

- **Precio de lo que se vende** → `catalogQuery`.
- **Tarifas y montos que no son producto** (envío, delivery, abono mínimo,
  cargo de Ferguson) → `searchKb`.
- Y una zona que no está en la lista **no cuesta lo que la de al lado**: se
  pasa con una persona.

---

## 4. Cómo se actualiza cada cosa

**Un precio o el stock** → `/admin/catalogo`. Es lo único que cambia a diario y
por eso vive en la base, no en el repo. La dueña lo hace sola, sin desplegar.

**El stock también se mueve desde Telegram** (desde el 23-sep): `/venta`,
`/devolucion` y `/ajuste` en la consola del dueño, o el botón *Registrar venta*
de un aviso. Escriben la MISMA fila de `catalog_items` —el dato sigue teniendo
un solo dueño— y cada movimiento queda en `stock_movements`, con quién lo hizo y
cómo deshacerlo. El editor del catálogo no pisa un movimiento hecho mientras
estaba abierto. Ver `docs/consola-del-dueno.md`.

**Una política, una respuesta nueva, un cambio de regla** → en el panel,
pestaña **KB**: se edita el documento del tema y se guarda. Se indexa al
instante; no hace falta desplegar nada. Desde Telegram también: la consola le
propone el texto y el documento, y usted lo guarda con ✅.

**Una talla, la descripción de un producto, un dato de la empresa** →
`member/conocimiento/` en GitHub (la agencia): se edita el `.md`, se corre
`pnpm conocimiento` y se mergea. Llega al bot con el despliegue.

**El seguimiento** (a quién, cuándo, qué dice, qué pasa tras una compra) → la
consola de Telegram: `/seguimiento`, o pidiéndolo con sus palabras (propuesta
con ✅). **Quién compró** → el botón ✅ Compró del aviso o `/compro #ref`.

**Dos dueños, sin temas en común** (29-sep-2026). Entre el 23 y el 29-sep el
panel fue la única fuente; antes, el panel y los `.md` de `member/kb/` tenían
los MISMOS temas, el bot buscaba en los dos y se contradecían (cambios de
talla, retiro, recomendar talla). Ahora cada tema tiene un solo lado:

- **Conocimiento base de la empresa → GitHub**, `member/conocimiento/*.md`:
  tallas y productos, sobre Baby Caleb, uso del producto. Lo actualiza la
  agencia con un PR; cada despliegue lo sube al índice. Tras editar un `.md`,
  `pnpm conocimiento` regenera `src/kb/conocimiento.generado.ts` (una prueba
  falla si se olvida). El panel lo muestra de solo lectura, rechaza un documento
  con su mismo título, y la consola de Telegram le deja a la dueña el texto
  para reenviárselo a la agencia en vez de guardarlo.
- **Comportamiento → el panel** (o Telegram): pagos, envíos, retiro, cambios,
  agotados, cuándo pasar a una persona. La dueña los cambia sin desplegar.
- **Seguimiento → ajustes**, no documentos. El cron que lo manda no lee la base
  de conocimiento: el 28-sep la dueña pidió por Telegram «ya no le des
  seguimiento a nadie», quedó guardado como documento y el cron siguió
  escribiendo (40 mensajes). Ver `docs/AUDITORIA_CONOCIMIENTO.md`.

Además:

- **El índice es un espejo de los dos.** Cada reindex (el del despliegue o el
  botón del panel) sube lo que hay y **borra lo que ya no está**. La tabla
  `kb_indice` anota qué se subió; sin ella un reindex solo podía sumar.
- **GitHub guarda una copia del panel, en una sola dirección.**
  `respaldar-kb.yml` baja cada noche los documentos del panel a
  `member/kb-respaldo/`. Es historial: el bot no la lee, el despliegue la ignora
  y una prueba falla si alguien la conecta al índice. **Editar esa carpeta no
  cambia nada en el bot.** (No confundir con `member/conocimiento/`, que sí.)
- Las pruebas de `test/babycaleb/` leen las dos carpetas: si un cambio en el
  panel o en GitHub contradice el documento de la dueña, la próxima corrida lo
  marca.

**El catálogo desde cero** → `src/db/seed-catalog.sql`, aplicado con wrangler. Ojo: **borra el stock
cargado**. Para corregir precios en una base que ya está en producción sin
perder existencias, use `src/db/verdad-2026-09.sql`, que es idempotente.

---

## 5. Comprobar la base EN VIVO: `pnpm auditar`

Los tests vigilan los **archivos del repo**. El bot no lee archivos: lee D1.
Entre los dos hay un paso manual —aplicar el `.sql`, guardar en el panel— y
todo lo que depende de que alguien se acuerde, algún día no se hace.

**Sin terminal:** pestaña **Actions** → **"Auditar la verdad"** → botón
**"Run workflow"**. El informe sale en el resumen del run, y además corre sola
todos los lunes. Con terminal, es `pnpm auditar`. Solo lee, nunca escribe.

Contesta tres preguntas, en orden de qué tan callado es el daño:

1. **¿Hay algo en `settings` que le esté ganando al catálogo?** Un
   `system_prompt_override` guardado anula el bloque `<fuentes_de_verdad>`
   entero; un `business_context` viejo mete precios en el prompt de cada turno;
   una tool apagada deja al bot sin fuente. También avisa si el flywheel
   aprendió una lección con cifras de dinero dentro: esas van al prompt y no se
   actualizan cuando cambie el catálogo.
2. **¿Los precios de `catalog_items` son los del documento?** Producto por
   producto, y avisa de los que están inactivos o con stock en cero (el bot los
   ofrece como agotados) y de los que están en la base pero no en el documento.
3. **¿La base de conocimiento del panel existe y no trae precios de producto?**
   Es la única fuente: vacía es un problema; un monto que no sea el abono o el
   cargo a Ferguson es un aviso.

Distingue **problemas** (el bot dice algo falso — sale con código 1) de
**avisos** (el bot se calla o se queda corto). Sirve igual en CI que a mano.

**Necesita credenciales de Cloudflare.** Desde Actions ya las tiene: son los
mismos secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` que usa el
deploy. Corriéndola a mano en una terminal, se exportan como variables de
entorno (nunca se pegan en un chat); el token se crea en
<https://dash.cloudflare.com/profile/api-tokens> con permisos de cuenta
**D1:Edit · Workers Scripts:Edit · Vectorize:Edit · Account Settings:Read**.

## 6. Los tests que cierran la brecha

En `test/babycaleb/`. El fallo que importa aquí no es un crash: es que el bot
cotice $45 donde son $50 y nadie se entere hasta que una clienta reclame. Por
eso los tests comparan **archivos contra el documento de la dueña**, no código
contra código.

- **`verdad-del-cliente.ts`** — el documento transcrito a estructuras. No es
  una segunda fuente de verdad ni algo que el bot lea: es la transcripción
  puesta donde una máquina la pueda comparar. Cuando la dueña mande un
  documento nuevo, **se corrige aquí primero**: los tests que se pongan rojos
  son exactamente los sitios del repo que hay que tocar.
- **`catalogo.test.ts`** — el `.sql` que se aplica a Cloudflare dice lo mismo
  que el documento: precio, cantidad por caja, talla, que nada entre activo con
  stock cero, que no queden costos inventados, y que el seed y la migración no
  se contradigan.
- **`kb.test.ts`** — la KB contesta las 18 causas de escalada, las 14 zonas de
  delivery con su tarifa pegada al nombre, el Yappy, el abono, los horarios; y
  **no** contiene ni un precio de producto ni un tuteo.
- **`contexto-y-prompt.test.ts`** — el `<business_context>` es el de Baby Caleb
  y no el de la barbería de la plantilla, no lleva precios, y con D1 vacío el
  bot igual arranca diciendo la verdad.
- **`busqueda-catalogo.test.ts`** — preguntar por la talla M devuelve **un**
  producto y no doce; "XL" no arrastra "XXL"; y se encuentra sin tildes.
- **`auditoria.test.ts`** — que `pnpm auditar` reconozca la falta de
  credenciales (para dar la instrucción útil en vez de un volcado), que
  encuentre el JSON entre los avisos de colores de wrangler, y que **solo haga
  `SELECT`**: una auditoría que modifique la base no es una auditoría.

Lo que **ya estaba cubierto** antes de este trabajo y sigue verde, sin tocarlo:
que `catalogQuery` nunca devuelva el costo, que nunca devuelva la cantidad
exacta de stock (solo `disponible` / `pocas` / `agotado`), que no muestre
inactivos, y que con el catálogo vacío mande a escalar en vez de improvisar.
Ver `test/tools/catalogQuery.test.ts` y `test/db/catalog.test.ts`.
