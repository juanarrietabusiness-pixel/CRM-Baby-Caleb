# Instagram en el CRM: por qué no llega (y qué falta)

## El hallazgo (22 oct 2026)

**Ninguna app de Meta está apuntando al CRM.** Las tres apps de la cuenta se
revisaron una por una:

| App de Meta | Estado | A dónde manda sus webhooks |
|---|---|---|
| Juancito Ads - Calendario (`2501027797085987`) | Publicada | `calendarios.juanarrietabusiness.workers.dev/api/webhooks/meta` — objetos **Page** e **Instagram**, campos `messages` y `comments` |
| Juancito Ads - Calendario (`28404814999181099`) | En desarrollo | Sin productos |
| Baby Cale CRM (`2099638607582456`) | Publicada | Solo el caso de uso de **WhatsApp**; sin Messenger ni Instagram |

El webhook del bot — `juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta`
— **no aparece en ninguna**. Y el worker de calendarios **no reenvía** nada al
bot: consume los eventos para su propia Bandeja (revisado en
`worker/lib/bandeja/webhook.js` del repo `CALENDARIOS-MARKETING-APP`).

### La regla de Meta que explica todo

Una app de Meta tiene **una sola Callback URL por objeto**. El objeto
`instagram` de la app del Calendario ya está ocupado apuntando al calendario:
no se le puede pedir que además mande una copia al CRM, y cambiarle la URL le
quitaría los eventos al calendario.

Pero sí hay salida: **una misma Página de Facebook y una misma cuenta de
Instagram pueden estar suscritas a varias apps a la vez**, y Meta entrega el
evento a cada una, a su propia URL. Es decir: el CRM necesita **su propia app
suscrita**, no quitarle nada al calendario.

### La buena noticia

Que los DMs de Instagram **sí lleguen al calendario** prueba que todo el lado
de Instagram ya está bien: la cuenta está conectada, el permiso de
*Herramientas conectadas* está activo y los permisos avanzados de
`instagram_manage_messages` funcionan. Eso ya no hay que arreglarlo. Lo único
que falta es la suscripción que apunte al CRM.

---

## El plan: usar la app "Baby Cale CRM"

Esa app ya existe, ya está publicada y ya es del portfolio correcto (Baby
Kaleb). Hay que agregarle Messenger e Instagram y apuntarla al bot.

1. **Agregar productos** a la app `2099638607582456`: Messenger y, si la cuenta
   de Instagram no está vinculada a la Página, también Instagram.
2. **Webhooks → objeto Page**: Callback URL
   `https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta`,
   verify token = el valor de `META_VERIFY_TOKEN` del bot. Suscribir `messages`.
3. **Webhooks → objeto Instagram**: la misma URL y el mismo verify token.
   Suscribir `messages`. **Este es el paso que falta hoy.**
4. **Suscribir la Página** (Messenger → *Add subscriptions*) y, si aplica,
   conectar la cuenta de Instagram en el producto Instagram.
5. **Los tres secrets del bot, tomados de ESTA app** (no de la del calendario):
   - `META_APP_SECRET` → el App Secret de Baby Cale CRM. Si el bot tiene
     guardado el de otra app, **todas** las firmas se rechazan con 403.
   - `META_PAGE_ACCESS_TOKEN` → el Page Access Token que genere esta app.
   - `META_VERIFY_TOKEN` → el que pegues en los pasos 2 y 3.
6. **Desplegar** y mandar un DM de prueba.

> Los dos sistemas van a ver el mismo DM: el calendario lo muestra en su
> Bandeja y el bot lo contesta. Eso es lo esperado, no un conflicto.

### Cuidado con esto

- **No** le cambies la Callback URL a la app del Calendario: le quitas los
  eventos a la Bandeja.
- **No** pegues el App Secret ni los tokens en el chat. Van directo del panel de
  Meta al panel de Cloudflare (Workers → tu Worker → Settings → Variables and
  Secrets), o con `wrangler secret put NOMBRE` desde la terminal.

---

## Instrucciones para Claude en Chrome

Copia y pega esto tal cual:

```
Vamos a configurar UNA app de Meta para que mande los mensajes de Messenger y
los DMs de Instagram a mi bot. Contexto que ya verifiqué, no hace falta que lo
vuelvas a revisar:

- La app "Juancito Ads - Calendario" (2501027797085987) manda sus webhooks al
  worker del calendario. NO LA TOQUES: ni su Callback URL, ni sus campos
  suscritos, ni sus productos. Si algo te obliga a modificarla, detente.
- La app que vamos a configurar es "Baby Cale CRM", ID 2099638607582456. Hoy
  solo tiene el caso de uso de WhatsApp.
- El webhook de mi bot es:
  https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta

Haz esto en la app Baby Cale CRM (2099638607582456):

1. Dime qué productos tiene hoy y si la Página de Facebook del negocio y la
   cuenta de Instagram aparecen disponibles para esta app.

2. Agrega el producto "Messenger". Si la cuenta de Instagram NO está vinculada
   a la Página de Facebook, agrega también el producto "Instagram".

3. En Webhooks, objeto "Page": pon como Callback URL la del bot que te di
   arriba. Cuando te pida el verify token, DETENTE y pídemelo — no lo inventes
   ni lo adivines. Después suscribe el campo "messages".

4. En Webhooks, cambia el selector al objeto "Instagram" y repite: misma
   Callback URL, mismo verify token, y suscribe el campo "messages". Si el
   selector no muestra "Instagram", dime qué opciones sí muestra.

5. En Messenger → Configuración, suscribe la Página del negocio al webhook
   ("Add subscriptions" / "Agregar suscripciones") y dime si la cuenta de
   Instagram aparece vinculada a esa Página.

6. Genera el Page Access Token de la Página en esta app, pero NO lo pegues en
   el chat ni me lo leas: solo dime que ya está generado y dónde queda, que yo
   lo copio.

7. Dime en qué nivel están los permisos instagram_basic,
   instagram_manage_messages, pages_messaging y pages_manage_metadata de esta
   app: "Acceso estándar" o "Acceso avanzado".

8. Usa el botón "Probar"/"Test" de la suscripción de Instagram, campo
   "messages", y dime qué código devuelve mi servidor. Un 403 es esperado
   mientras no haya guardado el App Secret de ESTA app — avísame y seguimos.

Reglas: no pegues tokens, App Secrets ni verify tokens en el chat; no cambies
el modo de la app; no toques la app del calendario; y si un paso pide
confirmar algo que cobre o publique algo, detente y pregúntame.
```

---

## Cómo leer el resultado en el panel del CRM

Esta versión del bot agrega una tarjeta **Instagram DMs (Meta)** en
`/admin/conexiones`, separada de Messenger, que dice qué pasó con el último
evento que mandó Meta:

- **"Nunca ha llegado un evento por este canal"** → Meta no está entregando
  nada. Es lo que debería decir hoy, antes de hacer el plan de arriba.
- **"RECHAZADO por firma inválida"** → el `META_APP_SECRET` guardado no es el de
  la app que está mandando los eventos (paso 5 del plan).
- **"IGNORADO por configuración"** → hay una bandera apagando Instagram
  (`IG_OFFICIAL="off"` o `IG_DM_SOURCE="manychat"` en `wrangler.toml`).
- **"procesado"** → el DM entró. Si el cliente no recibió respuesta, el problema
  es de envío, no de recepción: revisa *Conversaciones*.

## Cómo desplegar esta versión

El deploy sale de GitHub: haz merge de la rama a `main`, o en la pestaña
**Actions** del repositorio corre el workflow **Deploy** eligiendo la rama
`claude/brave-dirac-weyiy4`.
