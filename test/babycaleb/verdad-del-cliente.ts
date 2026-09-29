/**
 * La verdad de Baby Caleb, transcrita del documento de la dueña.
 *
 * Fuente: PREGUNTAS_BABY_CALEB_usted.docx (Yulilka Godoy, 2026-09). Ese
 * documento es la verdad absoluta del negocio: donde contradiga al ADN de la
 * agencia, al seed del catálogo o a cualquier otra cosa del repo, manda él.
 *
 * Esto NO es una segunda fuente de verdad ni algo que el bot lea en runtime.
 * Es la transcripción del documento puesta en un sitio donde una máquina la
 * pueda comparar contra lo que el bot sí lee: el catálogo (src/db/*.sql) y la
 * base de conocimiento (member/kb/). Si alguien cambia un precio en el seed y
 * no lo cambia en el documento —o al revés— los tests de esta carpeta fallan.
 *
 * Para actualizarlo: cuando la dueña mande un documento nuevo, se corrige aquí
 * PRIMERO, se ve qué tests se ponen rojos, y esos son exactamente los sitios
 * del repo que hay que tocar.
 *
 * Actualizaciones posteriores al documento, con quién las decidió:
 *   · 25 y 28-sep-2026, la dueña por Telegram: el retiro solo si la clienta
 *     insiste y sin dar la dirección (ya no «Altos de Curundú, 7 a 5»); el
 *     texto de Ferguson.
 *   · 29-sep-2026, la agencia con los precios de la dueña: costos de los pants,
 *     la caja de 1,200 wipes Dany Baby sale del catálogo (se vende por caja de
 *     600), los wipes Nateen SÍ se venden (caja de 960) y los rangos de peso de
 *     los pants.
 */

/** Precio de venta en CENTAVOS, como se guarda en D1. $50.00 → 5000. */
export interface ProductoVerdad {
  code: string;
  /** Fragmentos que TIENEN que aparecer en el nombre del producto. */
  nombreContiene: string[];
  precioCents: number;
  /** Costo interno en centavos. Nunca sale hacia el bot; sirve para el margen del panel. */
  costoCents: number;
  /** Unidades por caja, tal como las dice el documento. */
  porCaja?: number;
}

export const PRODUCTOS: ProductoVerdad[] = [
  // Pañales Nateen de cierre — "Caja 160 pañales — $50", etc.
  { code: "NAT-RN", nombreContiene: ["RN", "cierre", "160"], precioCents: 5000, costoCents: 2800, porCaja: 160 },
  { code: "NAT-S", nombreContiene: ["S", "cierre", "160"], precioCents: 5000, costoCents: 3200, porCaja: 160 },
  { code: "NAT-M", nombreContiene: ["M", "cierre", "144"], precioCents: 5000, costoCents: 3200, porCaja: 144 },
  { code: "NAT-L", nombreContiene: ["L", "cierre", "128"], precioCents: 4500, costoCents: 3000, porCaja: 128 },
  { code: "NAT-XL", nombreContiene: ["XL", "cierre", "112"], precioCents: 4500, costoCents: 2800, porCaja: 112 },
  { code: "NAT-XXL", nombreContiene: ["XXL", "cierre", "112"], precioCents: 4500, costoCents: 2920, porCaja: 112 },

  // Pants (pull-ups) — solo L, XL y XXL. "Caja 160 pañales — $55". Costos: 29-sep-2026.
  { code: "NAT-P-L", nombreContiene: ["L", "pants", "160"], precioCents: 5500, costoCents: 3600, porCaja: 160 },
  { code: "NAT-P-XL", nombreContiene: ["XL", "pants", "160"], precioCents: 5500, costoCents: 3800, porCaja: 160 },
  { code: "NAT-P-XXL", nombreContiene: ["XXL", "pants", "160"], precioCents: 5500, costoCents: 3800, porCaja: 160 },

  // Water wipes Dany Baby — caja de 600 (12 paquetes de 50) a $25. Ya no hay
  // combo de 2 cajas (29-sep-2026).
  { code: "DANY-AW600", nombreContiene: ["Dany Baby", "600"], precioCents: 2500, costoCents: 1400, porCaja: 600 },

  // Wipes Nateen — caja de 960 (12 paquetes de 80) a $45 (29-sep-2026).
  { code: "WIPESNAT", nombreContiene: ["Nateen", "960"], precioCents: 4500, costoCents: 2160, porCaja: 960 },

  // Fular prearmado Moon — "Valor $46". Costo: 29-sep-2026.
  { code: "MOON-FUL", nombreContiene: ["Moon", "unitalla"], precioCents: 4600, costoCents: 3220 },
];

/**
 * Códigos que salieron del catálogo. El bot no los puede nombrar.
 *   · NAT-WIP: el código viejo de los wipes Nateen; hoy se venden como WIPESNAT.
 *   · DANY-AW1200: el combo de 1,200 wipes Dany Baby (29-sep-2026: se vende por
 *     caja de 600).
 */
export const DESCATALOGADOS = ["NAT-WIP", "DANY-AW1200"];

