# Conectar tu bot a WhatsApp con la Cloud API oficial (directo con Meta)

Esta guía conecta tu chatbot a **WhatsApp** usando la **Cloud API oficial de Meta**, sin intermediarios como Twilio ni ManyChat. Está escrita para que la sigas aunque no sepas nada de programación. Claude Code hace el trabajo técnico; **estas credenciales solo las puedes conseguir tú** porque salen de tu cuenta de Meta.

> **¿Por qué esta opción?** Va directo a Meta, así que pagas **la tarifa más barata** (sin markup de un tercero) → mejor margen si revendes bots. La contra es que el setup es **más pesado** que Twilio: creas una cuenta de WhatsApp Business (WABA) y, para producción, haces verificación de negocio. Pero **puedes dejarlo funcionando gratis** con el **número de prueba** de Meta antes de meter tu número real.
>
> Si solo quieres ver WhatsApp vivo en 10 minutos, Twilio es más rápido de arrancar (ver `twilio-whatsapp.md`). Esta guía es para quien va en serio con volumen y margen.

---

## Qué vas a lograr

Que cuando un cliente le escriba a tu número de WhatsApp, tu bot le responda solo — incluyendo **notas de voz e imágenes** (el bot las procesa por un proxy de media firmado, no tienes que configurar nada extra). En modo prueba funciona con hasta ~5 números que tú verifiques; con número real y negocio verificado, con cualquiera.

## Antes de empezar

- Necesitas una cuenta de **Facebook** y acceso a **https://developers.facebook.com** (Meta for Developers). Es gratis.
- Un **Business Portfolio** (portafolio de negocio) en **https://business.facebook.com**. Si no tienes, el asistente te deja crear uno en el camino.
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`, algo como `https://TU-WORKER.workers.dev`).

---

## Paso 1 — Crea (o abre) tu app de Meta

1. Entra a **https://developers.facebook.com/apps** e inicia sesión.
2. Dale **Create App**. En "Use case" elige **Other**, y en tipo elige **Business**.
3. Ponle un nombre (ej. "Bot de mi negocio"), asócialo a tu Business Portfolio y créala.

> Si ya tienes una app de Meta para Instagram/Messenger (la de `meta-oficial.md`), **puedes usar la misma** y solo agregarle el producto WhatsApp. En ese caso, WhatsApp y Meta pueden compartir el `App Secret` y el `Verify Token`.

## Paso 2 — Agrega el producto "WhatsApp"

1. En el panel de tu app, en la lista de productos, busca **WhatsApp** y dale **Set up**.
2. Meta te asocia (o te pide crear) una **WhatsApp Business Account (WABA)**. Acéptala.
3. Vas a llegar a la pantalla **WhatsApp → API Setup** (o "Getting Started"). Aquí está casi todo lo que necesitas.

## Paso 3 — Anota tu Phone Number ID y el número de prueba

En la pantalla **API Setup**:

1. Meta te regala un **número de prueba** ("test number") ya listo. Debajo de él vas a ver el **Phone number ID** — es un número largo (ej. `123456789012345`). **Ese ID es lo que el bot usa, NO el número de teléfono.** Cópialo → es tu `WHATSAPP_PHONE_NUMBER_ID`.
2. En la sección **"To"** / **"Recipients"**, agrega los números **a los que vas a poder escribir mientras pruebas** (hasta ~5). Cada uno recibe un código de WhatsApp para verificarse. Agrega tu propio celular ahí para probar.

> El número de prueba **solo** puede mandar mensajes a esos destinatarios verificados, y solo tú puedes iniciar. Es perfecto para dejar el bot funcionando antes de conectar un número real.

## Paso 4 — Consigue el Access Token

En la misma pantalla **API Setup** verás un **temporary access token** que dura 24 h — sirve para una prueba rápida, pero **se vence**. Para que el bot funcione siempre, crea un token permanente:

