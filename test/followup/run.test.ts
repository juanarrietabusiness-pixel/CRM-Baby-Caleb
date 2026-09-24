/**
 * El seguimiento de la dueña: 5 horas, 3 días y 7 días sin respuesta, cordial,
 * en horario, y nunca a quien dijo que no le interesa. D1 real (miniflare); el
 * adapter del canal es un doble que anota lo que se mandó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendReplyMock = vi.fn();
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: (...a: unknown[]) => sendReplyMock(...a) }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { runFollowups, noQuiereSeguimiento, enHorario, textoDelPaso } from "../../src/followup/run";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
// Martes 22-sep-2026, 10:00 a.m. de Panamá (15:00 UTC): en horario.
const MARTES_10AM = Date.UTC(2026, 8, 22, 15, 0, 0);

let env: any;
let db: Db;
let convs: ConversationsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  env = { DB: d1, BOT_TIMEZONE: "America/Panama" };
  sendReplyMock.mockReset();
  sendReplyMock.mockResolvedValue(undefined);
});

/** La clienta escribió en `userAt`, el bot contestó en `botAt`. */
async function conversacion(id: string, userAt: number, botAt: number, opts: { channel?: string; texto?: string } = {}) {
  const conv = await convs.getOrCreate(opts.channel ?? "whatsapp-qr", id, `Clienta ${id}`);
  await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", [
    `${id}-u`,
    conv.id,
    opts.texto ?? "¿cuánto cuesta la talla M?",
    userAt,
  ]);
  await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', 'La M está a la venta…', ?)", [
    `${id}-a`,
    conv.id,
    botAt,
  ]);
  await db.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [botAt, conv.id]);
  return conv.id;
}

const enviados = () => sendReplyMock.mock.calls.map((c) => (c[0] as any).chunks[0] as string);

describe("los tres pasos", () => {
  it("a las 5 horas sale el mensaje de la dueña, y antes no", async () => {
    await conversacion("a", MARTES_10AM - 6 * HORA, MARTES_10AM - 4 * HORA);
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);

    await runFollowups(env, { now: MARTES_10AM + HORA + 1 });
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0]).toMatch(/¿Desea algún pedido\? Estoy agendando los pedidos de mañana/);
  });

  it("3 días después sale el segundo, 7 días después el tercero, y ahí se para", async () => {
    await conversacion("b", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await runFollowups(env, { now: MARTES_10AM });
    // Viernes 10 a.m. (3 días después)
    await runFollowups(env, { now: MARTES_10AM + 3 * DIA });
    // Viernes siguiente 10 a.m. (7 días después del segundo)
    await runFollowups(env, { now: MARTES_10AM + 10 * DIA });
    // Nada más, aunque pase el tiempo.
    await runFollowups(env, { now: MARTES_10AM + 17 * DIA });
    expect(enviados()).toHaveLength(3);
    expect(enviados()[1]).toMatch(/todavía le interesa su pedido/);
    expect(enviados()[2]).toMatch(/seguimos a la orden/);
  });

  it("si la clienta contesta, el ciclo vuelve a empezar desde el primero", async () => {
    const id = await conversacion("c", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await runFollowups(env, { now: MARTES_10AM });
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('c-u2', ?, 'user', 'mañana le confirmo', ?)", [
      id,
      MARTES_10AM + HORA,
    ]);
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('c-a2', ?, 'assistant', 'Con gusto', ?)", [
      id,
      MARTES_10AM + HORA,
    ]);
    await runFollowups(env, { now: MARTES_10AM + 7 * HORA });
    expect(enviados()).toHaveLength(2);
    expect(enviados()[1]).toMatch(/¿Desea algún pedido\?/);
  });

  it("todos son de usted, nunca tutean", () => {
    for (const p of [0, 1, 2]) {
      const t = textoDelPaso(p, 10);
      expect(t).not.toMatch(/\b(tú|tu bebé|quieres|necesitas|te ayudo)\b/i);
    }
  });
});

describe("a quién NO se le escribe", () => {
  it("nunca más a quien dijo que no le interesa (y queda marcada)", async () => {
    const id = await conversacion("d", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { texto: "No, gracias, ya no me interesa" });
    const r = await runFollowups(env, { now: MARTES_10AM });
    expect(r.sent).toBe(0);
    const conv = await convs.getById(id);
    expect(JSON.parse(conv!.metadata!).sin_seguimiento).toBe(true);
  });

  it("reconoce las formas comunes de decir que no", () => {
    for (const t of ["no me interesa", "No estoy interesada", "ya compré en otro lado", "no me escriba más", "ya no lo necesito"]) {
      expect(noQuiereSeguimiento(t)).toBe(true);
    }
    for (const t of ["¿cuánto cuesta?", "me interesa la talla M", "no sé qué talla", "gracias!"]) {
      expect(noQuiereSeguimiento(t)).toBe(false);
    }
  });

  it("ni a una conversación que atiende una persona, ni con un ticket abierto", async () => {
    const pausada = await conversacion("e", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await convs.setPausedUntil(pausada, MARTES_10AM + DIA);
    const conTicket = await conversacion("f", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await convs.setOpenTicket(conTicket, "t1");
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });

  it("ni fuera de horario: de noche o en fin de semana espera", async () => {
    await conversacion("g", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    const MARTES_10PM = MARTES_10AM + 12 * HORA;
    expect(enHorario(env, MARTES_10PM)).toBe(false);
    expect((await runFollowups(env, { now: MARTES_10PM })).sent).toBe(0);
    const SABADO_10AM = MARTES_10AM + 4 * DIA;
    expect(enHorario(env, SABADO_10AM)).toBe(false);
  });

  it("WhatsApp oficial: pasadas 24 h ya no se puede escribir primero (sin plantilla)", async () => {
    await conversacion("h", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { channel: "whatsapp" });
    await runFollowups(env, { now: MARTES_10AM }); // el de 5 h sí cabe
    await runFollowups(env, { now: MARTES_10AM + 3 * DIA }); // el de 3 días no
    expect(enviados()).toHaveLength(1);
  });
});

describe("garantías", () => {
  it("el mismo paso nunca sale dos veces, aunque dos corridas se crucen", async () => {
    await conversacion("i", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await Promise.all([runFollowups(env, { now: MARTES_10AM }), runFollowups(env, { now: MARTES_10AM })]);
    expect(enviados()).toHaveLength(1);
  });

  it("el bot en pausa global no manda nada", async () => {
    await conversacion("j", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('bot_paused', '1', ?)", [Date.now()]);
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });

  it("el seguimiento queda en la conversación, visible en el panel", async () => {
    const id = await conversacion("k", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await runFollowups(env, { now: MARTES_10AM });
    const ultimo = await db.first<{ role: string; model_used: string }>(
      "SELECT role, model_used FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1",
      [id],
    );
    expect(ultimo).toEqual({ role: "assistant", model_used: "seguimiento-1" });
  });
});
