# Catálogo de Baby Caleb — plan e implementación

> Fecha: 2026-08-12 · Rama: `claude/baby-caleb-catalog-plan-e7pjxx`
> **Estado: Fases 1 a 6 hechas.** Falta la Fase 7 (aplicar el esquema en Cloudflare,
> desplegar y cargar el stock) — eso lo corre el dueño.
> Origen: la herramienta de catálogo de **CRM-Business-Supplies** (PanaClaw), adaptada a
> las variables de Baby Caleb.
> Datos del negocio: `Agencia_Workspace/Baby Caleb/01_ADN_y_Memoria/01_brand_guidelines.md`
> (formulario de onboarding verificado por el cliente, 2026-08-05).

---

## 0. De dónde venía

| | CRM-Business-Supplies | CRM-Baby-Caleb (antes) |
|---|---|---|
| Dónde vive el catálogo | **D1** (`products` + `product_tiers`) | un array en `member/config.local.ts`, **vacío** |
| Quién lo edita | la dueña, desde `/admin/catalogo` | nadie: había que editar código y desplegar |
| Qué ve el bot | productos y precios, **nunca el costo** | nada → el bot improvisaba |
| Validación | reglas con errores/avisos + tests | ninguna |
| Panel | pestaña "Catálogo" completa | no existía |

Baby Caleb tenía el cascarón de la tool (`src/tools/catalogQuery.ts`) pero no el motor.
Se portó el motor completo: base de datos, validación, tool y panel.

Los dos repos son la misma familia de código (`Db`, Hono, mismo layout de panel, mismo
`db-apply.mjs`), así que el porte fue mecánico. **`BOT_TIER` ya estaba en `"pro"`** en
`wrangler.toml`, que es lo que habilita `catalogQuery` — no hubo que tocar el tier.

---

## 1. Lo que cambia respecto a Business Supplies

Business Supplies vende **al por mayor**: su catálogo es *precio por tramo de cantidad*
(1000 unidades a $350, 5000 a $260…), más un módulo de GPS y un cotizador con IVA. Baby
Caleb vende **cajas de producto terminado con inventario**. Nada de tramos, GPS ni
cotizador.

Las 6 variables del negocio, tal cual:

| Variable | Columna | Tipo | Notas |
|---|---|---|---|
| Código de producto | `code` | TEXT | Se normaliza a MAYÚSCULAS-CON-GUIONES |
| Nombre de producto | `name` | TEXT | Lo que el bot repite por WhatsApp |
| Precio de costo | `cost_price` | INTEGER (centavos) | **Interno. El bot NUNCA lo lee.** Opcional |
| Precio de venta | `sale_price` | INTEGER (centavos) | Lo único de precio que ve el bot |
| Cantidad de stock | `stock_qty` | INTEGER | Por bodega |
| Sucursal | `branch` | TEXT | Una de las 3 bodegas (lista cerrada) |

Tres decisiones de fondo:

**a) Plata en centavos, no en decimales.** Los precios de Baby Caleb tienen centavos
(el costo del XXL es $29.20). Guardar `29.20` como decimal en SQLite invita a errores de
redondeo al sumar. Se guarda `2920` y se formatea al mostrar. Usted escribe "29.20" en el
panel y ve "$29.20" — los centavos son plomería interna.

**b) Dólar panameño, no peso colombiano.** Business Supplies formatea `es-CO` sin
decimales. Aquí es `es-PA` con dos decimales siempre: `$45.00`, nunca `$45`.

**c) El costo es secreto de negocio.** Misma disciplina que PanaClaw: dos juegos de
columnas, `PUBLIC_COLS` (sin costo) para lo que lee el bot y `ADMIN_COLS` (con costo)
solo para el panel. El bot **no puede** soltar el costo porque el dato nunca sale de la
base hacia él. El ADN es explícito: *"Costo y ganancia = memoria interna, NUNCA se dicen
al cliente."*

---

## 2. Sucursales y modelo de datos

Las tres bodegas confirmadas, que son una **lista cerrada** en el panel (se eligen de un
desplegable, no se escriben — "Bodega Panama Oeste" sin tilde crearía una bodega fantasma
y partiría el inventario en dos):

1. Bodega Ciudad de Panamá
2. Bodega Panamá Oeste
3. Bodega Ciudad de Panamá Este Línea 2

**El modelo respeta exactamente las 6 columnas pedidas.** Una tabla, `catalog_items`, con
una fila por *producto en una bodega* y la llave `(code, branch)`:

| code | name | cost_price | sale_price | stock_qty | branch |
|---|---|---|---|---|---|
| NAT-XXL | Pañal Nateen Talla XXL | 2920 | 4500 | 12 | Bodega Ciudad de Panamá |
| NAT-XXL | Pañal Nateen Talla XXL | 2920 | 4500 | 3 | Bodega Panamá Oeste |

