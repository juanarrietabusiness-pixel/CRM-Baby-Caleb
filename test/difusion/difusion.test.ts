/**
 * La difusión: a quién le llega (lo que ELLAS escribieron, no los leads), y
 * cómo sale — de a poco, en horario, como mensaje del equipo, sin despertar al
 * seguimiento automático y sin escribirle a quien no quiere. D1 real
 * (miniflare); el adapter del canal es un doble que anota lo que se mandó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendReplyMock = vi.fn();
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: (...a: unknown[]) => sendReplyMock(...a) }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import {
  buscarPorTema,
  resumenDeAudiencia,
  crearBorrador,
  cambiarEstado,
  conteo,
  runDifusiones,
  porCorrida,
  limpiarPalabras,
} from "../../src/difusion/difusion";
import { runFollowups } from "../../src/followup/run";
import { horarioEnPalabras } from "../../src/owner/difusion";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
// Martes 22-sep-2026, 10:00 a.m. de Panamá (15:00 UTC): en horario.
const MARTES_10AM = Date.UTC(2026, 8, 22, 15, 0, 0);
const DOMINGO_10AM = MARTES_10AM - 2 * DIA;
const DANY = ["dany", "danny", "water wipes"];

let env: any;
let db: Db;
let convs: ConversationsRepo;
const sinEspera = { espera: async () => {} };

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  env = { DB: d1, BOT_TIMEZONE: "America/Panama" };
  sendReplyMock.mockReset();
  sendReplyMock.mockResolvedValue(undefined);
});

let n = 0;
/** Una clienta que escribió `texto` hace `haceDias`; el bot le contestó con el catálogo. */
async function clienta(
  id: string,
  texto: string,
  haceDias: number,
  opts: { channel?: string; nombre?: string; ahora?: number; bot?: string } = {},
) {
  const ahora = opts.ahora ?? MARTES_10AM;
  const conv = await convs.getOrCreate(opts.channel ?? "whatsapp-qr", id, opts.nombre ?? `Clienta ${id}`);
  const t = ahora - haceDias * DIA;
  await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", [
    `m${++n}`,
    conv.id,
    texto,
    t,
  ]);
  await db.run(
    "INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)",
    [`m${++n}`, conv.id, opts.bot ?? "Le comento los precios…", JSON.stringify([{ toolName: "catalogQuery", input: {} }]), t + 60_000],
  );
  await db.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [t + 60_000, conv.id]);
  return conv.id;
}

const enviados = () => sendReplyMock.mock.calls.map((c) => (c[0] as any).chunks[0] as string);

async function difusionActiva(texto: string, porDia = 40, ahora = MARTES_10AM) {
  const personas = await buscarPorTema(env, DANY, 60, ahora);
  const d = await crearBorrador(
    env,
    { texto, tema: "dany", porDia, conversaciones: personas.filter((p) => !p.motivo).map((p) => p.conv.id) },
    ahora,
  );
  expect(await cambiarEstado(env, d.id, "activa", ahora)).toBe(true);
  return d.id;
}

