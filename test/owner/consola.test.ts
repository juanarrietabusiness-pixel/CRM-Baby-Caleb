/**
 * La consola del dueño por Telegram, de punta a punta: vincular sin terminal,
 * responder sobre un aviso, botones, y el inventario (venta, devolución,
 * deshacer). D1 real con Miniflare; la API de Telegram y el puente de WhatsApp
 * son dobles que anotan lo que se les mandó.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { atenderAlDueno, partirComando, type TgUpdate } from "../../src/owner/consola";
import { crearCodigoDeVinculo, chatDelDueno, canjearCodigo } from "../../src/owner/dueno";
import { avisarAlDueno } from "../../src/owner/avisos";
import { parsearItems, elegirBodega } from "../../src/owner/inventario";

vi.mock("agents", () => ({ Agent: class {} }));

const DUENO = 777;
/** Updates con la firma de Telegram. Los sin firma tienen su propia prueba. */
const OK = { confiable: true };
let env: any;
let db: Db;
let enviados: { metodo: string; cuerpo: any }[];
let siguienteId: number;
let alPuente: any[];

function stubTelegram() {
  enviados = [];
  siguienteId = 100;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init?: any) => {
    const u = String(url);
    const metodo = u.split("/").pop()!;
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : {};
    enviados.push({ metodo, cuerpo });
    if (metodo === "getMe") return Response.json({ ok: true, result: { username: "BabyCalebBot" } });
    return Response.json({ ok: true, result: { message_id: siguienteId++ } });
  });
}

function mensaje(texto: string, extra: Record<string, unknown> = {}, de = DUENO): TgUpdate {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      from: { id: de, first_name: "Yulilka" },
      chat: { id: de, type: "private" },
      text: texto,
      ...extra,
    },
  };
}

function boton(data: string, messageId = 55, de = DUENO): TgUpdate {
  return {
    callback_query: {
      id: "cb1",
      from: { id: de },
      data,
      message: { message_id: messageId, chat: { id: de }, text: "texto original" },
    },
  };
}

const textos = (metodo = "sendMessage") => enviados.filter((e) => e.metodo === metodo).map((e) => e.cuerpo.text as string);
const ultimoTeclado = () => {
  const m = [...enviados].reverse().find((e) => e.cuerpo.reply_markup?.inline_keyboard?.length);
  return (m?.cuerpo.reply_markup.inline_keyboard ?? []).flat() as { text: string; callback_data?: string }[];
};
const datoDe = (texto: string) => ultimoTeclado().find((b) => b.text.includes(texto))!.callback_data!;

async function stockDe(code: string, branch = "Bodega Ciudad de Panamá") {
  return (await db.first<{ stock_qty: number }>("SELECT stock_qty FROM catalog_items WHERE code = ? AND branch = ?", [code, branch]))!.stock_qty;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  alPuente = [];
  env = {
    DB: d1,
    TELEGRAM_BOT_TOKEN: "tg-token",
    BUSINESS_NAME: "Baby Caleb",
    BOT_NAME: "Baby Caleb",
    BOT_TIER: "pro",
    DASHBOARD_BASE_URL: "https://bot.ejemplo",
    WA_TOKEN: "token-de-prueba-1234567890abcdef",
    WA_PUENTE_URL: "https://puente.ejemplo",
    PUENTE_WA: {
      fetch: async (req: Request) => {
        alPuente.push(await req.json());
        return Response.json({ ok: true });
      },
    },
  };
  const ahora = Date.now();
  for (const [code, branch, qty] of [
    ["NAT-M", "Bodega Ciudad de Panamá", 5],
    ["NAT-M", "Bodega Panamá Oeste", 2],
    ["NAT-L", "Bodega Ciudad de Panamá", 0],
  ] as const) {
    await db.run(
      "INSERT INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at) VALUES (?, ?, 3000, 5000, ?, ?, 1, ?)",
      [code, `Pañal Nateen Talla ${code.slice(-1)}`, qty, branch, ahora],
    );
  }
  stubTelegram();
});

afterEach(() => vi.restoreAllMocks());

async function vincular() {
  await new SettingsRepo(db).set(SETTING_KEYS.ownerTelegramChatId, String(DUENO));
}

