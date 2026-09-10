# Los cinco documentos que vivían en /admin/kb (agosto 2026)

Copia de respaldo, tomada de D1 el 2026-09-10 antes de retirarlos. **No se
indexan**: están fuera de `member/kb/` a propósito, y este README no es KB.

Se escribieron desde el panel el 2026-08-12, así que nunca estuvieron en git:
nadie los revisó y nadie vio un diff de ellos. Convivían en el mismo índice de
Vectorize con los de `member/kb/`, que es la superposición que este trabajo vino
a cerrar.

## Por qué se retiran

`compra-delivery-y-pagos` le decía al bot que **no estaban definidos** el costo
del delivery, si hay que abonar antes, y si los pañales son de pants o de
cierre — y que ante esas tres pasara a una persona. En agosto era la respuesta
correcta. Con el documento de la dueña de 2026-09 las tres tienen respuesta, y
son de las preguntas más frecuentes: el bot estaba escalando conversaciones que
ya puede resolver.

`productos-y-marcas` listaba **WIPES NATEEN**, que hoy no se manejan.

Los otros tres eran correctos. Lo que valía la pena de ellos ya está integrado
en `member/kb/`, en trato de usted:

| De aquí | Se mudó a |
|---|---|
| Traslape de tallas · elegir en el borde · la XXL como diferenciador | `01-tallas-y-productos.md` |
| Nunca decir una marca que no es · no exagerar · no minimizar una preocupación de salud · no dar consejo médico | `04-uso-del-producto.md` |
| Por qué elegirnos · canales completos · el eslogan como cita | `05-el-negocio.md` |

## Cómo se retiran (importante)

**Desde `/admin/kb`, borrándolos uno por uno.** No con SQL.

Borrar la fila de `kb_docs` a mano deja **huérfanos los vectores** en Vectorize:
el índice guarda `dash:<id>#0` … `#23` por documento, y solo la ruta del panel
llama a `removeDocVectors`. Un reindex general tampoco los limpia, porque hace
`upsert` por id y nunca borra. Es decir: si se borra la fila por SQL, el
contenido viejo se queda contestando para siempre y sin dejar rastro de dónde
salió.