/** Rangos de peso por talla, en libras y kilos, como los dice el documento. */
export const TALLAS: Array<{ talla: string; lbs: string; kg: string }> = [
  { talla: "RN", lbs: "4–11 lbs", kg: "2–5 kg" },
  { talla: "S", lbs: "6–13 lbs", kg: "3–6 kg" },
  { talla: "M", lbs: "8–19 lbs", kg: "4–9 kg" },
  { talla: "L", lbs: "15–39 lbs", kg: "7–18 kg" },
  { talla: "XL", lbs: "26–55 lbs", kg: "12–25 kg" },
  { talla: "XXL", lbs: "55 lbs", kg: "25 kg" },
];

/** Rangos de peso de los pants (29-sep-2026). Solo hay L, XL y XXL. */
export const TALLAS_PANTS: Array<{ talla: string; lbs: string; kg: string }> = [
  { talla: "L", lbs: "19–31 lbs", kg: "9–14 kg" },
  { talla: "XL", lbs: "26–37.5 lbs", kg: "12–17 kg" },
  { talla: "XXL", lbs: "más de 33 lbs", kg: "más de 15 kg" },
];

/**
 * Tarifario de delivery. NO son productos: viven en la base de conocimiento
 * porque el catálogo guarda cosas con existencias, y un envío no tiene stock.
 */
export const TARIFAS_DELIVERY: Array<[string, string]> = [
  ["12 de Octubre", "$3"],
  ["San Miguelito", "$4"],
  ["Vía España", "$4"],
  ["Albrook Mall", "$4"],
  ["Chanis", "$5"],
  ["Juan Díaz", "$5"],
  ["Villa Lucre", "$5"],
  ["Cerro Viento", "$6"],
  ["Pedregal", "$6"],
  ["Las Acacias", "$7"],
  ["Villa Zaita", "$7"],
  ["Mañanitas", "$7"],
  ["Tocumen", "$8"],
  ["24 de Diciembre", "$8"],
];

/** Datos operativos que el bot repite a diario y no pueden salir mal. */
export const OPERACION = {
  yappy: "@babycalebpanama",
  abonoMinimo: "$5",
  cargoFerguson: "$2.50",
  corteEnvioMismoDia: "1:00 p.m.",
  ultimaEntrega: "5:00 p.m.",
  absorcion: "12 horas",
  panalesPorDiaRecienNacido: "8 a 12",
  duracionCaja: "20 a 25 días",
  coloresFular: ["gris", "verde menta"],
};

/**
 * Ajustes del panel (D1 `settings`) que el documento decide, y que por eso no
 * pueden quedar a criterio de quien abra la pestaña Config.
 *
 * `escalation_keywords` traía "factura" y el documento dice justo lo contrario:
 * la factura la resuelve el bot pidiendo nombre y dirección de entrega. Y le
 * faltaba entera la categoría más importante del documento —pagos y
 * comprobantes—, que es la primera de su lista de escaladas.
 */
export const AJUSTES = {
  tono: "cálido y servicial, tratando siempre de usted",
  /** Palabras que NO deben escalar porque el documento las contesta. */
  noEscalan: ["factura", "franquicia", "prensa", "entrevista", "reunión", "socio", "alianza"],
  /** Palabras que SÍ tienen que estar, uno por categoría del documento. */
  escalan: [
    "quiero pagar",
    "ya pagué",
    "comprobante",
    "yappy",
    "nequi",
    "número de cuenta",
    "cancelar mi pedido",
    "cambiar la talla",
    "devolución",
    "reembolso",
    "queja",
    "no me llegó",
    "hablar con una persona",
  ],
};

/**
 * Los disparadores de escalada del documento (§ "CUÁNDO EL CHATBOT ESCALA A
 * HUMANO"). Cada uno tiene que estar cubierto por la base de conocimiento.
 */
export const ESCALADAS: Array<{ id: string; pistas: string[] }> = [
  { id: "quiere-pagar", pistas: ["quiere pagar"] },
  { id: "ya-pago", pistas: ["ya pagó"] },
  { id: "comprobante", pistas: ["comprobante"] },
  { id: "a-que-cuenta", pistas: ["a qué cuenta"] },
  { id: "pago-recibido", pistas: ["pago fue recibido"] },
  // 23-sep-2026, decisión de la dueña: las notas de voz se transcriben y se
  // contestan; imágenes, videos y documentos siguen escalando.
  { id: "imagenes", pistas: ["imagen", "video", "documento"] },
  { id: "fuera-de-guion", pistas: ["no está en la base de conocimiento"] },
  { id: "medico-legal", pistas: ["médicos, legales"] },
  { id: "fuera-de-catalogo", pistas: ["no está en el catálogo"] },
  { id: "molesta", pistas: ["frustración, molestia o queja"] },
  { id: "pedido-problema", pistas: ["no llegó, llegó tarde o llegó dañado"] },
  { id: "pide-humano", pistas: ["hablar con una persona"] },
  { id: "cambio-talla", pistas: ["cambiar la talla"] },
  { id: "cancelar", pistas: ["cancelar un pedido"] },
  { id: "devolucion", pistas: ["devolución"] },
  { id: "estado-entrega", pistas: ["estado de una entrega"] },
  { id: "direccion-compleja", pistas: ["detalles complejos"] },
  { id: "descuento-volumen", pistas: ["descuento"] },
];
