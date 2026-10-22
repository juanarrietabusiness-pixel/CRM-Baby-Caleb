# Instagram en el CRM: estado real y qué falta

## Lo que ya está bien (revisado el 22 oct 2026)

La app **Baby Cale CRM** (`2099638607582456`) ya está conectada al bot:

- Objeto **Page**: Callback URL del bot, verify token guardado, campos
  `messages` y `messaging_postbacks` suscritos.
- Objeto **Instagram**: la misma URL del bot, `messages` y
  `messaging_postbacks` suscritos.
- De las 12 Páginas conectadas a la app, **Baby Caleb** es la única suscrita.
  Por eso Messenger sí llega.

Así que el webhook, el verify token y el `META_APP_SECRET` están correctos: si
no lo estuvieran, Messenger tampoco llegaría.

La app del Calendario (`2501027797085987`) apunta a su propio worker y recibe
los DMs de Instagram en su Bandeja. **No se toca.** Que ahí lleguen los DMs
prueba que el permiso de *Herramientas conectadas* de la cuenta de Instagram
está activo — eso es por cuenta, no por app, así que ya no hay que revisarlo.

## Las dos cosas que faltan

### 1. La cuenta de Instagram no está conectada a esta app

En *Casos de uso → Instagram → Configuración de la API con inicio de sesión de
Instagram*, el paso 2 solo muestra "Añadir cuenta": no hay ninguna cuenta
conectada. Sin cuenta conectada, Meta no tiene a quién asociarle los DMs,
aunque la suscripción exista.

Hay **dos caminos** y conviene elegir a conciencia:

| | **IG vía Página** (recomendado) | **IG Login standalone** |
|---|---|---|
| Qué se hace | Vincular la cuenta de IG Business a la Página de Facebook "Baby Caleb" | Conectar la cuenta en el producto Instagram Login |
| Secrets nuevos en el bot | **Ninguno** — usa los que ya funcionan | `INSTAGRAM_APP_SECRET` y `INSTAGRAM_ACCESS_TOKEN` |
| App Secret que firma | El de la app principal (ya guardado) | El de la app de Instagram (`1037214789354494`), distinto |
| Cuándo usarlo | La cuenta de IG es del negocio y hay Página | No hay Página de Facebook |

Como la Página **Baby Caleb** existe y ya está suscrita, el camino de la Página
es el que menos piezas mueve: no hay que guardar ni un secret nuevo y la
sección 3 de Instagram Login se queda vacía a propósito.

### 2. Los permisos están en "Listo para prueba" (acceso estándar)

`instagram_basic`, `instagram_manage_messages`, `pages_messaging` y
`pages_manage_metadata` están en acceso estándar. Con acceso estándar, Meta
entrega los DMs **solo de cuentas que tengan rol en la app** (administrador,
desarrollador o tester). Los de clientes reales no llegan.

Para producción hay que pedir **acceso avanzado** a `instagram_manage_messages`
en la revisión de la app. Mientras eso se tramita, se puede probar todo
agregando tu propia cuenta como tester.

> Ojo: esto también significa que, si alguna vez probaste con tu cuenta
> personal y no llegó nada, el acceso estándar pudo ser la causa, no la
> configuración.

## La prueba del botón "Test"

Meta dijo "test realizado correctamente", pero no muestra qué respondió el
servidor. Esa respuesta ahora se puede ver desde el panel del bot: la tarjeta
**Instagram DMs (Meta)** de `/admin/conexiones` dice qué pasó con el último
evento recibido:

- **"Nunca ha llegado un evento por este canal"** → Meta no entregó nada.
- **"RECHAZADO por firma inválida"** → el `META_APP_SECRET` guardado no es el de
  la app que firma (pasaría si se conecta por IG Login sin guardar
  `INSTAGRAM_APP_SECRET`).
- **"IGNORADO por configuración"** → hay una bandera apagando Instagram
  (`IG_OFFICIAL` o `IG_DM_SOURCE` en `wrangler.toml`).
- **"procesado"** → entró. Si el cliente no recibe respuesta, el problema es de
  envío y no de recepción.

Hay que desplegar esta versión antes de que el panel lo muestre.

---

## Instrucciones para Claude en Chrome

Camino de la Página (el recomendado). Copia y pega:

```
Seguimos con la app de Meta "Baby Cale CRM" (ID 2099638607582456). Ya verifiqué
que sus webhooks apuntan bien a mi bot en los objetos Page e Instagram, así que
NO toques los webhooks ni la Callback URL ni el verify token. Tampoco toques la
app "Juancito Ads - Calendario" (2501027797085987).

Vamos por el camino de vincular Instagram a la Página de Facebook, no por
Instagram Login. Por lo tanto NO conectes nada en "Configuración de la API con
inicio de sesión de Instagram" y deja su sección 3 de webhooks vacía.

1. Abre la configuración de la Página de Facebook "Baby Caleb" (en
   business.facebook.com o en la propia Página → Configuración → Cuentas
   vinculadas → Instagram). Dime si hay una cuenta de Instagram vinculada a
   esa Página y, si la hay, cuál es su usuario (@).

2. Si NO hay cuenta vinculada: dime exactamente qué botón aparece y detente.
   Vincularla pide iniciar sesión en Instagram, así que eso lo hago yo.

3. Vuelve a la app Baby Cale CRM → Casos de uso → Messenger (o Instagram) →
   la sección de Páginas/cuentas conectadas. Dime si ahora aparece la cuenta de
   Instagram asociada a la Página Baby Caleb y si está suscrita.

4. Ve a la revisión de permisos de esta app y dime, para
   instagram_manage_messages, qué pide Meta exactamente para darme acceso
   avanzado: qué pasos lista, si exige verificación del negocio y si hay un
   botón para solicitarlo. No lo solicites todavía: solo dime qué pide.

5. Dime si en esta app hay una sección de Roles / Funciones donde se agreguen
   testers, y qué pide para agregar una cuenta de Instagram como tester.

Reglas: no pegues tokens, App Secrets ni verify tokens en el chat; no cambies
el modo de la app; no envíes solicitudes de revisión a Meta sin preguntarme; y
si algo pide una contraseña o un inicio de sesión, detente y dímelo.
```

## Sobre las 4 cosas que pidió Claude en Chrome

1. **Verify token para Instagram Login** → no hace falta: por el camino de la
   Página, esa sección se queda vacía.
2. **Añadir la cuenta en Instagram Login** → tampoco; lo que toca es vincular
   la cuenta de Instagram a la Página de Facebook.
3. **La clave secreta de la app de Instagram** → no se necesita por este
   camino. El bot sigue con el `META_APP_SECRET` que ya le funciona a Messenger.
4. **La Página para el token** → sí, **Baby Caleb**. Es la única suscrita de las
   12 y es el nombre del negocio en la configuración del bot. Tampoco hay que
   generar un token nuevo: si Messenger ya responde, el
   `META_PAGE_ACCESS_TOKEN` guardado sirve igual para los DMs de Instagram por
   este camino.

## Cómo desplegar esta versión

El deploy sale de GitHub: haz merge de la rama a `main`, o en la pestaña
**Actions** del repositorio corre el workflow **Deploy** eligiendo la rama
`claude/brave-dirac-weyiy4`.
