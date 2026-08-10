# Conectar tu bot a WhatsApp con Twilio (canal Pro)

Esta guía es para conectar tu chatbot a **WhatsApp** usando **Twilio**. Está escrita para que cualquier persona la siga, aunque no sepas nada de programación. Claude Code va a hacer la mayoría del trabajo técnico, pero **estas credenciales solo las puedes conseguir tú** porque vienen de tu cuenta.

> WhatsApp por Twilio es una función **Pro**. Si estás en el plan Free, salta este canal y usa Telegram (más abajo te explico cómo) o ManyChat.

Tu bot puede hablar por **tres canales**. Esta guía cubre los tres, pero el principal es Twilio WhatsApp:

1. **Twilio WhatsApp** — WhatsApp "de verdad" con tu número de negocio.
2. **Telegram** — gratis, rápido de probar (también te explico cómo sacar tu chat para recibir avisos).
3. **ManyChat** — Instagram / Facebook Messenger / WhatsApp vía ManyChat.

---

## PARTE 1 — Twilio WhatsApp

### Qué vas a lograr

Que cuando un cliente le escriba a tu número de WhatsApp, tu bot le responda solo. Y que cuando una conversación necesite que un humano la atienda, el bot te avise **a ti** por WhatsApp con un mensaje aprobado.

### Paso 1 — Crea tu cuenta de Twilio

1. Entra a **https://www.twilio.com/try-twilio** y crea una cuenta (o inicia sesión si ya tienes).
2. Verifica tu correo y tu número de teléfono cuando te lo pidan.
3. Ya dentro, vas a llegar a la **Console** (el panel principal de Twilio).

### Paso 2 — Copia tus credenciales principales

