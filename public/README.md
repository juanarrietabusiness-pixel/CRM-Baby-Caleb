# `public/` — la marca de la plataforma

Todo lo que vive aquí se sirve **tal cual** desde la raíz del Worker. Un archivo
`public/logo.svg` queda en `https://<tu-worker>.workers.dev/logo.svg`.

No hay paso de compilación: lo que está aquí es lo que se publica.

## Qué hay

| Archivo | Dónde se usa |
|---|---|
| `logo.svg` | la marca del panel, en el menú y en la pantalla de entrada |
| `favicon.svg` | el icono de la pestaña del navegador |
| `favicon-32.png` | respaldo para navegadores que no leen SVG |
| `apple-touch-icon.png` | el icono al guardar el panel en la pantalla de un teléfono |

Los cuatro son los mismos archivos del sitio de PanaClaw, así que el panel y la
página web se ven de la misma familia.

## Esto es marca de plataforma, no del negocio

**Estos archivos no son un punto de personalización.** El panel es PanaClaw, del
mismo modo que la administración de una tienda Shopify lleva el logo de Shopify
aunque la tienda sea de otra persona.

El reparto es así:

| Es del negocio que instala | Es de la plataforma |
|---|---|
| El nombre — sale de `BUSINESS_NAME` y aparece en la pantalla de entrada | El logo |
| El bot, su tono y su base de conocimiento | Los iconos de pestaña |
| Las conversaciones, los leads y todos los datos | La paleta y las tipografías |

Por eso `panaclaw update` **sí** pisa esta carpeta, a diferencia de `member/`,
que es del negocio y nunca se toca. Si alguien cambia el logo, la siguiente
actualización lo devuelve a su sitio. Eso es intencional — ver la nota en
`cli/bin/cli.js`, en `extractOver`.

## Hasta dónde llega eso

Conviene decirlo sin adornos: **la marca es la predeterminada y se restaura sola,
pero no es técnicamente inviolable.**

Este repo es MIT y el bot corre en la cuenta de Cloudflare de quien lo instala,
con el código en su disco. Quien sepa programar puede pisar `logo.svg` y no
volver a actualizar nunca. Shopify puede blindarlo porque su panel corre en
servidores de Shopify; aquí no es el caso, y ningún truco en el código cambia
eso.

Lo que sí se consigue: que la marca sea el estado por defecto, que vuelva en
cada actualización y que la documentación no invite a cambiarla.

## Si cambia el logo de la marca

Se pisan los cuatro archivos y se despliega. Los originales del logo viven en el
repo del sitio (`PanaClaw/brand-assets/`), junto con la receta para regenerar
los iconos.

Tres cosas que conviene respetar:

1. **Que sea SVG.** Se dibuja a 34 px en el menú y a 42 px en la pantalla de
   entrada; un PNG chico se ve borroso en pantallas retina.
2. **Que la silueta llene el lienzo**, sin márgenes vacíos alrededor. Si el SVG
   trae aire de sobra, el logo se ve diminuto dentro de su caja.
3. **Que el color sea sólido.** El de hoy va pintado de `#FF5100` en el atributo
   `fill` del `<svg>`.
