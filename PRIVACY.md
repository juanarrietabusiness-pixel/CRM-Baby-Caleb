# Privacidad y datos — Juancito Ads

Juancito Ads es software **self-hosted**: se instala en **tu propia cuenta de Cloudflare**, con **tus propias llaves**. Ni Juancito Ads ni ninguna otra persona recibe, ve o guarda las conversaciones de tus clientes.

Este documento explica **qué datos maneja el bot, dónde viven y qué te toca hacer a ti** como dueño del negocio que lo instala.

---

## 1. Juancito Ads no llama a casa

El bot **no envía telemetría, analíticas ni datos de uso a nadie**. No hay ping de activación, ni contador de instalaciones, ni reporte de errores remoto. Puedes verificarlo tú mismo: busca en `src/` cualquier `fetch` a un dominio y verás que solo aparecen los servicios que **tú** conectas (Twilio, Meta, Telegram, ManyChat, Cal.com) y el proveedor de IA que elegiste.

Existe una API opcional en `/api/*` para conectar el bot a un panel externo. Está **apagada por defecto**: solo responde si tú configuras el secreto `CONTROL_PLANE_TOKEN`, y aun activada devuelve **únicamente números agregados** (cuántos leads, cuántos mensajes, cuántas conversaciones) más la versión del bot. Nunca el contenido de una conversación ni datos de una persona.

## 2. Qué datos guarda el bot (en TU base de datos)

Todo vive en **tu** D1 y **tu** Vectorize, dentro de tu cuenta de Cloudflare:

| Dato | Dónde | Cuánto tiempo |
|---|---|---|
| Mensajes de la conversación | tabla `messages` | **90 días**, se borran solos (cron diario) |
| Conversación (canal + id del usuario en ese canal) | `conversations` | mientras exista la conversación |
| Leads capturados (nombre, contacto, notas) | `leads` | hasta que tú los borres |
| Tickets (resumen + transcripción del caso) | `tickets` | hasta que tú los borres |
| Datos que el bot deduce del cliente | `customer_facts` | hasta que tú los borres |
| Resúmenes y etiquetas de la conversación | `conversation_insights`, `conv_labels` | hasta que tú los borres |
| Clics en links del bot (solo el contador) | `tracked_links` | sin IP ni navegador |

El bot **no guarda audios ni imágenes**: los transcribe o los describe al vuelo y conserva solo el texto resultante.

## 3. A dónde sale la información

Para poder responder, el texto de la conversación se envía al **proveedor de IA que tú elegiste** (Anthropic, OpenAI o xAI) con **tu** llave. Ese proveedor procesa el mensaje bajo *sus* términos: revísalos y, si tu giro maneja datos sensibles (salud, finanzas, menores), confirma que su política te sirve.

Las notas de voz se transcriben con **Workers AI**, que corre dentro de tu propia cuenta de Cloudflare.

Además, el mensaje pasa por el canal que conectaste (WhatsApp/Twilio, Instagram y Messenger/Meta, Telegram o ManyChat), cada uno con su propia política.

## 4. Lo que te toca a ti (importante)

Cuando instalas Juancito Ads, **tú eres el responsable** de los datos personales de tus clientes; Juancito Ads es solo la herramienta. Con eso en mente:

- **Avisa que hay un bot.** Di en tu perfil, en tu web o en el primer mensaje que la atención es automatizada con IA. Si un cliente pregunta si habla con una máquina, el bot lo admite (así viene configurado) — no lo cambies para que lo niegue.
- **Avisa que guardas la conversación.** Una línea en tu aviso de privacidad basta: qué guardas, para qué, y por cuánto tiempo.
- **Atiende las solicitudes de borrado.** Si un cliente pide que borres sus datos, hazlo: puedes borrar su conversación, su lead y sus tickets desde el panel (`/admin`) o directamente con `wrangler d1 execute`.
- **Cuida el acceso al panel.** `/admin` guarda las conversaciones de tus clientes: usa una contraseña fuerte en `DASHBOARD_PASSWORD` y no dejes `DASHBOARD_PUBLIC="1"`.
- **No metas datos sensibles a la base de conocimiento.** Lo que subes ahí lo puede citar el bot en un chat.
- **Revisa las leyes de tu país.** En México aplica la LFPDPPP (aviso de privacidad y derechos ARCO); en la Unión Europea, el RGPD; en otros países, lo suyo.

## 5. La API de métricas (opcional, apagada por defecto)

El bot expone `/api/*` con conteos agregados (cuántas conversaciones, cuántos leads):
**números, nunca conversaciones**. Está **cerrada** salvo que tú configures el secreto
`CONTROL_PLANE_TOKEN`, y sirve para que tú conectes tus propios tableros si algún día
quieres. No hay ningún servicio externo al que se reporte: Juancito Ads no opera servidores.

---

Juancito Ads se entrega **tal cual**, bajo licencia MIT y sin garantías (ver [LICENSE](./LICENSE)). El cumplimiento legal de tu operación es responsabilidad tuya.

¿Encontraste algo que en tu opinión maneja datos de forma indebida? Abre un issue — se toma en serio.
