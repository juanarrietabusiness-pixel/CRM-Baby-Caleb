# Bitácora — WhatsApp por QR en Baby Caleb

Registro de lo que se rompió y cómo se arregló en **este** repo, con el canal de
WhatsApp por código QR (Baileys en un contenedor de Cloudflare) ya en
producción.

**Para qué existe este archivo.** El canal se pilotó en
[PanaClaw](https://github.com/abrinay1997-stack/CRM-PANACLAW) y de allá salió el
plan del port (`docs/plan-whatsapp-qr.md`). Pero los fallos del 16 y el 17 de
septiembre de 2026 pasaron **aquí**, en producción, y varios no estaban en ese
plan porque nadie los había visto todavía: uno de ellos venía en el código del
piloto y tardó en aparecer solo porque nadie había dejado el canal solo una
noche entera. El código del repo apunta a este archivo cuando explica por qué
hace algo raro; esto es lo que hay al otro lado de esas flechas.

**Cómo se llena.** En el momento, no al final. Un tropiezo que no se anota es un
tropiezo que se vuelve a pagar.

---

## Estado

| | |
|---|---|
| Fase | producción — el puente sostiene el socket con el panel cerrado, medido |
| Lo que falta | **volver a escanear el QR**: las credenciales se perdieron el 16-sep (ver abajo) |
| Última actualización | 2026-09-17 |

---

## La causa raíz: el contenedor vive mientras vive su Durable Object

Ésta es la entrada importante. Todas las demás son tropiezos; ésta es por qué el
canal no servía.

**El síntoma.** «Cuando la página del CRM no está abierta, el WhatsApp no
responde.» El dueño lo dijo en esas palabras y tenía razón literal.

**La medición.** Escuchamos el Worker tres minutos con el panel cerrado:

- **cero eventos.** Ni una alarma, ni un latido, ni un error.
- En dos horas y media: **89 arranques de contenedor contra 76 latidos**.

Un canal que arranca el contenedor más veces de las que late no está degradado,
está apagado y volviendo a nacer cada vez que alguien lo mira.

**Por qué.** Está en el código de Cloudflare, no en el nuestro. En
`@cloudflare/containers`, dentro de su manejador de alarma:

```
// do not remove this, container DOs ALWAYS need an alarm right now.
```

Su `alarm()` **duerme dentro del propio manejador** y al despertar la vuelve a
armar con `setAlarm(Date.now())`: siempre hay una alarma en vuelo, y eso es lo
que mantiene al Durable Object residente en memoria. **El contenedor vive
mientras vive su DO.**

El nuestro hacía su trabajo y retornaba. Entre latido y latido no quedaba
ninguna alarma en vuelo, el DO se desalojaba, y el contenedor se iba con él.
Abrir el panel mandaba una petición, la petición despertaba el DO, el DO
levantaba el contenedor — y el mérito se lo llevaba la página.

Y había un agravante nuestro: el latido programaba con **retroceso
exponencial**. Esperar cada vez más tras cada fallo es lo correcto para algo
que se reintenta; para un socket que debe estar siempre abierto es al revés.
El retroceso alargaba esos huecos hasta quince minutos.

**Cómo se arregló.** Tres cosas, y el orden no es casual:

1. `PuenteWa` **extiende `Container`** en vez de usar `ctx.container` crudo. La
   decisión anterior («evita una dependencia más en la ruta crítica») es la que
   tuvo el canal caído: lo que esa librería hace no es azúcar, es la gestión del
   ciclo de vida. La vigilancia va por `schedule()` y **no** sobrescribiendo
   `alarm()` — pisar ese manejador rompe justo la pieza que sostiene todo.
2. **Un Cron Trigger cada minuto**, que es un supervisor **fuera** del DO. Uno
   que vive dentro de la cosa que vigila no puede levantarla cuando se cae del
   todo. El cron es de plataforma: llega aunque el DO esté desalojado y su
   alarma perdida.
3. **Se quitó el retroceso.** Treinta segundos fijos.

**Cómo se verificó** (panel cerrado, 17-sep): ~9 alarmas en 5 minutos, el cron
entrando cada minuto, cero apagones, y el contenedor escribiendo en D1 por su
cuenta. En PanaClaw, la prueba más limpia: la última escritura en la base pasó
de las 01:19 a las **02:30:07** sin que nadie tocara nada — el contenedor
volvió, leyó las credenciales de D1 y reabrió el socket **sin código QR**.

**Detalle de operación:** el cron tarda unos **once minutos** en empezar a
llegar después de un despliegue que lo estrena. Dos escuchas en silencio
seguidas de una tercera con todo funcionando no son un fallo intermitente, son
eso.

---

## Qué más salió mal

Formato: **qué pasó** → **por qué** → **cómo se arregló**.

### `schedule()` no reemplaza, agrega (se cazó antes de desplegar)

Al reescribir la vigilancia, tres sitios distintos la programaban: `vigilar()`,
`onStart()` y el cron. Cada llamada a `schedule()` **agrega** una tarea, así que
tres dueños son tres cadenas — y las cadenas se multiplican: un cron que
vigilara por su cuenta haría nacer una cadena nueva por minuto, y a la hora
habría sesenta vigilando en paralelo, cada una arrancando contenedores.

Programar tiene **un solo dueño**: `vigilar()`. `onStart()` y `matar()` a
propósito no programan, y el cron es un desfibrilador, no un segundo corazón:
solo revive la cadena cuando el latido está vencido o no ha existido nunca.

### El botón "Reiniciar el servicio" no reiniciaba nada

**El síntoma.** «Le doy a reiniciar servicio y no vuelve a estar conectado.»
Solo refrescar la página lo levantaba.

**Por qué.** `matar()` destruía el contenedor y ahí se acababa su trabajo. La
vuelta quedaba a merced de otros dos caminos, y los dos estaban frenados:

- `ultimoArranque` seguía puesto, así que el guardia anti-rebote le negaba el
  arranque al siguiente sondeo hasta 15 s. Ese guardia existe para que refrescar
  el panel no reinicie el contenedor solo; no está para discutirle a quien tocó
  el botón a propósito.
- `fallosSeguidos` seguía contando, y el latido programaba con retroceso: un
  reinicio a mano heredaba el castigo pensado para algo que se cae solo.

**Cómo se arregló.** `reinicioPedido()` limpia los tres campos juntos: un
reinicio pedido por una persona es un punto y aparte, no la continuación de la
racha anterior. Tiene test propio.

### La cuenta de arranques subía sola (17-sep-2026)

**El síntoma.** El diagnóstico del panel decía `arranquesContenedor: 89` con
`reiniciosForzados: 0`. Parte de esos 89 eran reales; parte, ruido.

**Por qué.** La librería llama `onStart()` al final de **cada**
`startAndWaitForPorts()`, sin mirar si hizo falta arrancar algo: su
`startContainerIfNotRunning()` es un no-op cuando el contenedor ya corría, y el
`onStart()` de después no lo es. Con la vigilancia cada 30 s, eso son 120
"arranques" por hora de un contenedor que no se cayó ni una vez.

No es cosmético: la cuenta de arranques **contra** la de latidos es la señal con
la que se encontró la causa raíz de arriba. Una señal que sube sola no sirve
para diagnosticar nada.

**Cómo se arregló.** Todos los arranques que pedimos pasan por `#arrancar()`,
que mira `ctx.container.running` **antes** y le dice a `onStart()` si esto fue
un arranque o una comprobación. Los que dispara `containerFetch()` sí se
cuentan: ésa solo arranca cuando el contenedor no estaba corriendo.

### `npx wrangler@4` rompió el despliegue sin que tocáramos nada (17-sep-2026)

```
VALIDATE_INPUT
observability cannot define both observability and configuration.observability
```

**Por qué.** `npx wrangler@4` trae siempre la última publicada. La **4.133.0**
salió el 16-sep a las 20:23 UTC —49 minutos después del último despliegue verde,
que corrió con la 4.132.0— y empezó a mandar
`containers.configuration.observability.logs` además del campo `observability`
que la aplicación ya tenía. La API rechaza las dos formas juntas.

**Cómo se arregló.** La versión va **clavada** (`WRANGLER: "4.132.0"` en
`.github/workflows/puente-wa.yml`). Un despliegue que depende de "lo último que
hayan publicado" no es reproducible: el mismo commit pasa hoy y falla mañana sin
que nadie toque nada. Subirla es una decisión deliberada, no un efecto
secundario.

### El puente dejó de ser autosuficiente (se cazó antes de desplegar)

Desde que extiende `Container`, su bundle importa `@cloudflare/containers` y
esbuild tiene que poder resolverlo. Sin un `pnpm install` en el workflow el
deploy muere al empaquetar, con un error de módulo no encontrado que no dice que
falte instalar. El paso instala en la **raíz** del repo: `puente-wa/` no tiene
`package.json` propio.

### El `deploy.yml` del bot no tenía paso de secrets

El plan del port daba por hecho un paso que carga secrets antes de desplegar
—PanaClaw lo tiene— y aquí no existía. Se agregó uno **acotado solo a
`WA_TOKEN`**, y que avisa y sigue en vez de fallar: un token que falte o no sea
apto no puede bloquear el despliegue del bot, que publica también la base de
conocimiento.

### El orden del service binding

Cloudflare **no despliega** un Worker que declara un binding a otro Worker que
todavía no existe. El port entró en dos merges con el `[[services]]` comentado
en el primero, para que `main` no pasara por rojo.

### Se perdieron las credenciales de WhatsApp (16-sep-2026, ~20:22)

`hay_creds: 0` en `juancitoads-bot-wa-auth`. El número quedó **desvinculado** y
hay que volver a escanear el QR desde el panel.

**Hipótesis, sin probar:** los 89 arranques de contenedor en dos horas y media
son 89 reconexiones del mismo dispositivo vinculado, y WhatsApp puede haber
cerrado la sesión por esa razón. Encaja en el tiempo, pero no está demostrado y
no conviene tratarlo como hecho. Lo que sí está demostrado es lo contrario y es
lo que importa hacia adelante: **un despliegue del puente no cuesta la sesión** —
se midió en PanaClaw, donde `hay_creds` siguió en 1 y `813 == 813` antes y
después de desplegar.

---

## 23-sep-2026 · El bot contestaba encima de la dueña

**Síntoma.** Con el canal ya estable, la dueña contestaba a una clienta desde el
teléfono del negocio y el bot seguía respondiendo en la misma conversación. Los
dos le escribían a la vez. En Telegram y en la API oficial eso no pasaba: ahí la
respuesta humana pausa el bot.

**Causa.** El contenedor tiraba **todo** mensaje propio:

    if (msg.key?.fromMe) continue;

Un mensaje que sale del número del negocio es `fromMe` lo mande el bot o lo
escriba una persona, así que el CRM nunca se enteraba de que alguien había
tomado la conversación.

**Arreglo.**

- El bot genera el id de cada mensaje ANTES de enviarlo y lo anota
  (`puente-wa/contenedor/propios.mjs`). Tiene que ser antes: Baileys emite el
  eco de lo enviado en el mismo tick en que termina `sendMessage`, y el id que
  devuelve llegaría tarde a su propio eco.
- Un `fromMe` que no está anotado, con contenido de verdad (no una reacción ni
  un borrado), de un chat uno a uno y reciente → lo escribió una persona. Va por
  una ruta APARTE: `/puente/propio` → `/webhooks/whatsapp-qr/propio`. Aparte a
  propósito: un bot sin este cambio contesta 404 en vez de tratar el texto de
  la dueña como si fuera de la clienta.
- El CRM anota el mensaje como `owner` y pausa la conversación
  (`src/takeover.ts`). Segunda red: si el texto es igual a lo que el bot acaba
  de decir, es un eco que se coló tras un reinicio y no pausa.
- WhatsApp mezcla identificadores LID y número para el mismo chat: el puente
  manda los dos (y los que resuelve su mapa), y el CRM usa el que ya tenga
  conversación.
- El agente revisa la pausa en tres momentos: al llegar el mensaje, al vencer
  la espera del buffer y **justo antes de enviar** — el modelo tarda segundos,
  y en esos segundos la dueña pudo haber contestado.

**Orden de despliegue.** Primero el bot (merge a `main`), después el puente
(sale solo con el mismo merge porque cambia `puente-wa/`, y se reinicia solo).
Al revés tampoco rompe nada: un bot viejo contesta 404 a la ruta nueva.

**Lo que se vio en la base ese día**, y que no era de este canal: el bot estaba
en pausa global desde el 17-sep y con una línea como prompt entero. Ver
`docs/AUDITORIA_CONOCIMIENTO.md`.

---

## 23-sep-2026 · Las notas de voz y las fotos llegaban vacías

**Síntoma.** Por el WhatsApp por QR el bot no entendía notas de voz ni fotos.
Con la Cloud API (el número de prueba de Meta) sí las entendía.

**Causa.** No era Baileys ni Cloudflare: era el contenedor. `reenviar()` solo
mandaba `conversation` y `extendedTextMessage.text`. De una nota de voz no
mandaba nada —ni el audio—, y de una foto ni la leyenda. La Cloud API y
Telegram dejan el archivo en una URL que se descarga después; Baileys no: el
archivo se descarga dentro del contenedor, en el momento, o se pierde.

**Arreglo.**
- El contenedor descarga la nota de voz o la foto con `downloadMediaMessage`
  (tope 12 MB) y la manda en base64 junto al mensaje, con la leyenda
  (`textoDe`). Si la descarga falla, el mensaje sale igual y el CRM dice qué
  era. El estado cuenta `archivosRecibidos`.
- El CRM la guarda en D1 (`media_temporal`, en partes, dos días) y la ve como
  la de cualquier canal: una URL firmada (`/webhooks/whatsapp-qr/media/:id`).
  La transcripción lee los bytes de D1, sin que el Worker se llame a sí mismo.
- Las reacciones y los mensajes de protocolo ya no llegan al agente como un
  mensaje vacío.

**Ojo con `escalar_media`.** En Baby Caleb está encendido (Config): una **foto**
no la ve la IA, crea un ticket (es el comprobante de pago que nadie verificó).
Ahora esa foto le llega a la dueña por Telegram antes del aviso. Las **notas
de voz** sí se transcriben y se contestan.

**Después de desplegar:** el contenedor tiene que tomar la imagen nueva.
`puente-wa.yml` lo reinicia solo al terminar.

---

## 24-sep-2026 · El bot contestaba los ESTADOS: conversaciones fantasma

**Síntoma.** En el panel aparecía una conversación en la que "el cliente"
mandaba una foto y el bot le contestaba. En el teléfono esa conversación no
existía. Pasaba aquí, en PanaClaw y en B&S (los tres llevan el mismo contenedor).

**Causa.** Cuando un contacto publica una foto en su **estado**, a Baileys le
llega como un mensaje del chat `status@broadcast` (quien lo publicó va en
`key.participant`). El contenedor reenviaba al CRM todo lo que no fuera
propio, sin mirar de qué chat venía. El CRM lo tomó por una clienta, el bot
lo "contestó"… a `status@broadcast`. Mandarle texto a ese chat no le llega a
nadie en un chat: es **publicar un estado** con el número del negocio. Todos
los estados de todos los contactos caían, además, en la MISMA conversación.

**Arreglo** (tres puertas, la misma regla: `esChatDeUnaPersona`):
- El contenedor (`propios.mjs`) no reenvía estados, difusiones (`@broadcast`),
  grupos (`@g.us`), canales (`@newsletter`) ni bots de Meta (`@bot`). Los
  cuenta en `ignoradosNoSonChat` (se ve en el estado del puente).
- El contenedor se niega a ENVIAR a esos chats (`/enviar` → 400).
- El CRM los ignora en `/webhooks/whatsapp-qr` antes de despertar al agente
  (ni guarda la foto), y `sendReply` se niega a mandarles nada: una
  conversación fantasma que ya exista en la base no puede volver a escribir.

Es una lista de lo que NO es, a propósito: WhatsApp estrena formatos de chat
de persona (`@lid`, `@hosted`) más seguido que de otra cosa, y un formato
nuevo de persona no debe perder mensajes. Una clienta que RESPONDE a un estado
del negocio sí llega: eso viene de su chat, no de `status@broadcast`.

**Limpieza:** la conversación fantasma que ya exista (su "cliente" es
`status@broadcast`) se borra desde el panel, en Conversaciones.

---

## Cómo se consiguen los logs sin abrir una terminal

El dueño de este bot no usa la terminal, y el fallo de arriba era invisible
desde el panel: el panel se veía bien porque **abrirlo** era lo que arreglaba
el canal. Se agregaron dos workflows en la pestaña **Actions**, y son los que
encontraron la causa:

- **`ver-logs-puente.yml`** — escucha el Worker en vivo (120 / 180 / 300 s) y
  deja la salida en el log del job. Escuchar **con el panel cerrado** es la
  prueba: si no aparece nada, el canal está apagado, no lento.
- **`revisar-sesion-wa.yml`** (en PanaClaw; el equivalente aquí es
  `pnpm auditar` y el propio panel) — consulta la base de la sesión y responde
  las cinco preguntas de aceptación: `hay_creds == 1`, `sin_subir ==
  siguiente`, `prekeys ~800`, `app_state >= 1`, `lid > 0`.

---

## Deuda anotada

- **Las pre-keys se acumulan.** Se podan a mano con `/api/podar` (conserva
  1000). Deliberadamente no es automático: borrar una llave que WhatsApp
  todavía puede usar rompe la sesión.
- **El costo de 24 h del Durable Object no está medido.** Ahora hay una alarma
  cada 30 s más un cron cada minuto, permanentes. El contenedor `lite` prendido
  24/7 se midió en ~$1.50–2.00/mes; esta parte, no.
- ~~**La pestaña Conversaciones muestra `whatsapp-qr` en crudo**~~ — resuelto
  el 23-sep: se lee *WhatsApp (QR)*.
