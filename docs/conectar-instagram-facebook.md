# Conectar Instagram y Facebook (Messenger) para que el bot responda

Esta guía es para el dueño del bot. **No hace falta abrir una terminal**: todo se
hace en el navegador, en tres sitios: **Meta for Developers**, **Meta Business
Suite** y el **panel de Cloudflare**.

Una sola app de Meta y una sola dirección sirven para los dos canales: los
mensajes directos de **Instagram** y los de **Facebook Messenger** de la Página.

> **Lo que este canal NO hace (todavía).** Si usted contesta desde la app de
> Instagram, de Facebook o desde Meta Business Suite, **el bot no se calla** en
> esa conversación (en WhatsApp por QR sí se calla). Mientras eso no cambie,
> conteste desde el panel (`/admin` → Conversaciones) o desde Telegram, que sí lo
> callan. Tampoco contesta comentarios: solo mensajes directos.

---

## Lo que tiene que estar listo antes (10 minutos)

1. **La Página de Facebook de Baby Caleb**, con usted como administradora.
2. **El Instagram @babycalebpanama como cuenta de empresa** (o de creador) y
   **vinculado a la Página**: Meta Business Suite → Configuración → Cuentas →
   Cuentas de Instagram → Conectar.
3. **Permitir el acceso a los mensajes** en el Instagram, desde el teléfono:
   Instagram → Configuración y privacidad → Mensajes y respuestas a historias →
   Herramientas conectadas → **Permitir el acceso a los mensajes** (encendido).
   Sin esto, Instagram no le entrega los mensajes a ninguna app.
4. Entrar a **developers.facebook.com** con el mismo Facebook que administra la
   Página (es gratis; la primera vez pide aceptar los términos).

## Cómo se guarda un "secreto" en Cloudflare

Lo va a hacer tres veces, así que aquí va una sola vez:

1. Entre a **dash.cloudflare.com** → **Workers y Pages** → **juancitoads-bot**.
2. **Configuración** → **Variables y secretos** → **+ Agregar**.
3. Tipo: **Secreto**. Nombre: el que diga el paso (copiado exacto, en mayúsculas).
   Valor: lo que copió de Meta.
4. **Implementar** (o Guardar). Queda activo al momento.

Los secretos **no se borran** cuando GitHub vuelve a desplegar el bot. Y nunca se
pegan en un chat, en un correo ni en GitHub.

---

## Paso 1 · Inventar la clave de verificación

Es una palabra secreta que **usted inventa** y que Meta usa una sola vez para
comprobar que la dirección del bot es suya. Por ejemplo `babycaleb-` seguido de
letras y números al azar, sin espacios ni tildes.

Guárdela en Cloudflare como **`META_VERIFY_TOKEN`**. Anótela aparte: la va a
pegar también en Meta en el paso 5. **Tiene que ser idéntica en los dos lados.**

## Paso 2 · Crear la app de Meta

1. **developers.facebook.com/apps** → **Crear app**.
2. Nombre: por ejemplo "Bot Baby Caleb". Correo: el suyo.
3. Casos de uso: elija **Interactuar con clientes en Messenger** y **Administrar
   mensajes y contenido en Instagram**. (Si le pide un tipo de app, **Negocio**.)
4. Portafolio comercial: **el de Baby Caleb**.
5. Crear.

## Paso 3 · La clave secreta de la app

En la app: **Configuración de la app → Básica → Clave secreta de la app →
Mostrar**. Cópiela y guárdela en Cloudflare como **`META_APP_SECRET`**.

Con ella el bot comprueba que cada mensaje viene de verdad de Meta. Si falta o
está mal, los mensajes llegan y el bot no contesta.

## Paso 4 · El token de la Página

1. En la app: **Messenger → Configuración de la API de Messenger**.
2. En **Generar tokens de acceso**: **Conectar** → elija la Página Baby Caleb y
   acepte los permisos que pide (incluidos los de Instagram).
3. Junto a la Página: **Generar** → copie el token (empieza con `EAA`).
4. Guárdelo en Cloudflare como **`META_PAGE_ACCESS_TOKEN`**.

**Compruebe que no vence:** pegue el token en
**developers.facebook.com/tools/debug/accesstoken** → Depurar. Debe decir
*Caduca: Nunca*. Si dice una fecha, avíseme antes de seguir: hay que sacarlo de
otra forma (un "usuario del sistema"), o el bot dejará de responder ese día.

Con la cuenta de Instagram vinculada a la Página, **este mismo token sirve para
Instagram**. No hace falta otro.

