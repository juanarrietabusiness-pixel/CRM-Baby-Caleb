# Messenger llega, Instagram no — cómo encontrar la causa

Síntoma: los mensajes de **Facebook Messenger** entran al bot y los **DMs de
Instagram** no, aunque las dos conexiones se ven hechas.

Que Messenger funcione prueba que el webhook, el `META_VERIFY_TOKEN` y el
`META_APP_SECRET` están bien. Instagram pasa por el **mismo** webhook
(`/webhooks/meta`), así que el problema está en uno de estos cinco puntos — y
cuatro de los cinco **no se ven** desde el panel de Meta, porque Meta cree que
entregó el evento correctamente.

| # | Causa | Qué se ve en Meta | Dónde se arregla |
|---|---|---|---|
| 1 | El campo `messages` está suscrito para el objeto **Page** pero no para el objeto **Instagram** | Todo verde | App de Meta |
| 2 | La cuenta de Instagram no dio permiso: *Herramientas conectadas → permitir acceso a los mensajes* está apagado | Todo verde | App de Instagram (celular) |
| 3 | La app está en modo **Desarrollo** o sin acceso avanzado a `instagram_manage_messages` | Todo verde | App de Meta → Revisión |
| 4 | Instagram se conectó con **Instagram Login** (token `IGAA…`), que firma con **su propio** App Secret, y no se guardó `INSTAGRAM_APP_SECRET` | Entregas con error 403 | `wrangler secret put` |
| 5 | Una bandera del bot apaga Instagram: `IG_OFFICIAL="off"` o `IG_DM_SOURCE="manychat"` | Todo verde (el bot responde 200 y descarta el DM) | `wrangler.toml` |

## Primero: que el panel te lo diga

Desde esta versión, `/admin/conexiones` tiene una tarjeta **Instagram DMs
(Meta)** aparte de Messenger, y cada tarjeta muestra qué pasó con el último
evento que mandó Meta:

- **"Nunca ha llegado un evento por este canal"** → es la causa **1, 2 o 3**:
  Meta no está entregando nada. El problema está en la app de Meta o en el
  permiso de la cuenta de Instagram, no en el bot.
- **"RECHAZADO por firma inválida"** → es la causa **4**. El detalle dice qué
  App Secrets hay configurados.
- **"IGNORADO por configuración"** → es la causa **5**. El detalle nombra la
  bandera exacta.
- **"procesado"** → el DM entró. Si el cliente no recibió respuesta, el
  problema es de envío (token de Instagram), no de recepción: mira
  *Conversaciones* en el panel.

Pasos: despliega esta versión, manda un DM de prueba desde otra cuenta de
Instagram, espera ~30 segundos y recarga `/admin/conexiones`.

---

## Instrucciones para Claude en Chrome

Copia y pega esto tal cual en Claude en Chrome (necesita estar con la sesión de
Facebook/Instagram del negocio abierta):

