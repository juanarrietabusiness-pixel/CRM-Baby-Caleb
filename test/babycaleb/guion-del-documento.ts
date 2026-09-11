/**
 * El guion de la dueña, convertido en casos comprobables.
 *
 * Cada entrada es una pregunta REAL del documento —tal como la escribe una
 * clienta por WhatsApp— junto con los datos que la respuesta tiene que llevar
 * y de dónde deben salir. Sirve para dos cosas:
 *
 *  1. `test/babycaleb/guion.test.ts` comprueba, sin red y sin llave de IA, que
 *     el bot TIENE de dónde sacar cada respuesta: que el dato está en la
 *     fuente que le toca y que ninguna fuente contradice a la otra.
 *  2. Cuando haya llave de IA, las mismas preguntas se le pueden mandar al bot
 *     desplegado para juzgar cómo las redacta.
 *
 * Lo que esto SÍ garantiza: que el bot no puede quedarse sin el dato, y que no
 * lo va a encontrar en dos sitios distintos diciendo cosas distintas.
 * Lo que NO garantiza: la redacción exacta de una respuesta generada por un
 * modelo. Eso se mide con el bot en vivo.
 */

export type Fuente =
  /** Precio, existencia o qué productos hay: solo catalogQuery. */
  | "catalogo"
  /** Tarifa de delivery por zona: solo cotizarEnvio. Es una tabla, no un texto. */
  | "envio"
  /** Políticas, tarifas, uso del producto: solo searchKb. */
  | "kb"
  /** El bot no contesta: pasa con una persona. */
  | "escalada";

export interface CasoDelGuion {
  id: string;
  /** Lo que escribe la clienta, en su forma real. */
  pregunta: string;
  fuente: Fuente;
  /** Fragmentos que la fuente TIENE que contener para poder contestar. */
  debeContener: string[];
  /** Fragmentos que NO deben aparecer en la fuente (fugas o contradicciones). */
  noDebeContener?: string[];
}

