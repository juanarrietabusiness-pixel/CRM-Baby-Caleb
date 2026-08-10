# Elegir canal y método — el rompecabezas de conexiones

> Esta guía es para TI, el agente que instala el bot (Claude Code / Codex). Úsala
> al inicio de la FASE 3 para ayudar al miembro a **decidir cómo conectar cada
> red**. Presenta las opciones con sus pros y contras, deja que el miembro elija,
> y recién entonces abres la guía específica del método. No decidas por él sin
> explicarle el trade-off — la decisión es del dueño del negocio.

El bot recibe mensajes por **4 puertas** (webhooks ya desplegados en su Worker):
`/webhooks/telegram`, `/webhooks/twilio`, `/webhooks/meta`, `/webhooks/manychat`,
`/webhooks/whatsapp` (WhatsApp Cloud API oficial).
Cada red social se puede conectar por una de estas puertas. Un mismo canal (ej.
Instagram) tiene **más de un método**; tu trabajo es que el miembro elija el que
le conviene.

---

## Mapa rápido: qué red → qué métodos

| Red del cliente | Métodos posibles | Puerta (webhook) | Llaves que pide |
|---|---|---|---|
| **WhatsApp** | Cloud API oficial · Twilio · ManyChat | `/webhooks/whatsapp` · `/webhooks/twilio` · `/webhooks/manychat` | Cloud API: `WHATSAPP_PHONE_NUMBER_ID`+`WHATSAPP_ACCESS_TOKEN`+`WHATSAPP_VERIFY_TOKEN`+`WHATSAPP_APP_SECRET` — Twilio: `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_WA_FROM` — ManyChat: `MANYCHAT_API_KEY` |
| **Instagram DMs** | Meta oficial · ManyChat | `/webhooks/meta` · `/webhooks/manychat` | Meta: `META_PAGE_ACCESS_TOKEN`+`META_VERIFY_TOKEN`+`META_APP_SECRET` — ManyChat: `MANYCHAT_API_KEY` |
| **Facebook Messenger** | Meta oficial · ManyChat | `/webhooks/meta` · `/webhooks/manychat` | igual que Instagram Meta oficial |
| **Telegram** | BotFather (único) | `/webhooks/telegram` | `TELEGRAM_BOT_TOKEN` |

> **Recomendación de arranque para no técnicos:** empezar por **Telegram** (5 min,
> gratis, sin verificaciones) para ver el bot vivo de inmediato, y en paralelo
> conectar la red donde de verdad están sus clientes (casi siempre WhatsApp o
> Instagram).

---

## WhatsApp — Cloud API oficial vs Twilio vs ManyChat

### Opción A · Twilio (la más rápida para arrancar y probar)
- **Pros:** arranca en minutos con el **sandbox** de Twilio (pruebas sin
  verificación de negocio); API estable y bien documentada; el bot ya trae el
  adaptador nativo (`/webhooks/twilio`); soporta plantillas HSM para el aviso de
  handoff al dueño.
- **Contras:** cobra **por mensaje** (precio de Meta + margen de Twilio); para
  producción necesitas un **sender aprobado** (tu número propio o uno de Twilio),
  y esa aprobación de WhatsApp puede tardar horas/días; requiere tarjeta.
- **¿Instalar el Twilio CLI?** *Opcional.* 
  - *Con CLI* (`brew install twilio/brew/twilio` o `npm i -g twilio-cli`): automatizas
    crear el sender y registrar el webhook desde la terminal — útil si el miembro
    quiere que TÚ hagas todo. Pro: menos clicks. Contra: una instalación más.
  - *Sin CLI* (solo dashboard de Twilio, `console.twilio.com`): pegas la URL del
    webhook a mano en la config del sender. Pro: nada que instalar, más visual
    para no técnicos. **Default recomendado: sin CLI** salvo que el miembro pida
    automatizar.
- Guía detallada: `twilio-whatsapp.md`.

### Opción B · ManyChat (WhatsApp visual, sin código)
- **Pros:** todo se arma con clicks en ManyChat; maneja el opt-in y las
  automatizaciones de marketing; un solo `MANYCHAT_API_KEY` para IG/FB/WA.
