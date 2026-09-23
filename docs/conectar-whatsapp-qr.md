# Conectar WhatsApp con un código QR

Esta guía es para el dueño del bot. **No hace falta abrir una terminal**: todo se
hace desde GitHub (pestaña *Actions*) y desde el panel del bot, con el teléfono.

---

## Qué es esto, en una frase

Un segundo canal de WhatsApp que se vincula **escaneando un código**, como
WhatsApp Web, sin trámite comercial con Meta.

**Es un canal alterno, no un reemplazo.** No usa la API oficial, así que
**WhatsApp puede bloquear el número vinculado**. Por eso la Cloud API oficial se
queda conectada: si el QR cae, el bot no se queda mudo. Conviene saberlo antes de
vincular, no después.

**Cuesta ~$1.50–2.00 al mes**, sobre el plan de $5 de Cloudflare que ya se paga.
No es una suscripción nueva: es consumo del mismo plan.

---

## Antes de empezar (una sola vez)

### 1. El plan de Cloudflare

En el panel de Cloudflare, la cuenta tiene que decir **Workers Paid ($5/mes)**.
Los contenedores vienen incluidos ahí; no hay nada extra que contratar.

### 2. El permiso que nadie adivina

El token de Cloudflare del repositorio (`CLOUDFLARE_API_TOKEN`) necesita un
permiso más de los que ya tiene: **Cloudflare Images · Edit**.

> Sin ese permiso el despliegue del puente muere al subir la imagen, **con un
> error que no menciona Images por ningún lado**. Es el permiso que no se
> adivina, porque no se parece a lo que uno está haciendo.

Se renueva en `dash.cloudflare.com → Manage Account → API Tokens`, sobre el token
que ya existe, y se vuelve a guardar en
`Settings → Secrets and variables → Actions`.

### 3. El `WA_TOKEN`

Es la contraseña compartida entre el bot y el puente. **Tiene que ser el mismo
valor en los dos**, y se guarda una sola vez como secret del repositorio, con el
nombre `WA_TOKEN`.

Requisitos: **mínimo 24 caracteres y solo letras, números y guiones**. Sin ñ, sin
tildes, sin emojis, sin comillas curvas.

> Esto no es pedantería. Un token con un carácter raro **funciona en toda prueba
> hecha desde el navegador y falla solo en la máquina**: llega del mismo largo y
> con distinto contenido, así que el error no delata nada. Los dos workflows lo
> rechazan antes de desplegar para que no pase.

---

## Conectar (en orden — el orden importa)

### Paso 1 · Desplegar el puente

Se despliega solo cuando un merge a `main` cambia `puente-wa/`. A mano:
pestaña **Actions** → *Puente WhatsApp · desplegar* → **Run workflow** →
`desplegar`.

Crea solo la base de la sesión, construye la imagen y publica el puente. Es un
workflow aparte del bot a propósito: si la imagen no construye, el que no sale es
el puente y **el bot se sigue publicando**.

### Paso 2 · Desplegar el bot

Mergear a `main`. Eso solo ya despliega el bot, corre las pruebas, aplica el
esquema y reindexa la base de conocimiento.

> **Los dos, sí.** El bot y el puente se llaman entre ellos por un enlace interno
> que cada uno declara de su lado. Con uno solo desplegado, ese enlace apunta a
> un servicio que el otro todavía no declara.

### Paso 3 · Reiniciar el servicio

Desde el 23-sep-2026 lo hace el propio workflow al terminar de desplegar (último
paso, *Reiniciar el contenedor*). Si ese paso avisa que no pudo, a mano: panel →
**Conexiones** → tarjeta *WhatsApp (por código QR)* → botón **Reiniciar el
servicio**.

> **Este paso no es opcional después de desplegar el puente.** Un contenedor sano
> **no toma la imagen nueva**: el servicio de vigilancia lo ve corriendo y lo deja
> en paz. En el piloto costó media hora diagnosticando código viejo creyendo que
> era el nuevo.

### Paso 4 · Escanear

En la misma tarjeta aparece el código. Desde el **teléfono del negocio**:
WhatsApp → *Dispositivos vinculados* → *Vincular un dispositivo* → apunte al
código.

La tarjeta pasa a **Conectado** y el código desaparece solo. (No se muestra el
código cuando ya está conectado: eso es seguridad, no estética — un código
servido con la sesión activa dejaría que cualquiera con el panel abierto vincule
**otro** teléfono al bot.)

### Paso 5 · La prueba que decide

Desde **otro** teléfono, mándele un mensaje al número vinculado. Tiene que
aparecer en *Conversaciones* con la etiqueta `whatsapp-qr` **y el bot tiene que
contestar**. Eso recorre la cadena completa; cualquier cosa menos que eso no
prueba nada.

---

## Qué dice la tarjeta, y qué significa

| Lo que ve | Qué pasa |
|---|---|
| **Conectado** | Su número está atendiendo. No hace falta hacer nada. |
| **Reconectando** | Se perdió la conexión y se está restableciendo sola. Suele tardar menos de un minuto. |
| **Esperando el código** | Hay que escanear. El bot no contesta por este canal hasta que lo haga. |
| **Sin vincular** | Se desvinculó desde el teléfono. Hay que escanear un código nuevo. |
| **Conexión revisada hace 40 segundos** | La vigilancia está trabajando. Esto es lo normal. |
| **"El servicio de vigilancia dejó de revisar la conexión"** *(en rojo)* | Toque **Reiniciar el servicio**. Ver abajo. |

### Ese aviso en rojo, de dónde salió

El 16 de septiembre de 2026 el canal de PanaClaw se quedó sin contestar toda una
noche. El panel mostraba todo bien. Se descubrió escribiéndole al bot y no
recibiendo respuesta; al abrir el panel, la conexión se restableció sola.

La causa: el servicio que vigila la conexión se podía apagar en silencio, y
**nadie preguntaba nunca si seguía vivo**. Ahora la tarjeta lo dice. Si alguna vez
lee ese aviso en rojo, el botón de **Reiniciar el servicio** lo devuelve.

El detalle técnico está en el repositorio de PanaClaw
(`docs/bitacora-whatsapp-qr.md`), y el procedimiento completo de este port en
[`plan-whatsapp-qr.md`](./plan-whatsapp-qr.md).

---

## Desvincular

Misma tarjeta, botón **Desvincular**. El bot deja de contestar por este canal
hasta que se escanee un código nuevo. La Cloud API oficial sigue funcionando.