Con una regla que evita que eso se desincronice: **el precio y el nombre son del producto;
el stock es de la bodega.** El panel escribe el mismo nombre y los mismos precios en todas
las filas de un código, así que el pañal M no puede valer $50 en una bodega y $48 en otra
según cuál lea el bot. Usted edita "el pañal M" una vez y cambia en las tres. Lo único que
se edita por bodega es la cantidad.

Hay dos columnas de plomería que usted no escribe: `active` (el botón Activar/Desactivar)
y `updated_at`.

### Códigos

Patrón: **MARCA-PRODUCTO/TALLA**, mayúsculas y guiones. El panel lo normaliza solo (si
escribe `nat rn` guarda `NAT-RN`), así que el mismo producto no queda cargado dos veces
por una diferencia de tipeo.

| Código | Producto |
|---|---|
| `NAT-RN` · `NAT-S` · `NAT-M` · `NAT-L` · `NAT-XL` · `NAT-XXL` | Pañales Nateen por talla |
| `NAT-WIP` | Wipes Nateen (caja grande) |
| `DANY-AW2` | Combo 2 cajas AquaWipes Dany Baby |
| `MOON-FUL` | Fular/portabebé Moon |

Para productos nuevos, la misma lógica: marca abreviada, guion, qué es. Si el código ya
existe, el panel avisa en vez de pisar el producto anterior.

---

## 3. Qué quedó construido

### Fase 1 — Base de datos ✅

`src/db/schema.sql` gana la tabla `catalog_items` (arriba). `src/db/catalog.ts` trae el
repositorio `CatalogRepo`:

- `search(query, limit)` y `listActive()` → lo que alimenta al bot. **No seleccionan
  `cost_price`.**
- `listAllForAdmin()` / `getForAdmin(code)` → con costo, solo para el panel.
- `saveProduct(...)` → borra y reescribe las filas del código (una por bodega).
- `setActive(code, bool)`, `delete(code)`, `allCodes()`.

Las filas se agrupan en un objeto por producto con `stockTotal` sumado, que es como lo
piensa el negocio.

### Fase 2 — Validación ✅

`src/catalog/validation.ts`, funciones puras sin base de datos (por eso se pueden probar
directo). **Errores** no dejan guardar; **avisos** dejan guardar pero se muestran:

| Regla | Tipo |
|---|---|
| Falta código o nombre | error |
| Código de más de 40 caracteres | error |
| Precio de venta en cero o negativo | error |
| Costo negativo | error |
| Bodega que no está en la lista | error |
| La misma bodega dos veces en un producto | error |
| Stock negativo o con decimales | error |
| Producto activo sin ninguna bodega | error |
| Código repetido al renombrar | error |
| **Precio de venta por debajo del costo** | aviso |
| Precio fuera de $1–$500 | aviso |
| Activo con todo el stock en cero | aviso |

Ahí viven también `normalizeCode`, `dollarsToCents` / `fmtUSD` y el umbral `STOCK_BAJO = 5`.

### Fase 3 — La tool ✅

`src/tools/catalogQuery.ts` ahora consulta D1. Dos cosas que **no** devuelve, a propósito:

1. **El costo** — la consulta no lo selecciona.
2. **La cantidad exacta de stock** — devuelve una etiqueta: `disponible`, `pocas` o
   `agotado`. Si el bot nunca ve el número, no hay forma de que responda "quedan 3".

Lo que sí devuelve: código, nombre, precio formateado, disponibilidad y en qué bodegas
hay (sin cantidades), que es lo que sirve para coordinar el delivery.

Si la búsqueda no encuentra nada, devuelve el catálogo completo en vez de una lista
vacía: quien escribe "hola, precios?" no busca nada en particular, y una lista vacía haría
que el bot se disculpe en vez de vender. Y si el catálogo está vacío, le dice
explícitamente al bot que **no invente precios y pase a una persona**.

### Fase 4 — Panel `/admin/catalogo` ✅

Bajo **Mi Agente**, al lado de Conocimiento. Respeta `docs/design-system.md` (tokens de
Juancito Ads — el panel es de la plataforma; la marca de Baby Caleb es del negocio).

- **Lista** (`src/admin/views/catalogo.ts`): buscador por nombre o código, KPIs
  (productos, activos, agotados, quedan pocas, bodegas), y cada producto desplegable con
  costo, venta, **margen %** y su tabla de stock por bodega. Badges de `Inactivo`,
  `Agotado` y `Quedan pocas`.
