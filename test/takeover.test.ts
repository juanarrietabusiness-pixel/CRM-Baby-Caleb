import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../src/db/settings";
import {
  takeoverMsFrom,
  esEcoDelBot,
  registrarRespuestaDelTelefono,
  TAKEOVER_DEFAULT_MIN,
} from "../src/takeover";
import { parseRespuestaPropia } from "../src/channels/whatsappQr";

vi.mock("agents", () => ({ Agent: class {} }));

let mf: Awaited<ReturnType<typeof createTestMiniflare>>;
let env: any;
let db: Db;

beforeEach(async () => {
  mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  env = { DB: d1, WA_TOKEN: "token-de-prueba-1234567890abcdef" };
});

describe("takeoverMsFrom", () => {
  it("sin ajuste es una hora, como antes", () => {
    expect(takeoverMsFrom(null)).toBe(TAKEOVER_DEFAULT_MIN * 60_000);
    expect(takeoverMsFrom("")).toBe(60 * 60_000);
    expect(takeoverMsFrom("basura")).toBe(60 * 60_000);
  });

  it("respeta lo que eligió el panel, dentro de un rango sensato", () => {
    expect(takeoverMsFrom("240")).toBe(240 * 60_000);
    expect(takeoverMsFrom("1")).toBe(5 * 60_000);
    expect(takeoverMsFrom("999999")).toBe(7 * 24 * 60 * 60_000);
  });
});

describe("esEcoDelBot", () => {
  const recientes = [{ content: "Sí, tenemos Pañal Nateen Talla M disponible. ¿Le interesa?" }];

  it("reconoce un mensaje entero que el bot acaba de mandar", () => {
    expect(esEcoDelBot("Sí, tenemos Pañal Nateen Talla M disponible. ¿Le interesa?", recientes)).toBe(true);
  });

  it("reconoce un trozo largo (el bot parte sus respuestas en burbujas)", () => {
    expect(esEcoDelBot("Sí, tenemos Pañal Nateen Talla M disponible.", recientes)).toBe(true);
  });

  it("un 'Sí' de la dueña NO es un eco, aunque el bot haya dicho 'Sí, tenemos…'", () => {
    expect(esEcoDelBot("Sí", recientes)).toBe(false);
    expect(esEcoDelBot("Talla M", recientes)).toBe(false);
  });
});

