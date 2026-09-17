// Candados de la lógica del puente de WhatsApp.
//
// Cada bloque de aquí corresponde a un fallo que YA ocurrió en producción
// durante el piloto (ver docs/bitacora-whatsapp-qr.md). No son pruebas de
// cobertura: son la garantía de que esos seis no vuelven.

import { describe, it, expect } from "vitest";
import {
  huella,
  tokenPresentado,
  tokensIguales,
  autorizado,
  tokenEsApto,
  pedazos,
  veredictoDeSalud,
  latidoVencido,
  reinicioPedido,
  FILAS_POR_IDA,
  LATIDO_MS,
  LATIDO_VENCIDO_MS,
  LATIDOS_ANTES_DE_REINICIAR,
  VIGILANCIA_S,
} from "../../puente-wa/src/comun";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

function pedido(opciones: { b64?: string; query?: string } = {}): Request {
  const url = new URL("https://puente.ejemplo/estado");
  if (opciones.query !== undefined) url.searchParams.set("t", opciones.query);
  const headers = new Headers();
  if (opciones.b64 !== undefined) headers.set("x-wa-token-b64", opciones.b64);
  return new Request(url.toString(), { headers });
}

describe("huella", () => {
  it("da el mismo valor para la misma cadena", () => {
    expect(huella("secreto-largo-de-prueba")).toBe(huella("secreto-largo-de-prueba"));
  });

  it("distingue cadenas del mismo largo", () => {
    // Es justo el caso que destapó el token mutado: 95 caracteres de cada lado,
    // contenido distinto. Si la huella no distinguiera esto, no serviría.
    expect(huella("abcdefghij")).not.toBe(huella("abcdefghik"));
  });

  it("distingue un carácter cambiado en mil cadenas parecidas", () => {
    // Una versión anterior recortaba la huella a cuatro caracteres y colisionaba
    // con facilidad. Una huella que colisiona diría "los dos lados tienen el
    // mismo token" cuando no lo tienen: peor que no tenerla.
    const vistas = new Set<string>();
    for (let i = 0; i < 1000; i++) vistas.add(huella(`token-de-prueba-numero-${i}`));
    expect(vistas.size).toBe(1000);
  });

  it("no revela el largo del secreto", () => {
    expect(huella("x").length).toBeLessThanOrEqual(7);
    expect(huella("x".repeat(500)).length).toBeLessThanOrEqual(7);
  });
});

describe("tokenPresentado", () => {
  it("lee el token de la cabecera en base64", () => {
    const r = tokenPresentado(pedido({ b64: b64("token-de-prueba-1234567890") }));
    expect(r.via).toBe("cabecera-b64");
    expect(r.valor).toBe("token-de-prueba-1234567890");
  });

  it("sobrevive a un token con caracteres fuera de ASCII", () => {
    // EL fallo caro del piloto. En claro, una cabecera con "ñ" llegaba con el
    // mismo largo y distinto contenido; en base64 llega intacta.
    const conEñe = "clave-con-Ñ-y-tildes-áéí-1234567890";
    const r = tokenPresentado(pedido({ b64: b64(conEñe) }));
    expect(r.valor).toBe(conEñe);
    expect(r.valor.length).toBe(conEñe.length);
  });

  it("acepta el token por query, que es como entra una persona", () => {
    const r = tokenPresentado(pedido({ query: "token-de-prueba-1234567890" }));
    expect(r.via).toBe("query");
    expect(r.valor).toBe("token-de-prueba-1234567890");
  });

  it("prefiere la cabecera sobre la query", () => {
    const r = tokenPresentado(pedido({ b64: b64("de-cabecera"), query: "de-query" }));
    expect(r.via).toBe("cabecera-b64");
    expect(r.valor).toBe("de-cabecera");
  });

  it("no revienta con un base64 corrupto: devuelve vacío", () => {
    const r = tokenPresentado(pedido({ b64: "no-es-base64-válido-!!!" }));
    expect(r.valor).toBe("");
  });

  it("informa cuando no llegó ningún token", () => {
    expect(tokenPresentado(pedido()).via).toBe("nada");
  });
});

describe("tokensIguales", () => {
  it("acepta el token correcto", () => {
    expect(tokensIguales("abc123", "abc123")).toBe(true);
  });

  it("rechaza uno del mismo largo y distinto contenido", () => {
    expect(tokensIguales("abc123", "abc124")).toBe(false);
  });

  it("rechaza largos distintos", () => {
    expect(tokensIguales("abc", "abc123")).toBe(false);
  });

  it("nunca acepta con el esperado vacío", () => {
    // Si el secret faltara, un token vacío NO debe abrir la puerta.
    expect(tokensIguales("", "")).toBe(false);
  });
});