- **Editor** (`src/admin/views/catalogoEditor.ts`): los 6 campos, con el margen
  recalculándose mientras escribe (rojo si vende bajo el costo). Un producto nuevo arranca
  con las 3 bodegas en cero; quitar una fila es más rápido que agregar tres. Si la
  validación falla, **devuelve el formulario con lo que usted escribió** y los errores
  arriba — nunca una pantalla de error que le borre el trabajo.
- **Acciones**: Editar · Activar/Desactivar · Duplicar · Borrar. La copia nace inactiva y
  con stock en cero, para que no aparezca un duplicado ante una clienta ni prometa el
  inventario del original. Borrar pide escribir `BORRAR` y recomienda desactivar, que es
  reversible.

### Fase 5 — Contexto del bot ✅

Las reglas viven en la descripción de la tool, no en el prompt general (que es plantilla
compartida de Juancito Ads): consultar el catálogo **antes** de decir cualquier precio,
nunca inventar, y traducir la etiqueta de stock a "quedan pocas" sin dar el número. La
descripción del nodo en el canvas de Flujo también se actualizó.

### Fase 6 — Datos iniciales ✅

`src/db/seed-catalog.sql` con lo verificado en el ADN:

| Código | Producto | Costo | Venta |
|---|---|---|---|
| `NAT-RN` | Pañal Nateen RN (2–5 kg) | $28.00 | **$45.00** |
| `NAT-S` | Pañal Nateen S (3–6 kg) | $32.00 | **$50.00** |
| `NAT-M` | Pañal Nateen M (4–9 kg) | $32.00 | **$50.00** |
| `NAT-L` | Pañal Nateen L (7–18 kg) | $30.00 | **$45.00** |
| `NAT-XL` | Pañal Nateen XL (12–25 kg) | $28.00 | **$45.00** |
| `NAT-XXL` | Pañal Nateen XXL (+55 lbs) | $29.20 | **$45.00** |
| `DANY-AW2` | Combo 2 cajas AquaWipes Dany Baby | (pendiente) | **$35.00** |

**Entran inactivos y con stock en cero**, a propósito: un producto activo sin existencias
hace que el bot le diga "agotado" a cada clienta que pregunte, que es peor que no
ofrecerlo. Cargue el stock desde el panel y actívelos ahí mismo.

**No están los wipes Nateen (`NAT-WIP`) ni el fular Moon (`MOON-FUL`)**: el ADN no trae su
precio. Créelos desde el panel cuando los tenga — un precio inventado en la base es un
precio que el bot promete.

### Fase 7 — Pendiente (lo corre el dueño)

```bash
pnpm db:apply:remote      # crea catalog_items en la D1 de verdad
pnpm run deploy           # publica el panel con la pestaña Catálogo

# opcional: cargar los 7 productos del ADN de una vez
wrangler d1 execute juancitoads-bot-db --file=src/db/seed-catalog.sql --remote
```

Después: entrar a `/admin/catalogo`, cargar el stock de cada bodega, activar los
productos, y probar por WhatsApp con *"hola, ¿tienen pañales talla XXL y cuánto
cuestan?"* → debe responder $45.00, confirmar disponibilidad, y **no** mencionar costo,
margen ni cantidades.

---

## 4. Archivos

**Nuevos**
- `src/db/catalog.ts` · `src/db/seed-catalog.sql`
- `src/catalog/validation.ts`
- `src/admin/views/catalogo.ts` · `src/admin/views/catalogoEditor.ts`
- `test/catalog/validation.test.ts` · `test/db/catalog.test.ts`

**Modificados**
- `src/db/schema.sql` (tabla `catalog_items`)
- `src/tools/catalogQuery.ts` (D1 en vez del array)
- `src/admin/routes.ts` (7 rutas) · `src/admin/views/layout.ts` (nav) ·
  `src/admin/views/agente.ts` (descripción del nodo)
- `test/tools/catalogQuery.test.ts` (probaba el array viejo)
- `CLAUDE.md`

**No se tocaron:** `member/`, `src/niches/`, `public/`, `LICENSE`.

Estado de las pruebas: `pnpm typecheck` limpio y `pnpm test` en **501 pruebas, todas
pasando** (68 archivos).

---

## 5. Lo que queda abierto

1. **Precio y costo** de los wipes Nateen y del fular Moon; **costo** del combo Dany Baby.
2. **Stock inicial** por bodega — se carga desde el panel.
3. **Costo del delivery**: el ADN lo deja pendiente ("depende de la ubicación"). Mientras
   no esté definido, el bot debe pasar a una persona en vez de estimar un envío.
4. **Guía de tallas en la KB**: la pregunta real de las mamás es *"¿qué talla le sirve a
   mi bebé de 8 kilos?"*, no *"¿cuánto vale la M?"*. El catálogo responde precio; un doc
   de KB con la tabla de peso por talla responde lo otro. Los dos juntos cierran la venta.
