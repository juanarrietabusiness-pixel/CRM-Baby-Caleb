# Plan de implementación — Catálogo real para Baby Caleb

> Fecha: 2026-08-12 · Rama: `claude/baby-caleb-catalog-plan-e7pjxx`
> Origen: la herramienta de catálogo de **CRM-Business-Supplies** (PanaClaw), adaptada a
> las variables de Baby Caleb.
> Fuente de los datos del negocio: `Agencia_Workspace/Baby Caleb/01_ADN_y_Memoria/01_brand_guidelines.md`
> (formulario de onboarding verificado por el cliente, 2026-08-05).

---

## 0. Dónde estamos hoy

| | CRM-Business-Supplies | CRM-Baby-Caleb (hoy) |
|---|---|---|
| Dónde vive el catálogo | **D1** (tablas `products` + `product_tiers`) | un array en `member/config.local.ts` (hoy **vacío**) |
| Quién lo edita | la dueña, desde `/admin/catalogo` | nadie: hay que editar código y volver a desplegar |
| Qué ve el bot | productos + tramos de precio, **nunca el costo** | nada (array vacío → el bot improvisa) |
| Validación | `src/catalog/validation.ts` con errores/avisos + tests | ninguna |
| Panel | pestaña "Catálogo" con lista, editor, duplicar, activar/borrar | no existe la pestaña |

O sea: **Baby Caleb tiene el cascarón de la tool (`src/tools/catalogQuery.ts`) pero no
el motor**. Lo que se porta de Business Supplies es el motor completo: base de datos,
validación, panel y tool.

Lo bueno: los dos repos son la misma familia de código (`Db`, Hono, mismo layout de
panel, mismo `db-apply.mjs`), así que el porte es mecánico. **BOT_TIER ya está en `"pro"`**
en `wrangler.toml`, que es lo que habilita `catalogQuery` — no hay que tocar el tier.

---

## 1. Lo que cambia respecto a Business Supplies

Business Supplies vende **al por mayor**: su catálogo es *precio por tramo de cantidad*
(1000 unidades a $350, 5000 a $260…), más un módulo aparte de GPS. Baby Caleb vende
**cajas de producto terminado con inventario**. Nada de tramos ni de GPS.

Las 6 variables que pediste, y cómo se mapean:

| Variable Baby Caleb | Columna | Tipo | Notas |
|---|---|---|---|
| Código de producto | `code` | TEXT único | El que usa la dueña (ej. `NAT-RN`, `DANY-AW100`). Es lo que ella dicta por WhatsApp. |
| Nombre de producto | `name` | TEXT | "Pañal Nateen Talla RN (2–5 kg)" |
| Precio de costo | `cost_price` | INTEGER (centavos) | **Interno. El bot NUNCA lo puede leer.** |
| Precio de venta | `sale_price` | INTEGER (centavos) | Lo único de precio que ve el bot |
| Cantidad de stock | `stock_qty` | INTEGER | Por sucursal (ver §2) |
| Sucursal | `branch` | TEXT | Ver §2 |

Tres decisiones que hay que tomar antes de escribir código:

**a) Plata en centavos, no en decimales.** Los precios de Baby Caleb tienen centavos
($29.20 de costo del XXL). Guardar `29.20` como decimal en SQLite invita a errores de
redondeo en las sumas. Se guarda `2920` (centavos USD) y se formatea al mostrar.
Business Supplies guarda enteros COP sin decimales — ese atajo aquí no sirve.

**b) Moneda USD panameña, no COP.** Todo el formateo de Business Supplies es
`toLocaleString("es-CO")` con `$` sin decimales. Para Baby Caleb: `es-PA`, dos
decimales, `$45.00`. Se hace una sola función `fmtUSD()` y se usa en todos lados.

**c) El costo es secreto de negocio.** Se copia tal cual la disciplina de
`src/db/products.ts` de Business Supplies: dos juegos de columnas, `PUBLIC_COLS`
(sin costo) para lo que lee el bot y `ADMIN_COLS` (con costo) solo para el panel.
Así el bot **no puede** filtrar el costo aunque el cliente lo intente sonsacar.
El ADN es explícito: *"Costo y ganancia = memoria interna, NUNCA se dicen al cliente."*

---

## 2. La decisión de "sucursal" (hay que confirmarla contigo)

Según el ADN verificado, Baby Caleb hoy es **venta únicamente online por delivery** —
no hay sucursales físicas (y el objetivo a 3 meses menciona *evaluar* abrir una pañalera).
Así que "sucursal" puede significar dos cosas distintas y el modelo de datos cambia:

**Opción A — una fila por producto y sucursal** (código repetido en cada sucursal).
Es lo más parecido a un Excel. Simple, pero el precio queda duplicado: cambiar el precio
del pañal M obliga a editarlo en cada sucursal, y si se desincronizan el bot cotiza
distinto según de dónde lea.

