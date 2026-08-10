# Meta oficial — Instagram DMs + Facebook Messenger

> Un solo webhook (`/webhooks/meta`) y una sola app de Meta sirven para
> **Messenger e Instagram** a la vez. Esta guía es agnóstica de agente: sirve
> igual si el que instala es Claude Code o Codex. Ningún token se pega en el
> chat — todos se guardan con `wrangler secret put`.

## Qué vamos a lograr
El bot recibe y responde DMs de Instagram y/o mensajes de Facebook Messenger
directamente por la API de Meta (sin intermediario de pago). Al final, la
tarjeta **Meta** en `/admin/conexiones` se pone verde.

## Requisitos antes de empezar (que el miembro tenga)
- Una **Página de Facebook** del negocio (no un perfil personal).
- Para Instagram: una cuenta de **Instagram Business o Creator**, idealmente
  **vinculada a esa Página** (Configuración de la Página → Cuentas vinculadas →
  Instagram). Con la cuenta vinculada, el **Page Access Token cubre también los
  DMs de Instagram** — es el camino más simple.
- Una cuenta en **developers.facebook.com** (gratis).

## Decisión de método para Instagram
- **IG vía Página (recomendado):** la cuenta IG Business está vinculada a la
  Página → usas el **Page Access Token** (`META_PAGE_ACCESS_TOKEN`). Un solo
  token para Messenger + IG. Más simple.
- **IG Login (standalone):** el negocio maneja Instagram sin Página de Facebook →
  usas el producto **Instagram** con IG Login, que da un token `IGAA…`
  (`INSTAGRAM_ACCESS_TOKEN`) y firma con `INSTAGRAM_APP_SECRET`. Úsalo solo si no
  hay Página vinculada.

---

## Paso 1 — Crear la app de Meta
1. Entra a `https://developers.facebook.com/apps` → **Crear app**.
2. Tipo: **Business**. Ponle un nombre (ej. "Bot NombreNegocio").
3. En el panel de la app, agrega los **productos** que necesites:
   - **Messenger** — si quieren Facebook Messenger y/o IG vía Página.
   - **Instagram** — si van por IG Login standalone.

## Paso 2 — Elegir tu verify token (lo inventas tú)
Meta pide un "verify token" para el handshake del webhook. **Es una cadena que tú
eliges** (cualquier texto secreto, ej. `pc-` + algo aleatorio). Guárdalo:
```bash
wrangler secret put META_VERIFY_TOKEN
```
> El código valida el GET del webhook comparando `hub.verify_token` contra este
> valor y devuelve el `hub.challenge`. Tiene que ser **idéntico** al que pegues en
> Meta en el Paso 4.

## Paso 3 — App Secret (firma de los eventos)
En **Configuración → Básica** de la app está el **App Secret**. Cópialo y guárdalo:
```bash
wrangler secret put META_APP_SECRET          # para Messenger / IG vía Página
# solo si usas IG Login standalone, además:
wrangler secret put INSTAGRAM_APP_SECRET
```
> El POST del webhook viene firmado (`x-hub-signature-256`); el bot valida la
> firma contra estos secretos (fail-closed). Sin el App Secret correcto, los
> mensajes se rechazan con 403.

## Paso 4 — Registrar el webhook
En el producto (Messenger → Configuración de webhooks, o Instagram → Webhooks):
1. **Callback URL:** `https://<worker>.workers.dev/webhooks/meta`
2. **Verify token:** el MISMO valor que guardaste en `META_VERIFY_TOKEN`.
3. Meta hace un GET de verificación al instante — si el token cuadra, queda
   verificado (✓). Si da error, revisa que el secret y el pegado sean idénticos y
   que el Worker esté desplegado.
4. **Suscribe los campos (fields):**
   - Messenger: `messages`, `messaging_postbacks`.
   - Instagram: `messages` (y `comments` si van a usar el embudo de comentarios).
5. **Suscribe la Página al webhook** (Messenger → "Add subscriptions" sobre la
   Página del negocio).

## Paso 5 — Token de acceso
### Camino Página (Messenger + IG vinculado)
1. En Messenger → Configuración, sección **Access Tokens**, selecciona la Página →
   genera el **Page Access Token**.
2. Conviértelo en **long-lived** (o usa un System User token para que no expire —
   recomendado para producción).
3. Guárdalo:
   ```bash
   wrangler secret put META_PAGE_ACCESS_TOKEN
   ```

### Camino IG Login (standalone, opcional)
1. En el producto **Instagram**, completa el flujo de **IG Login** para tu cuenta
   Business → obtienes un token `IGAA…`.
2. Guárdalo:
   ```bash
   wrangler secret put INSTAGRAM_ACCESS_TOKEN
   ```

## Paso 6 — Desplegar y verificar verde
```bash
wrangler deploy
```
Pídele al miembro: "Recarga `/admin/conexiones` — la tarjeta **Meta** debe estar
verde." La tarjeta se enciende cuando están `META_PAGE_ACCESS_TOKEN`,
`META_VERIFY_TOKEN` y `META_APP_SECRET`. Manda un DM de prueba desde otra cuenta y
confirma que el bot responde.

---

## Banderas útiles (opcionales, en `[vars]` de `wrangler.toml`)
- `IG_DM_SOURCE = "manychat"` — los **DMs de Instagram** entran SOLO por ManyChat
  (el webhook oficial los ignora para no procesarlos doble). Úsala si el miembro
  quiere IG por ManyChat pero Messenger por Meta oficial. Comentarios/postbacks del
  embudo NO se ven afectados.
- `IG_OFFICIAL = "off"` — apaga por completo el canal oficial de Instagram (DMs +
  embudo + postbacks). Messenger sigue funcionando. El bot de IG viviría solo en
  ManyChat.

## Problemas comunes
- **Webhook no verifica (GET falla):** el `META_VERIFY_TOKEN` guardado no coincide
  con el pegado en Meta, o el Worker no está desplegado con ese secret. Re-guarda y
  `wrangler deploy`.
- **Mensajes llegan pero el bot no responde / 403 "bad signature":** falta o está
  mal el `META_APP_SECRET` (o `INSTAGRAM_APP_SECRET` si es IG Login).
- **IG no responde pero Messenger sí:** la cuenta IG no está vinculada a la Página,
  o falta suscribir el campo `messages` de Instagram, o `IG_DM_SOURCE="manychat"`
  está desviando los DMs.
- **El bot manda respuestas dobles en IG:** tienes Meta oficial **y** ManyChat
  activos para IG sin `IG_DM_SOURCE="manychat"`. Pon esa bandera.