- **Contras:** **costo mensual** de ManyChat encima del de WhatsApp; dependes de
  su plataforma y de sus límites de plan; menos control fino.
- Requiere `MANYCHAT_CONTENT_TYPE = "whatsapp"`. Guía: `manychat-webhook.md`.

### Opción C · WhatsApp Cloud API oficial (directo con Meta, sin intermediario) — mejor margen
- **Pros:** va **directo a Meta**, sin BSP ni markup de Twilio → **la tarifa más
  barata** (mejor margen para revender). Mismo ecosistema Graph que Messenger/IG.
  El bot ya trae el adaptador nativo (`/webhooks/whatsapp`), maneja notas de voz
  e imágenes (proxy de media firmado), y **no cobramos por conversación**.
- **Contras:** el setup es **más pesado** que Twilio: creas una **WABA** + número,
  haces **verificación de negocio** de Meta (tarda días) y necesitas **plantillas
  aprobadas** para iniciar conversación fuera de la ventana de 24h. Dentro de esa
  ventana, texto libre.
- **Se puede PROBAR gratis, sin nada de eso:** Meta te da un **número de prueba**
  y hasta ~5 destinatarios verificados. Perfecto para dejar el canal funcionando
  antes de meter número real. → **recomienda esta opción para quien va en serio /
  quiere volumen y margen; usa Twilio para arrancar rápido.**
- Guía detallada: `whatsapp-cloud.md`.

---

## Instagram DMs — Meta oficial vs ManyChat

### Opción A · Meta oficial (recomendada si ya maneja su IG)
- **Pros:** **sin costo de terceros** (solo la API de Meta, gratis para DMs);
  control total; un mismo webhook `/webhooks/meta` te sirve para Instagram **y**
  Messenger a la vez.
- **Contras:** setup más largo: necesitas **cuenta de Instagram Business**, una
  **app en developers.facebook.com**, y aceptar permisos; algunos permisos
  avanzados requieren revisión de Meta.
- Guía detallada: `meta-oficial.md`.

### Opción B · ManyChat (Instagram visual)
- **Pros:** setup guiado sin código; ideal si el miembro ya usa ManyChat para
  embudos; maneja historias/comentarios→DM con su UI.
- **Contras:** costo mensual; dependes de ManyChat.
- Guía: `manychat-webhook.md`. (Si el miembro quiere IG **solo** por ManyChat y
  además tiene Meta oficial encendido, se pone `IG_DM_SOURCE = "manychat"` para
  que el webhook oficial no procese los DMs doble.)

---

## Facebook Messenger — Meta oficial vs ManyChat
Mismo trade-off que Instagram. **Meta oficial** (gratis, `/webhooks/meta`, pide
`META_PAGE_ACCESS_TOKEN`) vs **ManyChat** (visual, de pago). Con Meta oficial,
Messenger e Instagram entran por la **misma app y el mismo webhook** — si el
miembro quiere las dos, se configuran juntas en `meta-oficial.md`.

---

## Telegram — método único
BotFather. Gratis, sin verificaciones, ~5 min. Es el mejor "primer canal" para
que el miembro vea el bot funcionando antes de pelear con WhatsApp/Meta. Guía en
el sub-flujo de `configurar-mi-chatbot.md` (Paso 3.1).

---

## CLIs que pueden hacer falta (resumen de instalaciones)
- **Cloudflare `wrangler` (obligatorio):** ya lo instalaste/usaste en la FASE 1
  (crea D1/Vectorize/R2, guarda secrets, despliega). Es EL CLI del proyecto.
- **Twilio CLI (opcional):** solo si eligen WhatsApp por Twilio y quieren
  automatizar sender/webhook. Si no, el dashboard basta.
- **Meta:** no usa CLI — todo se hace en `developers.facebook.com` y
  `business.facebook.com` (dashboard). Las llaves resultantes se guardan con
  `wrangler secret put`.

## Regla de oro para guardar llaves
**Nunca** pegues tokens/keys en el chat. Cada llave se guarda con
`wrangler secret put NOMBRE` (entrada oculta). Después de guardar los secrets de
un canal, corre `wrangler deploy` y pídele al miembro que **recargue
`/admin/conexiones`**: la tarjeta del canal se pone **verde** = quedó.
