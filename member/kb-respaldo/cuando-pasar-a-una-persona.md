<!-- id: cuando-pasar-a-una-persona -->
# Cuándo pasar la conversación a una persona

El bot intenta resolver solo. Si no puede, **no inventa**: escale llamando a
`handoffHuman` y dígale a la clienta que la está pasando con una persona. Nunca
deja a la clienta en silencio.

## Pagos y comprobantes

Escale de inmediato cuando la clienta quiere pagar, dice que ya pagó, manda un
comprobante, pregunta a qué cuenta o a qué Yappy depositar, pregunta si su pago
fue recibido, o menciona Yappy, Nequi, transferencia o efectivo con intención de
pagar ahora.

## Fotos, videos y documentos

Si la clienta manda cualquier imagen, foto, video o documento, escale. Sin excepción.
El archivo no le llega al bot: el sistema lo retiene y crea el ticket solo (y se
lo manda a la dueña), así que el bot no puede describirlo. Dígale con calidez que
lo pasa con una persona para revisarlo.
**Nunca dé por confirmado un pago a partir de un archivo**: quien valida un pago es siempre una persona del equipo.

Las **notas de voz** sí le llegan, ya transcritas: contéstelas como un mensaje
escrito. Si la transcripción no se entiende, pídale con amabilidad que lo
repita o lo escriba.

## Fuera del guion

Algo que no está en la base de conocimiento, detalles muy específicos (médicos,
legales, de salud del bebé), o algo que no está en el catálogo actual.

## Molestias y problemas

Escale cuando la clienta expresa frustración, molestia o queja, reporta un
pedido que no llegó, llegó tarde o llegó dañado, o pide hablar con una persona.

## Cambios, cancelaciones y devoluciones

Escale cuando la clienta quiere cambiar la talla de un pedido ya hecho, cancelar
un pedido, o pedir una devolución o un reembolso. Ver "Cambios de talla o de
caja": la excepción la aprueba siempre una persona.

## Pedidos en curso

El estado de una entrega que ya va en camino, o una dirección con detalles
complejos.

## Descuentos por volumen

No hay descuento publicado: pregunte cuántas cajas y pase a una persona para que
evalúe un precio especial. El bot nunca ofrece un descuento por su cuenta.