```
Necesito que revises la configuración de una app de Meta porque los mensajes de
Facebook Messenger llegan a mi bot pero los DMs de Instagram no. El webhook del
bot es:

  https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta

Revisa en este orden y no cambies nada hasta el paso 7:

1. Abre https://developers.facebook.com/apps y entra a la app del negocio.
   Dime el nombre de la app, su App ID y si está en modo "Desarrollo" o "Activo
   (Live)" — el interruptor está arriba, junto al nombre.

2. Dime qué productos tiene agregados en el menú de la izquierda: ¿solo
   "Messenger", solo "Instagram", o los dos?

3. Entra a Webhooks (menú izquierdo, o
   https://developers.facebook.com/apps/<APP_ID>/webhooks/). Arriba hay un
   selector de objeto. Míralo objeto por objeto:
   - En "Page": dime la Callback URL y qué campos están suscritos.
   - Cambia el selector a "Instagram": dime si existe la suscripción, cuál es
     su Callback URL y si el campo "messages" está suscrito.
   Esto es lo más importante: es muy común que "messages" esté suscrito en
   "Page" y NO en "Instagram". Si el selector no tiene la opción "Instagram",
   dímelo.

4. Si existe el producto "Instagram": entra a "Configuración de la API con
   Instagram Login" (o "API setup with Instagram login"). Dime si ahí hay una
   cuenta de Instagram conectada, y si la sección de webhooks de ESE producto
   tiene la misma Callback URL y el campo "messages". NO copies ningún token ni
   ningún App Secret en el chat — solo dime si existen o no.

5. Si existe el producto "Messenger": entra a su configuración y busca la
   sección de Instagram. Dime si la cuenta de Instagram del negocio aparece
   vinculada a la Página de Facebook y si tiene suscripción activa.

6. Busca los errores de entrega: en la página de Webhooks, cada suscripción
   tiene "Ver registros" o "Recent Error Messages" / "Recent Errors". Dime si
   hay errores recientes para el objeto Instagram y, textual, qué código y qué
   mensaje traen (por ejemplo 403).

7. Revisa los permisos: en "Revisión de la app" → "Permisos y características",
   dime en qué nivel están `instagram_basic`, `instagram_manage_messages`,
   `pages_messaging` y `pages_manage_metadata` — "Acceso estándar" o "Acceso
   avanzado". Si `instagram_manage_messages` no tiene acceso avanzado y la app
   está en modo Desarrollo, solo llegarían DMs de cuentas que sean
   administradores o testers de la app; dímelo.

Después de reportarme todo eso, haz solo estos arreglos si hacen falta:

   a) Si en el objeto "Instagram" falta la suscripción o falta el campo
      "messages": suscríbelo con esa misma Callback URL. Si te pide el verify
      token, NO lo inventes: detente y pídemelo.
   b) Si la cuenta de Instagram no aparece conectada/suscrita en el producto
      correspondiente: conéctala y suscríbela.
   c) Usa el botón "Probar" / "Test" de la suscripción de Instagram para el
      campo "messages" y dime qué respuesta devuelve mi servidor (debería ser
      200).

No hagas nada de esto: no regeneres el App Secret, no cambies la Callback URL,
no cambies el modo de la app de Desarrollo a Activo, y no pegues tokens ni
secrets en el chat. Si algo requiere una de esas acciones, paras y me lo dices.

Por último, abre https://www.instagram.com con la cuenta del negocio y revisa
si en Configuración → Mensajes (o "Mensajes y respuestas a historias") existe
la opción de "Herramientas conectadas" / permitir acceso a los mensajes, y si
está activada. Si no la encuentras en la web, dímelo: toca revisarla en la app
del celular.
```

## Lo que viene después, según lo que reporte

- **Falta `messages` en el objeto Instagram** (lo más común): se arregla ahí
  mismo, sin tocar el bot. En cuanto quede suscrito, el DM de prueba aparece en
  `/admin/conexiones` como "procesado".
- **Hay 403 en los registros de entrega** → Instagram está firmando con el App
  Secret del producto Instagram. Guarda ese secret (desde la terminal, nunca por
  chat) y vuelve a desplegar:
  ```bash
  wrangler secret put INSTAGRAM_APP_SECRET
  ```
  Si además el token de envío es `IGAA…`, guarda también
  `INSTAGRAM_ACCESS_TOKEN`.
- **"Herramientas conectadas" apagado** → se activa en la app de Instagram del
  negocio (Configuración → Mensajes → Herramientas conectadas → permitir acceso
  a los mensajes). Sin eso, Meta no entrega ningún DM.
- **App en Desarrollo sin acceso avanzado** → mientras tanto, solo llegan DMs de
  cuentas que sean administradores/testers de la app. Para producción hay que
  pedir acceso avanzado a `instagram_manage_messages` en Revisión de la app.
- **Bandera del bot** → quita `IG_OFFICIAL` o `IG_DM_SOURCE` de `[vars]` en
  `wrangler.toml` y vuelve a desplegar.

## Cómo desplegar esta versión

El deploy sale de GitHub: haz merge de la rama a `main`, o en la pestaña
**Actions** del repositorio corre el workflow **Deploy** eligiendo la rama
`claude/brave-dirac-weyiy4`.