describe("registrarRespuestaDelTelefono", () => {
  it("anota el mensaje de la dueña como `owner` y pausa la conversación", async () => {
    const convs = new ConversationsRepo(db);
    await convs.getOrCreate("whatsapp-qr", "245161514766536@lid", "Clienta");

    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["245161514766536@lid"],
      texto: "Hola, soy Yulilka. Ya le reservo su caja.",
      tipo: "conversation",
      enviadoEn: Date.now(),
    });

    expect(r.accion).toBe("pausada");
    expect(await convs.isPaused("whatsapp-qr:245161514766536@lid")).toBe(true);
    const msgs = await new MessagesRepo(db).lastN("whatsapp-qr:245161514766536@lid", 5);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["owner", "Hola, soy Yulilka. Ya le reservo su caja."],
    ]);
  });

  it("usa la conversación que ya existe aunque el chat llegue con el número y no con el LID", async () => {
    const convs = new ConversationsRepo(db);
    await convs.getOrCreate("whatsapp-qr", "245161514766536@lid");

    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["50761234567@s.whatsapp.net", "245161514766536@lid"],
      texto: "Buenas",
      tipo: "conversation",
      enviadoEn: Date.now(),
    });

    expect(r).toMatchObject({ accion: "pausada", conversationId: "whatsapp-qr:245161514766536@lid" });
    const n = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM conversations");
    expect(n?.n).toBe(1);
  });

  it("si la dueña escribió primero, abre la conversación ya pausada (con el LID)", async () => {
    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["50761234567@s.whatsapp.net", "111@lid"],
      texto: "Hola, le escribo de Baby Caleb",
      tipo: "conversation",
      enviadoEn: Date.now(),
    });
    expect(r).toMatchObject({ accion: "pausada", conversationId: "whatsapp-qr:111@lid" });
  });

  it("cada respuesta usa el plazo que eligió el panel", async () => {
    await new SettingsRepo(db).set(SETTING_KEYS.takeoverMinutes, "240");
    const antes = Date.now();
    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["222@lid"],
      texto: "Ya la atiendo yo",
      tipo: "conversation",
      enviadoEn: antes,
    });
    if (r.accion !== "pausada") throw new Error("debió pausar");
    expect(r.hasta).toBeGreaterThanOrEqual(antes + 240 * 60_000);
  });

  it("el eco de lo que el bot acaba de decir no pausa (red de abajo por si el contenedor se reinició)", async () => {
    const convs = new ConversationsRepo(db);
    await convs.getOrCreate("whatsapp-qr", "333@lid");
    await new MessagesRepo(db).append(
      "whatsapp-qr:333@lid",
      "assistant",
      "Perfecto, tenemos 5 cajas de Pañal Nateen Talla M disponibles para usted.",
    );

    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["333@lid"],
      texto: "Perfecto, tenemos 5 cajas de Pañal Nateen Talla M disponibles para usted.",
      tipo: "conversation",
      enviadoEn: Date.now(),
    });
    expect(r).toEqual({ accion: "ignorada", motivo: "eco del bot" });
    expect(await convs.isPaused("whatsapp-qr:333@lid")).toBe(false);
  });

  it("ignora grupos y estados", async () => {
    const r = await registrarRespuestaDelTelefono(env, {
      jids: ["1203630@g.us", "status@broadcast"],
      texto: "hola grupo",
      tipo: "conversation",
      enviadoEn: Date.now(),
    });
    expect(r.accion).toBe("ignorada");
  });

  it("una foto sin texto se anota igual, para que el panel muestre que hubo respuesta", async () => {
    await registrarRespuestaDelTelefono(env, {
      jids: ["444@lid"],
      texto: null,
      tipo: "imageMessage",
      enviadoEn: Date.now(),
    });
    const msgs = await new MessagesRepo(db).lastN("whatsapp-qr:444@lid", 5);
    expect(msgs[0].content).toBe("(imagen enviado desde el teléfono)");
  });
});

describe("parseRespuestaPropia", () => {
  it("exige al menos un chat", () => {
    expect(() => parseRespuestaPropia({ texto: "hola" })).toThrow(/sin chat/);
  });

  it("normaliza el cuerpo del puente", () => {
    const r = parseRespuestaPropia({ jids: ["1@lid", 5], texto: "hola", tipo: "conversation", enviadoEn: 10 });
    expect(r).toEqual({ jids: ["1@lid"], texto: "hola", tipo: "conversation", enviadoEn: 10 });
  });
});

describe("POST /webhooks/whatsapp-qr/propio", () => {
  async function llamar(body: unknown, token = env.WA_TOKEN) {
    const { default: worker } = await import("../src/index");
    return worker.fetch(
      new Request("https://bot/webhooks/whatsapp-qr/propio", {
        method: "POST",
        headers: { "content-type": "application/json", "x-wa-token": token },
        body: JSON.stringify(body),
      }),
      env,
      {} as any,
    );
  }

  it("rechaza sin el token del puente", async () => {
    const res = await llamar({ jids: ["1@lid"], texto: "x" }, "otro");
    expect(res.status).toBe(401);
  });

  it("pausa la conversación con el token correcto", async () => {
    const res = await llamar({ jids: ["555@lid"], texto: "Yo la atiendo", enviadoEn: Date.now() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, accion: "pausada" });
    expect(await new ConversationsRepo(db).isPaused("whatsapp-qr:555@lid")).toBe(true);
  });
});
