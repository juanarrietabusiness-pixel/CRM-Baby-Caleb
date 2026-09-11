/**
 * El mensaje de seguimiento es un SEGUNDO bot, y nadie lo estaba vigilando.
 *
 * `runFollowups` corre en el cron diario (wrangler.toml: "0 3 * * *") y le
 * escribe a clientas reales. Pero arma su propio prompt: no comparte nada con
 * el del agente — ni <forma_de_trato>, ni <ultimo_recordatorio>, ni el
 * business_context, ni las tools. Decía literalmente "español mexicano casual"
 * (el negocio es panameño y trata de usted) y le pedía al modelo "retoma lo
 * último que hablaron", con un transcript de 6 mensajes que casi siempre trae
 * el precio que el bot cotizó días atrás — sin ninguna forma de reconsultarlo.
 *
 * O sea: el fallo exacto que trato-y-busqueda.test.ts existe para prevenir,
 * reintroducido por un camino que ese test no mira.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOLLOWUP = readFileSync(resolve(ROOT, "src/followup/run.ts"), "utf8");

describe("el seguimiento habla como el negocio", () => {
  it("no le pide al modelo un registro que no es el del negocio", () => {
    expect(FOLLOWUP).not.toMatch(/mexicano/i);
  });

  it("exige usted, y lo exige contra el propio historial", () => {
    expect(FOLLOWUP).toMatch(/hable SIEMPRE de usted/i);
    // El historial puede traer tuteo del propio bot de antes de los arreglos:
    // sin esta línea, el modelo lo copia como ejemplo.
    expect(FOLLOWUP).toMatch(/aunque en el historial usted mismo haya tuteado/i);
  });
});

describe("el seguimiento no puede afirmar nada que no pueda verificar", () => {
  it("tiene prohibido repetir precios, aunque estén en el historial", () => {
    expect(FOLLOWUP).toMatch(/NO repitas ni menciones ningún PRECIO/i);
    expect(FOLLOWUP).toMatch(/aunque aparezca en los mensajes de abajo/i);
  });

  it("tiene prohibido afirmar disponibilidad", () => {
    expect(FOLLOWUP).toMatch(/NO afirmes que algo está disponible/i);
  });

  it("tiene prohibido mandar a la clienta a otro canal", () => {
    expect(FOLLOWUP).toMatch(/NO des WhatsApp, Instagram, correo/i);
  });

  it("tiene prohibido confirmar pagos o entregas", () => {
    expect(FOLLOWUP).toMatch(/NO confirmes pagos, pedidos, fechas de entrega/i);
  });

  it("el transcript se le presenta como contexto, no como datos repetibles", () => {
    expect(FOLLOWUP).toMatch(/son CONTEXTO para saber de qué hablaban, no datos que puedas repetir/i);
  });
});

describe("el seguimiento no pisa a una persona del equipo", () => {
  it("no le escribe a una conversación con ticket abierto", () => {
    // Un "¿le quedó alguna duda?" automático encima de un comprobante que
    // alguien está verificando es peor que no escribir nada.
    const consulta = FOLLOWUP.slice(FOLLOWUP.indexOf("SELECT * FROM"));
    expect(consulta).toMatch(/c\.open_ticket_id IS NULL/);
  });

  it("sigue respetando la pausa del dueño", () => {
    const consulta = FOLLOWUP.slice(FOLLOWUP.indexOf("SELECT * FROM"));
    expect(consulta).toMatch(/c\.paused_until IS NULL/);
  });
});
