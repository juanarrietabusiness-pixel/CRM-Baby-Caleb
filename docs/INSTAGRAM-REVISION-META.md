# Instagram: por qué el calendario funciona sin revisión y el bot no

## Dónde estamos

Los DMs de Instagram **ya entran al bot y el bot responde**, pero solo los de
cuentas con rol en la app. Los de terceros no llegan.

El diagnóstico técnico está cerrado: webhooks, Página suscrita, cuenta vinculada
y token están bien. El límite es el **nivel de acceso** de
`instagram_manage_messages`, que está en acceso estándar:

> *Standard Access — Webhooks will only be sent if the person using your app has
> a role on the app.*
> *Advanced Access — Webhooks will be sent when any person uses your app.*

Es exactamente el comportamiento observado.

## La diferencia real con el calendario: webhook vs. preguntar

En el calendario **no se hizo ninguna revisión de Meta**, y funciona con los
mensajes de todo el mundo. La razón no es un permiso distinto — es que **no usa
webhooks para leer los DMs**.

Su Bandeja los **pregunta** (`worker/lib/bandeja/graph.js`):

```
GET /{page-id}/conversations
     ?platform=instagram
     &fields=id,updated_time,participants,messages.limit(N){id,message,from,to,created_time}
```

Con el token de la Página. Y ahí está la clave: eso lee **las conversaciones de
tu propia cuenta**, que son datos tuyos, autorizados por ti al conectar la app.
No importa quién escribió — no hay regla de rol en esa lectura. Su `DEPLOY.md`
lo confirma: *"Sin el webhook … la Bandeja funciona igual con el botón
Actualizar, que lee los últimos comentarios de las publicaciones recientes y las
últimas conversaciones."*

El bot del CRM, en cambio, depende **enteramente** del webhook, y el webhook con
acceso estándar sí está limitado por el rol de **quien envía** el mensaje.

| | Calendario (Bandeja) | Bot del CRM (hoy) |
|---|---|---|
| Cómo se enteran | Pregunta cada tanto (`/conversations`) | Espera el webhook |
| Permiso que manda | El que dio el dueño de la cuenta | El rol de quien envía |
| Funciona con terceros sin revisión | **Sí** | **No** |
| Qué tan rápido | Cuando se consulta | Al instante |

Misma ruta (`graph.facebook.com`, Facebook Login), mismos permisos, mecanismo
distinto. Eso es todo lo que había.

## La salida que esto abre: que el bot también pregunte

El bot puede leer las conversaciones igual que la Bandeja: un cron que consulta
`/{page-id}/conversations?platform=instagram`, detecta los mensajes nuevos y los
mete al agente por el mismo camino que ya usa el webhook.

**Sin revisión de Meta, sin video, sin verificación del negocio.** Y es todo
dentro de este repositorio.

Lo que cuesta, dicho honestamente:

- **Demora.** El cron de Cloudflare va por minuto, así que la respuesta llega
  hasta ~1 minuto después, no al instante. Para soporte es aceptable; no es
  igual que el webhook.
- **Hay que evitar duplicados.** Guardar una marca de agua (último mensaje visto)
  para no reprocesar ni contestar dos veces, y para no chocar con los DMs que sí
  llegan por webhook.
- **La ventana de 24 h sigue siendo de Meta.** Pasado ese plazo desde el último
  mensaje de la persona, Meta no deja responder. Eso no lo cambia ningún
  mecanismo.
- **Primero hay que comprobarlo, no asumirlo.** El paso 1 es un botón en el panel
  que haga esa consulta con el token guardado y muestre cuántas conversaciones
  devuelve y de quién. Si ahí aparecen terceros, el camino está confirmado; si
  no, se cae y volvemos a la revisión.

## Las otras salidas

### Pasar la revisión de Meta
Da entrega instantánea por webhook, que es lo ideal. Cuesta semanas: verificación
del negocio *Baby Kaleb*, video del flujo y descripción del caso de uso. Se pide
con "Añadir a la revisión de la aplicación" para `instagram_manage_messages` y
`pages_messaging`, mencionando `business_management` como dependencia.

Ventaja del momento actual: con tus cuentas el flujo completo ya funciona (DM
entra, bot responde, se ve en el panel), que es justo lo que el revisor necesita
poder reproducir. El video se graba hoy.

### Rol de Evaluador
Atajo para pocas personas conocidas mientras se tramita lo demás. No escala a
clientela real.

### Puente desde el calendario
La app del calendario ya recibe esos DMs; se le podría agregar un reenvío al
webhook del bot. Funciona, pero acopla los dos sistemas: si el calendario se
cae, el bot deja de recibir. Comparado con que el bot pregunte por su cuenta,
tiene más partes y más dueños. No lo recomiendo.

## Lo que corrijo de lo que dije antes

- Dije que había "posibilidad real de que el acceso estándar alcance" porque Meta
  dice que basta para las cuentas que uno maneja. Tu prueba lo refutó: para el
  webhook, el rol lo necesita **quien envía**, no el dueño de la cuenta.
- Dije que el calendario también había pasado por la revisión, apoyado en su
  `DEPLOY.md`, que describe ese trámite. Me dijiste que nunca se hizo, y el
  código le da la razón a tu memoria: la Bandeja lee por API, y ese camino no
  pide revisión. La guía describe la revisión como lo que haría falta para los
  webhooks, no como algo que se hizo.

## Fuentes

- [Webhooks for Instagram Messaging — niveles de acceso](https://developers.facebook.com/docs/instagram-messaging/webhooks)
- [Instagram Platform — Overview](https://developers.facebook.com/docs/instagram-platform/overview/)
- `worker/lib/bandeja/graph.js` y `DEPLOY.md` del repo
  `CALENDARIOS-MARKETING-APP`.
