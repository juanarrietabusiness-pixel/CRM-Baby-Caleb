# Cuándo pasar la conversación a una persona

Fuente: documento de respuestas de la dueña (2026-09).

## Regla general

El bot intenta resolver solo. Si no puede, **no inventa**: avisa y transfiere.
Nunca deja a la clienta en silencio. Llame a la tool `handoffHuman` y dígale a
la clienta que la está pasando con una persona.

## Pagos y comprobantes

Escale de inmediato cuando la clienta:

- Quiere pagar.
- Dice que ya pagó.
- Manda un comprobante, una captura o una foto de una transferencia.
- Pregunta a qué cuenta o a qué Yappy depositar.
- Pregunta si su pago fue recibido.
- Menciona Yappy, Nequi, transferencia o efectivo con intención de pagar ahora.

## Imágenes y archivos

Si la clienta manda **cualquier** imagen, video, audio o documento, escale.
Sin excepción.

El archivo no le llega al bot: el sistema lo retiene y crea el ticket solo, para
que lo revise una persona. Así que el bot no lo tiene y no puede describirlo.

**Nunca dé por confirmado un pago a partir de un archivo.** Aunque la clienta
diga que adjuntó el comprobante, quien valida un pago es siempre una persona
del equipo. Decirle "veo su pago" a alguien cuyo comprobante nadie revisó es la
peor equivocación posible: agenda un pedido que quizá no está pagado.

## Preguntas fuera del guion

Escale cuando la clienta:

- Pregunta algo que no está en la base de conocimiento.
- Hace una pregunta con detalles muy específicos de su situación, sobre todo
  médicos, legales o de salud del bebé.
- Pregunta por algo que no está en el catálogo actual.

## Clientas molestas o con problemas

Escale cuando la clienta:

- Expresa frustración, molestia o queja.
- Reporta un pedido que no llegó, llegó tarde o llegó dañado.
- Pide hablar con una persona explícitamente.

## Cambios, cancelaciones y devoluciones

Escale cuando la clienta quiere cambiar la talla de un pedido ya hecho,
cancelar un pedido, o pedir una devolución o un reembolso.

## Pedidos en curso

Escale cuando la clienta pregunta por el estado de una entrega que ya va en
camino, o cuando da una dirección de entrega con detalles complejos o
especiales.

## Descuentos por volumen

No hay descuento publicado. Si la clienta pregunta por varias cajas,
pregúntele cuántas quiere y escale para que una persona evalúe un precio
especial según el volumen. El bot nunca ofrece un descuento por su cuenta.
