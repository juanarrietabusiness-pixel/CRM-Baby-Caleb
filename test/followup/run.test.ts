/**
 * El seguimiento: 5 horas, 3 días y 7 días sin respuesta, cordial, en horario,
 * solo a las interesadas, nunca a quien dijo que no le interesa, y a quien ya
 * compró solo el de recompra a los 15 días. D1 real (miniflare); el adapter del
 * canal es un doble que anota lo que se mandó.
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
import { marcarCompra, diceQueCompro, diceQuePago } from "../../src/followup/compras";
import { guardarAjustes } from "../../src/followup/ajustes";

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

/**
 * La clienta escribió en `userAt`, el bot contestó en `botAt`. Por defecto el
 * bot consultó el catálogo para contestarle: es una interesada.
 */
async function conversacion(
  id: string,
  userAt: number,
  botAt: number,
  opts: { channel?: string; texto?: string; sinInteres?: boolean } = {},
) {
  const conv = await convs.getOrCreate(opts.channel ?? "whatsapp-qr", id, `Clienta ${id}`);
  await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", [
    `${id}-u`,
    conv.id,
    opts.texto ?? "¿cuánto cuesta la talla M?",
    userAt,
  ]);
  await db.run(
    "INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', 'La M está a la venta…', ?, ?)",
    [`${id}-a`, conv.id, opts.sinInteres ? null : JSON.stringify([{ toolName: "catalogQuery", input: { query: "M" } }]), botAt],
  );
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
    // «Ya compré» a secas es una compra, no un «no me escriban».
    for (const t of ["¿cuánto cuesta?", "me interesa la talla M", "no sé qué talla", "gracias!", "ya compré", "ya lo compré, gracias"]) {
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

// Pausar o devolver al bot reescribía `metadata` entera y se llevaba la marca
// de la clienta que pidió no recibir más mensajes: el seguimiento volvía a
// escribirle. (Se cazó al portar el seguimiento a B&S, 24-sep-2026.)
describe("la marca de 'no me escriban' sobrevive a una pausa", () => {
  it("pausar y devolver al bot no la borran", async () => {
    const { pausarPorHumano, devolverAlBot } = await import("../../src/takeover");
    const id = await conversacion("nn", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { texto: "no me escriban más" });
    await runFollowups(env, { now: MARTES_10AM });
    await pausarPorHumano(env, id, "panel");
    await devolverAlBot(env, id, { quien: "panel" });
    const meta = JSON.parse(
      (await db.first<{ metadata: string }>("SELECT metadata FROM conversations WHERE id = ?", [id]))!.metadata,
    );
    expect(meta.sin_seguimiento).toBe(true);
    expect(meta.atiende).toBeUndefined();
  });
});


// ── La regla del 29-sep-2026 ────────────────────────────────────────────────
// El seguimiento le escribía a todas: a quien solo dijo «hola», a quien la
// dueña le acababa de cerrar la venta a mano, y a quien ya había pagado. La
// orden de la dueña por Telegram quedó en la base de conocimiento, que este
// cron no lee.

async function mensaje(convId: string, role: "user" | "assistant" | "owner", content: string, at: number) {
  await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)", [
    crypto.randomUUID(),
    convId,
    role,
    content,
    at,
  ]);
  await db.run("UPDATE conversations SET last_message_at = MAX(last_message_at, ?) WHERE id = ?", [at, convId]);
}

describe("solo a las interesadas", () => {
  it("a quien solo saludó (el bot no consultó nada) no se le escribe", async () => {
    await conversacion("s1", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { texto: "Hola", sinInteres: true });
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });

  it("cotizar un envío o anotarla como interesada también cuenta", async () => {
    const id = await conversacion("s2", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { sinInteres: true });
    await db.run(
      "INSERT INTO leads (id, conversation_id, intent, created_at, updated_at) VALUES ('l1', ?, 'Caja M', ?, ?)",
      [id, MARTES_10AM - 5 * HORA, MARTES_10AM - 5 * HORA],
    );
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(1);
  });

  it("si la última en escribir fue la dueña, el bot no hace seguimiento", async () => {
    const id = await conversacion("s3", MARTES_10AM - 8 * HORA, MARTES_10AM - 7 * HORA);
    await mensaje(id, "owner", "Listo, su pedido sale mañana", MARTES_10AM - 6 * HORA);
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });
});