1. Ve a **https://business.facebook.com/settings** → **Users → System Users**.
2. Crea un **System User** (rol Admin), o usa uno existente.
3. Dale **Assign assets** y asígnale tu **WABA** (la WhatsApp Business Account) con permiso de **manage** (control total).
4. Dale **Generate new token**, elige tu app, y en permisos marca **`whatsapp_business_messaging`** y **`whatsapp_business_management`**.
5. Copia el token que te da → es tu `WHATSAPP_ACCESS_TOKEN`. Un token de System User **no expira** (a menos que lo revoques).

> ⚠️ Ese token es como una llave maestra de tu WhatsApp. **No lo pegues en chats ni se lo mandes a nadie.** Solo lo vas a pegar en la terminal en el Paso 7.

## Paso 5 — Inventa tu Verify Token (token de verificación del webhook)

El **Verify Token** es una palabra secreta que **tú inventas** — sirve para el "apretón de manos" entre Meta y tu bot cuando registras el webhook. No viene de ningún lado, tú la decides.

- Elige algo difícil de adivinar, ej. `mi-bot-wa-9f3k2` (letras y números, sin espacios).
- Anótalo. Lo vas a usar en dos lugares: al guardarlo como secret (Paso 7) y al pegarlo en Meta (Paso 8), y **tienen que ser idénticos**.

> Si ya usas la misma app para Instagram/Messenger (Meta oficial) y ya tienes `META_VERIFY_TOKEN` configurado, **puedes reutilizarlo**: si no defines `WHATSAPP_VERIFY_TOKEN`, el bot usa `META_VERIFY_TOKEN`.

## Paso 6 — Consigue tu App Secret (para validar la firma)

Meta firma cada mensaje que te manda, y el bot verifica esa firma para asegurarse de que de verdad viene de Meta.

1. En tu app, ve a **Settings → Basic**.
2. Busca **App Secret** y dale **Show**. Cópialo → es tu `WHATSAPP_APP_SECRET`.

> Igual que el Verify Token: si compartes app con Meta oficial, el bot usa `META_APP_SECRET` cuando `WHATSAPP_APP_SECRET` no está definido. No necesitas duplicarlo.

## Paso 7 — Guarda las credenciales en tu bot

Claude Code las guarda como "secrets" del Worker en Cloudflare. Cuando te lo pida, corre estos comandos (uno por uno) y pega el valor cuando te lo pregunte. **Pega solo el dato, sin comillas, y dale Enter.**

```bash
# El Phone Number ID del número (el número largo, NO el teléfono)
pnpm wrangler secret put WHATSAPP_PHONE_NUMBER_ID

# El access token del System User (no expira)
pnpm wrangler secret put WHATSAPP_ACCESS_TOKEN

# El verify token que TÚ inventaste (Paso 5)
# — puedes saltarlo si vas a reutilizar META_VERIFY_TOKEN
pnpm wrangler secret put WHATSAPP_VERIFY_TOKEN

# El App Secret de Settings → Basic
# — puedes saltarlo si vas a reutilizar META_APP_SECRET
pnpm wrangler secret put WHATSAPP_APP_SECRET
```

Después de guardarlos, Claude corre `pnpm run deploy` para que el Worker tome los secrets.

> ⚠️ **Nunca** pegues estos valores en el chat. Solo van en la terminal con `wrangler secret put` (la entrada va oculta).

## Paso 8 — Conecta el webhook a tu Worker

El **webhook** es la "dirección" a la que Meta le avisa a tu bot que llegó un mensaje. Tu bot escucha en:

```
https://TU-WORKER.workers.dev/webhooks/whatsapp
```

Cambia `TU-WORKER.workers.dev` por la dirección real de tu Worker.

Para configurarlo en Meta:

1. En tu app ve a **WhatsApp → Configuration** (o **API Setup → Webhooks**).
2. En **Callback URL** pega `https://TU-WORKER.workers.dev/webhooks/whatsapp`.
3. En **Verify token** pega **exactamente** el mismo Verify Token del Paso 5.
4. Dale **Verify and save**. Si el bot ya está desplegado con ese token, Meta confirma el apretón de manos y guarda.
5. Ahora, en **Webhook fields**, busca la fila **`messages`** y dale **Subscribe**. (Sin suscribir `messages`, Meta no te manda los mensajes entrantes.)

