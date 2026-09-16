# WhatsApp por QR en Baby Caleb — plan de port

**Estado: listo para ejecutar.** Esto ya no es un diseño: es el trasplante de un
canal que quedó **funcionando de punta a punta en PanaClaw** el 15-sep-2026 a las
22:21 UTC (mensaje real entrando, bot contestando, 812 llaves subidas, cero
pendientes). El diseño se validó allá a propósito, para que aquí no haya que
descubrir nada.

Cada sección trae, cuando corresponde, un bloque **⚠ Esto ya falló** con el error
exacto que costó tiempo en PanaClaw. No son advertencias genéricas: son las siete
paradas del piloto. Si una de ellas aparece aquí, es que este plan se saltó.

> **Fuente de verdad técnica:** `docs/bitacora-whatsapp-qr.md` en el repo de
> PanaClaw. Este documento es el procedimiento; la bitácora es el porqué.

---

## 0. Lo que hay que entender antes de tocar nada

**WhatsApp Web no tiene webhooks.** Alguien tiene que sostener un WebSocket
permanente, y un Worker de Cloudflare no vive tanto. Por eso el canal necesita un
**contenedor** — no es un capricho de arquitectura, es el único camino.

**Esto es Baileys, que no es oficial.** WhatsApp puede banear el número
vinculado. Por eso el canal es **alterno**: la Cloud API oficial se queda
conectada. Si el QR cae, el bot no se queda mudo. Hay que decírselo a la dueña
con esas palabras antes de empezar.

**Cuesta plata.** Un contenedor `lite` siempre prendido sale en **~$1.50–2.00 al
mes**, sobre el plan Workers Paid de $5 que ya se paga. No es una suscripción
nueva que haya que activar: es consumo del mismo plan.

**Dos Workers, no uno.** El bot (`juancitoads-bot`) y el puente
(`juancitoads-bot-wa`) se despliegan por separado a propósito: si la imagen del
contenedor no construye, el que no sale es el puente y el bot sigue
publicándose. Un cambio de la base de conocimiento no puede quedarse sin
publicar porque WhatsApp esté roto.

---

## 1. Diferencias de Baby Caleb que cambian el procedimiento

Esto es lo que NO se puede copiar tal cual de PanaClaw.

| | PanaClaw | Baby Caleb | Consecuencia |
|---|---|---|---|
| Cuenta | del dueño | **del cliente** | el token, el plan y los secrets son suyos |
| `deploy.yml` | solo a mano | **corre en cada push a `main`** | mergear **es** desplegar |
| Reindexado de KB | no lo hace | **sí, tras cada deploy** | un deploy fallido deja el bot con conocimiento viejo |
| Worker | `panaclaw-oficial` | `juancitoads-bot` | cambian los nombres del binding |
| Trato | tuteo en el panel | **de usted, siempre** | los textos del canal ya vienen en usted |
| Guardas | — | `test/babycaleb/` + `FUENTES_DE_VERDAD.md` | ver §7 |

**La diferencia más peligrosa es la segunda.** En PanaClaw un error se quedaba en
un PR rojo. Aquí, mergear a `main` despliega el bot automáticamente. De ahí sale
la regla dura del §6.

---

## 2. Fase 0 — la plataforma del cliente (antes de escribir una línea)

### 2.1 El plan de Cloudflare

Verificar en el dashboard del cliente: **Workers Paid ($5/mes)**. Containers
viene incluido en ese plan; no hay nada extra que contratar.

### 2.2 El token de API

`dash.cloudflare.com → Manage Account → API Tokens → Create Token →` plantilla
**"Edit Cloudflare Workers"**, y sumarle:

| permiso | para qué |
|---|---|
| D1 · Edit | el esquema del bot y el del puente |
| Vectorize · Edit | el índice de la base de conocimiento |
| Workers Scripts · Edit | desplegar |
| **Cloudflare Images · Edit** | **el registro de imágenes del contenedor** |

> **⚠ Esto ya falló.** Sin *Images · Edit* el despliegue del puente muere al
> subir la imagen, con un error que **no menciona Images por ningún lado**. Es el
> permiso que nadie adivina porque no se parece a lo que uno está haciendo.

Guardarlo como secret del repositorio: `CLOUDFLARE_API_TOKEN`.

### 2.3 El `WA_TOKEN`

