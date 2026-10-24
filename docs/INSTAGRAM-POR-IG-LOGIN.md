# Instagram por la ruta de Instagram Login

## Por qué esta ruta

El bot venía conectado por la **Página de Facebook** (token `EAA…`). Por ahí,
con acceso estándar, Meta solo entrega los DMs de cuentas con rol en la app —
comprobado hasta el fondo, y confirmado por la propia Meta al devolver:

> *"Tu consulta ha caducado porque tienes demasiadas conversaciones con usuarios
> que no tienen un rol en la aplicación. Solicita acceso avanzado…"*

La ruta de **Instagram Login** (token `IG…`) es otra puerta: la cuenta de
Instagram inicia sesión y autoriza la app ella misma, así que sus
conversaciones son datos de un usuario de la app. Hay al menos un caso en
producción —otra óptica, con el mismo tipo de bot— atendiendo DMs de clientes
reales por esta vía **sin acceso avanzado**.

El bot ya la soporta: `src/channels/meta.ts` envía por `graph.instagram.com`
cuando existe `INSTAGRAM_ACCESS_TOKEN`, y `/webhooks/meta` acepta la firma del
App Secret de Instagram si está `INSTAGRAM_APP_SECRET`.

**Messenger no se toca.** Sigue por la Página, con su token actual.

## Lo que hay que conseguir

Dos secrets nuevos en Cloudflare:

| Secret | De dónde sale |
|---|---|
| `INSTAGRAM_APP_SECRET` | La **clave secreta de la app de Instagram** (es distinta del App Secret de Facebook) |
| `INSTAGRAM_ACCESS_TOKEN` | El token de la cuenta, empieza por `IG…` |

El webhook y el verify token **no cambian**: se reutilizan los de siempre.

---

## Instrucciones para Claude en Chrome

```
Vamos a conectar Instagram a mi bot por la ruta de "Instagram API con inicio de
sesión de Instagram". Es una ruta distinta de la que ya está configurada, y las
dos van a convivir.

REGLAS:
- NO toques nada de Messenger ni de la Página de Facebook: eso ya funciona y no
  se debe romper.
- NO toques la app "Juancito Ads - Calendario" (2501027797085987).
- NO pegues tokens ni claves secretas en el chat. Cuando haya que copiar una,
  decime que está lista y la copio yo.
- Si algo pide contraseña o un código de verificación, detente y dímelo.

La app es "Baby Cale CRM", ID 2099638607582456. La cuenta de Instagram es
@babycalebpanama. El webhook de mi bot es:

  https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/meta

PASOS:

1. En la app, entra a Casos de uso → Instagram → "Configuración de la API con
   el inicio de sesión de Instagram". Decime qué secciones ves y en qué estado
   está cada una.

2. En la sección de permisos, agrega los tres de mensajería de Instagram:
     instagram_business_basic
     instagram_business_manage_comments
     instagram_business_manage_messages
   Si hay un botón de "agregar todos los permisos necesarios", úsalo. Decime
   cuáles quedaron.

3. ROL DE EVALUADOR (importante, sin esto no se puede agregar la cuenta):
   Ve a Roles de la app → Roles → Agregar personas → elige "Evaluador de
   Instagram" (está en roles adicionales, NO es el "Evaluador" normal).
   Escribe @babycalebpanama y elige la cuenta exacta de la lista. Agrégala.

4. Dime cuando esté enviada la invitación. Yo la acepto desde Instagram
   (instagram.com/accounts/manage_access/ → "Invitaciones para evaluadores").

5. Cuando yo te confirme que acepté: en "Generar tokens de acceso" la cuenta
   debe aparecer ya en la tabla, con su id numérico. Confírmame que aparece.

6. WEBHOOK de esta sección: pon como URL de devolución de llamada la del bot
   que te di arriba. Cuando pida el token de verificación, DETENTE y pídemelo:
   es el mismo que ya uso y lo pego yo.
   Después confirma que los campos "messages" y "comments" queden suscritos.

7. Muéstrame dónde está la "Clave secreta de la app de Instagram" (NO la leas
   ni la pegues), y dónde está el botón "Generar token" de la cuenta. Yo copio
   las dos cosas.
```

## Lo que hago yo después

1. Guardar en Cloudflare (Workers → `juancitoads-bot` → Settings → Variables
   and Secrets):
   - `INSTAGRAM_APP_SECRET` → la clave secreta de la app de Instagram
   - `INSTAGRAM_ACCESS_TOKEN` → el token `IG…`
2. Probar con un DM desde una cuenta **sin rol** en la app.
3. Mirar la tarjeta **Instagram DMs (Meta)** en `/admin/conexiones`.

## Qué esperar, y qué vigilar

- **Si entra el DM de un tercero** → resuelto, sin revisión de Meta y sin pagar
  ningún puente.
- **Respuestas dobles:** si el mismo DM entra por las dos rutas, el bot podría
  contestar dos veces. Si pasa, se quita el campo `messages` del objeto
  Instagram en los webhooks de la Página (Messenger no se ve afectado) o se usa
  la bandera `IG_DM_SOURCE`.
- **El token `IG…` vence a los 60 días.** Hay que renovarlo o automatizar la
  renovación. El de la Página no caduca; este sí. Conviene anotarlo.
- **La ventana de 24 horas** sigue igual: solo se puede responder dentro de las
  24 h del último mensaje de la persona.

## Si esta ruta también falla

Entonces sí es el acceso avanzado para todo, y el trámite está armado en
`docs/REVISION-META-CHECKLIST.md`.