describe("vincular el Telegram del dueño sin terminal", () => {
  it("el enlace del panel (/start dueno_<código>) deja el chat como el del dueño", async () => {
    const { codigo } = await crearCodigoDeVinculo(env);
    expect(await atenderAlDueno(env, mensaje(`/start dueno_${codigo}`), OK)).toBe(true);
    expect(await chatDelDueno(env)).toBe(String(DUENO));
    expect(textos()[0]).toMatch(/Listo/);
  });

  it("el código es de un solo uso", async () => {
    const { codigo } = await crearCodigoDeVinculo(env);
    expect(await canjearCodigo(env, codigo, 1)).toBe(true);
    expect(await canjearCodigo(env, codigo, 2)).toBe(false);
    expect(await chatDelDueno(env)).toBe("1");
  });

  it("un código vencido no vincula", async () => {
    const antes = Date.now() - 20 * 60_000;
    const { codigo } = await crearCodigoDeVinculo(env, antes);
    expect(await canjearCodigo(env, codigo, 5)).toBe(false);
    expect(await chatDelDueno(env)).toBeNull();
  });

  it("el secret OWNER_TELEGRAM_CHAT_ID sigue mandando si existe", async () => {
    await vincular();
    expect(await chatDelDueno({ ...env, OWNER_TELEGRAM_CHAT_ID: "999" })).toBe("999");
  });
});

describe("quién llega a la consola", () => {
  it("el mensaje de una clienta NO lo consume la consola: sigue al agente", async () => {
    await vincular();
    expect(await atenderAlDueno(env, mensaje("hola, tienen talla M?", {}, 1234), OK)).toBe(false);
  });

  it("sin dueño vinculado, todo sigue al agente", async () => {
    expect(await atenderAlDueno(env, mensaje("/pendientes"), OK)).toBe(false);
  });

  it("en modo clienta, el dueño habla con el bot como cualquiera (y /dueno lo regresa)", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/cliente"), OK);
    expect(await atenderAlDueno(env, mensaje("hola bot"), OK)).toBe(false);
    expect(await atenderAlDueno(env, mensaje("/dueno"), OK)).toBe(true);
    expect(await atenderAlDueno(env, mensaje("/pendientes"), OK)).toBe(true);
  });

  it("los botones de otra persona no hacen nada", async () => {
    await vincular();
    expect(await atenderAlDueno(env, boton("a:xxxx", 1, 4444), OK)).toBe(true);
    expect(enviados.find((e) => e.metodo === "answerCallbackQuery")?.cuerpo.text).toMatch(/solo para el dueño/);
  });
});

describe("sin la firma de Telegram, la consola no obedece", () => {
  it("un update falso 'del dueño' no ejecuta nada y no llega al agente", async () => {
    await vincular();
    expect(await atenderAlDueno(env, mensaje("/venta NAT-M 2"), { confiable: false })).toBe(true);
    expect(await stockDe("NAT-M")).toBe(5);
    // Se protege solo: registra el webhook con el secreto y pide repetir.
    expect(textos().at(-1)).toMatch(/activé la protección/);
    expect(enviados.some((e) => e.metodo === "setWebhook" && e.cuerpo.secret_token)).toBe(true);
  });

  it("un botón falso tampoco", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/venta NAT-M 2"), OK);
    const deshacer = datoDe("Deshacer");
    await atenderAlDueno(env, boton(deshacer), { confiable: false });
    expect(await stockDe("NAT-M")).toBe(3);
  });

  it("ni el código de vínculo", async () => {
    const { codigo } = await crearCodigoDeVinculo(env);
    await atenderAlDueno(env, mensaje(`/start dueno_${codigo}`), { confiable: false });
    expect(await chatDelDueno(env)).toBeNull();
  });

  it("una clienta sin firma sigue al agente como siempre", async () => {
    await vincular();
    expect(await atenderAlDueno(env, mensaje("hola", {}, 1234), { confiable: false })).toBe(false);
  });

  it("el secreto sale del token del bot y se compara exacto", async () => {
    const { secretoDelWebhook, webhookConfiable } = await import("../../src/owner/telegram");
    const s1 = await secretoDelWebhook(env);
    expect(s1).toMatch(/^[0-9a-f]{48}$/);
    expect(await webhookConfiable(env, s1)).toBe(true);
    expect(await webhookConfiable(env, "otro")).toBe(false);
    expect(await webhookConfiable({ ...env, TELEGRAM_BOT_TOKEN: "otro-token" }, s1)).toBe(false);
  });

  it("asegurarWebhook registra el secreto y habilita los botones", async () => {
    const { asegurarWebhook, secretoDelWebhook } = await import("../../src/owner/telegram");
    expect(await asegurarWebhook(env)).toEqual({ ok: true });
    const set = enviados.find((e) => e.metodo === "setWebhook")!;
    expect(set.cuerpo).toMatchObject({
      url: "https://bot.ejemplo/webhooks/telegram",
      secret_token: await secretoDelWebhook(env),
      allowed_updates: ["message", "callback_query"],
    });
  });
});

