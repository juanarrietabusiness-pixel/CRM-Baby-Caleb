---
name: modo-agencia
description: Opera PanaClaw como agencia — un bot por cliente, todos en TU cuenta de Cloudflare, con el selector de proyectos del panel para brincar entre ellos. Cubre el alta de un cliente nuevo de punta a punta, el padrón de clientes (PEER_BOTS), los límites reales de la cuenta y la actualización masiva cuando sale versión nueva. Actívalo con "/modo-agencia", "dar de alta un cliente", "cliente nuevo", "agregar un bot de cliente", "cuántos clientes aguanta mi cuenta", "actualizar todos mis bots".
---

# Modo agencia — un bot por cliente en TU Cloudflare

Eres el operador técnico de la agencia. El dueño de la agencia **puede que no programe**:
tú corres los comandos. Aquí NO estamos instalando el bot de un negocio en la nube de ese
negocio — estamos montando **varios bots, de varios clientes, dentro de UNA sola cuenta de
Cloudflare: la de la agencia**.

## La regla que no se rompe: un cliente = sus propios recursos

Cada bot tiene su **propio** Worker, su **propia** D1, su **propio** índice Vectorize y su
**propio** bucket de R2. Nunca se reusan entre clientes: si dos bots comparten una D1,
heredan las conversaciones, los leads y la personalidad del otro — es una fuga de datos
entre dos negocios distintos.

El CLI ya hace esto solo. Al instalar estampa un `uid` único de 6 caracteres en
`wrangler.toml`:

```
name          = "panaclaw-<giro>-<uid>"
database_name = "panaclaw_<giro>_<uid>_db"
index_name    = "panaclaw_<giro>_<uid>_kb"
bucket_name   = "panaclaw-catalog-<giro>-<uid>"
```

**Verifica siempre ese `uid` antes de desplegar un cliente nuevo.** Si dos carpetas tienen
el mismo, algo se copió a mano: párate y arregla el `wrangler.toml` antes de seguir.

El `uid` sobrevive a `panaclaw update` (el update excluye `wrangler.toml`), así que una vez
asignado es estable de por vida.

---

## Alta de un cliente nuevo

### Paso 1 · Carpeta del cliente

Una carpeta por cliente, con el nombre del cliente — no del giro:

```bash
node cli/bin/cli.js install generico
mv generico cliente-<nombre>
cd cliente-<nombre>
```

Confirma que el `uid` es nuevo:

```bash
grep -E '^name|_name' wrangler.toml
```

### Paso 2 · Datos del negocio del cliente

Entrevista al dueño del negocio (o usa lo que ya te pasó la agencia) y vuelca las respuestas
siguiendo la **FASE 2** de `/configurar-mi-chatbot`. No repitas preguntas que ya estén en
`member/config.local.ts`.

### Paso 3 · Recursos en Cloudflare (con los nombres del `wrangler.toml`)

Lee los nombres del `wrangler.toml` de ESTE cliente y créalos tal cual — no uses los nombres
genéricos de la guía de instalación:

```bash
wrangler d1 create panaclaw_<giro>_<uid>_db          # pega el database_id en wrangler.toml
wrangler vectorize create panaclaw_<giro>_<uid>_kb --dimensions=1024 --metric=cosine
wrangler r2 bucket create panaclaw-catalog-<giro>-<uid>
wrangler d1 execute panaclaw_<giro>_<uid>_db --file=src/db/schema.sql --remote
```

### Paso 4 · Secretos — contraseña DISTINTA por cliente

```bash
wrangler secret put ANTHROPIC_API_KEY     # (o OPENAI_API_KEY / XAI_API_KEY)
wrangler secret put DASHBOARD_PASSWORD
wrangler secret put KB_REINDEX_TOKEN
```

**`DASHBOARD_PASSWORD` tiene que ser única por cliente.** El panel se protege con una sola
contraseña (sin usuario): si repites la contraseña entre clientes,
cualquiera de ellos entra al panel de los demás. Genera una distinta cada vez:

```bash
openssl rand -base64 24
```

Guárdala en el gestor de contraseñas de la agencia y entrégasela al cliente por un canal
privado. **Nunca la pegues en el chat.**

Sobre la llave de IA tienes dos modelos, y es decisión comercial de la agencia:

- **Llave de la agencia** (la misma en todos los bots): más fácil de montar, pero el consumo
  de todos los clientes cae en tu factura. Pon un tope por bot en el panel → **Costos** →
  presupuesto mensual, o el cliente que se vuelva viral te sorprende.
- **Llave del cliente**: cada quien paga lo suyo. Más fricción en el alta, cero sorpresas.

### Paso 5 · Desplegar

```bash
wrangler deploy
```

Toma la URL que imprime el deploy, ponla en `DASHBOARD_BASE_URL` del `wrangler.toml` y
vuelve a desplegar para que los enlaces del panel apunten bien.

### Paso 6 · Canales

Sigue la **FASE 3** de `/configurar-mi-chatbot`. Los tokens de canal son del cliente
(su WhatsApp, su Telegram) y van como secretos de ESE worker.

### Paso 7 · Agregar al padrón

Ver la sección siguiente. **Hazlo al final**, cuando el bot ya responde.

---

## El padrón de clientes (`PEER_BOTS`)