## Paso 5 · Decirle a Meta a dónde mandar los mensajes

1. En **Messenger → Configuración de la API de Messenger → Configurar webhooks**:
   - URL de devolución de llamada:
     `https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta`
   - Token de verificación: **la clave del paso 1**.
   - **Verificar y guardar.** Si sale error, la clave no es idéntica a la de
     Cloudflare (revise espacios al copiar).
2. Junto a la Página, **Agregar suscripciones** → marque **messages** y
   **messaging_postbacks** → Guardar.
3. Ahora **Instagram → Configuración de la API** (con inicio de sesión de
   Facebook) → **Webhooks**: la MISMA dirección y la MISMA clave → Verificar y
   guardar → suscriba **messages** y **messaging_postbacks**.

## Paso 6 · Comprobar que está conectado

1. Abra el panel del bot: **/admin → Conexiones**. La tarjeta **Instagram +
   Messenger (Meta)** tiene que estar **en verde**. Si dice que falta algo, es el
   nombre de un secreto mal escrito.
2. La app todavía está en **modo de desarrollo**: solo le contesta a personas con
   un papel en la app. En la app: **Roles de la app → Roles → Agregar personas**
   → agregue como *evaluador* la cuenta de Facebook o Instagram con la que va a
   probar (no la de la Página).
3. Desde esa cuenta, escríbale a la Página por Messenger y a @babycalebpanama por
   Instagram. El bot debe contestar en unos 15 segundos (espera a que la clienta
   termine de escribir), y la conversación aparece en **/admin → Conversaciones**.

## Paso 7 · Abrirlo a todas las clientas (la parte lenta)

En modo de desarrollo **las clientas reales no reciben respuesta**. Para que sí:

1. **Verificar el negocio** en Meta Business Suite → Configuración → Centro de
   seguridad → Verificación del negocio (piden documentos de la empresa; tarda
   unos días).
2. En la app: **Revisión de la app → Permisos y funciones**: pida **acceso
   avanzado** para `pages_messaging`, `instagram_manage_messages`,
   `instagram_basic` y `pages_manage_metadata`. Meta pide explicar para qué es
   ("atención automática a clientes en Messenger e Instagram") y un video corto
   del bot contestando (el del paso 6 sirve).
3. Una política de privacidad en una dirección pública (puede ser una página de
   babycaleb.netlify.app) y ponerla en Configuración → Básica.
4. Cuando Meta apruebe: arriba en la app, cambie el modo a **Activo (Live)**.

## Paso 8 · Que no conteste dos veces

- En **Meta Business Suite → Bandeja de entrada → Automatizaciones**, apague la
  *respuesta instantánea*, el *mensaje de ausencia* y las *preguntas frecuentes*:
  si no, a la clienta le llegan dos respuestas, la de Meta y la del bot.
- Si hoy Instagram está conectado a **ManyChat**, avíseme antes del paso 5: hay
  que decidir por cuál entra Instagram, o cada mensaje se contesta dos veces.

---

## Lo que conviene saber

- **La ventana de 24 horas.** Meta solo deja escribirle a una clienta dentro de
  las 24 horas desde su último mensaje. Por eso, en Instagram y Messenger los
  seguimientos de 3 y 7 días no salen (el bot ya lo sabe y no los intenta).
- **Fotos y comprobantes**: igual que en WhatsApp, no se le muestran al bot; se
  crea un ticket y le llega a usted. Las notas de voz sí se transcriben y se
  contestan.
- **La app de calendarios** tiene su propia app de Meta para la Bandeja de
  comentarios: pueden convivir sin problema. Pero si contesta un mensaje desde
  esa Bandeja, el bot tampoco se calla (es el mismo límite de arriba).

## Si algo falla

| Lo que pasa | Lo más probable |
|---|---|
| Meta no deja guardar el webhook | La clave del paso 1 no es idéntica en Meta y en Cloudflare |
| Llegan mensajes y el bot no contesta | Falta o está mal `META_APP_SECRET` |
| Messenger contesta e Instagram no | El Instagram no está vinculado a la Página, falta "Permitir el acceso a los mensajes" o falta suscribir *messages* en Instagram |
| Le contesta a usted pero no a las clientas | La app sigue en modo de desarrollo (paso 7) |
| Un día dejó de contestar | El token de la Página venció o se cambió la contraseña de Facebook: genere otro (paso 4) |
| Contesta dos veces | Automatizaciones de Business Suite o ManyChat encendidos (paso 8) |