describe("a quién le llega: lo que ELLAS escribieron", () => {
  it("encuentra a las que nombraron el producto, con mayúsculas o mal escrito, en el plazo", async () => {
    await clienta("a", "Hola, info de los wipes Dany Baby", 5);
    await clienta("b", "precio DANNY BABY?", 40);
    await clienta("c", "tienen water wipes?", 59);
    await clienta("viejo", "dany baby", 70); // fuera de los 60 días
    await clienta("otro", "¿cuánto cuesta la talla M?", 3); // no preguntó por eso
    const ids = (await buscarPorTema(env, DANY, 60, MARTES_10AM)).map((p) => p.conv.display_name).sort();
    expect(ids).toEqual(["Clienta a", "Clienta b", "Clienta c"]);
  });

  it("no cuenta a quien solo vio el producto en una lista del bot", async () => {
    // El bot nombra el catálogo entero cuando le preguntan «¿qué tienen?».
    await clienta("lista", "¿qué tienen?", 2, { bot: "Tenemos pañales Nateen y wipes Dany Baby…" });
    expect(await buscarPorTema(env, DANY, 60, MARTES_10AM)).toHaveLength(0);
  });

  it("marca a quien no se le escribe y a quien ya compró, sin sacarlas del conteo", async () => {
    const no = await clienta("no", "dany baby?", 10);
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('x1', ?, 'user', 'no me interesa, gracias', ?)", [
      no,
      MARTES_10AM - 9 * DIA,
    ]);
    await clienta("ig", "precio de los dany", 3, { channel: "instagram" }); // >24 h por Instagram
    const compro = await clienta("compro", "quiero los danny", 20);
    await db.run(
      "INSERT INTO compras (id, conversation_id, comprado_en, origen, created_at) VALUES ('k1', ?, ?, 'duena', ?)",
      [compro, MARTES_10AM - 19 * DIA, MARTES_10AM],
    );
    const ps = await buscarPorTema(env, DANY, 60, MARTES_10AM);
    const de = (nombre: string) => ps.find((p) => p.conv.display_name === `Clienta ${nombre}`)!;
    expect(de("no").motivo).toBe("dijo que no le interesa");
    expect(de("ig").motivo).toMatch(/24 h/);
    expect(de("compro").motivo).toBeNull();
    expect(de("compro").compro).toBe(true);

    const texto = resumenDeAudiencia(ps, DANY, 60);
    expect(texto).toMatch(/: 3 personas/);
    expect(texto).toMatch(/Se les puede escribir: 1/);
    expect(texto).toMatch(/Con compra registrada: 1/);
  });

  it("limpia las palabras: sin repetidas, sin las de menos de 3 letras", () => {
    expect(limpiarPalabras([" Dany ", "dany", "wi", "Water  Wipes"])).toEqual(["dany", "water wipes"]);
  });
});

describe("cómo sale: de a poco, en horario, del equipo", () => {
  it("una corrida manda solo su parte de la hora, con su nombre y espera entre una y otra", async () => {
    for (let i = 0; i < 10; i++) await clienta(`c${i}`, "¿precio de los dany baby?", 10 + i, { nombre: `Ana${String.fromCharCode(97 + i)}` });
    await difusionActiva("Hola {nombre}, ¡bajaron los Dany Baby!");
    const espera = vi.fn(async () => {});
    const r = await runDifusiones(env, { now: MARTES_10AM, espera });
    // 40 al día en un horario de 8 a 18 = 4 por hora.
    expect(porCorrida(40, 8, 18)).toBe(4);
    expect(r.enviados).toBe(4);
    expect(espera).toHaveBeenCalledTimes(3);
    expect(enviados()[0]).toMatch(/^Hola Ana[a-j], ¡bajaron los Dany Baby!$/);
  });

  it("queda escrito como mensaje del equipo, no pausa al bot, y el seguimiento no arranca por él", async () => {
    const id = await clienta("vieja", "¿y los dany baby?", 45);
    await difusionActiva("Hola {nombre}, bajaron de precio");
    await runDifusiones(env, { now: MARTES_10AM, ...sinEspera });
    const ultimo = await db.first<{ role: string }>(
      "SELECT role FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1",
      [id],
    );
    expect(ultimo?.role).toBe("owner");
    const conv = await convs.getById(id);
    expect(conv?.paused_until ?? null).toBeNull();

    // Si quedara como mensaje del bot, a las 5 horas saldría «¿Desea algún pedido?».
    sendReplyMock.mockClear();
    await runFollowups(env, { now: Date.now() + 6 * HORA });
    expect(enviados()).toHaveLength(0);
  });

  it("fuera del horario no sale nada", async () => {
    await clienta("a", "dany", 3, { ahora: DOMINGO_10AM });
    await difusionActiva("Hola", 40, DOMINGO_10AM);
    expect((await runDifusiones(env, { now: DOMINGO_10AM, ...sinEspera })).enviados).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("no pasa del tope del día aunque corra cada hora", async () => {
    for (let i = 0; i < 8; i++) await clienta(`c${i}`, "dany baby", 10);
    await difusionActiva("Hola", 5);
    for (let h = 0; h < 8; h++) await runDifusiones(env, { now: MARTES_10AM + h * HORA, ...sinEspera });
    expect(enviados()).toHaveLength(5);
    // Al día siguiente sigue.
    await runDifusiones(env, { now: MARTES_10AM + DIA, ...sinEspera });
    expect(enviados()).toHaveLength(6);
  });

  it("salta a quien atiende una persona y a quien dijo «no me interesa» después de armar la lista; espera a quien está conversando", async () => {
    const atendida = await clienta("atendida", "dany", 10);
    const arrepentida = await clienta("arrepentida", "dany", 10);
    const conversando = await clienta("conversando", "dany", 10);
    const id = await difusionActiva("Hola");
    await db.run("UPDATE conversations SET paused_until = ? WHERE id = ?", [MARTES_10AM + HORA, atendida]);
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('x2', ?, 'user', 'ya no me interesa', ?)", [
      arrepentida,
      MARTES_10AM - 3 * HORA,
    ]);
    await db.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [MARTES_10AM - 30 * 60_000, conversando]);

    const r = await runDifusiones(env, { now: MARTES_10AM, ...sinEspera });
    expect(r).toMatchObject({ enviados: 0, saltados: 2 });
    expect((await conteo(env, id)).pendientes).toBe(1);

    // Dos horas después, la que conversaba ya no está conversando.
    await runDifusiones(env, { now: MARTES_10AM + 3 * HORA, ...sinEspera });
    expect(enviados()).toHaveLength(1);
    expect(sendReplyMock.mock.calls[0][0]).toMatchObject({ channelUserId: "conversando" });
  });

  it("en pausa no sale nada; al seguir, continúa donde quedó", async () => {
    for (let i = 0; i < 6; i++) await clienta(`c${i}`, "dany", 10);
    const id = await difusionActiva("Hola");
    await runDifusiones(env, { now: MARTES_10AM, ...sinEspera });
    expect(await cambiarEstado(env, id, "pausada")).toBe(true);
    await runDifusiones(env, { now: MARTES_10AM + HORA, ...sinEspera });
    expect(enviados()).toHaveLength(4);
    expect(await cambiarEstado(env, id, "activa")).toBe(true);
    await runDifusiones(env, { now: MARTES_10AM + 2 * HORA, ...sinEspera });
    expect(enviados()).toHaveLength(6);
  });

  it("cuando no queda nadie, termina", async () => {
    await clienta("a", "dany", 10);
    const id = await difusionActiva("Hola");
    const r = await runDifusiones(env, { now: MARTES_10AM, ...sinEspera });
    expect(r.terminada).toBe(true);
    expect((await db.first<{ estado: string }>("SELECT estado FROM difusiones WHERE id = ?", [id]))?.estado).toBe("terminada");
  });

  it("si el canal falla, queda en error y no se reintenta", async () => {
    await clienta("a", "dany", 10);
    await clienta("b", "dany", 11);
    const id = await difusionActiva("Hola");
    sendReplyMock.mockRejectedValueOnce(new Error("puente caído"));
    await runDifusiones(env, { now: MARTES_10AM, ...sinEspera });
    await runDifusiones(env, { now: MARTES_10AM + HORA, ...sinEspera });
    const c = await conteo(env, id);
    expect(c.errores).toBe(1);
    expect(c.enviados).toBe(1);
    expect(sendReplyMock).toHaveBeenCalledTimes(2);
  });
});

