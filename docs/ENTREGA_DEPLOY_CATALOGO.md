# Entrega — desplegar el catálogo de Baby Caleb

> Escrito el 2026-08-12. **Cerrado el 2026-08-12: desplegado y verificado.**

## Estado: hecho

El catálogo está en producción y el deploy sale del repositorio. Quedó así:

- Run **#3** del workflow `Deploy` en verde, los 9 pasos.
- La tabla `catalog_items` **existe en la D1 de producción** — antes no estaba, así que
  es prueba de que el esquema se aplicó de verdad y no solo de que el log dijo "success".
- El Worker responde: `/health` → 200, `/admin/login` → 200.
- `catalog_items` en 0 productos, que es lo esperado antes de cargar el catálogo.

De aquí en adelante **cada push a `main` se despliega solo**. Lo que sigue no es técnico:
cargar los productos y el stock (ver "Después del deploy", abajo).

Este documento se conserva como registro de lo que costó llegar acá — los tres runs, qué
falló en cada uno y por qué. Si mañana hay que montar esto mismo para otro cliente, las
tres piedras del camino están abajo con nombre y apellido.

### Los tres intentos

| Run | Murió en | Causa |
|---|---|---|
| #1 | Aplicar el esquema a D1 | `wrangler` no estaba en el PATH (`ENOENT`). El workflow llama al script con `node`, sin pasar por pnpm. Arreglado con `npx wrangler`. |
| #2 | Aplicar el esquema a D1 | `Wrangler requires at least Node.js v22.0.0`. Los workflows fijaban Node 20. Arreglado subiendo a 22. |
| #3 | — | Verde. Lo que faltaba era el token: el `Invalid access token [code: 9109]` del run #2 se fue al regenerarlo. |

Ninguno de los dos primeros llegó a escribir nada: los dos murieron antes de tocar la
base, y el paso del Worker quedó en `skipped` las dos veces.

## Qué está hecho

El catálogo completo, en código: tabla en D1, validación, la tool que consulta el bot y
la pestaña `/admin/catalogo` para crear, editar, activar/desactivar, duplicar y borrar
productos. Las 6 variables del negocio (código, nombre, costo, venta, stock, sucursal) y
las tres bodegas reales. `pnpm typecheck` limpio, `pnpm test` en 501 pruebas pasando.

El detalle técnico está en `docs/PLAN_CATALOGO_BABY_CALEB.md`. Este documento cubre solo
lo que costó ponerlo en producción.

## Qué se verificó antes de entregar

Todo lo que se puede comprobar sin el token, se comprobó:

- `tsc --noEmit` limpio y **501 pruebas en 68 archivos, todas pasando**.
- `wrangler deploy --dry-run` arma el bundle completo (4 MB, 692 KB gzip) con sus cuatro
  bindings (Durable Object, D1, Vectorize, AI) y sus variables — o sea que **no falta
  ningún archivo en git**: lo que CI clona alcanza para construir el Worker. Era el riesgo
  real, porque parte de la config del negocio vive en `member/`, y quedó descartado.
- La D1 `juancitoads-bot-db` existía con el esquema viejo (17 tablas) pero **sin
  `catalog_items`** — confirmaba que el catálogo nunca se había desplegado, y que el paso
  de esquema del workflow era justamente lo que faltaba correr.
- El esquema es idempotente de verdad: las 17 tablas son `CREATE TABLE IF NOT EXISTS`, así
  que aplicarlo en cada deploy no toca los datos que ya están.

**Se encontró y se arregló un bug que habría tumbado el primer run de CI.**
`scripts/db-apply.mjs` invocaba `wrangler` a secas. Eso funciona en una Mac (porque ahí se
llama vía `pnpm`, que pone `node_modules/.bin` en el PATH), pero el workflow lo llama con
`node scripts/db-apply.mjs --remote`, sin pasar por pnpm — y ahí `wrangler` no existe en el
PATH: el paso moría con `ENOENT` antes de tocar la base. Ahora usa `npx wrangler`, igual
que `scripts/ci-deploy.mjs`. De paso, sin terminal responde solo a la pregunta de "vas a
tocar producción, ¿seguro?" (con terminal la sigue haciendo: ahí esa pregunta protege a una
persona).

