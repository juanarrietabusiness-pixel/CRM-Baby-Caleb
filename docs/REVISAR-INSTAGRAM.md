# Instagram en el CRM: estado y plan

## Estado confirmado (22 oct 2026)

Lo que ya está bien en la app **Baby Cale CRM** (`2099638607582456`), que es la
que alimenta al bot:

- La app está **publicada** (requisito para recibir webhooks, independiente de
  la revisión).
- Objeto **Page**: Callback URL del bot, verify token guardado, `messages` y
  `messaging_postbacks` suscritos.
- Objeto **Instagram**: la misma URL del bot, `messages` y `messaging_postbacks`
  suscritos.
- La Página **Baby Caleb** está suscrita (2 campos). Por eso Messenger llega.
- La cuenta **@babycalebpanama** (`17841471553036144`) **sí está vinculada** a la
  Página Baby Caleb. Camino "IG vía Página" confirmado como viable.

La app del Calendario (`2501027797085987`) apunta a su propio worker. No se
toca.

## Las dos cosas que faltan

### 1. El Page Access Token, con el permiso de mensajes de Instagram

En *Messenger → Configuración de Instagram*, las 12 Páginas muestran "Generar
identificador" y **ninguna lo tiene generado ("—")**.

Esto importa más de lo que parece: Meta exige que el **permiso
`instagram_manage_messages` viaje dentro del Page Access Token**, además de
tener los webhooks de Instagram suscritos. Un token emitido antes de vincular
Instagram, o sin ese permiso, no sirve para los DMs — ni para recibirlos ni
para contestarlos.

> Corrección de lo que dije antes: sí hay que generar el token. Si el bot está
> funcionando con un token de System User creado en Business Manager, esa
> pantalla no lo mostraría; pero igual hay que confirmar que ese token lleve
> `instagram_manage_messages`. Lo más simple y seguro es generar el de la Página
> Baby Caleb desde esa pantalla y guardarlo en el bot como
> `META_PAGE_ACCESS_TOKEN`.

Permisos que debe otorgar: `instagram_basic`, `instagram_manage_messages`,
`pages_messaging`, `pages_manage_metadata`. Meta además lista
`business_management` como **dependencia** de `instagram_manage_messages`.

### 2. El nivel de acceso

Los permisos están en "Listo para prueba" = **acceso estándar**. La
documentación de Meta es explícita:

> *Standard Access — Webhooks will only be sent if the person using your app has
> a role on the app.*
> *Advanced Access — Webhooks will be sent when any person uses your app.*

Es decir: con acceso estándar, un DM de un cliente cualquiera **no genera
webhook**. Solo los de cuentas con rol en la app.

La otra cara, también de la documentación de Meta: *"If your app only serves
your Instagram professional account or an account you manage, Standard Access is
all your app needs."* El acceso avanzado se exige cuando la app atiende cuentas
que **no** son tuyas, y pide **App Review + verificación del negocio**.

@babycalebpanama es del mismo negocio (Baby Kaleb) que la app, así que hay una
posibilidad real de que el acceso estándar alcance. **La prueba lo resuelve**, y
es gratis hacerla: mandar un DM desde una cuenta con rol en la app.

## El plan, en orden

1. **Generar el Page Access Token** de la Página Baby Caleb en esa pantalla,
   otorgando los cuatro permisos de arriba, y guardarlo en el bot como
   `META_PAGE_ACCESS_TOKEN`.
2. **Desplegar** esta versión del bot (trae el diagnóstico por canal y el
   arreglo de `messaging_type`).
3. **Probar con una cuenta que tenga rol**: Juan Arrieta ya es Administrador.
   Manda un DM a @babycalebpanama desde el Instagram ligado a esa cuenta de
   Facebook, espera ~30 s y abre `/admin/conexiones`.
4. **Leer la tarjeta Instagram DMs (Meta)**:
   - **"procesado"** → funciona. Entonces la pregunta es solo si hace falta
     acceso avanzado para clientes reales: prueba con una cuenta SIN rol. Si
     esa también entra, no hay nada más que hacer.
   - **"Nunca ha llegado un evento"** → Meta no entregó. Faltaba el permiso en
     el token (paso 1) o hace falta acceso avanzado.
   - **"RECHAZADO por firma inválida"** → el `META_APP_SECRET` del bot no es el
     de esta app.
   - **"IGNORADO por configuración"** → una bandera (`IG_OFFICIAL` /
     `IG_DM_SOURCE`) en `wrangler.toml`.
