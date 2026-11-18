# Instagram: la causa real es el permiso dentro del token

## Lo que se probó (22 oct 2026)

Prueba hecha a mano, con una cuenta de **una persona sin rol en la app**: esa
persona mandó un DM de Instagram a una cuenta del calendario, el mensaje
**apareció solo en la Bandeja a los ~30 segundos, sin pulsar "Actualizar"**, y
se pudo responder desde ahí.

Eso llegó por **webhook**. Comprobado en el código del calendario:

- Su cron de cada minuto publica cola, métricas, informes y Estudio —
  `worker/index.js`, `scheduled()`. **No lee la Bandeja.**
- La pantalla solo consulta a Meta con el botón (`onClick` en
  `src/pages/Bandeja.jsx`). El único `setInterval` es un reloj que refresca las
  horas relativas.

Nada preguntó a Meta en esos 30 segundos.

## Qué significa

El webhook del calendario **sí entrega DMs de terceros**, con:

| | Calendario |
|---|---|
| `instagram_manage_messages` | "Listo para prueba" (acceso estándar) |
| Revisión de la app | Ninguna |
| Negocio verificado | No |

O sea que la regla que parecía bloquearnos —*"con acceso estándar el webhook
solo se manda si quien usa la app tiene rol"*— no es lo que frena al CRM. Si lo
fuera, el calendario tampoco recibiría nada, y recibe.

**Entonces lo que falta en el CRM es el permiso otorgado, no el nivel de
acceso.**

## La causa, y por qué encaja con todo

Meta exige que `instagram_manage_messages` **viaje dentro del Page Access
Token**, además de tener el webhook suscrito al tema Instagram.

Y en la app Baby Cale CRM, la pantalla de tokens muestra **"—" en las 12
Páginas**: nunca se generó un token con esos permisos. El bot está funcionando
con un token que no los lleva.

Eso explica el síntoma exacto, sin forzar nada:

- **Sin el permiso otorgado**, Meta entrega solo lo que el acceso estándar
  permite de todos modos: los DMs de quien tiene rol en la app. ← el CRM hoy.
- **Con el permiso otorgado**, entrega los DMs de cualquiera. ← el calendario.

El calendario consiguió ese otorgamiento con su botón **"Conceder permisos de
comentarios y mensajes"**, que pide exactamente `pages_manage_metadata`,
`pages_manage_engagement`, `pages_messaging` e `instagram_manage_messages`. Está
en su propio `DEPLOY.md`.

## Lo que hay que hacer (y lo que ya NO hace falta)

### Hacer
1. **Generar el Page Access Token** de la Página Baby Caleb en la app Baby Cale
   CRM, otorgando `instagram_basic`, `instagram_manage_messages`,
   `pages_messaging` y `pages_manage_metadata`.
2. **Guardarlo** como `META_PAGE_ACCESS_TOKEN` (panel de Cloudflare → Workers →
   `juancitoads-bot` → Settings → Variables and Secrets, o
   `wrangler secret put`).
3. **Comprobar** con el botón "Probar lectura de DMs" de
   `/admin/conexiones` → tarjeta Instagram DMs (Meta). Si el token lleva el
   permiso, esa consulta funciona; si no, lo dice con el nombre del permiso que
   falta.
4. **Probar** con un DM desde una cuenta sin rol.

### Ya no hace falta
- ❌ **El cron que pregunta.** Si el webhook entrega, no hay que construirlo.
  Queda como red de seguridad opcional, no como solución.
- ❌ **La revisión de Meta y el video.** El calendario recibe DMs de terceros
  sin revisión aprobada.
- ❌ **La verificación del negocio.** Ninguno de los dos negocios está
  verificado, y el calendario funciona igual.
- ❌ **El puente desde el calendario.**

## Honestidad sobre esto

Que la causa sea el permiso del token es una **inferencia fuerte**, no una
certeza: encaja con todo lo observado y con lo que exige la documentación, pero
no está comprobada hasta que el token nuevo esté puesto. Lo que **sí** es
certeza, por la prueba de hoy, es que el acceso estándar sin revisión **no
impide** recibir DMs de terceros por webhook.

Si con el token nuevo sigue sin llegar, el siguiente sospechoso es la
suscripción de la Página: el calendario la hace por API
(`/{page-id}/subscribed_apps` con `feed,messages`) al encender la bandeja,
mientras que en el CRM se hizo a mano desde el panel de Meta.

## Lo que corrijo

Dije que el camino era hacer que el bot **preguntara** como la Bandeja, porque
creía que la Bandeja se enteraba preguntando. El código dice que se entera por
webhook. La diferencia entre los dos sistemas nunca fue el mecanismo: es el
permiso que lleva el token.

## Fuentes

- [Webhooks for Instagram Messaging](https://developers.facebook.com/docs/instagram-messaging/webhooks)
- [Instagram Messaging with the Messenger Platform](https://developers.facebook.com/docs/messenger-platform/instagram)
- `worker/index.js`, `src/pages/Bandeja.jsx` y `DEPLOY.md` del repo
  `CALENDARIOS-MARKETING-APP`.