## Qué faltaba

El token. Los dos pasos de navegador del Camino A — ya hechos.

---

## Por qué el deploy sale del repositorio

El dueño pidió explícitamente que **el proyecto se despliegue desde el repositorio, no
desde el computador de nadie**. Eso es lo correcto y es a donde hay que llegar.

Aclaración por si genera duda: el bot **corre en Cloudflare** en los dos casos. Desplegar
desde una Mac solo *sube* el código; la laptop no queda prendida sirviendo nada. Lo que
cambia es quién tiene la última palabra sobre qué versión está publicada — y debe ser git,
no la carpeta local de una persona.

### Camino A — CI desde GitHub (el elegido)

Ya está escrito el workflow: **`.github/workflows/deploy.yml`**. Corre en cada push a
`main`: instala, corre typecheck y pruebas, aplica el esquema a D1 y despliega el Worker.
Si las pruebas fallan, no despliega.

Usa `scripts/ci-deploy.mjs`, que ya venía en el repo y está pensado justo para esto —
crea el índice Vectorize si no existe y despliega sin el hook `predeploy` que exige
secrets interactivos.

**Lo que hubo que hacer para encenderlo** (y la receta si hay que repetirlo en otro bot):

1. **Crear un token de API de Cloudflare** en la cuenta donde vive `juancitoads-bot`
   (dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token):

   Todos los permisos son de tipo **Account** (la primera columna del selector):

   | Permiso | Nivel | Para qué |
   |---|---|---|
   | Workers Scripts | Edit | subir el Worker, la migración del Durable Object, los assets |
   | D1 | Edit | aplicar el esquema |
   | Workers AI | Edit | el binding `[ai]` |
   | Vectorize | Edit | crear/usar el índice de la base de conocimiento |
   | Workers KV Storage | Edit | Cloudflare lo mete por defecto en sus tokens de CI |
   | Account Settings | Read | que wrangler resuelva la cuenta |

   Y dos de tipo **User** (el selector tiene una sección aparte para eso, más abajo):

   | Permiso | Nivel | Para qué |
   |---|---|---|
   | User Details | Read | wrangler llama a `/accounts` para ubicarse |
   | Memberships | Read | ídem — van juntos en el token que arma Cloudflare |

   ⚠️ **El valor del token es el que Cloudflare muestra UNA sola vez, en la pantalla
   verde de "Create Token".** No es el código que aparece después en la lista de tokens:
   ése es el *ID* del token, se parece bastante y no sirve para autenticar. Copiarlo por
   error es el motivo más común de `Invalid access token [code: 9109]`. Si esa pantalla
   ya se cerró, no hay forma de recuperarlo — hay que hacer "Roll" y copiar el nuevo.

   Account Resources: solo esa cuenta. Zone Resources: ninguno (el bot vive en
   `workers.dev`). Client IP Filtering: vacío.

   > Sobre **Workers KV Storage**: el bot no usa KV. Va igual porque es lo que
   > Cloudflare incluye por defecto en el token que genera para desplegar desde CI,
   > y agregarlo cuesta un clic — mientras que si llegara a faltar, el error de
   > permisos aparece recién a mitad del deploy. Es barato ir sobre seguro.

2. **Guardarlo como secret del repositorio** en GitHub → Settings → Secrets and variables
   → Actions → New repository secret. Son dos:

   - `CLOUDFLARE_API_TOKEN` — el token del paso 1. Cloudflare lo muestra **una sola
     vez**; si se cierra esa pantalla sin copiarlo, hay que generar otro.
   - `CLOUDFLARE_ACCOUNT_ID` — el ID de la cuenta. Está en dash.cloudflare.com →
     Workers & Pages, en la barra derecha ("Account ID"), y también es el código que
     aparece en la URL del dashboard: `dash.cloudflare.com/<ese-código>/...`.

   **El token no se pega en ningún chat ni en ningún archivo del repo.** Solo ahí.