describe("autorizado", () => {
  const esperado = "token-de-prueba-1234567890";

  it("deja pasar por cabecera", () => {
    expect(autorizado(pedido({ b64: b64(esperado) }), esperado)).toBe(true);
  });

  it("deja pasar por query", () => {
    expect(autorizado(pedido({ query: esperado }), esperado)).toBe(true);
  });

  it("rechaza sin token", () => {
    expect(autorizado(pedido(), esperado)).toBe(false);
  });

  it("deja pasar un token con eñe por las dos vías", () => {
    const conEñe = "clave-con-Ñ-1234567890abcdef";
    expect(autorizado(pedido({ b64: b64(conEñe) }), conEñe)).toBe(true);
    expect(autorizado(pedido({ query: conEñe }), conEñe)).toBe(true);
  });
});

describe("tokenEsApto", () => {
  it("acepta hexadecimal largo", () => {
    expect(tokenEsApto("a".repeat(32)).apto).toBe(true);
  });

  it("acepta base64url", () => {
    expect(tokenEsApto("Ab3-_xYz".repeat(4)).apto).toBe(true);
  });

  it("rechaza uno con eñe, aunque funcione por navegador", () => {
    const r = tokenEsApto("clave-con-Ñ-1234567890abcdef");
    expect(r.apto).toBe(false);
    expect(r.motivo).toMatch(/ASCII/);
  });

  it("rechaza uno con espacio o salto de línea", () => {
    expect(tokenEsApto("clave con espacio 1234567890").apto).toBe(false);
    expect(tokenEsApto("clave-1234567890abcdefgh\n").apto).toBe(false);
  });

  it("rechaza uno corto", () => {
    expect(tokenEsApto("corto").apto).toBe(false);
  });
});


// ── El lote ────────────────────────────────────────────────────────────────
//
// El séptimo fallo del piloto, y el más caro de diagnosticar: el canal se
// vinculaba y se caía enseguida. Al emparejar, WhatsApp exige subir 812 llaves
// de un solo uso; Baileys se las entrega al almacén en UNA llamada y las relee
// todas acto seguido. Guardándolas de a una son ~1.600 viajes al puente contra
// un plazo de 30 s que Baileys no negocia. Medido en producción: 17 por
// segundo, 644 de 812 escritas, y ahí murió.
//
// `pedazos` es la pieza que parte ese lote. Un off-by-one aquí no se ve como un
// error: se ve como un WhatsApp que se vincula y al rato deja de andar.

