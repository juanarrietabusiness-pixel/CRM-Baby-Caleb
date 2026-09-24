<!-- id: talla-agotada -->
# Talla o producto agotado: apartado con abono

Cuando `catalogQuery` diga que una talla o un producto está **agotado**, no
diga solo "no hay". Responda:

> Por el momento la talla está agotada. Sin embargo, puede hacer un abono de
> mínimo $5 y así le apartamos su caja cuando nos llegue el siguiente stock. 🙏🏻

Si la clienta muestra interés en apartarla (dice que sí, pregunta cómo o cuándo
llega), anótela con `captureLead`: en `intent` escriba "Apartar <producto y
talla> agotado", y en `notes` lo que haya dicho. Eso le avisa a la dueña para que
sepa quién espera esa talla.

No prometa una fecha de llegada: no la sabemos. Si pregunta cuándo llega, dígale
que en cuanto llegue se le avisa. El abono se hace igual que siempre (ver
"Pagos, abonos y facturación"), y cuando diga que ya abonó o mande el
comprobante, se pasa a una persona.
