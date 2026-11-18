import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { TicketsRepo } from "../../src/db/tickets";
import {
  avisarRetiroEnPersonaTool,
  LLAVE_AVISO_RETIRO,
  VENTANA_DEL_AVISO_MS,
} from "../../src/tools/avisarRetiroEnPersona";

// El aviso real habla con Telegram; aquí solo importa a quién y con qué se llama.
const avisar = vi.fn();
vi.mock("../../src/owner/avisos", () => ({ avisarAlDueno: (...a: unknown[]) => avisar(...a) }));

let env: any;
let db: Db;
let convs: ConversationsRepo;
let convId: string;

type Resultado = { avisada: boolean; repetida?: boolean; instruccion: string };

async function llamar(id: string | null = convId): Promise<Resultado> {
  const t = avisarRetiroEnPersonaTool(env, () => id);
  return (await t.execute!({ queDijo: "prefiere pasar a buscar el pedido hoy" }, {} as any)) as Resultado;
}

async function metadata(): Promise<Record<string, unknown>> {
  return JSON.parse((await convs.getById(convId))!.metadata ?? "{}");
}

beforeEach(async () => {
  avisar.mockReset();
  avisar.mockResolvedValue(true);
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  convId = (await convs.getOrCreate("telegram", "u1")).id;
  env = { DB: d1, BOT_TIER: "pro" };
});

describe("avisarRetiroEnPersona — avisa a la dueña SIN transferir", () => {
  it("manda el aviso con lo que dijo la clienta y le dice al bot que siga con el delivery", async () => {
    const r = await llamar();
    expect(r.avisada).toBe(true);
    expect(avisar).toHaveBeenCalledTimes(1);
    const aviso = avisar.mock.calls[0][1];
    expect(aviso.conversationId).toBe(convId);
    expect(aviso.titulo).toMatch(/en persona/i);
    expect(aviso.cuerpo).toContain("prefiere pasar a buscar el pedido hoy");
    expect(aviso.cuerpo).toMatch(/SIGUE atendiéndola/);
    expect(r.instruccion).toMatch(/delivery/);
    expect(r.instruccion).toMatch(/no la pases con una persona/i);
  });

  it("no abre ticket ni pausa el bot: la conversación sigue", async () => {
    await llamar();
    expect(await new TicketsRepo(db).listOpen()).toHaveLength(0);
    expect((await convs.getById(convId))!.open_ticket_id).toBeNull();
    expect(await convs.isPaused(convId)).toBe(false);
  });

  it("no repite el aviso si la clienta insiste dentro de la ventana", async () => {
    await llamar();
    const r = await llamar();
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ avisada: true, repetida: true });
    expect(r.instruccion).toMatch(/delivery/);
  });

  it("avisa otra vez cuando pasó la ventana", async () => {
    await llamar();
    await db.run("UPDATE conversations SET metadata = ? WHERE id = ?", [
      JSON.stringify({ [LLAVE_AVISO_RETIRO]: Date.now() - VENTANA_DEL_AVISO_MS - 1000 }),
      convId,
    ]);
    await llamar();
    expect(avisar).toHaveBeenCalledTimes(2);
  });

  it("si el aviso no salió (Telegram sin vincular) no lo anota, y lo reintenta en el próximo turno", async () => {
    avisar.mockResolvedValueOnce(false);
    const r1 = await llamar();
    expect(r1.avisada).toBe(false);
    expect(r1.instruccion).toMatch(/delivery/);
    expect((await metadata())[LLAVE_AVISO_RETIRO]).toBeUndefined();

    const r2 = await llamar();
    expect(r2.avisada).toBe(true);
    expect(avisar).toHaveBeenCalledTimes(2);
  });

  it("si el aviso revienta, la atención sigue igual", async () => {
    avisar.mockRejectedValueOnce(new Error("telegram caído"));
    const r = await llamar();
    expect(r.avisada).toBe(false);
    expect(r.instruccion).toMatch(/delivery/);
  });

  it("anota cuándo avisó sin pisar el resto de la metadata", async () => {
    await db.run("UPDATE conversations SET metadata = ? WHERE id = ?", [
      JSON.stringify({ sin_seguimiento: true }),
      convId,
    ]);
    await llamar();
    const meta = await metadata();
    expect(meta.sin_seguimiento).toBe(true);
    expect(Number(meta[LLAVE_AVISO_RETIRO])).toBeGreaterThan(Date.now() - 5000);
  });

  it("sin conversación no avisa, pero tampoco rompe", async () => {
    const r = await llamar(null);
    expect(r.avisada).toBe(false);
    expect(avisar).not.toHaveBeenCalled();
  });
});
