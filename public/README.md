# `public/` — la marca de la plataforma

Todo lo que vive aquí se sirve **tal cual** desde la raíz del Worker. Un archivo
`public/logo.png` queda en `https://<tu-worker>.workers.dev/logo.png`.

No hay paso de compilación: lo que está aquí es lo que se publica.

## Qué hay

| Archivo | Tamaño | Dónde se usa |
|---|---|---|
| `logo.png` | 256 px | la marca del panel, en el menú y en la pantalla de entrada |
| `favicon-32.png` | 32 px | el icono de la pestaña del navegador |
| `favicon-192.png` | 192 px | el mismo icono en pantallas retina y al instalar el panel |
| `apple-touch-icon.png` | 180 px | el icono al guardar el panel en la pantalla de un teléfono |

Los cuatro salen del `logo.png` del sitio de Juancito Ads, así que el panel y la
página web se ven de la misma familia.

**Son PNG, no SVG, y es a propósito.** El logo de Juancito Ads es una ilustración
3D con degradados, no una silueta plana: en SVG pesaría más y se vería peor. A
cambio hay que respetar los tamaños de arriba — `logo.png` se dibuja a 34 px en
el menú y a 42 px en la entrada, así que 256 px cubre pantallas retina con
holgura sin pesar.

**El recorte importa.** Los cuatro archivos llevan solo la marca (el megáfono con
las letras JA), sin la palabra "JUANCITO" que trae el logo completo del sitio: a
34 px esa palabra es una mancha ilegible. El nombre ya lo pone el panel al lado,
en texto de verdad.

`apple-touch-icon.png` es el único sin transparencia — va compuesto sobre el azul
marino de la marca (`#050D1F`), porque iOS rellena de negro lo que sea
transparente y el logo quedaría flotando en un cuadro que no es nuestro.

## Esto es marca de plataforma, no del negocio

**Estos archivos no son un punto de personalización.** El panel es Juancito Ads, del
mismo modo que la administración de una tienda Shopify lleva el logo de Shopify
aunque la tienda sea de otra persona.

El reparto es así:

| Es del negocio que instala | Es de la plataforma |
|---|---|
| El nombre — sale de `BUSINESS_NAME` y aparece en la pantalla de entrada | El logo |
| El bot, su tono y su base de conocimiento | Los iconos de pestaña |
| Las conversaciones, los leads y todos los datos | La paleta y las tipografías |

Por eso `juancitoads update` **sí** pisa esta carpeta, a diferencia de `member/`,
que es del negocio y nunca se toca. Si alguien cambia el logo, la siguiente
actualización lo devuelve a su sitio. Eso es intencional — ver la nota en
`cli/bin/cli.js`, en `extractOver`.

## Hasta dónde llega eso

Conviene decirlo sin adornos: **la marca es la predeterminada y se restaura sola,
pero no es técnicamente inviolable.**

Este repo es MIT y el bot corre en la cuenta de Cloudflare de quien lo instala,
con el código en su disco. Quien sepa programar puede pisar `logo.png` y no
volver a actualizar nunca. Shopify puede blindarlo porque su panel corre en
servidores de Shopify; aquí no es el caso, y ningún truco en el código cambia
eso.

Lo que sí se consigue: que la marca sea el estado por defecto, que vuelva en
cada actualización y que la documentación no invite a cambiarla.

## Si cambia el logo de la marca

El original vive en el repo del sitio, en
[`PAGINA-JUANCITO-ADS/public/logo.png`](https://github.com/juanarrietabusiness-pixel/PAGINA-JUANCITO-ADS).
Los cuatro archivos de aquí se regeneran de él con
`scripts/brand-icons.mjs` (recorta la marca, la centra y escala a los cuatro
tamaños):

```bash
node scripts/brand-icons.mjs ../PAGINA-JUANCITO-ADS/public/logo.png
```

Tres cosas que conviene respetar si algún día se hace a mano:

1. **Que la silueta llene el lienzo**, sin márgenes vacíos alrededor. Si el
   archivo trae aire de sobra, el logo se ve diminuto dentro de su caja.
2. **Que `logo.png` no baje de 256 px.** Por debajo se nota borroso a 42 px en
   una pantalla retina.
3. **Que el fondo sea transparente** en los tres primeros. El panel es azul
   marino; un cuadro blanco detrás del logo se ve como un error.
