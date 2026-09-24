/**
 * La base de conocimiento contesta todo lo que el documento contesta, y NO
 * contesta lo que le toca al catálogo.
 *
 * Los dos lados importan igual:
 *   · Un hueco (una zona de envío que falta) hace que el bot escale de más o,
 *     peor, que estime una tarifa.
 *   · Un solapamiento (un precio de producto escrito aquí) hace que el bot
 *     tenga dos respuestas para la misma pregunta y elija la que le quede más
 *     a mano. Eso es lo que se sentía como "los datos se superponen".
 */
import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtures } from "../../scripts/generate-fixtures";
import { CHUNK_CHARS } from "../../src/kb/chunk";
import { ZONAS_CIUDAD_PANAMA } from "../../member/zonas-envio";
import {
  PRODUCTOS,
  TALLAS,
  TARIFAS_DELIVERY,
  OPERACION,
  ESCALADAS,
} from "./verdad-del-cliente";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chunks = buildFixtures(resolve(ROOT, "member/kb-respaldo"));

/**
 * Todo el texto que se va a indexar, junto y con el espacio normalizado.
 *
 * Lo de normalizar no es para que pasen los tests: es que el ancho de columna
 * del .md no es un dato. El modelo de embeddings ve la frase, no dónde parte
 * la línea, así que buscar "el resto se paga cuando el motorizado entrega"
 * tiene que dar igual esté esa frase en una línea o en dos.
 */
const KB = chunks.map((c) => c.content).join("\n\n").replace(/\s+/g, " ");