Es el secreto compartido entre el bot, el puente y el contenedor. **Tiene que ser
el mismo valor en los tres lados.**

Requisitos: **mínimo 24 caracteres y SOLO ASCII imprimible**. Sin ñ, sin tildes,
sin emojis, sin comillas tipográficas.

Generarlo así (no inventarlo a mano):

```
openssl rand -base64 32 | tr -d '/+=' | head -c 40
```

> **⚠ Esto ya falló, y costó tres rondas de diagnóstico.** Un token con un
> carácter fuera de ASCII da un **401 que no delata nada**: Node escribe el valor
> de una cabecera HTTP en latin-1 y el runtime de Cloudflare lo lee como UTF-8, y
> cada carácter raro se convierte en el de reemplazo **uno por uno** — así que el
> largo NO cambia. Se ve idéntico y no es igual. Peor: por navegador funciona,
> porque la URL lo codifica bien; falla solo en la máquina.
>
> Ya hay dos defensas puestas: el token viaja en **base64** (`x-wa-token-b64`) y
> `tokenEsApto()` lo rechaza al desplegar. Las dos se portan. No las quites.

Guardarlo como secret del repositorio: `WA_TOKEN`.

### 2.4 Verificación de la Fase 0

- [ ] El plan dice Workers Paid.
- [ ] El token tiene los cuatro permisos, **Images incluido**.
- [ ] `WA_TOKEN` creado, ≥24 caracteres, solo ASCII.
- [ ] Corrió `deploy.yml` a mano y terminó en verde **antes** de tocar el canal.

> **⚠ Esto ya falló.** En PanaClaw descubrimos a mitad del trabajo que el deploy
> **nunca había funcionado** — el secret no existía desde agosto. Nos enteramos
> cuando ya teníamos código encima. En Baby Caleb el riel ya funciona (20+
> corridas), pero se confirma igual: cuesta un minuto y ahorra confundir un
> problema nuevo con uno viejo.

---

## 3. Fase 1 — el puente (Worker + contenedor)

Se copia **entera** la carpeta `puente-wa/` de PanaClaw. No se reescribe nada.

```
puente-wa/
  wrangler.toml
  esquema.sql
  tsconfig.json
  src/worker.ts          ← el Durable Object, el latido y el almacén por lotes
  src/comun.ts           ← lógica pura, con pruebas
  contenedor/Dockerfile
  contenedor/package.json
  contenedor/servidor.mjs ← Baileys
.github/workflows/puente-wa.yml
```

### 3.1 Los seis cambios de nombre

En `puente-wa/wrangler.toml`:

| línea | valor de Baby Caleb |
|---|---|
| `name` | `juancitoads-bot-wa` |
| `[[d1_databases]] database_name` | `juancitoads-bot-wa-auth` |
| `[[d1_databases]] database_id` | el uuid que devuelva crear la base |
| `PUENTE_BASE_URL` | `https://juancitoads-bot-wa.<subdominio>.workers.dev` |
| `CRM_WEBHOOK_URL` | `https://<url-del-bot>/webhooks/whatsapp-qr` |
| `[[services]] service` | `juancitoads-bot` |

Crear la base primero:

```
pnpm wrangler d1 create juancitoads-bot-wa-auth
pnpm wrangler d1 execute juancitoads-bot-wa-auth --remote --file=puente-wa/esquema.sql
```

### 3.2 El Dockerfile va tal cual — y hay una razón

Es de dos etapas, y la primera instala `git` y reescribe el protocolo:

```dockerfile
RUN git config --global url."https://github.com/".insteadOf "git@github.com:"
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
```

> **⚠ Esto ya falló.** Baileys trae `libsignal` **desde git**, la imagen `slim`
> no incluye git, y npm intenta resolverlo por SSH sin llaves. El error que sale
> es `npm error enoent An unknown git error occurred` — que no nombra ni a git ni
> a SSH ni a libsignal. La segunda etapa copia solo `node_modules`, así que git
> no viaja a producción.

### 3.3 La versión de Baileys

`"@whiskeysockets/baileys": "^7.0.0-rc.12"` o superior.

> **⚠ Esto ya falló.** La `rc.9` tiene un aviso de seguridad
> (**GHSA-qvv5-jq5g-4cgg**, suplantación de mensajes). No bajes de la rc.12.

### 3.4 Lo que NO se toca del código portado

