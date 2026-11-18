import { describe, it, expect } from "vitest";
import {
  revisarRespuesta,
  hayQueBloquear,
  montoRespaldado,
  montosEn,
  notaDeRevision,
} from "../../src/replies/revisor";
import { frasesProhibidas } from "../../member/config.local";

// Las frases de "lo detiene" son respuestas que el bot MANDÓ de verdad entre el
// 29-sep y el 6-oct-2026 (D1 de producción, sin datos de las clientas). Las de
// "lo deja pasar" son respuestas correctas del mismo periodo: un revisor que
// frena lo bueno termina apagado.

const usted = { formaDeTrato: "usted" as const, frasesProhibidas };
const codigos = (t: string, ctx = usted) => revisarRespuesta(t, ctx).map((p) => p.codigo);

describe("lo detiene: frases reales que no debían salir", () => {
  it("dar por recibido un pago porque la clienta lo dijo (bloquea)", () => {
    const t =
      "✓ Perfecto, le confirmo que recibimos su abono total de $57.50 (producto + envío a Bugaba). " +
      "Su pedido está listo para que Ferguson lo recoja hoy y llegue a Bugaba.";
    const ps = revisarRespuesta(t, usted);
    expect(ps.map((p) => p.codigo)).toContain("pago-confirmado");
    expect(ps.map((p) => p.codigo)).toContain("pedido-tocado");
    expect(ps.map((p) => p.codigo)).toContain("promesa-de-entrega");
    expect(hayQueBloquear(ps)).toBe(true);
  });

  it("'le confirmo que recibimos su comprobante' tras una foto", () => {
    expect(codigos("Perfecto, le confirmo que recibimos su comprobante. Gracias por su compra 🙌🏻")).toContain(
      "pago-confirmado",
    );
  });

  it("la dirección de retiro que la dueña mandó quitar (bloquea)", () => {
    const ps = revisarRespuesta(
      "El retiro en persona se hace en **Altos de Curundú, después de la Estación de Policía**.",
      usted,
    );
    expect(ps.map((p) => p.codigo)).toContain("frase-prohibida");
    expect(hayQueBloquear(ps)).toBe(true);
  });

  it("tuteo", () => {
    expect(
      codigos("Entiendo que recibiste un mensaje. Estoy aquí para ayudarte con tus preguntas."),
    ).toContain("tuteo");
    expect(codigos("De nada, queda atenta a los mensajes del equipo. ¡Bendiciones! 🙌🏻")).toContain("tuteo");
  });

  it("hueco de plantilla", () => {
    expect(codigos("Entonces el total sería: - Caja talla XXL de pant: (precio del producto)")).toContain(
      "hueco-de-plantilla",
    );
  });

  it("'actualizar' un pedido que ya había salido", () => {
    expect(codigos("Perfecto. Su pedido queda actualizado: ✓ 1 caja Talla S ✓ Entrega: lunes")).toContain(
      "pedido-tocado",
    );
  });

  it("prometer un día o 'hoy mismo'", () => {
    expect(codigos("Le confirmo que el motorizado llega hoy, antes de las 5:00 p.m.")).toContain(
      "promesa-de-entrega",
    );
    expect(codigos("Así alguien del equipo se comunica con usted hoy mismo para completar todo.")).toContain(
      "promesa-de-entrega",
    );
  });

  it("inventar el titular de la cuenta", () => {
    expect(codigos("Entiendo. El nombre de la cuenta es **Baby Caleb**, pero no tengo el número.")).toContain(
      "datos-bancarios",
    );
  });

  it("mandarla a llamar en vez de pasarla con una persona", () => {
    expect(codigos("Cuando tenga los datos, nos llama o nos escribe y le confirmamos todo.")).toContain(
      "manda-a-otro-canal",
    );
  });

  it("un monto que no salió de ningún lado", () => {
    const ps = revisarRespuesta("El resto ($55 de la caja + $5 del delivery) lo paga al motorizado.", {
      respaldoMontos: ['{"precio":"$55.00"}'],
    });
    // $55 tiene respaldo; $5 de delivery, no (no se cotizó, y el abono no está en el respaldo).
    expect(ps.map((p) => p.codigo)).toEqual(["monto-sin-respaldo"]);
    expect(ps[0].frase).toBe("$5.00");
  });
});

describe("lo deja pasar: respuestas correctas", () => {
  const buenas = [
    "Buenas, un gusto atenderle. Somos Baby Caleb Panamá 👼🏻 ¿Le interesan los water wipes, los fulares o los pañales Nateen?",
    "El delivery tiene un costo adicional: va aparte del precio del producto y depende de la zona.",
    "Con abono o pago total antes de la 1:00 p.m., el envío sale hoy mismo; si abona después, sale mañana.",
    "Cuando nos envíe el comprobante, una persona del equipo lo verifica y le confirma.",
    "Para agendar su pedido necesitamos un abono mínimo de $5.00 al Yappy Comercial @babycalebpanama. Una persona del equipo se lo agenda.",
    "Por favor, antes de realizar su pedido, verifique que la talla corresponda al peso actual de su bebé.",
    "En Baby Caleb Panamá pensamos en cada etapa de tu bebé. ¿Qué talla necesita?",
    "Estas son las tallas que tenemos: RN, S y M. ¿Cuál le sirve?",
    "Puede hacer un abono de mínimo $5 y así le apartamos su caja cuando nos llegue el siguiente stock. 🙏🏻",
    "Le paso con una persona del equipo para que valide su pago y le confirme.",
  ];
  for (const t of buenas) {
    it(t.slice(0, 60), () => {
      expect(revisarRespuesta(t, usted)).toEqual([]);
    });
  }

  it("la frase prohibida que dijo la CLIENTA no se bloquea: es su barrio, no la dirección de retiro", () => {
    const t = "Altos de Curundú no está en el tarifario: le paso con una persona para confirmar el envío.";
    expect(revisarRespuesta(t, { ...usted, textoDeLaClienta: "vivo en altos de curundu, cuanto es el envio?" })).toEqual([]);
    expect(codigos(t)).toContain("frase-prohibida");
  });

  it("el tuteo solo se busca cuando el negocio trata de usted", () => {
    expect(revisarRespuesta("¿Te sirve la caja?", { formaDeTrato: "tu" })).toEqual([]);
  });

  it("'Water wipes' (el tipo de toallita) sí; 'WaterWipes' (otra marca) no", () => {
    expect(codigos("Le tenemos Water wipes Dany Baby.")).toEqual([]);
    expect(codigos("Le tenemos WaterWipes.")).toContain("frase-prohibida");
  });
});