export const GUION: CasoDelGuion[] = [
  // ── Producto y tallas ───────────────────────────────────────────────────
  {
    id: "talla-por-peso",
    pregunta: "hola, mi bebé pesa 15 libras, ¿qué talla le sirve?",
    fuente: "kb",
    debeContener: ["8–19 lbs", "15–39 lbs", "por el peso actual"],
  },
  {
    id: "prematuro",
    pregunta: "¿tienen pañales para prematuro?",
    fuente: "kb",
    debeContener: ["prematuro", "talla RN"],
  },
  {
    id: "cuantos-trae-la-caja",
    pregunta: "¿cuántos pañales trae la caja de la M?",
    fuente: "catalogo",
    debeContener: ["144"],
  },
  {
    id: "precio-talla-m",
    pregunta: "¿cuánto vale la caja de talla M?",
    fuente: "catalogo",
    debeContener: ["$50.00"],
  },
  {
    id: "duracion-caja",
    pregunta: "¿cuánto me dura una caja?",
    fuente: "kb",
    debeContener: ["20 a 25 días", "8 a 12 pañales"],
  },
  {
    id: "cierre-o-pants",
    pregunta: "¿son de cierre o de pants?",
    fuente: "kb",
    debeContener: ["cintas adhesivas", "pull-ups", "de la talla L en adelante"],
  },
  {
    id: "solo-caja-completa",
    pregunta: "¿puedo comprar solo un paquete?",
    fuente: "kb",
    debeContener: ["no se venden paquetes sueltos", "cajas completas"],
  },
  {
    id: "mayorista",
    pregunta: "¿tienen precio al por mayor? soy revendedora",
    fuente: "kb",
    debeContener: ["revendedores"],
  },
  {
    id: "panales-dany-baby-no",
    pregunta: "¿tienen pañales Dany Baby?",
    fuente: "kb",
    debeContener: ["Pañales Dany Baby: no se manejan", "Nateen"],
  },
  {
    id: "wipes-nateen-no",
    pregunta: "¿van a llegar más wipes nateen?",
    fuente: "kb",
    debeContener: ["Wipes Nateen: hoy no se manejan", "se le avisará"],
  },
  {
    id: "fular-colores",
    pregunta: "¿el fular viene en otros colores?",
    fuente: "kb",
    debeContener: ["gris", "verde menta", "no invente un color"],
  },
  {
    id: "fular-cesarea",
    pregunta: "tuve cesárea hace poco, ¿puedo usar el fular?",
    fuente: "kb",
    debeContener: ["cesárea", "autorización previa", "No dé consejo médico"],
  },

  // ── Envíos y pagos ──────────────────────────────────────────────────────
  {
    id: "delivery-zona-conocida",
    pregunta: "¿cuánto me sale el envío a San Miguelito?",
    fuente: "envio",
    debeContener: ["San Miguelito", "$4.00"],
  },
  {
    id: "delivery-zona-cara",
    pregunta: "¿y a Tocumen cuánto?",
    fuente: "envio",
    debeContener: ["Tocumen", "$8.00"],
  },
  {
    id: "delivery-sin-tildes",
    pregunta: "cuanto sale a juan diaz",
    fuente: "envio",
    debeContener: ["Juan Díaz", "$5.00"],
  },
  {
    id: "delivery-costa-del-este",
    pregunta: "es para Costa del Este, estudio Dreams Factory",
    fuente: "envio",
    debeContener: ["no está en el tarifario", "handoffHuman"],
  },
  {
    id: "delivery-panama-oeste",
    pregunta: "vivo en La Chorrera",
    fuente: "envio",
    debeContener: ["Panamá Oeste", "$3.00 a $6.00", "pasa la conversación a una persona"],
  },
  {
    id: "delivery-no-incluido",
    pregunta: "¿el envío va incluido en el precio?",
    fuente: "kb",
    debeContener: ["costo adicional", "nunca está incluido en el precio"],
  },
  {
    id: "delivery-zona-desconocida",
    pregunta: "¿cuánto cuesta el envío a Penonomé?",
    fuente: "kb",
    debeContener: ["no la calcule por parecido", "pase la conversación a una persona"],
  },
  {
    id: "interior-ferguson",
    pregunta: "vivo en Veraguas, ¿me pueden enviar?",
    fuente: "kb",
    debeContener: ["Veraguas", "Ferguson", "$2.50", "totalidad del producto"],
  },
  {
    id: "mismo-dia",
    pregunta: "¿si pago ahora me llega hoy?",
    fuente: "kb",
    debeContener: ["1:00 p.m.", "sale ese mismo día"],
  },
  {
    id: "fin-de-semana",
    pregunta: "¿entregan sábado o domingo?",
    fuente: "kb",
    debeContener: ["sábados", "domingos no hay entregas"],
  },
  {
    id: "retiro",
    pregunta: "¿puedo pasar a buscarlo?",
    fuente: "kb",
    debeContener: ["Altos de Curundú", "7:00 a.m.", "5:00 p.m.", "un día de anticipación"],
  },
  {
    id: "abono-minimo",
    pregunta: "¿cuánto tengo que abonar para apartar?",
    fuente: "kb",
    debeContener: ["$5.00", "@babycalebpanama", "No se entregan pedidos sin abono"],
  },
  {
    id: "contra-entrega",
    pregunta: "¿es contra entrega?",
    fuente: "kb",
    debeContener: ["Sí y no", "el resto se paga cuando el motorizado entrega"],
  },
  {
    id: "factura",
    pregunta: "¿me pueden hacer factura?",
    fuente: "kb",
    debeContener: ["nombre y", "apellido", "dirección de entrega"],
  },

  // ── Uso del producto ────────────────────────────────────────────────────
  {
    id: "rozaduras",
    pregunta: "¿estos pañales dan rozaduras?",
    fuente: "kb",
    debeContener: ["no producen pañalitis", "pieles sensibles"],
  },
  {
    id: "toda-la-noche",
    pregunta: "¿aguanta toda la noche?",
    fuente: "kb",
    debeContener: ["12 horas", "amarilla a azul"],
  },
  {
    id: "wipes-en-la-cara",
    pregunta: "¿los wipes sirven para la carita?",
    fuente: "kb",
    debeContener: ["carita", "manitos", "hipoalergénicos"],
  },

  // ── Escaladas: el bot NO contesta ───────────────────────────────────────
  {
    id: "escalada-comprobante",
    pregunta: "aquí le mando el comprobante",
    fuente: "escalada",
    debeContener: ["comprobante", "escale"],
  },
  {
    id: "escalada-numero-de-cuenta",
    pregunta: "¿a qué número de cuenta deposito?",
    fuente: "escalada",
    debeContener: ["número de cuenta"],
  },
  {
    id: "escalada-imagen",
    pregunta: "[la clienta manda una foto]",
    fuente: "escalada",
    debeContener: ["imagen", "Sin excepción"],
  },
  {
    id: "escalada-pedido-no-llego",
    pregunta: "mi pedido no ha llegado y ya pasaron dos días",
    fuente: "escalada",
    debeContener: ["no llegó, llegó tarde o llegó dañado"],
  },
  {
    id: "escalada-cambio-talla",
    pregunta: "me llegó la talla equivocada, quiero cambiarla",
    fuente: "escalada",
    debeContener: ["cambiar la talla", "talla equivocada"],
  },
  {
    id: "escalada-descuento-volumen",
    pregunta: "quiero 20 cajas, ¿me hacen precio?",
    fuente: "escalada",
    debeContener: ["cuántas", "nunca ofrece un descuento"],
  },
];