Cada una de estas piezas existe porque algo se rompió. Están comentadas en el
código con su motivo:

| pieza | qué pasa si se quita |
|---|---|
| **almacén por lotes** (`/puente/kv-lote`) | **el canal no se puede vincular** — ver §5 |
| `cerrarAnterior()` + generaciones | dos sockets sobre el mismo número se expulsan en ciclo |
| `process.on("unhandledRejection")` | una promesa suelta mata Node 22 y el contenedor entra en ciclo de caídas |
| `fetchLatestBaileysVersion()` en try/catch | un fallo de red ahí deja el canal muerto con "fetch failed" |
| retroceso exponencial del latido | el DO golpea un contenedor caído cada minuto para siempre |
| `conTope()` en `/api/estado` | el panel se cuelga justo cuando más falta hace |

### 3.5 Verificación de la Fase 1

- [ ] `puente-wa.yml` → `desplegar` termina en verde.
- [ ] La validación ASCII del token pasó (falla en ~17 s si no).

---

## 4. Fase 2 — el bot

### 4.1 Archivos nuevos (se copian tal cual)

```
src/channels/whatsappQr.ts        ← el adaptador
src/admin/views/whatsappQr.ts     ← la tarjeta del panel
test/channels/whatsappQr.test.ts
test/admin/whatsappQr.test.ts
test/puente-wa/comun.test.ts
```

### 4.2 Archivos existentes que hay que tocar

| archivo | qué |
|---|---|
| `src/channels/shared.ts` | agregar `"whatsapp-qr"` al `ChannelId` |
| `src/replies/sender.ts` | `if (channel === "whatsapp-qr") return whatsappQrAdapter;` |
| `src/index.ts` | ruta `POST /webhooks/whatsapp-qr` |
| `src/env.ts` | `PUENTE_WA?: Fetcher`, `WA_PUENTE_URL?`, `WA_TOKEN?` |
| `src/admin/routes.ts` | `/whatsapp-qr/estado`, `/reiniciar`, `/desvincular` |
| `src/admin/views/conexiones.ts` | montar `renderWhatsappQrCard()` |
| `wrangler.toml` | `[[services]] binding = "PUENTE_WA"` |
| `tsconfig.json` | sumar `"puente-wa/src/**/*"` al `include` |
| `.github/workflows/deploy.yml` | `WA_TOKEN` a la lista de secrets |

### 4.3 Los DOS service bindings — en los dos sentidos

En `wrangler.toml` del **bot**:

```toml
[[services]]
binding = "PUENTE_WA"
service = "juancitoads-bot-wa"
```

En `puente-wa/wrangler.toml` del **puente**:

```toml
[[services]]
binding = "CRM"
service = "juancitoads-bot"
```

> **⚠ Esto ya falló, y era un error de diseño mío.** Yo había decidido "HTTPS con
> token, no service bindings, porque un binding no cruza cuentas". El razonamiento
> era correcto y la premisa falsa: **el bot y su puente viven SIEMPRE en la misma
> cuenta**, la del cliente. El cruce que motivó la decisión no ocurre nunca.
>
> El síntoma fue `error code: 1042` disfrazado de **404**, que se lee como "la
> ruta no existe" cuando en realidad la petición **ni siquiera llegó**. Cloudflare
> rechaza que un Worker llame por URL pública a otro Worker de la misma cuenta.
>
> **Los dos sentidos.** El lado puente→CRM no había explotado todavía porque no
> había entrado ningún mensaje. Habría fallado igual, y el síntoma —un canal que
> recibe pero no contesta— habría sido mucho más confuso.

**Hay que desplegar los dos Workers.** Con uno solo, ese lado apunta a un binding
que el otro todavía no declara.

### 4.4 Verificación de la Fase 2

- [ ] `pnpm typecheck` **y** `pnpm test` en verde. Los dos.

> **⚠ Esto ya falló.** Después de editar los tests corrí solo `pnpm test` y salió
> verde: **vitest no revisa tipos**, transpila y ejecuta. El CI corre `tsc`
> primero y lo cazó. Aquí importa más, porque mergear despliega.

---

## 5. El fallo que casi no encontramos: el almacén por lotes

**Este es el hallazgo que justifica todo el piloto.** Si Baby Caleb hereda una
sola cosa de PanaClaw, que sea esta.