5. **Si hace falta acceso avanzado**: en la app, el permiso
   `instagram_manage_messages` → "Añadir a la revisión de la aplicación".
   Requiere verificación del negocio Baby Kaleb y explicar el caso de uso (lo
   habitual es un video del flujo). Hay que mencionar `business_management` como
   dependencia en la solicitud.

## Tres trampas documentadas, para no perseguir fantasmas

- **GIFs y stickers no generan webhook.** Prueba siempre con texto.
- **Si @babycalebpanama es cuenta de Creador** (no Business), Meta exige que la
  cuenta haga primero una llamada a la Conversations API antes de poder recibir
  webhooks.
- **Carpeta de Solicitudes**: los mensajes de desconocidos pueden caer ahí, y
  los que llevan más de 30 días inactivos no se devuelven por API.

## Sobre los roles

- Rol de **Evaluador de Instagram**: no sirve para esto — la propia app aclara
  que es de la Instagram Basic Display API, no de mensajes. Bien visto.
- Los roles se asignan a **cuentas de Facebook**, no de Instagram. Para probar
  con una cuenta ajena, se le da rol de Evaluador al usuario de Facebook dueño
  de ese Instagram. Según Meta, un tester necesita: rol en la app, otorgar los
  permisos, y rol en la cuenta profesional de Instagram.

---

## Instrucciones para Claude en Chrome

```
Seguimos con la app de Meta "Baby Cale CRM" (ID 2099638607582456). Ya verifiqué
que los webhooks apuntan bien a mi bot en los objetos Page e Instagram, y que la
cuenta @babycalebpanama está vinculada a la Página Baby Caleb. NO toques los
webhooks, ni la Callback URL, ni el verify token, ni la app "Juancito Ads -
Calendario" (2501027797085987).

Vamos por el camino de IG vía Página. No conectes nada en "Configuración de la
API con el inicio de sesión de Instagram".

1. Entra a Casos de uso → Messenger → "Configuración de Instagram" (la pantalla
   que lista las 12 Páginas con el botón "Generar identificador").

2. Genera el identificador de acceso SOLO para la Página "Baby Caleb". Cuando
   Meta muestre el diálogo de permisos, asegúrate de otorgar: instagram_basic,
   instagram_manage_messages, pages_messaging y pages_manage_metadata. Si el
   diálogo deja elegir, dime cuáles ofrece antes de aceptar.

3. Cuando el token esté generado: NO lo pegues en el chat ni me lo leas. Dime
   solo que ya está, y déjame la pestaña abierta para copiarlo yo.

4. Dime si en esa misma pantalla, después de generar el token, aparece la cuenta
   de Instagram @babycalebpanama asociada a la Página y si queda suscrita.

5. Dime si @babycalebpanama es cuenta de tipo "Empresa/Business" o "Creador":
   lo ves en la ficha de la cuenta en Meta Business Suite. Es importante porque
   las de Creador necesitan un paso extra para recibir webhooks.

Reglas: no pegues tokens, App Secrets ni verify tokens en el chat; no envíes
solicitudes de revisión a Meta; no cambies el modo de la app; y si algo pide
contraseña o inicio de sesión, detente y dímelo.
```

## Dónde se guarda el token

Dos opciones, las dos sin pasar por el chat:

- **Panel de Cloudflare** (sin terminal): Workers & Pages → `juancitoads-bot` →
  Settings → Variables and Secrets → editar `META_PAGE_ACCESS_TOKEN` → pegar →
  Deploy.
- **Terminal**: `wrangler secret put META_PAGE_ACCESS_TOKEN`.

## Cómo desplegar esta versión

Haz merge de la rama a `main`, o en la pestaña **Actions** del repositorio corre
el workflow **Deploy** eligiendo la rama `claude/brave-dirac-weyiy4`.

## Fuentes

- [Instagram Platform — Overview (niveles de acceso)](https://developers.facebook.com/docs/instagram-platform/overview/)
- [Webhooks for Instagram Messaging](https://developers.facebook.com/docs/instagram-messaging/webhooks)
- [Instagram Messaging with the Messenger Platform](https://developers.facebook.com/docs/messenger-platform/instagram)
- [Overview of Instagram Messaging API](https://developers.facebook.com/docs/instagram-messaging/overview)