El panel trae un selector de proyectos en el header: un dropdown para brincar entre los bots
de la agencia. Se alimenta de la var `PEER_BOTS` en el `[vars]` del `wrangler.toml`:

```toml
PEER_BOTS = '[{"name":"Tacos Ana","url":"https://panaclaw-generico-df5952.workers.dev/admin"},{"name":"Barbería Luis","url":"https://panaclaw-generico-a31c07.workers.dev/admin"}]'
```

Reglas del formato (las impone `src/admin/projects.ts`):

- JSON array de `{name, url}`. Si el JSON está roto, el selector simplemente no aparece — no
  rompe el panel.
- Las URLs deben empezar con `http://` o `https://`; cualquier otra cosa se descarta.
- **Máximo 20 entradas.** Las demás se ignoran.

**Esto es solo navegación, no fusión de datos.** Cada bot conserva su propia base de datos y
su propia contraseña: brincar a otro proyecto pide la contraseña de ese proyecto. Es una
comodidad para ti, no un panel unificado.

### El costo de mantenerlo, dicho claro

`PEER_BOTS` vive en el `wrangler.toml` de **cada** bot. Agregar el cliente número N obliga a
editar y redesplegar los N-1 bots anteriores para que todos vean al nuevo. Con 10 clientes,
cada alta son 10 redeploys.

Tres formas de vivir con eso, de menos a más trabajo:

1. **Solo en tu bot "central"**: pon el `PEER_BOTS` completo únicamente en uno de los bots
   (o en uno que uses de índice) y entra siempre por ahí. Los bots de los clientes se quedan
   sin selector — que además es lo que quieres: **el cliente no debería ver la lista de tus
   otros clientes**. Esta es la opción recomendada, y de paso resuelve un problema de
   privacidad.
2. **Por lotes**: acumula altas y actualiza el padrón de todos una vez por semana.
3. **En todos, siempre**: solo si son pocos y de la misma empresa.

> Si le pones el padrón completo al bot de un cliente, ese cliente ve los nombres y las URLs
> de todos tus demás clientes en su dropdown. No puede entrar (no tiene sus contraseñas),
> pero ve la cartera completa de la agencia. Piénsalo antes de hacerlo.

---

## Cuántos clientes aguanta una cuenta

Los topes son **por cuenta de Cloudflare**, y el que se agota primero no es el obvio:

| Recurso | Plan gratis | Plan Workers Paid ($5/mes) |
|---|---|---|
| **Cron triggers** | **5** | **250** |
| Workers | 100 | 500 |
| Índices Vectorize | 100 | 50,000 |

**El cuello de botella son los cron triggers: 250.** Cada bot usa uno (`crons = ["0 3 * * *"]`,
la purga diaria de mensajes viejos). O sea **~250 clientes por cuenta en plan pago, y solo 5
en el gratis** — el plan gratis no sirve para agencia, ni para empezar.

Si algún día llegas a ese techo, el camino de Cloudflare es
[Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/),
que quita el límite de scripts. Es otra arquitectura; cuando llegues ahí, replantéalo.

Cada bot suma a la factura: Workers, D1, Vectorize y R2 se cobran por uso agregado de la
cuenta, más lo que consuma de IA. Revisa **Costos** en cada panel para saber qué cobrarle a
quién.

---

## Actualizar todos los bots cuando sale versión nueva

`panaclaw update` conserva `member/` y `wrangler.toml`, así que es seguro correrlo por
cliente. Desde la carpeta que contiene todas las carpetas de clientes:

```bash
for d in cliente-*/; do
  echo "── $d"
  (cd "$d" && node <ruta-al-cli>/cli.js update && pnpm install && wrangler deploy)
done
```

Antes de correrlo en toda la cartera:

1. Pruébalo en **un** cliente y verifica que responde.
2. Avisa a los clientes si el cambio es visible.
3. Si un bot falla, sigue con los demás y vuelve a ese — no dejes la cartera a medias.

Corre `node <ruta-al-cli>/cli.js doctor` en cada carpeta al terminar para confirmar que todos
quedaron sanos.

---

## Checklist de alta (repásalo antes de entregar)

- [ ] El `uid` del `wrangler.toml` es único (no se repite con otro cliente).
- [ ] D1, Vectorize y R2 creados con los nombres exactos del `wrangler.toml`.
- [ ] Esquema aplicado (`--remote`).
- [ ] `DASHBOARD_PASSWORD` **distinta** de la de todos los demás clientes, guardada en el
      gestor de la agencia y entregada por canal privado.
- [ ] Presupuesto mensual puesto en el panel → **Costos** (sobre todo si la llave de IA es
      de la agencia).
- [ ] `DASHBOARD_BASE_URL` con la URL real del worker.
- [ ] Al menos un canal conectado y probado con un mensaje real.
- [ ] Cliente agregado al padrón, según el modelo que elegiste arriba.
- [ ] El cliente sabe entrar a su panel y cambiar su contraseña te la pide a ti.

## Lo que le dices al cliente

Su bot vive en la infraestructura de la agencia, no en su propia cuenta. Eso significa que
**tú** eres responsable de sus datos: las conversaciones de sus clientes están en una D1 de
tu cuenta de Cloudflare. Déjalo por escrito en el contrato, y si te pide llevarse sus datos,
`/exportar` se los entrega en CSV — es suyo, sin candados.