## Paso 9 — Prueba

1. Desde uno de los teléfonos que **verificaste** en el Paso 3, mándale un mensaje al número de prueba de WhatsApp.
2. Tu bot debería responder en unos segundos.
3. Prueba también una **nota de voz** y una **foto**: el bot las entiende (transcribe el audio y "ve" la imagen) sin configuración extra.
4. Abre `/admin/conexiones` en tu dashboard: la tarjeta **"WhatsApp (Oficial · Cloud API)"** debe estar **verde**.

---

## Pasar de prueba a producción (número real)

Cuando ya funcione con el número de prueba y quieras atender a **cualquier** cliente:

1. En **WhatsApp → API Setup** dale **Add phone number** y registra tu número de negocio (uno que **no** esté ya en la app de WhatsApp normal).
2. Haz la **verificación de negocio** de Meta en **business.facebook.com → Security Center**. Tarda desde horas hasta varios días; pide documentos del negocio.
3. Sube el número a un **nivel de mensajería** (Meta arranca en 250 conversaciones/día y sube solo según tu calidad).
4. Copia el **nuevo Phone Number ID** de ese número y actualízalo: `pnpm wrangler secret put WHATSAPP_PHONE_NUMBER_ID` → `pnpm run deploy`.

### La regla de las 24 horas (plantillas)

WhatsApp deja que **respondas con texto libre** solo dentro de las **24 horas** desde el último mensaje del cliente (la "ventana de servicio"). Tu bot siempre contesta a un cliente que acaba de escribir, así que **para responder no necesitas plantillas**.

Solo necesitas una **plantilla aprobada** (Message Template) si quieres que el bot **inicie** una conversación o escriba **después** de esas 24 h (ej. recordatorios, promos). Se crean en **WhatsApp → Message Templates** y Meta las aprueba. Para el uso normal del bot (responder), no hace falta.

---

## Resumen — qué secret es qué

| Secret | De dónde sale | Para qué sirve |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | API Setup (debajo del número) | Identifica el número desde el que responde el bot |
| `WHATSAPP_ACCESS_TOKEN` | System User token (business.facebook.com) | Autoriza al bot a enviar y descargar media |
| `WHATSAPP_VERIFY_TOKEN` | Lo inventas tú | Apretón de manos al registrar el webhook (o reutiliza `META_VERIFY_TOKEN`) |
| `WHATSAPP_APP_SECRET` | Settings → Basic → App Secret | Valida la firma de los mensajes de Meta (o reutiliza `META_APP_SECRET`) |

**Webhook:** `https://TU-WORKER.workers.dev/webhooks/whatsapp` — suscribe el campo **`messages`**.

---

## Problemas comunes

- **"Verify and save" falla** → El `WHATSAPP_VERIFY_TOKEN` guardado en el bot y el que pegaste en Meta **no son idénticos**, o todavía no corriste `pnpm run deploy` después de guardarlo. Revisa que coincidan y vuelve a desplegar.
- **El bot no responde** → 1) ¿Suscribiste el campo **`messages`** en Webhook fields? 2) ¿El teléfono está en la lista de destinatarios verificados (modo prueba)? 3) Revisa que el token no sea el temporal de 24 h — usa el del System User.
- **Respondía y dejó de responder al día siguiente** → Probablemente usaste el **access token temporal** (dura 24 h). Cámbialo por el **token de System User** permanente (Paso 4).
- **"No me deja escribirle a un cliente nuevo"** → En modo prueba solo puedes hablar con números verificados. Para cualquier cliente necesitas número real + negocio verificado (sección de producción).
- **No entiende audios/imágenes** → El proxy de media necesita el `WHATSAPP_APP_SECRET` (o `META_APP_SECRET`) configurado para firmar las URLs. Verifica que uno de los dos esté guardado.
