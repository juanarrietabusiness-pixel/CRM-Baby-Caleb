/**
 * Un archivo entrante nunca llega al modelo, y el ticket no depende de él.
 *
 * El documento de la dueña dice que cualquier imagen, audio o documento escala
 * "sin excepción", y da una razón: "el bot no puede ver ni interpretar
 * archivos". Esa razón era FALSA en este sistema — vision.ts le pasaba la
 * imagen al modelo y transcribe.ts le pasaba el audio transcrito.
 *
 * Importa más de lo que parece. Una regla que el modelo puede comprobar que es
 * falsa es una regla débil: si ve la captura del Yappy, "tú no puedes ver esto"
 * no lo va a frenar. Y el escenario concreto es el más caro del negocio —
 * contestar "veo su pago, coordino la entrega" sobre un comprobante que nadie
 * verificó.
 *
 * Se arregló por los dos lados: el dato no llega (no es una instrucción, es
 * ausencia) y el ticket se crea en el agente, no pidiéndole al modelo que
 * llame una tool. Ya vimos qué pasa cuando el ticket depende del modelo: cero
 * tickets con un pedido de 70 cajas encima.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENT = readFileSync(resolve(ROOT, "src/agent.ts"), "utf8");
const KB = readFileSync(resolve(ROOT, "member/kb/06-cuando-escalar-a-humano.md"), "utf8");
const CONFIG = readFileSync(resolve(ROOT, "member/config.local.ts"), "utf8");

describe("el archivo no llega al modelo", () => {
  it("la imagen solo se adjunta si el negocio NO pidió escalar archivos", () => {
    expect(AGENT).toMatch(/imgMatch && isPro\(this\.env\) && !cfg\.escalarMedia/);
  });

  it("con escalar_media, al modelo le llega un aviso en vez del archivo", () => {
    // Las cadenas van partidas con + en el fuente, así que se comprueban por
    // trozos en vez de buscar la frase entera seguida.
    expect(AGENT).toMatch(/La clienta adjuntó un archivo\. NO puedes verlo/);
    expect(AGENT).toMatch(/NUNCA des por confirmado/);
    expect(AGENT).toMatch(/un pago ni describas el archivo: no lo tienes/);
  });

  it("el ticket se crea en el agente, no se le pide al modelo", () => {
    // Si dependiera de que el modelo llame handoffHuman, volvería a pasar lo
    // de las 70 cajas: el bot dio un teléfono y no creó nada.
    const bloque = AGENT.slice(AGENT.indexOf("if (mediaEscalada)"));
    expect(bloque).toMatch(/new TicketsRepo\(db\)\.create/);
    expect(bloque).toMatch(/notifyOwner/);
    expect(bloque).toMatch(/setOpenTicket/);
  });

  it("si el ticket falla, la conversación sigue: no se cae la respuesta", () => {
    const bloque = AGENT.slice(AGENT.indexOf("if (mediaEscalada)"));
    expect(bloque).toMatch(/catch \(e\)/);
  });
});

describe("la razón que se le da al bot ahora es cierta", () => {
  it("el KB ya no afirma una capacidad que el sistema sí tiene", () => {
    expect(KB).not.toMatch(/el bot no puede ver ni interpretar archivos/i);
    expect(KB).toMatch(/El archivo no le llega al bot/);
    expect(KB).toMatch(/el sistema lo retiene y crea el ticket solo/i);
  });

  it("prohíbe explícitamente confirmar un pago desde un archivo", () => {
    expect(KB).toMatch(/Nunca dé por confirmado un pago a partir de un archivo/i);
    expect(KB).toMatch(/quien valida un pago es siempre una persona/i);
    expect(CONFIG).toMatch(/NUNCA dé por confirmado un pago a partir de un archivo/);
  });

  it("el contexto dice que el archivo no lo recibe, no que no sepa verlo", () => {
    expect(CONFIG).toMatch(/retiene el archivo y abre el ticket solo/i);
    expect(CONFIG).toMatch(/usted NO lo recibe y no lo puede describir/);
  });
});