3. **Mergear la rama a `main`.** Ése es el primer deploy — no hay forma de ensayarlo antes.

   > **Ojo, esto se intentó y no se puede.** El workflow tiene `workflow_dispatch`, así
   > que en teoría se podría lanzar a mano sobre la rama para probar el token sin tocar
   > `main`. En la práctica no: GitHub solo ofrece "Run workflow" para workflows que ya
   > existen **en la rama por defecto**, y `deploy.yml` nace en esta rama. Mientras no se
   > mergee, el botón no aparece y la API responde 404. Después del merge sí queda
   > disponible para cualquier rama — pero para el primer deploy, el merge *es* la prueba.

   El riesgo de mergear a ciegas es bajo y conviene tenerlo claro: el paso de Cloudflare
   va **último**, después de typecheck y de las 501 pruebas. Si el token quedara con algún
   permiso de menos, lo que falla es el deploy, no el merge — el código queda en `main`
   (que es donde debe estar, ya pasó CI), se corrige el token y se le da "Re-run jobs".
   Y si llegara a fallar justo entre los dos pasos de Cloudflare, lo peor que pasa es que
   el esquema quede aplicado y el Worker sin actualizar: las tablas nuevas se quedan ahí
   sin que nadie las use, sin tocar un solo dato de los que ya existen.

   De ahí en adelante, cada push a `main` se despliega solo.

4. **Mirar la pestaña Actions.** El run dirá en qué paso quedó. Se corrige lo que sea y se
   vuelve a lanzar el mismo run con "Re-run jobs" — no hace falta otro commit.

   Los errores que ya se vieron en la práctica, y qué significan:

   | En el log | Qué pasa |
   |---|---|
   | `Wrangler requires at least Node.js v22` | El workflow fijaba Node 20. Ya está arreglado. |
   | `Invalid access token [code: 9109]` | El token no es válido **como está guardado**. Casi siempre es que se copió el *ID* del token en vez del valor, o que se coló un espacio al pegarlo. No es falta de permisos: Cloudflare rechaza la credencial completa. |
   | `Authentication error [code: 10000]` | La credencial llega pero no puede con esa operación: o le falta un permiso de las tablas de arriba, o el `CLOUDFLARE_ACCOUNT_ID` no es el de la cuenta donde vive el bot. |

   Para saber si el token sirve, sin adivinar — se pega el valor en una terminal
   cualquiera (esto **no** toca nada, solo pregunta):

   ```bash
   curl https://api.cloudflare.com/client/v4/user/tokens/verify \
     -H "Authorization: Bearer <el-token>"
   ```

   Si responde `"status": "active"`, el token está bien y el problema es de permisos o
   del account ID. Si responde `9109`, el valor guardado no sirve y hay que generarlo
   otra vez.

5. **Comprobar que se puede entrar al panel** — `…workers.dev/admin`. Si pide contraseña
   y la acepta, listo.

   Ojo con esto, que es el otro hueco del Camino A: el panel **falla cerrado**. Si el
   Worker no tiene el secret `DASHBOARD_PASSWORD`, el deploy sale bien igual pero no hay
   contraseña que sirva — ninguna entra. El deploy manual sí avisa de esto antes de subir
   nada (el hook `predeploy`), pero CI se lo salta a propósito, porque ese chequeo pide
   una terminal.

   El Worker de Baby Caleb ya está desplegado y en pie, así que lo más probable es que el
   secret ya exista de la instalación. Si no entra, se crea **desde el navegador**, sin
   terminal: dash.cloudflare.com → Workers & Pages → `juancitoads-bot` → Settings →
   Variables and Secrets → Add → tipo **Secret**, nombre `DASHBOARD_PASSWORD`, y el valor
   es la contraseña que se quiera para `/admin`. Toma efecto sin volver a desplegar.

   (Este secret vive en el Worker, en Cloudflare — no es un secret del repo en GitHub.
   Son dos cajas distintas: las de GitHub son para que CI pueda desplegar, ésta es para
   que el bot funcione.)