describe("una a la vez, y solo los pasos que tienen sentido", () => {
  it("no se empieza una segunda mientras otra está en marcha o en pausa", async () => {
    await clienta("a", "dany", 10);
    await difusionActiva("Primera");
    const otra = await crearBorrador(env, { texto: "Segunda", tema: "x", porDia: 40, conversaciones: [] });
    expect(await cambiarEstado(env, otra.id, "activa")).toBe(false);
  });

  it("un borrador no se pausa, y una descartada no revive", async () => {
    const d = await crearBorrador(env, { texto: "Hola", tema: "x", porDia: 40, conversaciones: [] });
    expect(await cambiarEstado(env, d.id, "pausada")).toBe(false);
    expect(await cambiarEstado(env, d.id, "descartada")).toBe(true);
    expect(await cambiarEstado(env, d.id, "activa")).toBe(false);
  });

  it("el ritmo por día tiene tope", async () => {
    const d = await crearBorrador(env, { texto: "Hola", tema: "x", porDia: 500, conversaciones: [] });
    expect(d.por_dia).toBe(60);
  });
});

describe("cómo se lo cuenta a la dueña", () => {
  it("el horario en palabras", () => {
    expect(horarioEnPalabras({ dias: [1, 2, 3, 4, 5], horaDesde: 8, horaHasta: 18 })).toBe("de lunes a viernes, de 8:00 a 18:00");
    expect(horarioEnPalabras({ dias: [1, 3, 5], horaDesde: 9, horaHasta: 17 })).toBe("lunes, miércoles, viernes, de 9:00 a 17:00");
  });
});