**Opción B — producto + existencias por sucursal (RECOMENDADA).** Tabla `products`
(código, nombre, costo, venta) y tabla hija `product_stock` (código, sucursal, cantidad).
El precio vive una sola vez; el stock vive por bodega/sucursal.

Recomiendo **B** por tres razones:
1. Es exactamente el patrón que ya funciona en Business Supplies (`products` +
   `product_tiers` con `replaceTiers`), así que el porte de panel y repositorio es casi
   copiar/pegar en vez de rediseñar.
2. Deja responder bien la pregunta que sí le hacen a Baby Caleb hoy: *"¿tienen XXL?"* —
   el bot suma el stock de todas las sucursales para decir sí/no, y el panel muestra
   dónde está.
3. Si hoy solo hay una sucursal ("Bodega principal"), B se ve igual de simple: una fila
   de stock por producto. Y el día que abra la pañalera física no hay migración.

**Lo que necesito de ti:** el listado de sucursales/bodegas reales (aunque sea una sola)
y su nombre exacto. Si me dices "solo bodega principal", arranco con esa y listo.
Mientras no me digas otra cosa, **implemento B con una única sucursal `"Principal"`**.

---

## 3. Fases de implementación

Cada fase se puede desplegar sola y deja el bot funcionando. Orden no negociable: los
datos primero, el panel al final.

### Fase 1 — Base de datos (`src/db/schema.sql` + `src/db/products.ts`)

Se agregan al esquema, al final del archivo, dos tablas:

```sql
-- Catálogo de Baby Caleb. Precios en CENTAVOS USD (45.00 → 4500).
-- cost_price es memoria interna: lo lee el panel para margen, NUNCA el bot
-- (ver ProductsRepo.PUBLIC_COLS y src/tools/catalogQuery.ts).
CREATE TABLE IF NOT EXISTS products (
  code       TEXT PRIMARY KEY,       -- código del negocio: NAT-RN, DANY-AW100…
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,          -- panal | wipes | porteo | otro
  description TEXT,                  -- peso/talla, contenido de la caja
  cost_price INTEGER,                -- centavos USD — interno
  sale_price INTEGER NOT NULL,       -- centavos USD — lo que ve el cliente
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Existencias por sucursal/bodega.
CREATE TABLE IF NOT EXISTS product_stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  branch     TEXT NOT NULL,          -- "Principal", "Pañalera Vía España"…
  stock_qty  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_code) REFERENCES products(code) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_prod_branch
  ON product_stock(product_code, branch);
```

Y un `src/db/products.ts` calcado del de Business Supplies, con:
- `search(query, limit)` → productos activos + stock total, **sin `cost_price`**
- `getByCode(code)` / `listAll()` / `allCodes()`
- `stockForAgent(code)` → `[{branch, stock_qty}]`
- `getForAdmin(code)` → **con** `cost_price` (solo panel)
- `upsert(...)`, `replaceStock(code, filas)`, `setActive`, `delete`
- `totalStock(code)` → suma de sucursales

**Aplicar:** `pnpm db:apply` (local) y `pnpm db:apply:remote` (Cloudflare). El script ya
existe y lee `wrangler.toml`, no hay que tocarlo.

**Riesgo:** ninguno. Son tablas nuevas; nada del bot actual las usa todavía.

### Fase 2 — Validación (`src/catalog/validation.ts` + tests)

Se porta el archivo de Business Supplies (funciones puras, sin D1, testeables). Reglas
adaptadas a Baby Caleb — **errores** (no guarda) vs **avisos** (guarda y avisa):

| Regla | Tipo |
|---|---|
| Falta nombre o código | error |
| Código repetido | error |
| Código con espacios/caracteres raros (se normaliza a MAYÚSCULAS-GUION) | error |
| Categoría fuera de la lista (`panal`, `wipes`, `porteo`, `otro`) | error |
| Precio de venta ≤ 0 | error |
| Producto activo sin precio de venta | error |
| Stock negativo | error |
| Sucursal repetida para el mismo producto | error |
| **Precio de venta por debajo del costo** | aviso |
| Precio fuera del rango razonable ($1–$500) | aviso |
| Stock en 0 en todas las sucursales estando activo | aviso ("el bot lo va a ofrecer como agotado") |

Tests en `test/catalog/validation.test.ts`, mismo estilo que el resto de `test/`.

### Fase 3 — La tool (`src/tools/catalogQuery.ts`)

Se reemplaza la versión que lee `member/config.local.ts` por la que consulta D1.
Búsqueda por nombre, código o categoría, hasta 8 resultados. Lo que devuelve:

```ts
{
  matches: [{
    codigo: "NAT-XXL",
    nombre: "Pañal Nateen Talla XXL (+55 lbs)",
    descripcion: "Caja para el mes · hipoalergénico, sin cloro",
    precio: "$45.00",
    disponible: true,          // stock total > 0
    stock: 12,                 // total sumado
    sucursales: [{ sucursal: "Principal", cantidad: 12 }]
  }],
  mensaje?: "No hay ningún producto que coincida."
}
```

Detalles que importan:
- **Nunca** se selecciona `cost_price` en esta ruta (no es un filtro en la respuesta:
  la columna físicamente no se consulta).
- El stock se expone como **disponibilidad**, no como número exacto al cliente: en el
  prompt se le indica al bot decir "sí, tenemos" / "se nos agotó, te aviso cuando entre",
  no "quedan 3". El número exacto sirve para que el bot no prometa lo que no hay.
- La descripción del nodo en `src/admin/views/agente.ts` (`catalogQuery`) se actualiza
  para que diga "consulta precios y existencias reales por sucursal".
- `member/config.local.ts` **no se toca** (regla del CLAUDE.md). El array `catalog` queda
  ahí sin uso; D1 pasa a ser la única fuente de verdad.

### Fase 4 — Panel `/admin/catalogo`

Se portan tres piezas de Business Supplies, respetando `docs/design-system.md` (tokens
Juancito Ads: `--bg #050D1F`, `--accent #1E90FF`, `--accent-2 #F5A623`; **no** los colores
de marca de Baby Caleb — el panel es de la plataforma, el negocio solo pone su nombre):

1. **`src/admin/views/catalogo.ts`** — lista: buscador, agrupado por categoría, cada
   producto desplegable con precio de venta, costo, **margen %**, y la tabla de stock por
   sucursal. Badges: `Inactivo`, `Agotado` (`--warn`), `Stock bajo` (< 5, `--warn`).
2. **`src/admin/views/catalogoEditor.ts`** — alta/edición: código, nombre, categoría,
   descripción, costo, venta, activo + filas de sucursal/cantidad (la última siempre en
   blanco para agregar). Si la validación falla, **devuelve el formulario con lo que la
   dueña escribió** y los errores arriba — nunca una pantalla de error que le borre el
   trabajo.
3. **Rutas en `src/admin/routes.ts`**: `GET /catalogo`, `GET /catalogo/nuevo`,
   `GET /catalogo/:code/editar`, `POST /catalogo/guardar`, `POST /catalogo/:code/activo`,
   `POST /catalogo/:code/duplicar`, `POST /catalogo/:code/borrar`.
4. **Nav** en `src/admin/views/layout.ts`: item `{ id: "catalogo", label: "Catálogo",
   href: "/admin/catalogo", icon: "package" }` dentro del grupo **"Mi Agente"** (en
   Business Supplies vive suelto; aquí encaja al lado de "Conocimiento").

Lo que **no** se porta de Business Supplies: el módulo GPS (`gpsEditor.ts`, `GpsRepo`,
`gps_*`), el cotizador (`src/quoting/`, `generateQuote`, `generateGpsQuote`, tabla
`quotes`) y el importador de Excel. Baby Caleb no cotiza por volumen: vende cajas a
precio fijo. Si más adelante quieren cotizaciones formales por WhatsApp, es otro proyecto
y ahí sí se porta el cotizador.

### Fase 5 — Contexto del bot

- `src/businessContext.ts` no cambia de forma, pero el catálogo deja de ser "servicios"
  hardcodeados: el prompt gana una línea que le dice al bot **que consulte `catalogQuery`
  antes de dar cualquier precio o disponibilidad**, y que jamás invente uno.
- Reglas del ADN que entran al prompt (o a la KB, ver Fase 6):
  - Nunca declarar un producto como una marca que no es (riesgo legal — ej. no decir
    "WaterWipes" a algo que no lo es).
  - Nunca mencionar costo ni ganancia.
  - Tuteo, tono cálido "amiga experta hablándole a una mamá"; "talla" (no *size*),
    "libras" (no kg).
  - El delivery se cotiza aparte y **depende de la ubicación** — dato aún pendiente de
    validar con el cliente (§7 del ADN); mientras tanto el bot debe pasar a humano en
    vez de inventar un costo de envío.

### Fase 6 — Carga de los datos reales

Semilla `src/db/seed-catalog.sql` con lo verificado en el ADN (precios en centavos USD):

