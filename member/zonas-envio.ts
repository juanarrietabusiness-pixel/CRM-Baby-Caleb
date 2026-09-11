// member/zonas-envio.ts
// Tarifario de delivery de Baby Caleb. Datos del negocio: no se sobreescribe al
// actualizar la plantilla.
//
// Fuente: PREGUNTAS_BABY_CALEB_usted.docx (Yulilka Godoy, 2026-09).
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTO NO VIVE EN LA BASE DE CONOCIMIENTO
//
// Vivía ahí, y falló en producción: una clienta preguntó el envío a Tocumen
// —que está en el documento a $8— y el bot contestó "no tengo esa tarifa en el
// sistema". El dato estaba escrito; lo que falló fue la forma de buscarlo.
//
// searchKb busca por PARECIDO de redacción. Un tarifario es una tabla de 50
// filas de nombres propios: "Tocumen $8" no se "parece" a "¿cuánto cuesta el
// envío a Tocumen?" más de lo que se le parecen las otras 49 filas. Buscar un
// dato exacto por parecido es una lotería, y cada vez que sale mal el bot
// inventa una tarifa o niega una que sí existe. Las dos cosas cuestan plata.
//
// Una tabla se consulta, no se intuye. Por eso el tarifario es una tool
// (src/tools/cotizarEnvio.ts) y no un texto: la respuesta es exacta o es "esa
// zona no está en la lista, paso con una persona". Nunca un número aproximado.
// ─────────────────────────────────────────────────────────────────────────────

/** Tarifas en CENTAVOS, como el catálogo. $4.00 → 400. */
export interface ZonaEnvio {
  /** Como lo escribe la dueña y como aparece en el documento. */
  nombre: string;
  tarifaCents: number;
  /** Otras formas en que la clienta puede escribirlo. */
  alias?: string[];
}

export const ZONAS_CIUDAD_PANAMA: ZonaEnvio[] = [
  { nombre: "12 de Octubre", tarifaCents: 300, alias: ["doce de octubre"] },
  { nombre: "Betania", tarifaCents: 400 },
  { nombre: "Bella Vista", tarifaCents: 400 },
  { nombre: "Calle 50", tarifaCents: 400, alias: ["calle cincuenta"] },
  { nombre: "Condado del Rey", tarifaCents: 400, alias: ["condado"] },
  { nombre: "Fernández de Córdoba", tarifaCents: 400, alias: ["fernandez cordoba"] },
  { nombre: "Iglesia del Carmen", tarifaCents: 400, alias: ["el carmen"] },
  { nombre: "Ingenio", tarifaCents: 400, alias: ["el ingenio"] },
  { nombre: "La Lotería", tarifaCents: 400, alias: ["loteria"] },
  { nombre: "Los Andes", tarifaCents: 400 },
  { nombre: "Albrook Mall", tarifaCents: 400, alias: ["albrook"] },
  { nombre: "Multiplaza", tarifaCents: 400 },
  { nombre: "Obarrio", tarifaCents: 400, alias: ["el obarrio"] },
  { nombre: "Paitilla", tarifaCents: 400 },
  { nombre: "Punta Pacífica", tarifaCents: 400, alias: ["punta pacifica"] },
  { nombre: "San Francisco", tarifaCents: 400 },
  { nombre: "San Miguelito", tarifaCents: 400 },
  { nombre: "Santo Tomás", tarifaCents: 400, alias: ["hospital santo tomas"] },
  { nombre: "Tumba Muerto", tarifaCents: 400 },
  { nombre: "Vía Argentina", tarifaCents: 400, alias: ["via argentina"] },
  { nombre: "Vía Brasil", tarifaCents: 400, alias: ["via brasil"] },
  { nombre: "Vía España", tarifaCents: 400, alias: ["via espana"] },
  { nombre: "5 de Mayo", tarifaCents: 400, alias: ["cinco de mayo"] },

  { nombre: "Brisas del Golf", tarifaCents: 500 },
  { nombre: "Chanis", tarifaCents: 500 },
  { nombre: "Coco del Mar", tarifaCents: 500 },
  { nombre: "Crisol", tarifaCents: 500 },
  { nombre: "Diablo", tarifaCents: 500 },
  { nombre: "Juan Díaz", tarifaCents: 500, alias: ["juan diaz"] },
  { nombre: "Metromall", tarifaCents: 500 },
  { nombre: "Parque Lefevre", tarifaCents: 500, alias: ["lefevre"] },
  { nombre: "Río Abajo", tarifaCents: 500, alias: ["rio abajo"] },
  { nombre: "San Isidro", tarifaCents: 500 },
  { nombre: "Villa Lucre", tarifaCents: 500 },

  { nombre: "Cerro Viento", tarifaCents: 600 },
  { nombre: "Pedregal", tarifaCents: 600 },

  { nombre: "Brisas", tarifaCents: 700 },
  { nombre: "Ciudad Radial", tarifaCents: 700 },
  { nombre: "Concepción", tarifaCents: 700, alias: ["concepcion"] },
  { nombre: "Don Bosco", tarifaCents: 700 },
  { nombre: "Las Acacias", tarifaCents: 700 },
  { nombre: "Mañanitas", tarifaCents: 700, alias: ["mananitas", "las mananitas"] },
  { nombre: "Villa Zaita", tarifaCents: 700 },

  { nombre: "24 de Diciembre", tarifaCents: 800, alias: ["veinticuatro de diciembre"] },
  { nombre: "Tocumen", tarifaCents: 800 },
];

/**
 * Panamá Oeste no tiene tarifa fija: el documento dice "de $3 a $6 dependiendo
 * la distancia". No se inventa un punto medio — se reconoce la zona y se pasa
 * con una persona, que es lo que hace la dueña.
 */
export const PANAMA_OESTE = {
  nombres: ["Arraiján", "Arraijan", "La Chorrera", "Chorrera", "Panamá Oeste", "Panama Oeste"],
  minCents: 300,
  maxCents: 600,
};

/** Cargo del motorizado por llevar el paquete a Ferguson (envíos al interior). */
export const CARGO_FERGUSON_CENTS = 250;