**El síntoma.** El QR se escanea bien, el teléfono dice "vinculado", y a los
segundos el canal se cae. Todo parece correcto: el contenedor corre, Baileys
arranca, escribe en la base. La pregunta natural —"¿me falta pagar algo en
Cloudflare?"— es razonable y es la pista equivocada.

**La causa.** Al vincular, WhatsApp exige subir **812 llaves de un solo uso**
(`INITIAL_PREKEY_COUNT`). Baileys se las entrega al almacén en **una** llamada a
`keys.set` y enseguida **las relee todas** con `keys.get`. Un almacén que abre una
petición HTTP por llave son ~1.600 viajes al puente, contra el `UPLOAD_TIMEOUT`
de **30 segundos** que Baileys no negocia.

**Medido, no deducido** (en la base en vivo de PanaClaw):

| | antes | después |
|---|---|---|
| llaves subidas | **644 de 812**, y murió | **812 de 812** |
| tiempo | 38 s (hacían falta ~95) | **menos de 1 segundo** |
| reintentos | cada pocos minutos, sin parar | uno solo |

**El arreglo ya está en el código que se porta:** `/puente/kv-lote`. Una petición
lleva el lote entero; el puente lo parte en idas de 90 filas a D1 dentro del
mismo Worker, a milisegundos de la base. De ~1.600 viajes a **2**.

### La lección que vale más que el arreglo

La prueba de humo de PanaClaw **tenía este mismo fallo y la dimos por buena.**
Cuando por fin miramos su base: 9.890 llaves escritas, contador en 12.181, tandas
de 516, 555, 479, 730… cada pocos minutos durante más de dos horas. **Nunca
completó una sola subida.**

Pasó porque verificamos *"¿reconecta sin QR?"* — que sí, y era la pregunta que
decidía la viabilidad — y nunca *"¿terminó de instalarse?"*. Las dos señales que
sí miramos (`creds` presente, filas `lid-mapping`) **salen en verde con el
dispositivo a medio instalar**.

> Una prueba que pasa no dice que el sistema funcione: dice que la señal que
> elegimos salió verde. Antes de dar algo por bueno, hay que preguntarse qué se
> vería igual de verde si estuviera roto. Aquí la respuesta era "casi todo".

---

## 6. Fase 3 — desplegar, en el orden que Baby Caleb exige

**Aquí mergear despliega.** El orden no es cosmético:

1. **Crear los secrets ANTES de mergear** — `WA_TOKEN` en el repositorio.
2. **Desplegar el puente primero** (`puente-wa.yml` → `desplegar`). Es un
   workflow aparte: no toca el bot.
3. **Recién ahí, mergear a `main`** — esto despliega el bot solo.
4. **Confirmar que el reindexado de la KB pasó.** Baby Caleb reindexa Vectorize
   después de desplegar; si ese paso falla, el Worker queda nuevo y **el bot
   sigue contestando con el conocimiento anterior**. Verde por fuera, viejo por
   dentro.

> **⚠ Esto ya falló.** Un contenedor **sano no toma una imagen nueva**: el latido
> lo ve corriendo y lo deja en paz. Estuvimos ~30 minutos diagnosticando código
> viejo creyendo que era el nuevo. **Después de desplegar el puente hay que
> reiniciar el contenedor a la fuerza** desde el panel ("Reiniciar el servicio").

---

## 7. Las guardas propias de Baby Caleb

Este canal **no escribe datos del negocio**, así que no choca con
`docs/FUENTES_DE_VERDAD.md`. Aun así, tres reglas de la casa aplican:

- **El bot habla de usted.** Los textos del canal ya vienen así (`enCastellano()`
  dice "Escanee", no "Escanea"). Hay una prueba que lo exige — no la relajes.
- **`docs/design-system.md` §7 es contrato** antes de tocar
  `src/admin/views/`: 16 px en campos, **44 px táctiles**, piso de 12 px, nada de
  `min-width` en píxeles ni `100vh`. La tarjeta portada ya los cumple y hay una
  prueba que mide los botones.
- **No se toca `member/`.**

El panel se usa desde el teléfono. La tarjeta se refresca sola con htmx cada 5 s
y **no sirve el QR cuando ya está conectado** — eso es seguridad, no estética: un
QR servido con la sesión activa deja que cualquiera con el panel abierto vincule
**otro** teléfono al bot.

---

## 8. Prueba final — el criterio que NO se negocia

No se da por bueno hasta que las tres pasen:

### 8.1 Vincular

Panel → Conexiones → tarjeta **WhatsApp (por código QR)** → escanear desde
*Dispositivos vinculados* del teléfono del negocio. La tarjeta debe pasar a
**Conectado** y el QR desaparece solo.

### 8.2 La consulta que decide — la que no hicimos la primera vez

En la base `juancitoads-bot-wa-auth`:

```sql
SELECT
  (SELECT COUNT(*) FROM wa_auth WHERE clave LIKE 'pre-key-%')        AS prekeys,
  (SELECT COUNT(*) FROM wa_auth WHERE clave LIKE 'lid-mapping%')     AS lid_mapping,
  (SELECT COUNT(*) FROM wa_auth WHERE clave LIKE 'app-state-sync-key%') AS app_state,
  (SELECT json_extract(valor,'$.nextPreKeyId')          FROM wa_auth WHERE clave='creds') AS siguiente,
  (SELECT json_extract(valor,'$.firstUnuploadedPreKeyId') FROM wa_auth WHERE clave='creds') AS sin_subir;
```

**El veredicto está en las dos últimas columnas:**

| señal | tiene que decir | por qué |
|---|---|---|
| `sin_subir` == `siguiente` | **813 == 813** | **no queda ninguna llave pendiente** |
| `prekeys` | ~811–812 | 812 subidas, las consumidas se borran al usarse |
| `app_state` | ≥ 1 | la sincronización de estado llegó a ocurrir |
| `lid_mapping` | > 0 | el directorio de identidades se sincronizó |

> `firstUnuploadedPreKeyId == nextPreKeyId` es **la única señal que distingue "se
> vinculó" de "terminó de instalarse"**. Es la que nos faltó. Si no es igual, el
> canal está a medio instalar aunque el panel diga Conectado.

También: todas las pre-keys deben compartir la misma marca de tiempo. **Tandas
repetidas cada pocos minutos = el fallo del §5 volvió.**

### 8.3 El mensaje real

Desde **otro** teléfono, mandar un mensaje al número vinculado. Tiene que
aparecer en Conversaciones con la etiqueta `whatsapp-qr` y el bot tiene que
contestar. Eso recorre la cadena completa:

```
teléfono → WhatsApp → contenedor (Baileys)
  → puente /puente/entrante → binding CRM → bot /webhooks/whatsapp-qr
  → agente → binding PUENTE_WA → puente /api/enviar → contenedor → WhatsApp
```

---

## 9. Las siete paradas del piloto, en una tabla

Si alguna aparece en Baby Caleb, este plan se saltó un paso.

| # | síntoma | causa real | dónde lo previene este plan |
|---|---|---|---|
| 1 | deploy muere en la primera línea | faltaba `CLOUDFLARE_API_TOKEN` | §2.4 |
| 2 | `Wrangler requires Node.js v22` | workflow en Node 20 | ya viene en 22 |
| 3 | `npm error enoent ... git error` | `libsignal` viene de git; `slim` no trae git | §3.2 |
| 4 | **401 mudo** con el token correcto | cabecera latin-1 vs UTF-8; el largo no cambia | §2.3 |
| 5 | contenedor en ciclo de caídas | promesa sin capturar mata Node 22 | §3.4 |
| 6 | **404 con `error code: 1042`** | Worker→Worker de la misma cuenta por URL pública | §4.3 |
| 7 | **vincula y se cae a los segundos** | 812 llaves de a una contra un plazo de 30 s | §5 |

Y dos que no dieron error, que son las peores:

| | síntoma | por qué es peor |
|---|---|---|
| 8 | un contenedor sano **no toma la imagen nueva** | se diagnostica código viejo creyendo que es el nuevo | §6 |
| 9 | la prueba de humo **pasó estando rota** | medimos la señal equivocada | §5, §8.2 |

---

## 10. Deudas conocidas que se heredan

- **Las pre-keys se acumulan.** Hay una válvula manual (`/api/podar`,
  conservadora) y **a propósito no es automática**: borrar una que todavía haga
  falta rompe el descifrado de un mensaje pendiente.
- **El costo del Durable Object a 24 h no está medido.** En PanaClaw la medición
  quedó contaminada por dos contenedores corriendo a la vez. En Baby Caleb, con
  uno solo desde el arranque, sale limpia. Vale la pena mirarla a las 24 h.
