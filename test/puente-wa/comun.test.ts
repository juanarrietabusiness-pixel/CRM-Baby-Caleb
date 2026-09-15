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
  proximoLatido,
  tokenEsApto,
  pedazos,
  FILAS_POR_IDA,
  LATIDO_MS,
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

describe("proximoLatido", () => {
  it("con el contenedor sano espera un minuto", () => {
    expect(proximoLatido(0)).toBe(LATIDO_MS);
  });

  it("crece con cada fallo seguido", () => {
    expect(proximoLatido(1)).toBe(2 * LATIDO_MS);
    expect(proximoLatido(2)).toBe(4 * LATIDO_MS);
    expect(proximoLatido(3)).toBe(8 * LATIDO_MS);
  });

  it("no pasa de quince minutos", () => {
    expect(proximoLatido(10)).toBe(15 * 60_000);
    expect(proximoLatido(99)).toBe(15 * 60_000);
  });

  it("sobrevive a NaN y a negativos", () => {
    // Un diario viejo sin el campo daba NaN, y setAlarm(NaN) dejaba al
    // contenedor sin latido para siempre: un fallo mudo justo en la pieza que
    // existe para recuperarse de fallos.
    expect(proximoLatido(NaN)).toBe(LATIDO_MS);
    expect(proximoLatido(-5)).toBe(LATIDO_MS);
    expect(Number.isFinite(proximoLatido(NaN))).toBe(true);
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