describe("el aviso se puede responder: el texto le llega a la clienta", () => {
  it("responder sobre el aviso sale por el canal de la clienta, se anota y pausa el bot", async () => {
    await vincular();
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate("whatsapp-qr", "245161514766536@lid", "Ana");

    expect(await avisarAlDueno(env, { titulo: "🚨 Ticket · pago", cuerpo: "Quiere pagar", conversationId: conv.id })).toBe(true);
    const aviso = enviados.find((e) => e.metodo === "sendMessage")!;
    expect(aviso.cuerpo.text).toContain("Ana · WhatsApp (QR)");
    const botones = aviso.cuerpo.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(botones).toEqual(expect.arrayContaining(["▶️ Devolver al bot", "⏸ Pausar bot", "🛒 Registrar venta", "💬 Abrir en el panel"]));

    await atenderAlDueno(env, mensaje("Hola Ana, ya le confirmo su pedido", { reply_to_message: { message_id: 100 } }), OK);

    expect(alPuente).toEqual([expect.objectContaining({ para: "245161514766536@lid", chunks: ["Hola Ana, ya le confirmo su pedido"] })]);
    const ultimo = (await new MessagesRepo(db).lastN(conv.id, 1))[0];
    expect([ultimo.role, ultimo.content]).toEqual(["owner", "Hola Ana, ya le confirmo su pedido"]);
    expect(await convs.isPaused(conv.id)).toBe(true);
    expect(textos().at(-1)).toMatch(/Enviado a Ana/);
  });

  it("el botón Devolver al bot quita la pausa y cierra el ticket", async () => {
    await vincular();
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate("whatsapp-qr", "1@lid", "Bea");
    await convs.setPausedUntil(conv.id, Date.now() + 60_000);
    await avisarAlDueno(env, { titulo: "t", cuerpo: "c", conversationId: conv.id });

    await atenderAlDueno(env, boton(datoDe("Devolver")), OK);
    expect(await convs.isPaused(conv.id)).toBe(false);
    expect(textos().at(-1)).toMatch(/Devuelta al bot/);
  });

  it("un botón tocado dos veces se ejecuta una sola vez", async () => {
    await vincular();
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate("whatsapp-qr", "2@lid", "Cata");
    await avisarAlDueno(env, { titulo: "t", cuerpo: "c", conversationId: conv.id });
    const data = datoDe("Pausar");
    await atenderAlDueno(env, boton(data), OK);
    await atenderAlDueno(env, boton(data), OK);
    expect(enviados.filter((e) => e.metodo === "answerCallbackQuery").at(-1)?.cuerpo.text).toMatch(/ya se hizo/);
  });
});

describe("/pendientes", () => {
  it("lista las conversaciones que atiende una persona, con su botón para devolver", async () => {
    await vincular();
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate("whatsapp-qr", "3@lid", "Dora");
    await convs.setPausedUntil(conv.id, Date.now() + 60_000);
    await atenderAlDueno(env, mensaje("/pendientes"), OK);
    expect(textos().at(-1)).toContain("Dora");
    expect(ultimoTeclado().map((b) => b.text)).toContain("▶️ Devolver: Dora");
  });
});

