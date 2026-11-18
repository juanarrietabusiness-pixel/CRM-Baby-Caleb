# Imagen de la prueba de humo. La construye wrangler y la empuja al registro de
# Cloudflare — por eso el token necesita "Cloudflare Images: Edit".
#
# Node 22 y no 20: es el mismo piso que exige wrangler, y no vale la pena correr
# el runtime del contenedor en una versión que ya se está retirando.
#
# Dos etapas a propósito. Baileys necesita `git` para instalarse (ver abajo),
# pero `git` no tiene por qué viajar en la imagen final: menos superficie y
# menos disco, que en Containers se factura por GB-segundo las 24 horas.

# ── Etapa 1: instalar dependencias ─────────────────────────────────────────
FROM node:22-bookworm-slim AS dependencias

# Baileys depende de `libsignal` desde un repositorio de GitHub, no desde el
# registro de npm. La imagen slim no trae git, y sin git `npm install` muere con
# "npm error enoent An unknown git error occurred" — un mensaje que no nombra a
# git por ningún lado y manda a buscar el problema al lugar equivocado.
#
# El `insteadOf` es la otra mitad: npm resuelve ese repositorio como
# `git+ssh://git@github.com/...`, y un build de Docker no tiene llave SSH.
# Reescribirlo a https lo deja clonar sin credenciales.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "git@github.com:" \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ── Etapa 2: lo que de verdad corre ────────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json servidor.mjs propios.mjs ./

# El Worker habla con este puerto vía ctx.container.getTcpPort(8080).
EXPOSE 8080

# Sin capa de init: si el proceso de Node se cae, queremos que el contenedor
# muera y que el Worker lo note y lo levante. Un supervisor adentro escondería
# exactamente el fallo que esta prueba busca medir.
CMD ["node", "servidor.mjs"]
