# La consola del dueño por Telegram

> Para la dueña del negocio. Sin terminal: todo se hace desde el panel y desde
> el teléfono.

El mismo bot de Telegram que atiende clientas es también **su** canal con el
CRM. Por ahí le llegan los avisos —y por ahí usted le contesta, le da órdenes y
maneja el inventario.

## 1. Vincular su Telegram (una sola vez)

Hay dos caminos, los dos sin terminal. **Basta uno**: no hace falta hacer los
dos, ni dejar el panel abierto después.

**A · Con su ID, en Cloudflare**

1. Averigüe su ID: envíele **`/miid`** al bot del negocio (o use cualquier bot
   de ID, como @userinfobot). Es un número.
2. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   `juancitoads-bot` → **Settings → Variables and Secrets → Add**.
3. Tipo **Secret** (no *Text*: las de tipo Text se borran en el siguiente
   despliegue). Nombre: `OWNER_TELEGRAM_CHAT_ID`. Valor: ese número, sin
   espacios. **Deploy**.

Listo. El bot protege solo su consola antes del primer aviso.

**B · Con el enlace del panel**

1. Panel → **Conexiones** → tarjeta **Telegram** → **Vincular mi Telegram**.
2. Abra el enlace en el teléfono donde tiene Telegram y toque **Iniciar**.
3. La tarjeta se pone en verde sola.

El código del panel dura 15 minutos y sirve una sola vez. Si el enlace no abre,
envíele al bot el mensaje que aparece en pantalla (`/dueno 123456`). Si hay de
los dos, manda el de Cloudflare.

El ID **no** va en los secrets de GitHub: el despliegue no lo carga. Un dato,
un solo sitio.

Para comprobarlo (opcional): panel → Conexiones → Telegram → **Enviarme un
aviso de prueba**. En el Resumen, *Salud del bot* debe decir **✓ handoff avisa
por Telegram**.

> Antes esto exigía `wrangler secret put` en una terminal, y por eso el panel
> decía **⚠ HANDOFF SIN AVISO**: el bot creaba tickets y nadie se enteraba.

> Si alguna vez un botón contesta *"Activé la protección… Toque el botón otra
> vez"*, tóquelo otra vez y ya. Pasa solo si el webhook de Telegram se
> re-registró a mano.

## 2. Qué le llega

| Aviso | Cuándo |
|---|---|
| 🚨 **Ticket** | Una clienta pide una persona, quiere pagar, manda un comprobante, reclama… |
| 🛍 **Interesada** | El bot anotó a alguien con intención de compra (nombre, contacto). |
| 💬 **Le escribió** | Usted atiende una conversación desde Telegram y la clienta contestó. |
| ⚠️ **Salud del bot** | El bot está fallando en cadena (rara vez). |

Cada aviso de una conversación trae botones:

- **▶️ Devolver al bot** — el bot retoma la conversación y se cierra el ticket.
- **⏸ Pausar bot** — el bot se calla ahí; la atiende usted.
- **🛒 Registrar venta** — lee la conversación y le **propone** la venta para
  descontar del stock. Usted confirma con un toque.
- **💬 Abrir en el panel**.

**Y se puede responder:** toque *Responder* sobre el aviso, escriba, y su texto
le llega a la clienta por su canal (WhatsApp, Telegram…). El bot queda en pausa
en esa conversación mientras usted la atiende.

## 3. Comandos

| Comando | Qué hace |
|---|---|
| `/pendientes` | Tickets abiertos y conversaciones que atiende una persona, con botón para devolverlas. |
| `/bot #ref` | Devuelve la conversación al bot. La `#ref` sale en `/pendientes`. |
| `/pausar #ref` | Pausa el bot en esa conversación. |
| `/responder #ref texto` | Le escribe a esa clienta. |
| `/stock` · `/stock nateen m` | Stock exacto por bodega. |
| `/venta NAT-M 2` | Descuenta una venta (varias: `NAT-M 2, NAT-S 1`; bodega al final: `oeste`). Trae **↩️ Deshacer**. |
| `/devolucion NAT-L 1` | Pregunta si el producto **vuelve al inventario** — puede llegar abierto. |
| `/ajuste NAT-M +3` · `-1` · `=10` | Corrige el stock. |
| `/movimientos [código]` | Lo último que se movió en el inventario. |
| `/cliente` | Probar el bot como si fuera una clienta. `/dueno` para volver. |
| `/miid` | Su chat id (el número del secret `OWNER_TELEGRAM_CHAT_ID` en Cloudflare). |
| `/ayuda` | Esta lista. |

También puede escribir con sus palabras: *"¿qué tengo pendiente?"*, *"devuélvele
la conversación de Ana al bot"*, *"vendí 2 cajas de la M"*. Un asistente interno
lo entiende. Lo que sale hacia afuera (un mensaje a una clienta) o mueve el
inventario, **siempre** se lo propone con botones: no pasa nada sin su toque.

## 4. El inventario, con cuidado

- Una venta sale de la bodega que tenga stock suficiente (la de más stock), o
  de la que usted nombre. Si no alcanza, **no se descuenta nada** — ni de los
  productos que sí alcanzaban.
- Una devolución siempre pregunta: **✅ vuelve al stock** o **🚫 está
  abierto/dañado** (se anota, pero no se suma).
- Todo queda en la bitácora (`/movimientos`) con quién lo hizo, y se puede
  deshacer.
- El stock sigue viviendo en un solo sitio: el catálogo. Si alguien tiene el
  editor del catálogo abierto mientras usted registra una venta, el editor **no
  pisa** esa venta: avisa y recarga el stock actual.

## 5. Cuando usted contesta, el bot se calla

Da igual por dónde conteste —el panel, el **teléfono del negocio** (WhatsApp por
QR) o Telegram—: el bot se calla en esa conversación. Cuánto tiempo, lo decide
en **Config → Cuando una persona contesta** (1 hora, 4 horas o todo el día).
Cada respuesta suya reinicia el plazo. Para devolverla antes: el botón **▶️
Devolver al bot**, en Telegram o en el panel.