describe("member/kb — la base de conocimiento está cargada", () => {
  it("no está vacía: un KB vacío deja al bot sin nada que consultar", () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("está troceada, no subida como archivos enteros", () => {
    // Un vector de 5,000 caracteres se parece un poco a todas las preguntas y
    // mucho a ninguna. searchKb descarta lo que baje de 0.7 de score.
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(chunks.length).toBeGreaterThan(6);
  });

  it("cada trozo lleva título e id únicos", () => {
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
    for (const c of chunks) expect(c.title.trim().length).toBeGreaterThan(0);
  });
});

describe("un dato, un solo dueño", () => {
  it("los precios de producto NO están en la base de conocimiento", () => {
    // Si el precio vive aquí Y en el catálogo, el bot puede leer el de aquí sin
    // llamar catalogQuery, y ese se queda congelado el día que la dueña cambie
    // el del panel. Los precios salen de catalogQuery y de ningún otro lado.
    for (const producto of PRODUCTOS) {
      const precio = `$${(producto.precioCents / 100).toFixed(0)}`;
      expect(KB, `el precio ${precio} de ${producto.code} está duplicado en el KB`)
        .not.toContain(precio);
    }
  });

  it("la base de conocimiento dice de dónde salen los precios", () => {
    expect(KB).toContain("catalogQuery");
  });

  it("las existencias tampoco están escritas aquí", () => {
    expect(KB).not.toMatch(/quedan \d+ (cajas|unidades)/i);
  });
});

describe("tallas y presentaciones", () => {
  it.each(TALLAS)("la talla $talla tiene su rango de peso en libras y kilos", (t) => {
    expect(KB).toContain(t.lbs);
    expect(KB).toContain(t.kg);
  });

  it("explica que de cierre hay de RN a XXL y de pants solo de L a XXL", () => {
    expect(KB).toMatch(/cierre.*RN.*XXL/s);
    expect(KB).toMatch(/pants.*L.*XXL/s);
  });

  it("deja claro que solo se vende la caja completa", () => {
    expect(KB).toMatch(/no se venden paquetes sueltos/i);
    expect(KB).toMatch(/revendedores/i);
  });

  it("dice qué NO se maneja, para que el bot no lo ofrezca por si acaso", () => {
    expect(KB).toMatch(/wipes nateen.*no se manejan/i);
    expect(KB).toMatch(/pañales dany baby.*no se manejan/i);
  });
});

describe("envíos y delivery", () => {
  it.each(TARIFAS_DELIVERY)("%s cuesta %s, y sale de cotizarEnvio", (zona, tarifa) => {
    // El tarifario se mudó del KB a member/zonas-envio.ts. Vivía aquí y falló
    // en producción: buscar una tabla de 50 nombres propios por parecido de
    // redacción es una lotería, y el bot negó la tarifa de Tocumen teniéndola.
    const z = ZONAS_CIUDAD_PANAMA.find((x) => x.nombre === zona);
    expect(z, `falta la zona ${zona} en el tarifario`).toBeDefined();
    expect(`$${z!.tarifaCents / 100}`).toBe(tarifa);
  });

  it("las tarifas NO están duplicadas en la base de conocimiento", () => {
    for (const [zona, tarifa] of TARIFAS_DELIVERY) {
      expect(KB, `"${zona} ${tarifa}" quedó duplicado en el KB`).not.toContain(`${zona} ${tarifa}`);
    }
  });

  it("el KB manda a consultar la tool en vez de recitar precios", () => {
    expect(KB).toContain("cotizarEnvio");
    expect(KB).toMatch(/El tarifario zona por zona vive en la tool/i);
  });

  it("el delivery nunca va incluido en el precio del producto", () => {
    expect(KB).toMatch(/nunca está incluido en el precio|costo adicional/i);
  });

  it("prohíbe estimar una tarifa que no esté en la lista", () => {
    expect(KB).toMatch(/nunca estime una tarifa/i);
    expect(KB).toMatch(/no la calcule por parecido/i);
  });

  it("cubre Ferguson: el cargo del motorizado y el pago total por adelantado", () => {
    expect(KB).toContain(OPERACION.cargoFerguson);
    expect(KB).toMatch(/totalidad del producto/i);
  });

  it("cubre los tiempos: corte de la 1 p.m. y última entrega a las 5 p.m.", () => {
    expect(KB).toContain(OPERACION.corteEnvioMismoDia);
    expect(KB).toContain(OPERACION.ultimaEntrega);
    expect(KB).toMatch(/sábados.*agenda previa/i);
    expect(KB).toMatch(/domingos no hay entregas/i);
  });

  it("cubre el retiro en Altos de Curundú con su horario", () => {
    expect(KB).toContain(OPERACION.retiro);
    for (const hora of OPERACION.retiroHorario) expect(KB).toContain(hora);
    expect(KB).toMatch(/un día de anticipación/i);
  });
});

describe("pagos", () => {
  it("el Yappy Comercial está escrito tal cual", () => {
    expect(KB).toContain(OPERACION.yappy);
  });

  it("el abono mínimo y su razón de ser están dichos", () => {
    expect(KB).toContain(OPERACION.abonoMinimo);
    expect(KB).toMatch(/no se entregan pedidos sin abono/i);
  });

  it("explica el 'sí y no' del contra entrega", () => {
    expect(KB).toMatch(/sí y no/i);
    expect(KB).toMatch(/el resto se paga cuando el motorizado entrega/i);
  });

  it("el número de cuenta NO lo da el bot", () => {
    expect(KB).toMatch(/número de cuenta no lo da el bot|piden un número de cuenta, pase/i);
  });
});

describe("uso del producto", () => {
  it("trae los datos que la dueña repite a diario", () => {
    expect(KB).toContain(OPERACION.absorcion);
    expect(KB).toContain(OPERACION.panalesPorDiaRecienNacido);
    expect(KB).toContain(OPERACION.duracionCaja);
    expect(KB).toMatch(/amarilla a azul/i);
  });

  it("los colores del fular son los dos que hay, y solo esos", () => {
    for (const color of OPERACION.coloresFular) expect(KB).toContain(color);
    expect(KB).toMatch(/no invente un color/i);
  });

  it("no da consejo médico: cesárea y dudas de salud van a una persona", () => {
    expect(KB).toMatch(/cesárea/i);
    expect(KB).toMatch(/no dé consejo médico|no son consejo médico/i);
  });
});

describe("escalada a humano — los 18 disparadores del documento", () => {
  it.each(ESCALADAS)("$id está cubierto", ({ pistas }) => {
    for (const pista of pistas) {
      expect(KB.toLowerCase()).toContain(pista.toLowerCase());
    }
  });

  it("la regla general es no inventar y no dejar a la clienta en silencio", () => {
    expect(KB).toMatch(/no inventa/i);
    expect(KB).toMatch(/nunca deja a la clienta en silencio/i);
    expect(KB).toContain("handoffHuman");
  });

  it("cualquier archivo entrante escala, sin excepción", () => {
    // Desde el 23-sep-2026 las notas de voz se transcriben y se contestan (decisión
    // de la dueña); imágenes, videos y documentos siguen escalando siempre.
    expect(KB).toMatch(/cualquier imagen, foto, video o documento, escale/is);
    expect(KB).toMatch(/notas de voz.*transcritas/is);
    expect(KB).toMatch(/sin excepción/i);
  });

  it("la razón que se le da al bot es cierta, no una premisa falsa", () => {
    // Decía "el bot no puede ver ni interpretar archivos". Era falso: sí
    // podía. Ahora es cierto porque el sistema retiene el archivo — y una
    // regla que el modelo no puede desmentir es una regla que respeta.
    expect(KB).not.toMatch(/el bot no puede ver ni interpretar archivos/i);
    expect(KB).toMatch(/El archivo no le llega al bot/i);
    expect(KB).toMatch(/Nunca dé por confirmado un pago a partir de un archivo/i);
  });
});

describe("el trato es de usted", () => {
  it("está dicho en la base de conocimiento, no solo en el prompt", () => {
    expect(KB).toMatch(/nunca tutee/i);
  });

  /**
   * El eslogan de la marca. Es lo único que tutea y se cita tal cual, porque es
   * la promesa registrada: "En Baby Caleb Panamá pensamos en cada etapa de tu
   * bebé". La excepción es esta frase exacta y nada más — se recorta antes de
   * buscar tuteos para que el resto de la regla siga en pie.
   */
  const ESLOGAN = "pensamos en cada etapa de tu bebé";

  /**
   * Un tuteo, buscado como palabra completa y con fronteras que entienden
   * acentos.
   *
   * Esto antes se escribía /\btu bebé\b/i y NO COMPROBABA NADA: en JavaScript
   * \b es una frontera ASCII, y después de la "é" —que ya es un carácter no
   * ASCII— no hay ninguna transición que marcar, así que el patrón no puede
   * coincidir nunca. Un test que no puede fallar es peor que no tener test:
   * da luz verde. Por eso abajo hay una prueba que comprueba el comprobador.
   */
  const tuteo = (frase: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${frase}(?![\\p{L}\\p{N}])`, "iu");

  const TUTEOS = ["tu bebé", "tus", "escríbenos", "tienes", "puedes", "quieres", "contigo"];

  it("los patrones de tuteo sí detectan un tuteo (comprobar el comprobador)", () => {
    // Sin esto, un patrón roto pasa por bueno y el test entero es decorativo.
    expect(tuteo("tu bebé").test("cuidamos a tu bebé.")).toBe(true);
    expect(tuteo("tienes").test("si tienes dudas")).toBe(true);
    expect(tuteo("tus").test("para tus compras")).toBe(true);
    // Y no confunde una palabra que lo contenga.
    expect(tuteo("tus").test("los estatus del pedido")).toBe(false);
    expect(tuteo("tu bebé").test("su bebé")).toBe(false);
  });

  it("los documentos no tutean", () => {
    // El tuteo es del marketing de la agencia. En el guion de atención sería
    // una fuga de registro: la dueña responde de usted en todo el documento.
    for (const c of chunks) {
      const sinEslogan = c.content.replace(ESLOGAN, "");
      for (const frase of TUTEOS) {
        expect(sinEslogan, `${c.id} tutea: "${frase}"`).not.toMatch(tuteo(frase));
      }
    }
  });

  it("el eslogan es la única excepción, y está donde debe", () => {
    const conEslogan = chunks.filter((c) => c.content.includes(ESLOGAN));
    expect(conEslogan).toHaveLength(1);
    expect(conEslogan[0].id).toMatch(/^sobre-baby-caleb/);
    // Y queda dicho que es una cita, para que el bot no lo tome de licencia.
    expect(conEslogan[0].content).toMatch(/es el eslogan y se\s+cita tal cual/);
  });
});