| Código | Producto | Costo | Venta |
|---|---|---|---|
| `NAT-RN` | Pañal Nateen RN (2–5 kg) | $28.00 | **$45.00** |
| `NAT-S` | Pañal Nateen S (3–6 kg) | $32.00 | **$50.00** |
| `NAT-M` | Pañal Nateen M (4–9 kg) | $32.00 | **$50.00** |
| `NAT-L` | Pañal Nateen L (7–18 kg) | $30.00 | **$45.00** |
| `NAT-XL` | Pañal Nateen XL (12–25 kg) | $28.00 | **$45.00** |
| `NAT-XXL` | Pañal Nateen XXL (+55 lbs) | $29.20 | **$45.00** |
| `DANY-AW100-X2` | Combo 2 cajas AquaWipes Dany Baby (1,200 toallitas) | ⏳ | **$35.00** |
| `NAT-WIPES` | Wipes Nateen hipoalergénicos (caja grande) | ⏳ | ⏳ |
| `MOON-FULAR` | Fular/portabebé Moon (unitalla, RN–25 lbs) | ⏳ | ⏳ |

**⏳ = falta el dato.** El ADN no trae costo ni precio de los wipes Nateen ni del fular
Moon, ni el costo del combo Dany Baby. Esos tres entran **inactivos** (borradores) hasta
que los confirmes — un producto inactivo no lo ofrece el bot, así que no hay riesgo de
que invente un precio. El stock inicial de todos lo cargas tú desde el panel; el ADN
menciona ~40 cajas/mes de volumen pero no el inventario actual.

También hay que decidir el KB: conviene un doc en `/admin/kb` con la **tabla de peso por
talla** (RN 2–5 kg, S 3–6, M 4–9, L 7–18, XL 12–25, XXL +55 lbs), porque la pregunta real
de las mamás es *"¿qué talla le sirve a mi bebé de 8 kilos?"*, no *"¿cuánto vale la M?"*.
El catálogo responde precio; la KB responde talla. Los dos juntos cierran la venta.

### Fase 7 — Pruebas y despliegue

1. `pnpm typecheck` y `pnpm test` (incluye los tests nuevos de validación).
2. `pnpm db:apply` local + prueba en `pnpm dev`: crear un producto desde el panel,
   preguntarle el precio al bot, verificar que **no** suelta el costo aunque se lo pidan.
3. `pnpm db:apply:remote` → `pnpm run deploy`.
4. Cargar el catálogo real desde `/admin/catalogo`.
5. Prueba final por WhatsApp con un mensaje real: *"hola, ¿tienen pañales talla XXL y
   cuánto cuestan?"* → debe responder $45.00, confirmar disponibilidad y no mencionar
   costo ni margen.

---

## 4. Archivos que se tocan

**Nuevos**
- `src/db/products.ts`
- `src/db/seed-catalog.sql`
- `src/catalog/validation.ts`
- `src/admin/views/catalogo.ts`
- `src/admin/views/catalogoEditor.ts`
- `test/catalog/validation.test.ts`
- `test/db/products.test.ts`

**Modificados**
- `src/db/schema.sql` (dos tablas al final)
- `src/tools/catalogQuery.ts` (D1 en vez del array)
- `src/admin/routes.ts` (7 rutas + imports)
- `src/admin/views/layout.ts` (item de nav)
- `src/admin/views/agente.ts` (descripción del nodo)
- `src/system-prompt.ts` / `src/businessContext.ts` (regla de "consulta antes de cotizar")
- `CLAUDE.md` (mapa rápido: mencionar el catálogo en D1)

**No se tocan:** `member/`, `src/niches/`, `public/`, `LICENSE`.

---

## 5. Esfuerzo y orden sugerido

| Fase | Qué entrega | Tamaño |
|---|---|---|
| 1 · Base de datos | tablas + repositorio | mediano |
| 2 · Validación | reglas + tests | chico |
| 3 · Tool | el bot ya responde precios reales | chico |
| 4 · Panel | la dueña edita sin terminal | **el más grande** |
| 5 · Prompt | el bot deja de improvisar | chico |
| 6 · Datos | catálogo cargado | chico (depende de tus datos) |
| 7 · Deploy | en producción | chico |

Se puede cortar después de la Fase 3 y ya tener valor (el bot responde precios reales,
cargados por semilla). La Fase 4 es la que te quita a ti del medio.

---

## 6. Lo que necesito de ti antes de empezar

1. **Sucursales**: ¿una sola bodega, o varias? Nombres exactos.
2. **Códigos de producto**: ¿ya usas códigos propios, o arranco con los que propuse
   (`NAT-RN`, `NAT-M`…)?
3. **Los datos ⏳**: precio de venta y costo de los wipes Nateen y del fular Moon, y el
   costo del combo Dany Baby.
4. **Stock inicial** por producto (o lo cargas tú desde el panel cuando esté listo).
5. **Confirmar el criterio de stock**: ¿el bot dice "quedan pocas" cuando hay menos de 5,
   o prefieres otro número?
