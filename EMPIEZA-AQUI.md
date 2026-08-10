# 🐾 Empieza aquí — CRM PanaClaw

**Este documento es para el dueño de PanaClaw.** No hace falta que sepas programar.
Está escrito para que se lo pases a **Claude** y él haga el trabajo técnico por ti,
paso a paso, preguntándote solo cosas de negocio.

> **Si solo vas a hacer una cosa hoy:** salta a [Paso 3](#paso-3--dile-esto-a-claude) y
> pégale ese texto a Claude. Él te va llevando de la mano desde ahí.

---

## 1. Qué es esto, en palabras simples

Es **un chatbot con su panel de control, para un negocio**.

Piénsalo como **un local comercial llave en mano**: viene con todo montado — el mostrador,
la caja registradora, la bodega. Lo instalas para un negocio, le entregas su llave, y ese
negocio entra a *su* local y ve *sus* cosas.

Para un segundo negocio montas **otro local**, con su propia dirección y su propia llave.

**Qué hace el bot:**

- Contesta a los clientes por **WhatsApp, Instagram, Messenger y Telegram**, las 24 horas.
- Responde leyendo **tus documentos** (tus precios, tus políticas, tus preguntas frecuentes).
- Entiende **notas de voz** — las transcribe solo.
- Si algo es delicado o no está seguro, **te avisa a ti** en vez de inventar.
- Guarda **cada conversación y cada prospecto** en un panel donde los ves en vivo.

**Qué NO es** (importante, para que no te decepcione):

| | |
|---|---|
| ❌ No es una página web de publicidad | Eso hay que hacerlo aparte (es fácil) |
| ❌ No es un sitio donde la gente se registra sola y crea su bot | Eso habría que construirlo; es un proyecto grande |
| ✅ Sí es el bot y el panel, funcionando | Listo para desplegar hoy |

### Las tres piezas del negocio

| Pieza | ¿Ya existe? | ¿Dónde vive? |
|---|---|---|
| 🤖 El bot + su panel | **Sí, esto es** | Cloudflare (obligatorio) |
| 📢 Tu página de publicidad | No, falta | Donde quieras (Netlify, Vercel, Cloudflare Pages) |
| 🏢 La "recepción" donde los clientes se registran solos | No existe | Habría que construirla |

### ¿Por qué Cloudflare y no Netlify o Vercel?

Porque el bot usa piezas que **solo existen dentro de Cloudflare**: la memoria del agente, la
base de datos, la búsqueda inteligente y el almacenamiento de audios. No es una preferencia,
es que el motor no arranca en otro lado.

Y ojo con algo que confunde a mucha gente: normalmente una web tiene dos mitades — la
**vitrina** (lo que ves) y la **cocina** (lo que trabaja atrás) — y sí puedes ponerlas en
sitios distintos. **Aquí no hay dos mitades.** El panel no son páginas guardadas en archivos:
el bot las **fabrica en el momento**, cada vez que alguien lo abre. Panel y bot son el mismo
programa. No hay nada que separar.

**Tu página de publicidad sí puede ir en Netlify.** Esa es harina de otro costal y no
depende de este código.

---

## 2. Lo que necesitas antes de empezar

Junta estas cuatro cosas. Claude te ayuda con las últimas dos.

### ✅ 1. Una cuenta de Cloudflare con el plan de $5

Créala en [dash.cloudflare.com](https://dash.cloudflare.com) y activa **Workers Paid**
($5 USD/mes). **No sirve el plan gratis** — permite solo 5 bots y ni siquiera está pensado
para uso real.

Con esos $5 te alcanza para **hasta ~250 bots**, no es $5 por bot.

### ✅ 2. Una llave de inteligencia artificial

Es el "cerebro" del bot. Elige **una**:

| Proveedor | Dónde sacarla |
|---|---|
| **Claude** (recomendado) | [console.anthropic.com](https://console.anthropic.com) |
| ChatGPT | [platform.openai.com](https://platform.openai.com) |
| Grok | [console.x.ai](https://console.x.ai) |

Cuesta aproximadamente **$1–2 USD al mes** por bot de un negocio normal. Se paga por uso:
solo pagas lo que el bot "piensa".

> 🔒 **Esa llave es como la tarjeta de crédito de tu bot.** Nunca la pegues en un chat, ni
> en un correo, ni en un documento. Más abajo se explica dónde va.

### ✅ 3. Node y pnpm instalados en tu computadora

Son dos herramientas gratis. **Si no sabes si las tienes, no importa** — Claude lo revisa y
las instala por ti. Solo dile: *"revisa si tengo Node y pnpm, y si faltan instálamelos"*.

### ✅ 4. Claude Code

Es Claude corriendo en tu computadora, con permiso para ejecutar comandos.
Descárgalo en [claude.com/claude-code](https://claude.com/claude-code).

---

## 3. Conecta Claude con Cloudflare (MCP)

Esto es lo que hace que Claude pueda **ver y manejar tu cuenta de Cloudflare directamente**,
en vez de que tú andes copiando y pegando cosas del navegador.

**MCP** es simplemente la forma en que Claude se conecta a servicios externos. Piénsalo como
darle a Claude una llave de invitado a tu Cloudflare: él puede mirar y hacer cambios, pero
tú autorizas desde tu navegador y puedes quitársela cuando quieras.

### Instálalo (una sola vez)

Abre tu terminal y corre estos dos comandos:

```bash
claude mcp add --transport http cloudflare https://mcp.cloudflare.com/mcp
claude mcp add --transport http cloudflare-docs https://docs.mcp.cloudflare.com/mcp
```

- El primero le da acceso a **tu cuenta** de Cloudflare (crear bases de datos, desplegar, ver logs).
- El segundo le da acceso a la **documentación** de Cloudflare, para que no se invente cosas.

### Autoriza

La primera vez que Claude use la conexión, se abrirá tu navegador pidiéndote permiso.
**Acepta.** Es tu propia cuenta autorizándose a sí misma.

### Comprueba que quedó

```bash
claude mcp list
```

Debes ver `cloudflare` y `cloudflare-docs` en la lista.

<details>
<summary><b>Si usas Claude de escritorio en vez de Claude Code</b></summary>

Abre el archivo de configuración de Claude Desktop y agrega esto:

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://mcp.cloudflare.com/mcp"]
    },
    "cloudflare-docs": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://docs.mcp.cloudflare.com/mcp"]
    }
  }
}
```

Reinicia Claude Desktop y listo.
</details>

<details>
<summary><b>Si algo falla con MCP</b></summary>

- `claude mcp list` no lo muestra → quítalo y vuelve a agregarlo:
  `claude mcp remove cloudflare` y repite el comando de arriba.
- Dice que no puede autenticarse → completa el permiso en el navegador cuando te lo pida.
- **MCP no es obligatorio.** Si no logras conectarlo, Claude puede hacer todo igual usando
  la herramienta `wrangler` desde la terminal. Solo es más cómodo con MCP.
</details>

---

## 4. Paso 3 — Dile esto a Claude

Ya con todo listo, abre Claude Code **dentro de la carpeta de este proyecto** y pégale
este mensaje tal cual:

```
Lee el archivo EMPIEZA-AQUI.md y el CLAUDE.md de este repo.

Soy el dueño de PanaClaw y no programo. Quiero desplegar mi primer bot en
mi cuenta de Cloudflare. Ya tengo:
- Cuenta de Cloudflare con plan Workers Paid
- Una llave de IA
- El MCP de Cloudflare conectado

Guíame con el skill /configurar-mi-chatbot. Hazme UNA pregunta a la vez, en
español simple, y corre tú todos los comandos. Antes de empezar explícame
qué vas a hacer y cuánto va a costar.
```

Claude se encarga del resto. Va a preguntarte cosas de tu negocio (cómo se llama, qué
vendes, tus horarios, tu tono) y él pone la parte técnica.

### Lo que va a pasar, para que sepas qué esperar

Son cuatro fases, más o menos 35 minutos:

| Fase | Qué pasa | Qué te va a pedir |
|---|---|---|
| **1. La plataforma** | Crea tu base de datos, tu buscador y despliega el bot | Autorizar Cloudflare, tu llave de IA |
| **2. El chatbot** | Le da personalidad: tu negocio, tus precios, tus reglas | Datos de tu negocio |
| **3. Las conexiones** | Conecta WhatsApp / Telegram / Instagram | Tokens de esos canales |
| **4. Prueba final** | Le mandas un mensaje real y ves que conteste | Tu teléfono |

Al terminar, tu panel vive en una dirección así:

```
https://panaclaw-generico-a1b2c3.workers.dev/admin
```

Te recibe una pantalla de entrada con el logo de tu negocio. Solo pide **la contraseña**
que hayas elegido — no hay usuario que recordar.

---

## 5. Reglas de seguridad (estas no se rompen)

### 🔑 Nunca pegues llaves ni contraseñas en el chat

Ni a Claude, ni por correo, ni en un documento. Van guardadas como **secretos de Cloudflare**,
que es una caja fuerte donde ni Claude ni nadie las puede leer después. Claude sabe hacerlo:
usa el comando `wrangler secret put`, que te las pide en una entrada oculta.

Si por accidente ya pegaste una llave en algún lado: **bórrala del proveedor y genera una
nueva**. No la reutilices.

### 🔐 Una contraseña distinta por cada bot

El panel se protege con **una sola contraseña**. Si montas
bots para varios negocios y les pones la misma contraseña, **cualquiera de ellos puede entrar
al panel de los demás**.

Para generar una buena, pídele a Claude: *"genérame una contraseña segura para este bot"*.
Guárdala en un gestor de contraseñas y entrégasela al dueño por un canal privado
(no por WhatsApp de grupo, no por correo compartido).

### 💰 Ponle tope de gasto a cada bot

En el panel → sección **Costos** puedes fijar un presupuesto mensual. **Hazlo siempre.**
Si un bot se vuelve popular de golpe, sin tope la factura de IA te llega sin aviso.

### 📋 Tú eres responsable de los datos

Las conversaciones de los clientes viven en tu cuenta de Cloudflare. Si montas bots para
otros negocios, eso significa que **tú** guardas los datos de *sus* clientes. Déjalo por
escrito en tu contrato. El detalle legal está en [`PRIVACY.md`](./PRIVACY.md).

---

## 6. Que se vea como tu marca (dominio propio)

La dirección `panaclaw-generico-a1b2c3.workers.dev` funciona perfecto, pero se ve técnica.
Cloudflare te deja ponerle **tu propio dominio** a cada bot, gratis, y él se encarga solo del
certificado de seguridad.

Quedaría así:

```
panel.tunegocio.com          ← la marca de tu cliente
tacos.tumarca.com            ← o tu propia marca
```

Pídeselo a Claude: *"ponle el dominio panel.minegocio.com a este bot"*. Son tres líneas de
configuración. **Nadie sabrá nunca que por debajo hay un `workers.dev`.**

---

## 7. Cuánto cuesta de verdad

| Concepto | Costo | Nota |
|---|---|---|
| Cloudflare (Workers Paid) | **$5 USD/mes** | Cubre TODOS tus bots, no es por bot |
| Cerebro de IA | **~$1–2 USD/mes por bot** | Solo pagas lo que el bot piensa |
| Este software | **$0** | Es tuyo, código abierto |
| Mensualidad a alguien | **$0** | No le pagas a nadie por usarlo |

Un bot para un negocio normal sale en **$6–7 USD al mes en total**. Con diez clientes,
alrededor de $20 (los $5 se comparten).

**El techo:** una cuenta de Cloudflare aguanta unos **250 bots**. El límite que se agota
primero no es el obvio — es el de "tareas programadas", porque cada bot usa una para limpiar
mensajes viejos cada noche. Si algún día llegas ahí, avísale a Claude y él te explica el
siguiente paso.

---

## 8. El día a día — cómo le pides cosas a Claude

Este proyecto trae "recetas" (skills) que Claude ya sabe seguir. No tienes que memorizarlas:
háblale normal y él escoge la correcta.

| Si quieres… | Dile algo como… |
|---|---|
| Montar un bot nuevo | *"ármame un chatbot"* |
| Montar bots para varios clientes | *"quiero dar de alta un cliente nuevo"* |
| Ver cómo le fue este mes | *"hazme el reporte del mes"* |
| Bajar tus prospectos a Excel | *"exporta mis leads"* |
| Traer mejoras nuevas del código | *"actualiza mi bot"* |
| Reportar un error | *"abre un issue con este problema"* |

Las recetas completas están en la carpeta `skill/`, si algún día quieres leerlas.

---

## 9. Si algo sale mal

**Primero, siempre:** pídele a Claude que corra el diagnóstico.

```
corre el doctor de mi bot y explícame en simple qué está mal
```

Eso revisa la configuración, si la base de datos responde, si el bot está en línea y si los
canales están bien conectados.

### Problemas típicos

| Síntoma | Qué suele ser |
|---|---|
| "wrangler.toml todavía es la plantilla" | No se instaló con el CLI. Dile a Claude: *"instálalo con el CLI"* |
| El bot no contesta en WhatsApp | El canal no quedó conectado — revisa la fase 3 |
| El panel pide contraseña y no la acepta | Se guardó otra. Dile a Claude que la vuelva a poner |
| "No space" o errores raros al instalar | Falta Node o pnpm. *"revisa mis herramientas"* |
| El bot contesta cosas raras o se salta pasos | Sube el cerebro a **Máximo** en el panel → Configuración |

Si nada de eso lo arregla, abre un reporte en
[GitHub Issues](https://github.com/abrinay1997-stack/CRM-PANACLAW/issues) con: qué hiciste, qué
esperabas, y lo que dijo el doctor.

---

## 10. Cosas que conviene que sepas del proyecto

- **Es tuyo.** Licencia MIT: úsalo, cámbialo, véndelo, cobra por él. Sin permisos que pedir.
- **No manda información a nadie.** No hay telemetría, ni "llamadas a casa", ni activación.
  Los datos de tus clientes viven en tu Cloudflare y solo el proveedor de IA que elegiste ve
  el texto de las conversaciones (con tu llave, para poder responder).
- **Los mensajes se borran solos a los 90 días.** Los prospectos y tickets se quedan hasta
  que tú los borres.
- **Si preguntan si es un bot, el bot lo admite.** No lo configures para negarlo — es lo
  correcto y en varios países es obligatorio.
- **Todo viene desbloqueado.** No hay versión de pago, ni funciones capadas, ni licencias.

### De dónde viene este código

CRM PanaClaw es un derivado de **[Forja](https://github.com/santmun/forja)**, creado por
**Horizontes IA** y publicado con licencia MIT. Esa licencia permite este uso —incluido el
comercial— siempre que se conserve el aviso de copyright original, y así está en el archivo
[`LICENSE`](./LICENSE).

PanaClaw **no está afiliado a Horizontes IA ni respaldado por ellos**, y no usa nada de su
infraestructura: este proyecto no llama a sus servidores ni usa sus licencias.

---

## 11. Referencia rápida de archivos

Por si algún día quieres husmear (o para que Claude sepa dónde buscar):

| Archivo / carpeta | Qué es |
|---|---|
| `EMPIEZA-AQUI.md` | Este documento |
| `README.md` | Explicación técnica del proyecto |
| `CLAUDE.md` | Instrucciones para Claude — léelo antes de tocar código |
| `skill/` | Las recetas paso a paso que Claude sigue |
| `skill/configurar-mi-chatbot.md` | La instalación completa, en 4 fases |
| `skill/modo-agencia.md` | Cómo llevar varios clientes a la vez |
| `member/` | **Tus datos de negocio.** No se borra al actualizar |
| `wrangler.toml` | La configuración de tu bot en Cloudflare |
| `src/` | El código del bot y del panel |
| `PRIVACY.md` | Qué datos se guardan y por cuánto tiempo |

---

<div align="center">

**¿Listo?** Vuelve al [Paso 3](#paso-3--dile-esto-a-claude), pégale ese texto a Claude
y en un rato tienes tu bot contestando.

</div>
