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
| 1 | `system_prompt_override` | D1 · `settings` | el panel, pestaña Agente |
| 2 | `<business_context>` | D1 · `settings.business_context`, y si está vacío, `member/config.local.ts` | el panel, pestaña Config · o el repo |
| 3 | Lecciones aprendidas | D1 · `settings.learned_lessons` | el flywheel, solo |
| 4 | Catálogo | D1 · tabla `catalog_items` | el panel, pestaña Catálogo |
| 5 | Base de conocimiento | Vectorize, alimentada por `member/kb/` **y** por D1 · `kb_docs` | el repo · o el panel, pestaña KB |

Las capas 1 a 3 van **enteras dentro del system prompt, en cada turno**. Las
capas 4 y 5 solo llegan al modelo si él decide llamar una tool.

**Esa asimetría es la causa de casi todos los desfases.** Un precio escrito en
la capa 2 lo lee el modelo *antes* de decidir si consulta el catálogo, así que
le gana a la capa 4 sin que nadie se entere y sin que nada falle. Por eso la
regla no es "trate de no duplicar", es la de la sección siguiente.

### La capa 1 es un interruptor de emergencia

`system_prompt_override` **reemplaza el prompt entero**, incluido el bloque
`<fuentes_de_verdad>` que obliga a consultar el catálogo. Si alguien pega un
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
| Rangos de peso por talla | `member/kb/01-…` | `searchKb` | catálogo |
| Tarifas de delivery por zona | `member/kb/02-…` | `searchKb` | catálogo |
| Formas de pago, abono mínimo | `member/kb/03-…` | `searchKb` | catálogo |
| Uso del producto | `member/kb/04-…` | `searchKb` | — |
| Cuándo escalar | `member/kb/06-…` + prompt | `searchKb` / `handoffHuman` | — |
| Trato (usted), qué no se maneja | `member/config.local.ts` | va en el prompt | catálogo |

Dos consecuencias prácticas:

- **En `member/kb/` no hay precios de producto.** Están prohibidos y hay un
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

**Una política, una tarifa de envío, una respuesta nueva** → edite el `.md` que
corresponda en `member/kb/`, y luego:

```bash
pnpm kb:reindex        # regenera scripts/kb-fixtures.json desde member/kb/
pnpm test              # los tests de test/babycaleb/ verifican el contenido
pnpm run deploy
curl -X POST https://<worker>/kb/reindex -H "X-Reindex-Token: $KB_REINDEX_TOKEN"
```

El último paso es el que realmente sube los vectores. Sin él, el archivo cambió
y el bot sigue contestando lo de antes.

> Se puede editar la KB desde `/admin/kb` y se indexa al instante. Sirve para
> una urgencia. Pero lo que se escribe ahí **no está en git**: nadie lo revisa,
> nadie ve el diff, y la próxima vez que alguien corra el reindex general
> conviven las dos versiones. Para algo permanente, va en `member/kb/`.

**El catálogo desde cero** → `src/db/seed-catalog.sql`. Ojo: **borra el stock
cargado**. Para corregir precios en una base que ya está en producción sin
perder existencias, use `src/db/verdad-2026-09.sql`, que es idempotente.

---

## 5. Los tests que cierran la brecha

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

Lo que **ya estaba cubierto** antes de este trabajo y sigue verde, sin tocarlo:
que `catalogQuery` nunca devuelva el costo, que nunca devuelva la cantidad
exacta de stock (solo `disponible` / `pocas` / `agotado`), que no muestre
inactivos, y que con el catálogo vacío mande a escalar en vez de improvisar.
Ver `test/tools/catalogQuery.test.ts` y `test/db/catalog.test.ts`.