describe("quien ya compró", () => {
  const recompra = /¿Cómo le fue con su pedido\?/;

  it("marcada por la dueña: descansa 15 días, luego recompra y los recordatorios", async () => {
    const id = await conversacion("c1", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await marcarCompra(env, id, { cuando: MARTES_10AM - 5 * HORA });
    // Ni a las 5 horas ni en los días siguientes.
    for (const d of [0, 1, 3, 7, 14]) await runFollowups(env, { now: MARTES_10AM + d * DIA });
    expect(enviados()).toHaveLength(0);
    // Día 15 (miércoles): el de recompra.
    await runFollowups(env, { now: MARTES_10AM + 15 * DIA });
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0]).toMatch(recompra);
    // Si no contesta: 3 días después (cae sábado, así que sale el lunes), 7
    // días después de ese, y ahí se para.
    await runFollowups(env, { now: MARTES_10AM + 18 * DIA }); // sábado: fuera de horario
    expect(enviados()).toHaveLength(1);
    await runFollowups(env, { now: MARTES_10AM + 20 * DIA }); // lunes
    await runFollowups(env, { now: MARTES_10AM + 27 * DIA }); // lunes siguiente
    await runFollowups(env, { now: MARTES_10AM + 34 * DIA });
    expect(enviados()).toHaveLength(3);
    expect(enviados()[1]).toMatch(/todavía le interesa su pedido/);
    const etiquetas = await db.all<{ model_used: string }>(
      "SELECT model_used FROM messages WHERE conversation_id = ? AND model_used LIKE 'seguimiento%' ORDER BY created_at",
      [id],
    );
    expect(etiquetas.map((e) => e.model_used)).toEqual(["seguimiento-recompra", "seguimiento-recompra-2", "seguimiento-recompra-3"]);
  });

  it("sin recordatorios si la dueña los apaga: solo el de recompra", async () => {
    const id = await conversacion("c2", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await marcarCompra(env, id, { cuando: MARTES_10AM - 5 * HORA });
    await guardarAjustes(env, { postcompraRecordatorios: false });
    await runFollowups(env, { now: MARTES_10AM + 15 * DIA });
    await runFollowups(env, { now: MARTES_10AM + 20 * DIA });
    await runFollowups(env, { now: MARTES_10AM + 27 * DIA });
    expect(enviados()).toHaveLength(1);
  });

  it("una venta registrada por Telegram cuenta como compra", async () => {
    const id = await conversacion("c3", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await db.run(
      "INSERT INTO stock_movements (id, code, branch, delta, kind, conversation_id, created_at) VALUES ('m1', 'NAT-M', 'Bodega', -1, 'venta', ?, ?)",
      [id, MARTES_10AM - 5 * HORA],
    );
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });

  it("una venta deshecha ya no cuenta", async () => {
    const id = await conversacion("c4", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await db.run(
      "INSERT INTO stock_movements (id, code, branch, delta, kind, conversation_id, undone_at, created_at) VALUES ('m2', 'NAT-M', 'Bodega', -1, 'venta', ?, ?, ?)",
      [id, MARTES_10AM - 4 * HORA, MARTES_10AM - 5 * HORA],
    );
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(1);
  });

  it("un ticket de pago (comprobante) cuenta como compra", async () => {
    const id = await conversacion("c5", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await db.run(
      "INSERT INTO tickets (id, conversation_id, category, summary, transcript, status, created_at) VALUES ('t9', ?, 'billing', 'Mandó comprobante', '', 'resolved', ?)",
      [id, MARTES_10AM - 5 * HORA],
    );
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
  });

  it("si ella dice «ya compré», queda anotada como compra (no como «no me escriban»)", async () => {
    const id = await conversacion("c6", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA, { texto: "ya le pagué por Yappy" });
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
    const compra = await db.first<{ origen: string }>("SELECT origen FROM compras WHERE conversation_id = ?", [id]);
    expect(compra?.origen).toBe("dijo");
    const conv = await convs.getById(id);
    expect(JSON.parse(conv!.metadata ?? "{}").sin_seguimiento).toBeUndefined();
    await runFollowups(env, { now: MARTES_10AM + 15 * DIA });
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0]).toMatch(recompra);
  });

  it("la dueña cerró la venta a mano: ni a las 5 horas ni después", async () => {
    const id = await conversacion("c7", MARTES_10AM - 8 * HORA, MARTES_10AM - 7 * HORA);
    await mensaje(id, "user", "Envío pagos", MARTES_10AM - 7 * HORA);
    await mensaje(id, "owner", "Recibido, gracias. Sale hoy.", MARTES_10AM - 6 * HORA);
    for (const d of [0, 3, 10]) await runFollowups(env, { now: MARTES_10AM + d * DIA });
    expect(enviados()).toHaveLength(0);
  });

  it("si contesta el de recompra, esa secuencia se para", async () => {
    const id = await conversacion("c8", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await marcarCompra(env, id, { cuando: MARTES_10AM - 5 * HORA });
    await runFollowups(env, { now: MARTES_10AM + 15 * DIA });
    await mensaje(id, "user", "Todavía me queda, gracias", MARTES_10AM + 15 * DIA + HORA);
    await runFollowups(env, { now: MARTES_10AM + 20 * DIA });
    expect(enviados()).toHaveLength(1);
  });

  it("el de recompra no sale con semanas de atraso", async () => {
    const id = await conversacion("c9", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await marcarCompra(env, id, { cuando: MARTES_10AM - 5 * HORA });
    expect((await runFollowups(env, { now: MARTES_10AM + 23 * DIA })).sent).toBe(0);
  });

  it("reconoce cómo lo dicen", () => {
    for (const t of ["ya compré", "Ya lo compré", "ya me llegó el pedido", "ya los recibí", "ya hice mi pedido"]) {
      expect(diceQueCompro(t)).toBe(true);
    }
    for (const t of ["ya compré en otro lado", "quiero comprar", "ya recibí la información", "¿ya me llegó el mensaje?"]) {
      expect(diceQueCompro(t)).toBe(false);
    }
    for (const t of ["ya pagué", "ya le mandé el comprobante", "ya hice el yappy", "aquí está el comprobante"]) {
      expect(diceQuePago(t)).toBe(true);
    }
    for (const t of ["¿cómo pago?", "quiero pagar", "no he pagado"]) expect(diceQuePago(t)).toBe(false);
  });
});

describe("lo que la dueña cambia desde Telegram", () => {
  it("apagado, no sale ninguno", async () => {
    await conversacion("x1", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await guardarAjustes(env, { activo: false });
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
    await guardarAjustes(env, { activo: true });
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(1);
  });

  it("otros tiempos: el primero a las 24 horas", async () => {
    await conversacion("x2", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await guardarAjustes(env, { pasosHoras: [24, 72] });
    expect((await runFollowups(env, { now: MARTES_10AM })).sent).toBe(0);
    expect((await runFollowups(env, { now: MARTES_10AM + DIA })).sent).toBe(1);
  });

  it("su propio texto, con el saludo de la hora", async () => {
    await conversacion("x3", MARTES_10AM - 6 * HORA, MARTES_10AM - 5 * HORA);
    await guardarAjustes(env, { texto1: "{saludo}, ¿le separo su caja para mañana?" });
    await runFollowups(env, { now: MARTES_10AM });
    expect(enviados()[0]).toBe("Buen día, ¿le separo su caja para mañana?");
  });

  it("también el horario: sábados sí, si ella lo pide", async () => {
    const SABADO_10AM = MARTES_10AM + 4 * DIA;
    await conversacion("x4", SABADO_10AM - 6 * HORA, SABADO_10AM - 5 * HORA);
    expect((await runFollowups(env, { now: SABADO_10AM })).sent).toBe(0);
    await guardarAjustes(env, { dias: [1, 2, 3, 4, 5, 6] });
    expect((await runFollowups(env, { now: SABADO_10AM })).sent).toBe(1);
  });

  it("un ajuste inválido no se guarda", async () => {
    expect(await guardarAjustes(env, { postcompraDias: 0 })).toMatch(/1 a 120/);
    expect(await guardarAjustes(env, { horaDesde: 19, horaHasta: 8 })).toMatch(/antes/);
    expect(await guardarAjustes(env, { pasosHoras: [] })).toMatch(/1 a 5/);
  });

  it("el de recompra es de usted", () => {
    expect(textoDelPaso(10, 10)).not.toMatch(/\b(tú|tu bebé|quieres|necesitas|te ayudo)\b/i);
  });
});