describe("los montos: un total de verdad es precio × cajas + envío − abono", () => {
  const base = new Set([5000, 4500, 700, 500, 250]);
  it("se reconocen las cuentas de una cotización", () => {
    expect(montoRespaldado(4500 + 700, base)).toBe(true); // XL + Las Acacias
    expect(montoRespaldado(4500 + 700 - 500, base)).toBe(true); // el resto, menos el abono
    expect(montoRespaldado(4500 * 2 + 500, base)).toBe(true); // dos cajas + envío
    expect(montoRespaldado(4500 * 70, base)).toBe(true); // 70 cajas
  });
  it("lo que no sale de los datos, no", () => {
    expect(montoRespaldado(600, new Set([5000, 500]))).toBe(false);
    expect(montoRespaldado(15000 + 123, base)).toBe(false);
  });
  it("lee $50, $ 2.50 y $1,200.00", () => {
    expect(montosEn("Caja $50, cargo $ 2.50, total $1,200.00")).toEqual([5000, 250, 120000]);
  });
});

describe("la nota que se le devuelve al modelo", () => {
  it("lleva el borrador, cada problema y lo que dijeron las tools", () => {
    const ps = revisarRespuesta("le confirmo que recibimos su pago", usted);
    const nota = notaDeRevision("le confirmo que recibimos su pago", ps, '{"precio":"$50.00"}');
    expect(nota).toContain("<revision_de_tu_respuesta>");
    expect(nota).toContain("[pago-confirmado]");
    expect(nota).toContain("le confirmo que recibimos su pago");
    expect(nota).toContain('{"precio":"$50.00"}');
  });
});

describe("el revisor está conectado donde importa (src/agent.ts)", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const AGENT = readFileSync(resolve(ROOT, "src/agent.ts"), "utf8");

  it("revisa ANTES de la última puerta y de guardar/enviar", () => {
    const revisa = AGENT.indexOf("revisarRespuesta(assistantText");
    expect(revisa).toBeGreaterThan(-1);
    expect(revisa).toBeLessThan(AGENT.indexOf("Última puerta"));
    expect(revisa).toBeLessThan(AGENT.indexOf('await msgs.append(convId, "assistant", assistantText'));
  });

  it("al rehacer, solo deja tools que CONSULTAN: un ticket o un lead no se duplican", () => {
    const m = AGENT.match(/TOOLS_DE_CONSULTA = new Set\(\[([^\]]+)\]\)/);
    expect(m).not.toBeNull();
    const nombres = m![1].split(",").map((x) => x.trim().replace(/"/g, ""));
    expect(nombres.sort()).toEqual(["catalogQuery", "cotizarEnvio", "searchKb"]);
  });

  it("el texto de cada paso va separado: nada de 'el catálogo.Acá están'", () => {
    expect(AGENT).toMatch(/\.join\("\\n\\n"\)/);
  });
});

describe("<lo_que_no_puedes_hacer> en el prompt", async () => {
  const { renderSystemPrompt } = await import("../../src/system-prompt");
  const prompt = (toolList: string[]) =>
    renderSystemPrompt({ botName: "B", businessName: "N", language: "es", businessContext: "c", toolList, formaDeTrato: "usted" });

  it("dice en negativo lo que el bot no puede hacer", () => {
    const p = prompt(["catalogQuery", "searchKb", "cotizarEnvio", "handoffHuman"]);
    expect(p).toContain("<lo_que_no_puedes_hacer>");
    expect(p).toMatch(/Des por recibido, confirmado o "en orden" un pago/);
    expect(p).toMatch(/agendaste, apartaste/);
    expect(p).toMatch(/Prometas un día, una hora/);
    expect(p).toMatch(/cifra, una tarifa o una regla que trae la clienta/);
    expect(p).toContain("llamas handoffHuman");
  });

  it("no nombra tools apagadas", () => {
    const p = prompt(["searchKb"]);
    const bloque = p.slice(p.indexOf("<lo_que_no_puedes_hacer>"), p.indexOf("</lo_que_no_puedes_hacer>"));
    expect(bloque).not.toContain("handoffHuman");
    expect(bloque).not.toContain("catalogQuery");
    expect(bloque).toContain("ofreces pasar con una persona");
  });

  it("los ejemplos de frases para la clienta no tutean", () => {
    // Antes: "de 30 no te puedo cumplir hoy, de 25 sí", dentro de un prompt que exige usted.
    expect(prompt(["catalogQuery"])).not.toMatch(/no te puedo cumplir/);
  });
});
