# Entrega — desplegar el catálogo de Baby Caleb

> Para: Juan, con Claude Code corriendo **en su Mac** (la CLI local, no la web).
> Rama con el trabajo: `claude/baby-caleb-catalog-plan-e7pjxx`
> Escrito el 2026-08-12.

## Qué está hecho

El catálogo completo, en código: tabla en D1, validación, la tool que consulta el bot y
la pestaña `/admin/catalogo` para crear, editar, activar/desactivar, duplicar y borrar
productos. Las 6 variables del negocio (código, nombre, costo, venta, stock, sucursal) y
las tres bodegas reales. `pnpm typecheck` limpio, `pnpm test` en 501 pruebas pasando.

El detalle técnico está en `docs/PLAN_CATALOGO_BABY_CALEB.md`. Este documento es solo lo
que falta para ponerlo en producción.

## Qué falta

**Nada del código.** Falta desplegarlo, y decidir de dónde sale ese despliegue.

No se pudo hacer desde la sesión donde se escribió porque ese entorno tiene bloqueada la
salida a `api.cloudflare.com` por política de red. No es un problema del repo ni de
credenciales.

---

## Decisión: de dónde debe salir el deploy

El dueño pidió explícitamente que **el proyecto se despliegue desde el repositorio, no
desde el computador de nadie**. Eso es lo correcto y es a donde hay que llegar.

Aclaración por si genera duda: el bot **corre en Cloudflare** en los dos casos. Desplegar
desde una Mac solo *sube* el código; la laptop no queda prendida sirviendo nada. Lo que
cambia es quién tiene la última palabra sobre qué versión está publicada — y debe ser git,
no la carpeta local de una persona.

### Camino A — CI desde GitHub (el objetivo)

Ya está escrito el workflow: **`.github/workflows/deploy.yml`**. Corre en cada push a
`main`: instala, corre typecheck y pruebas, aplica el esquema a D1 y despliega el Worker.
Si las pruebas fallan, no despliega.

Usa `scripts/ci-deploy.mjs`, que ya venía en el repo y está pensado justo para esto —
crea el índice Vectorize si no existe y despliega sin el hook `predeploy` que exige
secrets interactivos.

**Lo que falta para encenderlo:**

1. **Crear un token de API de Cloudflare** en la cuenta donde vive `juancitoads-bot`
   (dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token):

   | Permiso | Nivel | Para qué |
   |---|---|---|
   | Workers Scripts | Edit | subir el Worker, la migración del Durable Object, los assets |
   | D1 | Edit | aplicar el esquema |
   | Workers AI | Edit | el binding `[ai]` |
   | Vectorize | Edit | crear/usar el índice de la base de conocimiento |
   | Account Settings | Read | que wrangler resuelva la cuenta |

   Account Resources: solo esa cuenta. Zone Resources: ninguno (el bot vive en
   `workers.dev`). Client IP Filtering: vacío.

2. **Guardarlo como secret del repositorio** en GitHub → Settings → Secrets and variables
   → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

   **El token no se pega en ningún chat ni en ningún archivo del repo.** Solo ahí.

3. **Mergear la rama a `main`.** El workflow solo corre en `main`; mientras el trabajo
   viva en la rama, no se dispara solo. (También se puede lanzar a mano desde la pestaña
   Actions con "Run workflow", eligiendo la rama, si se quiere probar antes de mergear.)

4. **Mirar la pestaña Actions.** El primer run dirá si el token quedó con los permisos
   correctos.

### Camino B — un deploy manual, una sola vez

Si se quiere ver el panel funcionando **hoy**, sin esperar a montar el CI. No reemplaza al
Camino A: es un atajo para desbloquear, y después se monta el CI igual.

```bash
node -v                 # necesita v18+; si falta, instalar Node LTS de nodejs.org
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
2. **Opcional**, para no cargar los 7 productos del ADN a mano:

   ```bash
   wrangler d1 execute juancitoads-bot-db --file=src/db/seed-catalog.sql --remote
   ```

   ⚠️ **Este archivo empieza con `DELETE FROM catalog_items`.** Correrlo *después* de haber
   cargado productos a mano los borra. Si se usa, que sea lo primero.

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