describe("inventario desde Telegram", () => {
  beforeEach(vincular);

  it("/venta descuenta de la bodega con más stock y se puede deshacer", async () => {
    await atenderAlDueno(env, mensaje("/venta NAT-M 2"), OK);
    expect(textos().at(-1)).toMatch(/Venta registrada[\s\S]*NAT-M.*5 → 3/);
    expect(await stockDe("NAT-M")).toBe(3);
    const mov = await db.first<{ kind: string; delta: number; actor: string }>("SELECT kind, delta, actor FROM stock_movements");
    expect(mov).toEqual({ kind: "venta", delta: -2, actor: `telegram:${DUENO}` });

    await atenderAlDueno(env, boton(datoDe("Deshacer")), OK);
    expect(await stockDe("NAT-M")).toBe(5);
  });

  it("una venta que no alcanza no descuenta NADA, ni de los productos que sí alcanzaban", async () => {
    await atenderAlDueno(env, mensaje("/venta NAT-M 1, NAT-L 1"), OK);
    expect(textos().at(-1)).toMatch(/No se descontó nada/);
    expect(await stockDe("NAT-M")).toBe(5);
  });

  it("se puede nombrar la bodega", async () => {
    await atenderAlDueno(env, mensaje("/venta NAT-M 1 oeste"), OK);
    expect(await stockDe("NAT-M", "Bodega Panamá Oeste")).toBe(1);
    expect(await stockDe("NAT-M")).toBe(5);
  });

  it("una devolución PREGUNTA si vuelve al inventario; 'No' la anota sin sumar", async () => {
    await atenderAlDueno(env, mensaje("/devolucion NAT-M 1"), OK);
    expect(textos().at(-1)).toMatch(/vuelve al inventario/);
    await atenderAlDueno(env, boton(datoDe("No, está abierto")), OK);
    expect(await stockDe("NAT-M")).toBe(5);
    const mov = await db.first<{ kind: string; delta: number }>("SELECT kind, delta FROM stock_movements");
    expect(mov).toEqual({ kind: "devolucion", delta: 0 });
  });

  it("'Sí' suma a la bodega principal, y el otro botón ya no sirve", async () => {
    await atenderAlDueno(env, mensaje("/devolución NAT-M 1"), OK);
    const si = datoDe("Sí, sumar");
    const no = datoDe("No, está abierto");
    await atenderAlDueno(env, boton(si), OK);
    expect(await stockDe("NAT-M")).toBe(6);
    await atenderAlDueno(env, boton(no), OK);
    expect(await stockDe("NAT-M")).toBe(6);
    expect(await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM stock_movements")).toEqual({ n: 1 });
  });

  it("/ajuste =N deja la bodega en N", async () => {
    await atenderAlDueno(env, mensaje("/ajuste NAT-M =10"), OK);
    expect(await stockDe("NAT-M")).toBe(10);
  });

  it("/stock muestra el número exacto por bodega (la dueña sí lo ve; el bot no)", async () => {
    await atenderAlDueno(env, mensaje("/stock"), OK);
    expect(textos().at(-1)).toMatch(/NAT-M — 7 en total/);
  });
});

describe("dos escritores de stock: el editor del panel no pisa una venta de Telegram", () => {
  it("si el producto cambió mientras el editor estaba abierto, no guarda y recarga el stock actual", async () => {
    await vincular();
    const { adminApp } = await import("../../src/admin/routes");
    const { CatalogRepo } = await import("../../src/db/catalog");
    const abierto = await new CatalogRepo(db).getForAdmin("NAT-M");
    await new Promise((r) => setTimeout(r, 5));

    // Mientras tanto, la dueña registra una venta por Telegram.
    await atenderAlDueno(env, mensaje("/venta NAT-M 2"), OK);
    expect(await stockDe("NAT-M")).toBe(3);

    // Y guarda el editor que tenía abierto, con el 5 viejo en pantalla.
    const auth = `Basic ${Buffer.from("admin:clave").toString("base64")}`;
    const form = new URLSearchParams({
      original_code: "NAT-M",
      loaded_at: String(abierto!.updatedAt),
      code: "NAT-M",
      name: "Pañal Nateen Talla M",
      sale_price: "50.00",
      cost_price: "30.00",
      active: "on",
    });
    form.append("stock_branch", "Bodega Ciudad de Panamá");
    form.append("stock_qty", "5");
    form.append("stock_branch", "Bodega Panamá Oeste");
    form.append("stock_qty", "2");
    const res = await adminApp.request(
      "/catalogo/guardar",
      { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form },
      { ...env, DASHBOARD_PASSWORD: "clave" },
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("cambió mientras usted lo editaba");
    expect(await stockDe("NAT-M")).toBe(3);
  });
});

describe("/miid", () => {
  it("el dueño vinculado también lo puede pedir en la consola", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/miid"), OK);
    expect(textos().at(-1)).toContain(String(DUENO));
  });
});

describe("piezas", () => {
  it("partirComando quita el @bot y las tildes", () => {
    expect(partirComando("/Devolución@BabyCalebBot NAT-M 1")).toEqual(["devolucion", "NAT-M 1"]);
    expect(partirComando("hola")).toBeNull();
  });

  it("parsearItems entiende varias formas", () => {
    expect(parsearItems("NAT-M 2, 1 NAT-S oeste")).toEqual({
      ok: true,
      items: [
        { code: "NAT-M", qty: 2, pista: undefined },
        { code: "NAT-S", qty: 1, pista: "oeste" },
      ],
    });
    expect(parsearItems("NAT-M").ok).toBe(false);
  });

  it("elegirBodega: 'este' no cae en 'Oeste'", () => {
    const p: any = {
      code: "X",
      stock: [
        { branch: "Bodega Panamá Oeste", stockQty: 3 },
        { branch: "Bodega Ciudad de Panamá Este Línea 2", stockQty: 1 },
      ],
    };
    expect(elegirBodega(p, -1, "este")).toEqual({ ok: true, branch: "Bodega Ciudad de Panamá Este Línea 2" });
  });
});