En la página de inicio de la **Console** de Twilio (https://console.twilio.com), busca la sección **Account Info**. Ahí vas a ver:

- **Account SID** — empieza con `AC...`. Es como el "usuario" de tu cuenta.
- **Auth Token** — está oculto; dale clic en **Show** o en el ojito para verlo. Es como la "contraseña" de tu cuenta.

> ⚠️ El **Auth Token** es secreto. No se lo mandes a nadie por mensaje ni lo pegues en chats públicos.

Guarda los dos en un lugar seguro (los vas a pegar en una terminal en el Paso 6).

### Paso 3 — Activa WhatsApp en Twilio

Tienes dos opciones, según qué tan en serio vayas:

**Opción A — Sandbox (para probar rápido y gratis):**
1. En el menú de la izquierda ve a **Messaging → Try it out → Send a WhatsApp message**.
2. Twilio te da un número de prueba (algo como `+1 415 523 8886`) y un código tipo `join algo-algo`.
3. Desde tu WhatsApp personal, mándale ese mensaje (`join algo-algo`) al número de prueba para "unirte" al sandbox.
4. Listo: ya puedes probar tu bot, pero **solo** con números que se hayan unido al sandbox.

**Opción B — Número real de WhatsApp Business (para producción):**
1. En el menú ve a **Messaging → Senders → WhatsApp senders**.
2. Sigue el asistente para registrar tu número de negocio en WhatsApp. Twilio te pide conectar tu cuenta de **Meta / Facebook Business** y verificar el negocio.
3. Este proceso tarda y requiere aprobación de Meta, así que empieza con el Sandbox para probar y pásate al número real cuando ya todo funcione.

Anota el número de WhatsApp que vas a usar (el del sandbox o el real). Lo vas a necesitar como **solo el número con código de país y el `+` — SIN el prefijo `whatsapp:`**, por ejemplo `+14155238886`.

> ⚠️ **Importante:** NO le pongas `whatsapp:` al valor de `TWILIO_WA_FROM`. El bot le agrega ese prefijo solo. Si lo escribes tú (`whatsapp:+1415...`), queda doble (`whatsapp:whatsapp:+1415...`) y el bot **no podrá enviar mensajes**.

### Paso 4 — (Solo Pro) Crea la PLANTILLA aprobada para avisarte cuando se necesite un humano

Cuando un cliente pide hablar con una persona, el bot te manda un aviso **a ti por WhatsApp**. WhatsApp **no permite** que un negocio inicie una conversación con texto libre: tiene que ser una **plantilla aprobada** (Content Template). Por eso necesitas crearla una vez.

1. En Twilio ve a **Content Template Builder**: **Messaging → Content Template Builder** (o entra a https://console.twilio.com/us1/develop/content-template-builder).
2. Dale **Create new** y elige una plantilla de tipo **Text** (texto simple) o con variables.
3. Escribe un mensaje corto que te sirva de aviso. Te recomiendo usar variables para que el bot llene los datos. Ejemplo:

   > 🔔 Un cliente necesita atención humana en {{1}}. Cliente: {{2}}. Resumen: {{3}}

   Aquí `{{1}}`, `{{2}}`, `{{3}}` son huecos que el bot rellena (nombre del negocio, nombre/número del cliente, resumen de la conversación).
4. Manda la plantilla **a aprobación** (Submit for WhatsApp approval). Meta tarda desde unos minutos hasta unas horas en aprobarla.
5. Cuando esté **Approved**, copia el **Content SID** de la plantilla. Empieza con **`HX...`**. Ese es el dato que el bot necesita.

> Sin esta plantilla aprobada, el aviso de "atención humana" por WhatsApp **no se enviará**. Si todavía no la tienes lista, no pasa nada: puedes recibir los avisos por **Telegram o correo** mientras tanto (ver Parte 2 y la sección de avisos al final).

### Paso 5 — Anota también tu propio número de WhatsApp (para recibir los avisos)

Es el número donde **tú** quieres recibir los avisos del bot. Anótalo con formato internacional, **solo el número con `+`, SIN el prefijo `whatsapp:`**, por ejemplo `+521559876543`. (Igual que `TWILIO_WA_FROM`: el bot le pone `whatsapp:` solo.)

### Paso 6 — Guarda las credenciales en tu bot

Claude Code va a guardar estas credenciales como "secrets" (datos secretos) de tu Worker en Cloudflare. Tú solo necesitas tener a la mano los datos de arriba. Cuando Claude te lo pida, vas a correr estos comandos (uno por uno) y pegar el valor cuando te lo pregunte:

```bash
# El "usuario" de tu cuenta Twilio (AC...)
pnpm wrangler secret put TWILIO_ACCOUNT_SID

# La "contraseña" de tu cuenta Twilio (el Auth Token)
pnpm wrangler secret put TWILIO_AUTH_TOKEN

# El número de WhatsApp DESDE el que sale tu bot — SOLO el número: +14155238886
# (NO le pongas "whatsapp:", el bot lo agrega solo)
pnpm wrangler secret put TWILIO_WA_FROM

# (Pro) El Content SID de la plantilla aprobada para avisarte (HX...)
pnpm wrangler secret put TWILIO_HANDOFF_CONTENT_SID

# (Pro) Tu propio número de WhatsApp para recibir los avisos — SOLO el número: +521559876543
# (tampoco lleva "whatsapp:")
pnpm wrangler secret put OWNER_WA_NUMBER
```

Cada comando te va a pedir que pegues el valor. Pega solo el dato (sin comillas) y dale Enter.

### Paso 7 — Conecta el webhook a tu Worker

El **webhook** es la "dirección" a la que Twilio le avisa a tu bot que llegó un mensaje nuevo. Tu bot escucha en esta ruta:

```
https://TU-WORKER.workers.dev/webhooks/twilio
```

Cambia `TU-WORKER.workers.dev` por la dirección real de tu Worker (Claude Code te la da después de hacer el deploy; suele aparecer al terminar `pnpm run deploy`).

Para configurar el webhook en Twilio:

- **Si usas el Sandbox:** ve a **Messaging → Try it out → Send a WhatsApp message → Sandbox settings**. En el campo **"When a message comes in"** pega tu URL `https://TU-WORKER.workers.dev/webhooks/twilio` y déjalo en método **POST**. Guarda.
- **Si usas un número real:** ve a **Messaging → Senders → WhatsApp senders**, abre tu número, y en la configuración de mensajes entrantes pega la misma URL `https://TU-WORKER.workers.dev/webhooks/twilio` con método **POST**. Guarda.

### Paso 8 — Prueba

1. Desde otro teléfono, mándale un mensaje a tu número de WhatsApp de Twilio (o al del sandbox si estás usando ese, recordando "unirte" primero).
2. Tu bot debería responder en unos segundos.
3. Para probar el aviso de humano, escribe algo como "quiero hablar con una persona" y revisa que te llegue el aviso (por la plantilla de WhatsApp, o por Telegram/correo si los configuraste).

---

## PARTE 2 — Telegram (gratis, ideal para probar)

Telegram es la forma más rápida y gratis de probar tu bot. También sirve para **recibir los avisos del bot por DM** (esto último funciona en Free y Pro).

### Paso 1 — Crea tu bot con BotFather

1. En Telegram busca **@BotFather** (es la cuenta oficial con palomita azul).
2. Mándale el comando **`/newbot`**.
3. Te pedirá un **nombre** (lo que verá la gente) y un **username** (tiene que terminar en `bot`, por ejemplo `mi_negocio_bot`).
4. Al terminar, BotFather te da un **token** largo, algo como `123456789:AAH...`. Ese es tu **TELEGRAM_BOT_TOKEN**.

### Paso 2 — Guarda el token

```bash
pnpm wrangler secret put TELEGRAM_BOT_TOKEN
```

Pega el token cuando te lo pida.

### Paso 3 — Conecta el webhook

Tu bot escucha los mensajes de Telegram en esta ruta:

```
https://TU-WORKER.workers.dev/webhooks/telegram
```

Para que Telegram le avise a tu bot, hay que registrar ese webhook una vez. Claude Code puede hacerlo por ti, o tú puedes pegar esta dirección en el navegador (cambiando el token y la URL del Worker):

```
https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://TU-WORKER.workers.dev/webhooks/telegram
```

Si ves un mensaje que dice `"ok":true`, quedó conectado.

### Paso 4 — Cómo obtener tu OWNER_TELEGRAM_CHAT_ID (para recibir avisos)

Por **default**, cuando el bot necesita avisarte que una conversación requiere atención humana, te manda un **DM por Telegram**. Para eso necesita saber tu "chat id" (tu identificador personal de Telegram). Así lo consigues:

1. Abre Telegram y busca **tu propio bot** (el username que creaste, ej. `@mi_negocio_bot`).
2. Dale **Start** o escríbele **`/start`**. Con eso tu bot ya "te conoce".
3. Tu bot está programado para **responderte con tu chat id** la primera vez que le das `/start`. Copia ese número (es algo como `123456789`).
   - Si por alguna razón no te lo muestra, puedes obtenerlo abriendo en el navegador:
     `https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/getUpdates`
     y buscando el campo `"chat":{"id": ...}` con tu nombre.
4. Guárdalo en tu bot:

```bash
pnpm wrangler secret put OWNER_TELEGRAM_CHAT_ID
```

Pega tu chat id (solo el número) cuando te lo pida.

> Importante: tienes que darle **`/start`** a tu propio bot primero. Telegram no deja que un bot le escriba a alguien que nunca lo ha iniciado.

---

## PARTE 3 — ManyChat (Instagram / Facebook / WhatsApp vía ManyChat)

Si ya manejas tu negocio con **ManyChat**, puedes conectar tu bot a Instagram, Facebook Messenger o WhatsApp a través de ahí.

### Paso 1 — Consigue tu API Key de ManyChat

1. Entra a tu cuenta de ManyChat: **https://app.manychat.com**.
2. Ve a **Settings (⚙️) → API**.
3. Copia tu **API Key** (es una cadena larga de letras y números).

### Paso 2 — Guarda la API Key

```bash
pnpm wrangler secret put MANYCHAT_API_KEY
```

Pega la API Key cuando te lo pida.

### Paso 3 — Conecta el webhook

Tu bot escucha a ManyChat en:

```
https://TU-WORKER.workers.dev/webhooks/manychat
```

En ManyChat, dentro de tu **Flow** o **Automation**, agrega una acción de tipo **External Request / Webhook** (Dynamic Block o "Request"), apuntando a esa URL con método **POST**, en el punto donde quieras que conteste tu bot. Guarda y publica el flujo.

---

## Resumen — qué secret corresponde a cada canal

| Canal | Secret(s) de wrangler | Para qué sirve |
|---|---|---|
| **Twilio WhatsApp** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM` | Credenciales y número desde el que responde el bot |
| **Twilio WhatsApp (aviso a ti, Pro)** | `TWILIO_HANDOFF_CONTENT_SID`, `OWNER_WA_NUMBER` | Plantilla aprobada + tu número para recibir avisos |
| **Telegram** | `TELEGRAM_BOT_TOKEN` | Token del bot creado con @BotFather |
| **Telegram (aviso a ti)** | `OWNER_TELEGRAM_CHAT_ID` | Tu chat id para recibir DMs del bot |
| **ManyChat** | `MANYCHAT_API_KEY` | Conexión con Instagram/Facebook/WhatsApp vía ManyChat |

### URLs de webhook (por canal)

- Twilio WhatsApp → `https://TU-WORKER.workers.dev/webhooks/twilio` (método POST)
- Telegram → `https://TU-WORKER.workers.dev/webhooks/telegram` (método POST)
- ManyChat → `https://TU-WORKER.workers.dev/webhooks/manychat` (método POST)

---

## ¿Cómo quieres recibir los avisos cuando se necesite un humano?

El bot te puede avisar de tres formas. Elige al menos una:

1. **Telegram (recomendado, default)** — solo necesitas `OWNER_TELEGRAM_CHAT_ID` (ver Parte 2, Paso 4). Es gratis e instantáneo.
2. **Correo (opcional)** — configura `RESEND_API_KEY` y `OWNER_EMAIL`. El bot te manda un email.
3. **WhatsApp (opcional, Pro)** — requiere la **plantilla aprobada** (`TWILIO_HANDOFF_CONTENT_SID`) y tu número (`OWNER_WA_NUMBER`). Recuerda: WhatsApp **no** permite mensaje de texto libre para iniciar, por eso es obligatoria la plantilla aprobada.

> Consejo: empieza con **Telegram** porque es lo más fácil y rápido de dejar funcionando. Cuando tengas la plantilla de WhatsApp aprobada, puedes sumar también el aviso por WhatsApp.

---

## Problemas comunes

- **"El bot no responde en WhatsApp"** → Revisa que el webhook en Twilio esté en `https://TU-WORKER.workers.dev/webhooks/twilio`, en **POST**, y con la dirección correcta de tu Worker. Si usas Sandbox, asegúrate de haberte "unido" con el mensaje `join ...`.
- **"No me llega el aviso de humano por WhatsApp"** → Tu plantilla (`TWILIO_HANDOFF_CONTENT_SID`) probablemente todavía no está **Approved**, o no guardaste `OWNER_WA_NUMBER`. Mientras tanto, usa Telegram o correo.
- **"Telegram no me da mi chat id"** → Asegúrate de haberle dado **`/start`** a tu propio bot primero.
- **"No sé la URL de mi Worker"** → Aparece al final de `pnpm run deploy`. También puedes verla en el panel de Cloudflare, en Workers & Pages.
