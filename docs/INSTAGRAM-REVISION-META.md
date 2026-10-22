# Instagram: por qué hay que pasar la revisión de Meta

## Dónde estamos

Los DMs de Instagram **ya entran al bot y el bot responde**, pero solo los de
cuentas con rol en la app (las tuyas). Los de otras personas no llegan.

Eso cierra el diagnóstico técnico: webhooks, Página suscrita, cuenta vinculada
y token están bien. Lo único que queda es el **nivel de acceso** del permiso
`instagram_manage_messages`, que está en acceso estándar.

> Documentación de Meta:
> *Standard Access — Webhooks will only be sent if the person using your app has
> a role on the app.*
> *Advanced Access — Webhooks will be sent when any person uses your app.*

Es exactamente el comportamiento observado. No es un error de configuración: es
el límite del nivel de acceso.

## "¿Y por qué en el calendario no tuve este problema?"

**Sí lo tuviste.** Está documentado en el `DEPLOY.md` del propio repo
`CALENDARIOS-MARKETING-APP`, en la sección *"La bandeja: comentarios y
mensajes"*:

> **"Esto sí pasa por la revisión de Meta (App Review)."** Los permisos que usa
> no van en «Conectar con Facebook» —lo romperían mientras la app no los tenga
> aprobados— y se piden aparte con el botón «Conceder permisos de comentarios y
> mensajes».
>
> "Hasta que Meta los apruebe funcionan con las personas que tienen un rol en la
> app (modo de desarrollo / acceso estándar), **que es lo que hay que usar para
> grabar el video que pide la revisión**."

Y la tabla de permisos de esa guía es la misma que necesita el CRM:
`pages_manage_metadata`, `pages_manage_engagement`, `pages_messaging`,
`instagram_manage_messages`, `instagram_manage_comments`.

Verifiqué además el código del calendario: usa **la misma ruta** que el CRM
(`graph.facebook.com`, Facebook Login, `instagram_basic` +
`instagram_manage_*`). No hay un atajo que el calendario conociera y el CRM no.

### Entonces la diferencia es otra

1. **Los permisos son por app, no por negocio ni por cuenta.** Aunque ya hayas
   pasado la revisión para la app del Calendario, la app **Baby Cale CRM** es
   otra app: empieza de cero.
2. **La revisión del calendario ya está hecha** (meses atrás), así que hoy ahí
   todo "simplemente funciona". El CRM está en el punto donde estaba el
   calendario antes de esa revisión.
3. **Puede que haya que verificar el negocio otra vez.** La app del Calendario
   pertenece al negocio *Juancito Ads*; Baby Cale CRM pertenece a *Baby Kaleb*.
   La verificación del negocio es por portafolio, no por app.

Así que Claude en Chrome tiene razón: el video es real y no hay forma de
esquivarlo por la vía oficial. La buena noticia es que **ya lo hiciste una vez**
y el caso de uso es el mismo, así que el texto y el video se parecen mucho a los
que ya se aprobaron.

## Las tres salidas, con su costo real

### A. Pasar la revisión (la solución de verdad)
Es lo único que hace llegar los DMs de clientes reales por la vía oficial.

Lo que ayuda: **el estado actual es justo el que sirve para grabar el video**.
Con acceso estándar, los DMs de tus cuentas sí entran y el bot responde — eso es
el flujo completo funcionando, que es lo que el revisor tiene que poder ver y
reproducir.

Checklist:

1. **Verificación del negocio Baby Kaleb** en Business Manager (si no está).
   Suele ser el paso más lento: pide documentos del negocio.
2. **Grabar el video** con una cuenta que tenga rol: un DM real a
   @babycalebpanama, la respuesta del bot, y el mensaje visible en
   `/admin/conversaciones`. Que se vea el flujo de punta a punta.
3. **Describir el caso de uso**: un negocio que atiende sus propios DMs de
   Instagram con un asistente automático; los mensajes se leen para responder y
   se muestran en el panel del dueño.
4. **Pedir los permisos** con "Añadir a la revisión de la aplicación":
   `instagram_manage_messages` y `pages_messaging`. Mencionar
   `business_management` como dependencia — Meta lo pide explícitamente.
5. Enviar y esperar. Los tiempos no están garantizados por Meta (suele ser días
   a semanas).

### B. Atajo: dar rol de Evaluador (días, no semanas)
Sirve para **pocas personas conocidas**, no para clientes. Cada persona necesita
una cuenta de Facebook, aceptar la invitación, y según Meta también rol en la
cuenta profesional de Instagram. No escala a clientela real, pero sirve para
seguir probando mientras se tramita A.

### C. Puente desde el calendario (sin revisión, con trabajo)
La app del Calendario **ya tiene los permisos aprobados** y ya recibe todos los
DMs de Instagram en su Bandeja. Se le podría agregar un reenvío al webhook del
bot, y el CRM funcionaría hoy con clientes reales, sin esperar a Meta.

Costo honesto: es modificar la otra aplicación (otro repo), firmar y validar ese
reenvío, y dejar los dos sistemas acoplados — si el calendario se cae, el bot
deja de recibir. Es una solución puente legítima, no un parche sucio, pero hay
que quererla.

> Nota: el acceso de esta sesión a ese repo es de solo lectura. Para hacer C
> habría que darle permiso de escritura.

## Lo que corrijo de lo que dije antes

Dije que había "posibilidad real de que el acceso estándar alcance", apoyado en
que Meta dice que basta para las cuentas que uno maneja. Tu prueba lo refutó: la
cuenta es tuya y aun así los DMs de terceros no llegan. Para el **Messenger API
con Instagram**, lo que manda es la regla del webhook — el rol lo necesita quien
**envía** el mensaje, no el dueño de la cuenta. Esa es la regla que aplica.

## Fuentes

- [Webhooks for Instagram Messaging — niveles de acceso](https://developers.facebook.com/docs/instagram-messaging/webhooks)
- [Instagram Platform — Overview](https://developers.facebook.com/docs/instagram-platform/overview/)
- `DEPLOY.md` del repo `CALENDARIOS-MARKETING-APP`, sección "La bandeja:
  comentarios y mensajes".