describe("pedazos", () => {
  it("no pierde ni repite un solo elemento", () => {
    const lista = Array.from({ length: 812 }, (_, i) => i);
    const grupos = pedazos(lista, FILAS_POR_IDA);
    expect(grupos.flat()).toEqual(lista);
  });

  it("parte 812 llaves —el número exacto del emparejamiento— sin dejar cola suelta", () => {
    const grupos = pedazos(Array.from({ length: 812 }, (_, i) => i), 90);
    expect(grupos).toHaveLength(10);
    expect(grupos.slice(0, 9).every((g) => g.length === 90)).toBe(true);
    expect(grupos.at(-1)).toHaveLength(2);
  });

  it("no inventa un grupo vacío cuando la división es exacta", () => {
    expect(pedazos([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("con la lista vacía no devuelve nada que recorrer", () => {
    expect(pedazos([], 90)).toEqual([]);
  });

  it("aguanta una lista más corta que el pedazo", () => {
    expect(pedazos([1], 90)).toEqual([[1]]);
  });

  it("se niega a un tamaño de cero en vez de colgarse para siempre", () => {
    // Sin esta guarda el `for` nunca avanza y el Worker se queda girando.
    expect(() => pedazos([1, 2], 0)).toThrow();
  });

  it("el tamaño por ida deja margen bajo el límite de parámetros de una consulta", () => {
    expect(FILAS_POR_IDA).toBeLessThanOrEqual(100);
    expect(FILAS_POR_IDA).toBeGreaterThan(1);
  });
});

// ── El fallo del 16-sep-2026: el canal mudo toda la noche ──────────────────
//
// El latido preguntaba `container.running` —"¿el proceso está prendido?"— y
// nunca "¿WhatsApp está conectado?". Un contenedor prendido con el socket de
// Baileys muerto salía SANO, y el canal se quedaba mudo sin que nada lo notara.
// El dueño lo descubrió escribiéndole al bot y no recibiendo respuesta.

describe("veredictoDeSalud", () => {
  it("solo 'conectada' cuenta como sano", () => {
    expect(veredictoDeSalud("conectada")).toBe("sano");
  });

  it("un contenedor que no contesta está caído, no sano", () => {
    // ESTE es el caso que el latido viejo daba por bueno: prendido y mudo.
    expect(veredictoDeSalud(null)).toBe("caido");
    expect(veredictoDeSalud(undefined)).toBe("caido");
    expect(veredictoDeSalud("cerrada")).toBe("caido");
    expect(veredictoDeSalud("arrancando")).toBe("caido");
  });

  it("esperar a una persona NO es un fallo que se arregle reiniciando", () => {
    // Reiniciar aquí genera un código nuevo y le tumba al dueño el que está
    // mirando en la pantalla del teléfono.
    expect(veredictoDeSalud("esperando-qr")).toBe("esperando-a-una-persona");
    expect(veredictoDeSalud("desvinculada")).toBe("esperando-a-una-persona");
  });

  it("un estado desconocido se trata como caído, no como sano", () => {
    // Por si Baileys estrena un estado: equivocarse hacia "caído" cuesta una
    // reconexión; equivocarse hacia "sano" cuesta una noche de silencio.
    expect(veredictoDeSalud("vaya-usted-a-saber")).toBe("caido");
  });
});

describe("latidoVencido", () => {
  const ahora = 1_800_000_000_000;

  it("un latido reciente no está vencido", () => {
    expect(latidoVencido(ahora - 30_000, ahora)).toBe(false);
  });

  it("un latido perdido todavía no es motivo de alarma", () => {
    expect(latidoVencido(ahora - LATIDO_MS * 2, ahora)).toBe(false);
  });

  it("tres latidos seguidos sin llegar es que la alarma dejó de existir", () => {
    expect(latidoVencido(ahora - LATIDO_VENCIDO_MS - 1, ahora)).toBe(true);
  });

  it("no haber latido nunca no es un vencimiento", () => {
    // Recién desplegado. Decir "vencido" ahí sería una alarma falsa en el peor
    // momento: justo cuando el dueño está vinculando por primera vez.
    expect(latidoVencido(null, ahora)).toBe(false);
    expect(latidoVencido(undefined, ahora)).toBe(false);
  });
});

describe("las esperas del rescate", () => {
  it("se le dan varios minutos al canal antes de destruir el contenedor", () => {
    // Reconectar es lo barato y hay que darle tiempo. Destruir el contenedor
    // cuesta una resincronización entera.
    expect(LATIDOS_ANTES_DE_REINICIAR).toBeGreaterThanOrEqual(3);
    expect(LATIDOS_ANTES_DE_REINICIAR * VIGILANCIA_S * 1000).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("reinicioPedido", () => {
  // El fallo del 16-sep-2026: se tocaba "Reiniciar el servicio", no pasaba
  // nada, y el servicio solo volvía al refrescar la página. Hoy `matar()`
  // destruye y vuelve a levantar en el mismo paso; esto fija lo que el diario
  // tiene que quedar diciendo.
  it("corta la racha anterior en vez de heredarla", () => {
    // Un reinicio pedido por una persona es un punto y aparte. Si arrastrara
    // los contadores, la vuelta heredaría castigos pensados para un contenedor
    // que se estaba cayendo solo.
    const tras = reinicioPedido(new Date());
    expect(tras.fallosSeguidos).toBe(0);
    expect(tras.ultimoArranque).toBeNull();
  });

  it("anota cuándo se pidió, que es lo que el panel muestra", () => {
    const ahora = new Date("2026-09-16T18:00:00.000Z");
    expect(reinicioPedido(ahora).ultimaMuerteVista).toBe("2026-09-16T18:00:00.000Z");
  });
});

// ── El canal se apagaba solo cuando nadie miraba (17-sep-2026) ────────────
//
// Tres minutos escuchando el Worker con el panel cerrado: cero eventos. Ni un
// latido. El contenedor vive mientras vive su Durable Object, y el DO se
// desalojaba entre latido y latido porque nuestro `alarm()` hacía su trabajo y
// retornaba. El retroceso exponencial alargaba esos huecos hasta 15 minutos.

describe("la cadencia de la vigilancia", () => {
  it("vigila varias veces dentro de la ventana que da por muerto el latido", () => {
    // Si la vigilancia fuera más lenta que el umbral de "latido vencido", el
    // panel declararía muerto un canal sano. Tiene que caber holgada.
    expect(VIGILANCIA_S * 1000).toBeLessThan(LATIDO_VENCIDO_MS / 2);
  });

  it("no retrocede: la espera es siempre la misma", () => {
    // El retroceso es correcto para algo que se reintenta y es al revés para un
    // socket que debe estar siempre abierto. Aquí es una constante, y que lo
    // siga siendo es justo lo que esta prueba cuida.
    expect(typeof VIGILANCIA_S).toBe("number");
    expect(VIGILANCIA_S).toBeGreaterThan(0);
  });
});