### Camino B — un deploy manual, una sola vez (plan de emergencia)

**No hace falta: se eligió el Camino A.** Queda escrito por si el CI se atasca y hay que
desbloquear a mano. No lo reemplaza — si se usa, se monta el CI igual después.

```bash
node -v                 # necesita v22+ (lo exige wrangler); si no, Node LTS de nodejs.org
corepack enable pnpm    # pnpm viene con Node, solo hay que encenderlo
pnpm -v

git clone https://github.com/juanarrietabusiness-pixel/CRM-Baby-Caleb.git
cd CRM-Baby-Caleb
git checkout claude/baby-caleb-catalog-plan-e7pjxx
pnpm install

pnpm exec wrangler login
pnpm exec wrangler whoami   # ⚠️ debe ser la cuenta de juancitoads-bot; si no, parar

pnpm db:apply:remote
pnpm run deploy
```

**Si `pnpm run deploy` corta con "Falta el secret DASHBOARD_PASSWORD":** ese secreto no
existe todavía en el Worker. Se crea una vez y se repite el deploy:

```bash
pnpm exec wrangler secret put DASHBOARD_PASSWORD
```

(Lo pide por teclado, no se ve en pantalla. Es la contraseña para entrar a `/admin`.)

---

## Después del deploy — cargar el catálogo

1. Entrar a `https://juancitoads-bot.juanarrietabusiness.workers.dev/admin/catalogo`.
2. **Opcional**, para no cargar los 7 productos del ADN a mano: aplicar
   `src/db/seed-catalog.sql`. Sin wrangler instalado (que es el caso si se fue por el
   Camino A), se hace desde el navegador: dash.cloudflare.com → Storage & Databases → D1
   → `juancitoads-bot-db` → pestaña **Console**, y pegar ahí el contenido del archivo.

   Con wrangler a mano, el equivalente es:

   ```bash
   wrangler d1 execute juancitoads-bot-db --file=src/db/seed-catalog.sql --remote
   ```

   ⚠️ **Este archivo empieza con `DELETE FROM catalog_items`.** Correrlo *después* de haber
   cargado productos a mano los borra. Si se usa, que sea lo primero.

   ⚠️ Y solo **después** de que el deploy haya corrido: la tabla `catalog_items` la crea el
   paso de esquema del workflow. Antes de eso el archivo falla con "no such table".

3. Cargar el **stock de cada bodega** en cada producto y **activarlos**. Entran inactivos
   y en cero a propósito: un producto activo sin existencias hace que el bot le diga
   "agotado" a cada clienta que pregunte.

4. **Prueba real por WhatsApp:** *"hola, ¿tienen pañales talla XXL y cuánto cuestan?"*

   Debe responder **$45.00**, confirmar que hay, y **no** mencionar el costo, el margen ni
   cuántas unidades quedan. Si dice cualquiera de esas tres cosas, avisar — sería un bug,
   no una configuración.

---

## Lo que sigue pendiente del negocio (no bloquea el deploy)

1. **Precio y costo de los wipes Nateen (`NAT-WIP`) y del fular Moon (`MOON-FUL`)**, y el
   **costo del combo Dany Baby (`DANY-AW2`)**. El ADN no los trae, por eso no están en la
   semilla — un precio inventado en la base es un precio que el bot le promete a una
   clienta. Se crean desde el panel cuando se tengan.
2. **Costo del delivery.** El ADN lo deja abierto ("depende de la ubicación"). Mientras no
   esté definido, el bot pasa a una persona en vez de estimar, que es lo correcto — pero
   es la pregunta #1 de las clientas, así que conviene cerrarlo.
3. **Guía de tallas en la base de conocimiento.** El catálogo responde "cuánto vale"; lo
   que realmente preguntan es *"¿qué talla le sirve a mi bebé de 8 kilos?"*. Un doc en
   `/admin/kb` con la tabla peso→talla (RN 2–5 kg, S 3–6, M 4–9, L 7–18, XL 12–25,
   XXL +55 lbs) cierra esa mitad de la conversación.
