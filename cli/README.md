# panaclaw

**Chatbots de IA para tu negocio, desde tu terminal.** `panaclaw` instala y mantiene
bots de IA por giro (restaurante, barbería, inmobiliaria, clínica…) en **tu propia
cuenta de Cloudflare**, con **tus llaves**. El bot es tuyo — para usarlo o revenderlo.

Pensado para que lo maneje tu **agente de IA** (Claude Code o Codex): tú respondes
preguntas de negocio y apruebas; el agente corre lo técnico.

> Parte de [CRM - PanaClaw](https://github.com/abrinay1997-stack/CRM-PANACLAW). Gratis y open source (MIT).

---

## Instalación

No necesitas instalar nada global. Se corre con `npx`:

```bash
npx panaclaw init
```

Requisitos:

- **Node 18+** (para `npx`).
- Una cuenta **gratis de Cloudflare** (ahí vive tu bot).
- Un **agente de IA** — [Claude Code](https://claude.com/claude-code) o Codex — para ejecutar los pasos.
- Una **llave de IA** (Anthropic, OpenAI o xAI). Se guarda como *secreto de Cloudflare*, nunca en el CLI.

## Inicio rápido

```bash
# 1 · asistente: elige idioma/región y giro, y te entrevista del negocio
npx panaclaw init

# 2 · verifica que todo esté sano
npx panaclaw doctor

# 3 · mantente al día cuando saquemos mejoras (sin perder tu configuración)
npx panaclaw update
```

`init` baja la plantilla del giro que elijas y te hace unas preguntas del negocio.
Al terminar, tu agente despliega el bot a Cloudflare y tú abres tu panel en
`https://<tu-worker>.workers.dev/admin`.

### Tu agente aprende a usar PanaClaw

La primera vez, `panaclaw` instala una guía para tu agente en
`~/.claude/skills/panaclaw/` (Claude Code). Con eso tu agente sabe cómo usar el CLI y el flujo
completo: instalar, configurar, desplegar y operar el bot. Puedes desactivarlo con
`--no-agent-skill` o la variable `PANACLAW_NO_AGENT_SKILL=1`.

## Comandos

| Comando | Qué hace |
|---|---|
| `panaclaw init` | Asistente interactivo: idioma/región, elige el giro, entrevista de negocio e instala. |
| `panaclaw list` | Muestra los giros disponibles. |
| `panaclaw install <slug>` | Instala un giro específico sin el asistente. |
| `panaclaw update [carpeta]` | Trae la versión nueva **conservando** tu `member/` (config, base de conocimiento). |
| `panaclaw doctor [carpeta]` | Diagnóstico del bot instalado: versión, archivos, config y si el worker responde. |
| `panaclaw ayuda` | Dónde pedir ayuda. |

Opciones útiles:

- `--email tu@correo.com` `--name "Tu Nombre"` — precarga datos sin teclearlos en el asistente.
- `--region es-419|es-ES|en|pt-BR` — idioma, moneda y zona horaria de arranque.
- `--force` (en `update`) — reinstala aunque ya estés en el último commit.
- Todo el onboarding acepta flags (pensado para que tu **agente** lo corra sin menús):
  `--giro --negocio --que --ofrece --horario --ubicacion --telefono --web --pagos --faq --reglas --tono --cerebro --yes`.

El asistente usa **menús con flechas** (↑/↓ + enter). Si corres en un entorno sin
terminal interactiva (CI, scripts), cae automáticamente a listas numeradas.

Las preferencias (idioma/región) se guardan en `~/.panaclaw/config.json`. La versión
instalada vive en el marcador `.panaclaw-bot.json` dentro de la carpeta de tu bot.

### De dónde sale el código

El CLI baja el repo público desde GitHub — no hay servidor de distribución ni licencias
que validar. Para probar un fork o una rama:

```bash
PANACLAW_REPO=miusuario/mi-fork PANACLAW_REF=develop npx panaclaw init
```

## Los comandos del agente

Una vez instalado, operas el bot pidiéndole **skills** a tu agente (no son subcomandos
de `panaclaw`, son instrucciones que tu agente ejecuta sobre el bot ya instalado):
`configurar-mi-chatbot`, `actualizar-mi-bot`, `reporte`, `exportar` y `contribuir`.

Le hablas normal a tu agente ("hazme el reporte del mes") y él sabe cuál usar.

## Sin planes ni licencias

PanaClaw es **gratis y open source** (MIT). No hay tiers, llaves, límites de instalación
ni cuenta que crear: todo viene desbloqueado. Lo único que pagas es tu propia
infraestructura — tu Cloudflare y tu llave de IA.

## Documentación

Guía completa y referencia de comandos:
**https://github.com/abrinay1997-stack/CRM-PANACLAW#readme**

## Privacidad

`panaclaw` corre en tu máquina y **no manda nada a ningún servidor nuestro** — no
existe tal servidor. Solo baja el código público desde GitHub. El bot y todos sus
datos viven en **tu** Cloudflare, con **tus** llaves.

---

© PanaClaw · [github.com/abrinay1997-stack/CRM-PANACLAW](https://github.com/abrinay1997-stack/CRM-PANACLAW)

## 🔍 ¿Es seguro? Verifícalo tú mismo

Es sano desconfiar de un `npx` que no conoces — si tu agente de IA se niega a ejecutarlo, está haciendo su trabajo. Aquí está todo lo que necesitas para comprobarlo en un minuto:

- **El código es este mismo repositorio**, carpeta [`cli/`](./bin/cli.js). Lo que se publica en npm es exactamente ese archivo: puedes leerlo completo antes de correr nada.
- **No tiene dependencias.** Cero paquetes de terceros: el `package.json` no declara ninguna. Nada que se pueda comprometer río arriba.
- **No recolecta datos tuyos.** No manda telemetría ni analíticas, y no hay servidor propio con el que hable. Solo contacta **github.com** para bajar el código y npm para instalarse.
- **Tu API key nunca pasa por aquí.** El CLI jamás la pide ni la guarda: va como secreto a *tu* cuenta de Cloudflare (`wrangler secret put`).
- **Licencia MIT**, publicado por PanaClaw.

Compruébalo con:

```bash
npm view panaclaw            # autor, licencia, repositorio
npm view panaclaw dist.tarball   # bájalo y léelo antes de ejecutarlo
```

Y si prefieres no usar `npx`, clona este repo y corre `node cli/bin/cli.js init` directamente.

### Por qué el CLI pide estos permisos

Los escáneres de cadena de suministro (Socket y similares) marcan las *capacidades* de un paquete. Un instalador necesita varias por definición; aquí está para qué usa cada una, y puedes comprobarlo en [`bin/cli.js`](./bin/cli.js):

| Capacidad | Para qué la usa | Cómo está acotada |
|---|---|---|
| **Red** (`fetch`) | Baja el código del bot desde GitHub y consulta el último commit. | Solo dos hosts: `codeload.github.com` y `api.github.com`. **No levanta ningún servidor local** ni escucha en ningún puerto. |
| **Shell** (`node:child_process`) | Descomprimir el bot (`tar`) y correr `wrangler` para leer/guardar secretos en TU Cloudflare. | Siempre con `execFileSync` y **arreglo de argumentos**, nunca una cadena de shell: no hay forma de inyectar comandos. Cero `shell: true`. |
| **Variables de entorno** | Únicamente las suyas: `PANACLAW_REPO`, `PANACLAW_REF`, `PANACLAW_YES`, `PANACLAW_NO_ART`, `PANACLAW_NO_AGENT_SKILL`, y `NO_COLOR` (estándar). | **No lee ninguna credencial del sistema.** Nada de tokens de nube, claves de npm ni variables ajenas. |
| **Sistema de archivos** | Escribe la carpeta del bot que instalas, tus preferencias en `~/.panaclaw/` y la guía del agente en `~/.claude/skills/panaclaw/`. | Nada fuera de eso. |
| **Cadenas URL** | Solo GitHub, y las APIs de los canales en el diagnóstico (`doctor --whatsapp` consulta la Graph API de Meta con el token que TÚ le pasas). | No hay direcciones IP ni dominios opacos. |

Y lo más importante: **tu API key nunca pasa por el CLI**. Cuando toca guardarla, se hace con `wrangler secret put` contra *tu* cuenta de Cloudflare — el CLI nunca la recibe, ni la escribe en disco, ni la manda a ningún lado.
