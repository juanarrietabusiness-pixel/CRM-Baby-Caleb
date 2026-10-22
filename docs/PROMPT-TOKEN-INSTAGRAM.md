# Prompt para Claude en Chrome: el token de la Página

Copiar y pegar tal cual. El objetivo es **uno solo**: generar el Page Access
Token de la Página Baby Caleb con los cuatro permisos que Instagram necesita,
para que Meta empiece a entregar los DMs de cualquier persona y no solo los de
quien tiene rol en la app.

---

```
Necesito que generes un token de acceso en una app de Meta. Contexto que ya
está verificado, no hace falta que lo revises de nuevo:

- La app es "Baby Cale CRM", ID 2099638607582456.
- Sus webhooks ya están bien configurados y apuntan a mi bot en los objetos
  Page e Instagram, con el campo "messages" suscrito. NO los toques: ni la
  Callback URL, ni el verify token, ni los campos.
- La cuenta de Instagram @babycalebpanama ya está vinculada a la Página de
  Facebook "Baby Caleb". No hay que vincular nada.
- NO toques la app "Juancito Ads - Calendario" (ID 2501027797085987). Si algo
  te obliga a modificarla, detente y dime.
- NO entres ni configures nada en "Configuración de la API con el inicio de
  sesión de Instagram" (Instagram Login). Ese camino no es el que usamos y su
  sección de webhooks se queda vacía a propósito.

EL PROBLEMA QUE ESTAMOS RESOLVIENDO: Meta exige que el permiso
instagram_manage_messages vaya DENTRO del Page Access Token. En esta app, la
pantalla de tokens muestra "—" en las 12 Páginas: nunca se generó uno. Por eso
solo llegan los DMs de cuentas con rol en la app.

PASOS:

1. Entra a la app Baby Cale CRM → Casos de uso → Messenger → "Configuración de
   Instagram" (o "Configuración de Messenger API"). Es la pantalla que lista
   las Páginas con un botón "Generar identificador" / "Generar token".
   Dime qué ves: cuántas Páginas lista y si alguna ya tiene token generado.

2. Genera el identificador de acceso SOLO para la Página "Baby Caleb". Hay 12
   Páginas conectadas a esa app y las otras 11 no tienen nada que ver con esto:
   si dudas de cuál es, detente y pregúntame antes de generar.

3. Cuando Meta abra el diálogo de permisos, asegúrate de que queden otorgados
   estos cuatro:
     - instagram_basic
     - instagram_manage_messages   ← este es el que falta hoy
     - pages_messaging
     - pages_manage_metadata
   Si el diálogo deja elegir cuáles, dime qué opciones ofrece ANTES de aceptar.
   Si alguno no aparece o aparece bloqueado, detente y dímelo: eso cambia el
   diagnóstico.

4. Cuando el token esté generado: NO lo pegues en el chat, no me lo leas y no
   lo escribas en ningún lado. Solo dime que ya está y deja la pestaña abierta
   para copiarlo yo.

5. Antes de terminar, dos comprobaciones de SOLO LECTURA:
   a) En esa misma pantalla, dime si después de generar el token aparece la
      cuenta de Instagram @babycalebpanama asociada a la Página.
   b) En Webhooks (o en Messenger → Configuración), mira la suscripción de la
      Página "Baby Caleb" y dime EXACTAMENTE qué campos tiene suscritos. Antes
      vimos "2 campos" y necesito saber cuáles son.

REGLAS:
- No pegues tokens, App Secrets ni verify tokens en el chat.
- No cambies el modo de la app ni la publiques o despubliques.
- No envíes solicitudes de revisión a Meta.
- No toques la app del calendario ni Instagram Login.
- Si un paso pide una contraseña, un 2FA o un inicio de sesión, detente y
  dímelo.
```

---

## Qué hago yo después

1. Copias el token de esa pestaña y lo pegas en **Cloudflare → Workers & Pages
   → `juancitoads-bot` → Settings → Variables and Secrets →
   `META_PAGE_ACCESS_TOKEN` → Deploy**. Nunca por el chat.
2. Abres `/admin/conexiones` → tarjeta **Instagram DMs (Meta)** → botón
   **"Probar lectura de DMs"**. Eso dice si el token quedó con el permiso,
   antes de ponerte a probar con mensajes.
3. Un DM de prueba, con texto (no GIF ni sticker), desde la cuenta sin rol.
4. Recargas esa tarjeta y lees la línea de "último evento".
