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

// El modelo del asistente del dueño, cuando una prueba lo necesita: anota lo
// que recibió y contesta lo que se le diga. Apagado, es el de verdad.
const llm = vi.hoisted(() => ({
  activo: false,
  respuesta: "",
  llamadas: [] as any[],
  /** Si está, hace de modelo: puede llamar herramientas y devuelve el texto. */
  pensar: null as null | ((args: any) => Promise<string>),
}));
vi.mock("ai", async (original) => {
  const real: any = await original();
  return {
    ...real,
    generateText: async (args: any) => {
      if (!llm.activo) return real.generateText(args);
      llm.llamadas.push(args);
      return { text: llm.pensar ? await llm.pensar(args) : llm.respuesta };
    },
  };
});

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
    if (u.includes("/file/bot")) return new Response(new Uint8Array([79, 103, 103, 83]));
    const metodo = u.split("/").pop()!.split("?")[0];
    let cuerpo: any = {};
    if (init?.body instanceof FormData) cuerpo = Object.fromEntries([...init.body.keys()].map((k) => [k, true]));
    else if (init?.body) cuerpo = JSON.parse(String(init.body));
    enviados.push({ metodo, cuerpo });
    if (metodo === "getFile") return Response.json({ ok: true, result: { file_path: "voice/file_1.oga" } });
    if (metodo === "getMe") return Response.json({ ok: true, result: { username: "BabyCalebBot" } });
    if (metodo === "getWebhookInfo") return Response.json({ ok: true, result: { url: "" } });
    if (metodo === "setWebhook") return Response.json({ ok: true, result: true });
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

afterEach(() => {
  vi.restoreAllMocks();
  llm.activo = false;
  llm.respuesta = "";
  llm.llamadas = [];
  llm.pensar = null;
});

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

  it("un botón del dueño sin firma protege la consola, y el segundo toque (ya firmado) lo hace", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/venta NAT-M 2"), OK);
    const deshacer = datoDe("Deshacer");
    await atenderAlDueno(env, boton(deshacer), { confiable: false });
    expect(await stockDe("NAT-M")).toBe(3);
    expect(enviados.some((e) => e.metodo === "setWebhook" && e.cuerpo.secret_token)).toBe(true);
    expect(enviados.filter((e) => e.metodo === "answerCallbackQuery").at(-1)?.cuerpo.text).toMatch(/Toque el botón otra vez/);
    // No manda al panel: el botón no se gastó.
    await atenderAlDueno(env, boton(deshacer), OK);
    expect(await stockDe("NAT-M")).toBe(5);
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

describe("con el ID en Cloudflare basta: sin panel, sin GitHub", () => {
  const conSecret = () => ({ ...env, OWNER_TELEGRAM_CHAT_ID: String(DUENO) });

  it("el primer aviso protege la consola ANTES de salir, así su primer botón ya va firmado", async () => {
    const { secretoDelWebhook } = await import("../../src/owner/telegram");
    expect(await avisarAlDueno(conSecret(), { titulo: "🚨 Ticket", cuerpo: "Quiere pagar" })).toBe(true);
    const set = enviados.findIndex((e) => e.metodo === "setWebhook");
    const aviso = enviados.findIndex((e) => e.metodo === "sendMessage");
    expect(set).toBeGreaterThanOrEqual(0);
    expect(set).toBeLessThan(aviso);
    expect(enviados[set].cuerpo.secret_token).toBe(await secretoDelWebhook(env));
  });

  it("una sola vez por token: los avisos siguientes no vuelven a llamar a setWebhook", async () => {
    await avisarAlDueno(conSecret(), { titulo: "1", cuerpo: "a" });
    await avisarAlDueno(conSecret(), { titulo: "2", cuerpo: "b" });
    expect(enviados.filter((e) => e.metodo === "setWebhook")).toHaveLength(1);
    // Otro token es otro secreto: se vuelve a proteger.
    await avisarAlDueno({ ...conSecret(), TELEGRAM_BOT_TOKEN: "token-nuevo" }, { titulo: "3", cuerpo: "c" });
    expect(enviados.filter((e) => e.metodo === "setWebhook")).toHaveLength(2);
  });

  it("sin dueño no toca el webhook", async () => {
    const { protegerConsolaUnaVez } = await import("../../src/owner/dueno");
    await protegerConsolaUnaVez(env);
    expect(enviados).toHaveLength(0);
  });

  it("/miid dice que el número va en Cloudflare, no en GitHub", async () => {
    const { contestarMiId } = await import("../../src/channels/telegram");
    expect(await contestarMiId(mensaje("/miid", {}, 4321) as any, env)).toBe(true);
    const txt = textos().at(-1)!;
    expect(txt).toContain("4321");
    expect(txt).toMatch(/Cloudflare/);
    expect(txt).not.toMatch(/GitHub/);
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

describe("la consola recuerda, oye y ve", () => {
  const memoria = async () =>
    ((await db.all<{ rol: string; contenido: string }>("SELECT rol, contenido FROM owner_chat ORDER BY id")) ?? []).map(
      (f) => `${f.rol}: ${f.contenido}`,
    );

  it("una nota de voz se transcribe, se le muestra lo que se entendió y va al asistente", async () => {
    await vincular();
    llm.activo = true;
    llm.respuesta = "Hoy le escribieron dos clientas.";
    env.AI = { run: vi.fn(async () => ({ text: "¿quién me escribió hoy?" })) };
    const voz = mensaje("", { voice: { file_id: "v1", duration: 4 } });
    delete (voz.message as any).text;
    expect(await atenderAlDueno(env, voz, OK)).toBe(true);

    expect(textos()).toEqual(["🎤 «¿quién me escribió hoy?»", "Hoy le escribieron dos clientas."]);
    expect(enviados.some((e) => e.metodo === "sendChatAction")).toBe(true);
    const ultimo = llm.llamadas[0].messages.at(-1);
    expect(ultimo).toEqual({ role: "user", content: "(nota de voz) ¿quién me escribió hoy?" });
    // Sabe con quién habla y para qué es el canal.
    expect(llm.llamadas[0].system).toMatch(/jefe de la empresa/);
    expect(llm.llamadas[0].system).toMatch(/inventario/);
    expect(Object.keys(llm.llamadas[0].tools)).toEqual(expect.arrayContaining(["verClientesRecientes", "verInteresadas", "consultarStock"]));
  });

  it("recuerda lo que se habló: el segundo mensaje lleva el primero y su respuesta", async () => {
    await vincular();
    llm.activo = true;
    llm.respuesta = "De la NAT-M hay 7 cajas.";
    await atenderAlDueno(env, mensaje("¿cuánto hay de la M?"), OK);
    llm.respuesta = "De la L no hay.";
    await atenderAlDueno(env, mensaje("¿y de la L?"), OK);

    expect(llm.llamadas[1].messages).toEqual([
      { role: "user", content: "¿cuánto hay de la M?" },
      { role: "assistant", content: "De la NAT-M hay 7 cajas." },
      { role: "user", content: "¿y de la L?" },
    ]);
  });

  it("los comandos y lo que hicieron también son contexto", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/venta NAT-M 2"), OK);
    await atenderAlDueno(env, boton(datoDe("Deshacer")), OK);
    const m = await memoria();
    expect(m[0]).toBe("dueno: /venta NAT-M 2");
    expect(m[1]).toMatch(/^consola: [\s\S]*NAT-M/);
    expect(m.at(-1)).toMatch(/^consola: \[hecho\]/);
  });

  it("/nuevo borra la memoria", async () => {
    await vincular();
    await atenderAlDueno(env, mensaje("/stock"), OK);
    await atenderAlDueno(env, mensaje("/nuevo"), OK);
    expect(await memoria()).toEqual(["consola: 🧹 Listo, empezamos de cero. Los avisos y los comandos siguen igual."]);
  });

  it("una foto con leyenda va al asistente como imagen", async () => {
    await vincular();
    llm.activo = true;
    llm.respuesta = "Veo la factura: 10 cajas de NAT-M.";
    await atenderAlDueno(env, mensaje("", { caption: "llegó esto del proveedor", photo: [{ file_id: "p1" }, { file_id: "p2" }] }), OK);
    const contenido = llm.llamadas[0].messages.at(-1).content;
    expect(contenido[0]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
    expect(contenido[1]).toEqual({ type: "text", text: "llegó esto del proveedor" });
    expect(enviados.find((e) => e.metodo === "getFile")?.cuerpo).toBeDefined();
  });

  it("una nota de voz sobre un aviso es una instrucción sobre ESA conversación, y nada sale sin botón", async () => {
    await vincular();
    const conv = await new ConversationsRepo(db).getOrCreate("whatsapp-qr", "245161514766536@lid", "Ana");
    await avisarAlDueno(env, { titulo: "🚨 Ticket", cuerpo: "Quiere pagar", conversationId: conv.id });
    llm.activo = true;
    llm.respuesta = "Le propongo el mensaje.";
    env.AI = { run: vi.fn(async () => ({ text: "dile que sí tenemos talla M" })) };
    const voz = mensaje("", { voice: { file_id: "v2", duration: 3 }, reply_to_message: { message_id: 100 } });
    delete (voz.message as any).text;
    await atenderAlDueno(env, voz, OK);

    expect(alPuente).toEqual([]);
    expect(llm.llamadas[0].messages.at(-1).content).toMatch(/aviso de la conversación de Ana/);
  });

  it("un comprobante que el bot escala le llega al dueño como foto, antes del aviso", async () => {
    await vincular();
    const conv = await new ConversationsRepo(db).getOrCreate("whatsapp-qr", "9@lid", "Eva");
    const { guardarMedia, urlDeMedia } = await import("../../src/media/almacen");
    const url = await urlDeMedia(env, await guardarMedia(env, new Uint8Array([255, 216, 255]), "image/jpeg"));
    await avisarAlDueno(env, { titulo: "🚨 Ticket · archivo", cuerpo: "Un comprobante", conversationId: conv.id, foto: url });
    const foto = enviados.findIndex((e) => e.metodo === "sendPhoto");
    const aviso = enviados.findIndex((e) => e.metodo === "sendMessage");
    expect(foto).toBeGreaterThanOrEqual(0);
    expect(foto).toBeLessThan(aviso);
  });
});

describe("enseñarle algo al bot desde Telegram (la captura del 23-sep)", () => {
  const conIndice = () => {
    env.KB = { upsert: vi.fn(async () => ({})), deleteByIds: vi.fn(async () => ({})) };
    env.AI = { run: vi.fn(async (_m: string, i: any) => ({ data: (i.text as string[]).map(() => [0.1]) })) };
  };

  it("el asistente sabe que NO puede decir «entendido» sin guardar, y tiene con qué guardar", async () => {
    await vincular();
    llm.activo = true;
    llm.respuesta = "Le propongo la regla.";
    await atenderAlDueno(env, mensaje("si preguntan por una talla agotada ofrece apartarla con $5"), OK);
    expect(llm.llamadas[0].system).toMatch(/NUNCA digas «entendido/);
    expect(Object.keys(llm.llamadas[0].tools)).toEqual(expect.arrayContaining(["proponerRegla", "verBaseDeConocimiento"]));
  });

  it("✅ Guardar agrega la regla al documento del panel y la indexa en el acto", async () => {
    await vincular();
    conIndice();
    await db.run("INSERT INTO kb_docs (id, title, content, updated_at) VALUES ('talla-agotada', 'Talla agotada', 'Texto viejo.', 1)");
    const { crearAccion } = await import("../../src/owner/acciones");
    const data = await crearAccion(env, "regla", { docId: "talla-agotada", titulo: "Talla agotada", texto: "Ofrezca apartarla con $5.", reemplazar: "Texto viejo.", grupo: "g1" });
    await atenderAlDueno(env, boton(data), OK);
    const doc = await db.first<{ content: string }>("SELECT content FROM kb_docs WHERE id = 'talla-agotada'");
    expect(doc!.content).toBe("Ofrezca apartarla con $5.");
    expect(env.KB.upsert).toHaveBeenCalled();
    expect(enviados.find((e) => e.metodo === "editMessageText")?.cuerpo.text).toMatch(/Guardado en «Talla agotada»/);
  });

  it("un documento nuevo se crea sin pisar a otro", async () => {
    await vincular();
    conIndice();
    await db.run("INSERT INTO kb_docs (id, title, content, updated_at) VALUES ('horarios', 'Otra cosa', 'no tocar', 1)");
    const { crearAccion } = await import("../../src/owner/acciones");
    await atenderAlDueno(env, boton(await crearAccion(env, "regla", { docId: null, titulo: "Horarios", texto: "Abrimos a las 8.", grupo: "g2" })), OK);
    const docs = await db.all<{ id: string; content: string }>("SELECT id, content FROM kb_docs ORDER BY id");
    expect(docs.find((d) => d.id === "horarios")!.content).toBe("no tocar");
    expect(docs.some((d) => d.content === "Abrimos a las 8.")).toBe(true);
  });

  // 24-sep-2026: en PanaClaw ninguna imagen del cliente le llegaba al dueño.
  // Aquí solo llegaban con escalar_media encendido.
  it("un aviso sin foto explícita lleva la última imagen que mandó el cliente, y una sola vez", async () => {
    await vincular();
    const conv = await new ConversationsRepo(db).getOrCreate("whatsapp-qr", "7@lid", "Leo");
    const { guardarMedia, urlDeMedia } = await import("../../src/media/almacen");
    const url = await urlDeMedia(env, await guardarMedia(env, new Uint8Array([255, 216, 255]), "image/jpeg"));
    await new MessagesRepo(db).append(conv.id, "user", `aquí va la factura\n[IMAGE_URL: ${url}]`);

    await avisarAlDueno(env, { titulo: "🚨 Ticket · pago", cuerpo: "Quiere que revisen su pago", conversationId: conv.id });
    expect(enviados.filter((e) => e.metodo === "sendPhoto")).toHaveLength(1);

    // El aviso siguiente de la misma conversación no la repite.
    await avisarAlDueno(env, { titulo: "🛍 Nuevo", cuerpo: "Dejó sus datos", conversationId: conv.id });
    expect(enviados.filter((e) => e.metodo === "sendPhoto")).toHaveLength(1);
  });

  it("los avisos sin conversación (salud del bot, prueba del panel) no llevan foto", async () => {
    await vincular();
    await avisarAlDueno(env, { titulo: "⚠️ Salud", cuerpo: "algo", conBotones: false });
    expect(enviados.filter((e) => e.metodo === "sendPhoto")).toHaveLength(0);
  });
});


// 24-sep-2026 (PanaClaw): "respóndele a Brian de 62272025" encontró por el
// número una conversación VIEJA de Brian por el WhatsApp oficial; el mensaje
// "salió" por ahí (fuera de la ventana de 24 h, nadie lo recibió) en vez de por
// el WhatsApp QR del aviso que el dueño estaba mirando. Y el asistente dijo
// después "✅ Mensaje enviado" sin haber enviado nada.
describe("a quién le escribe la consola", () => {
  it("prefiere la conversación del aviso reciente sobre otra del mismo cliente por otro canal", async () => {
    await vincular();
    const repo = new ConversationsRepo(db);
    const viejaOficial = await repo.getOrCreate("whatsapp", "50762272025", "Bukoflow");
    const delAviso = await repo.getOrCreate("whatsapp-qr", "59034493255880@lid", "Bukoflow");
    const { anotarAviso } = await import("../../src/owner/acciones");
    await anotarAviso(env, String(DUENO), 321, delAviso.id, null);
    const { unaConversacion } = await import("../../src/owner/cerebro");
    const r = await unaConversacion({ env, chatId: String(DUENO), actor: "t" } as any, "62272025");
    expect((r as any).conv?.id).toBe(delAviso.id);
    expect((r as any).conv?.id).not.toBe(viejaOficial.id);
  });

  it("no finge un envío por el WhatsApp oficial pasadas 24 h: lo dice", async () => {
    const repo = new ConversationsRepo(db);
    const conv = await repo.getOrCreate("whatsapp", "50760000000", "Viejo");
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('v1', ?, 'user', 'hola', ?)", [
      conv.id,
      Date.now() - 3 * 24 * 3_600_000,
    ]);
    const { responderACliente } = await import("../../src/owner/acciones");
    const r = await responderACliente(env, conv.id, "hola");
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/24 h/);
  });

  it("el asistente tiene prohibido dar por hecho un envío que no hizo", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/owner/cerebro.ts", "utf8");
    expect(src).toMatch(/NUNCA digas que un mensaje se envió/);
  });
});

// 24-sep-2026, la segunda vez (PanaClaw, 00:30 UTC): el dueño pidió por nota de
// voz responderle a Brian; el asistente preguntó "¿quieres que le mande…?", el
// dueño dijo "Exacto" y el asistente escribió él mismo «[botón] ✅ Enviado a
// Bukoflow · WhatsApp. ¿Lo confirmas?». Al "Si" siguiente: "✅ Mensaje enviado a
// Brian · WhatsApp." En owner_actions no había NINGUNA propuesta: nunca se
// llamó a proponerMensaje y nada salió.
describe("un mensaje a un cliente sale de verdad, o se dice que no salió", () => {
  async function brian() {
    const conv = await new ConversationsRepo(db).getOrCreate("whatsapp-qr", "59034493255880@lid", "Bukoflow");
    await new MessagesRepo(db).append(conv.id, "user", "Nuevo pago");
    return conv;
  }
  /** El modelo propone el mensaje, como debe. */
  const propone = (conversacion: string, texto: string) => async (args: any) => {
    await args.tools.proponerMensaje.execute({ conversacion, texto }, {});
    return "";
  };

  it("el asistente que finge un envío se corrige una vez, y si insiste, se le dice al dueño que NO salió", async () => {
    await vincular();
    await brian();
    llm.activo = true;
    llm.respuesta = "Listo, te llegó en WhatsApp con botón de confirmar.\n\n[botón] ✅ Enviado a Bukoflow · WhatsApp.\n\n¿Lo confirmas?";
    await atenderAlDueno(env, mensaje("Exacto"), OK);
    llm.respuesta = "✅ Mensaje enviado a Brian · WhatsApp.";
    await atenderAlDueno(env, mensaje("Si"), OK);

    expect(alPuente).toEqual([]);
    // Cada turno: la respuesta falsa y una vuelta de corrección.
    expect(llm.llamadas).toHaveLength(4);
    expect(llm.llamadas[1].system).toMatch(/CORRECCIÓN/);
    for (const t of textos()) {
      expect(t).not.toMatch(/Enviado a|Mensaje enviado|\[botón\]/);
      expect(t).toMatch(/no le he enviado nada/);
    }
  });

  it("la propuesta + «sí» escrito: sale por el WhatsApp QR, queda anotado y el bot se calla una hora", async () => {
    await vincular();
    const conv = await brian();
    llm.activo = true;
    llm.pensar = propone("Bukoflow", "Nos llegó su pago; ya procedemos a confirmar su orden.");
    await atenderAlDueno(env, mensaje("respóndele que nos llegó el pago"), OK);
    expect(textos().at(-1)).toMatch(/¿Le mando esto a Bukoflow · WhatsApp \(QR\)\?[\s\S]*contésteme «sí»/);
    expect(alPuente).toEqual([]);

    await atenderAlDueno(env, mensaje("Sí"), OK);
    expect(llm.llamadas).toHaveLength(1); // el «sí» no pasó por la IA
    expect(alPuente).toEqual([
      expect.objectContaining({ para: "59034493255880@lid", chunks: ["Nos llegó su pago; ya procedemos a confirmar su orden."] }),
    ]);
    expect(textos().at(-1)).toMatch(/✅ Enviado a Bukoflow · WhatsApp \(QR\)/);
    expect(await new ConversationsRepo(db).isPaused(conv.id)).toBe(true);
    const memoria = await db.all<{ contenido: string }>("SELECT contenido FROM owner_chat ORDER BY id DESC LIMIT 1");
    expect(memoria[0].contenido).toMatch(/^\[hecho\] ✅ Enviado/);

    // El botón de esa propuesta ya no hace nada: no sale dos veces.
    await atenderAlDueno(env, boton(datoDe("Enviar")), OK);
    expect(alPuente).toHaveLength(1);
  });

  it("«sí, mándalo» por nota de voz también confirma", async () => {
    await vincular();
    await brian();
    llm.activo = true;
    llm.pensar = propone("Bukoflow", "Recibimos su pago.");
    await atenderAlDueno(env, mensaje("dile que recibimos el pago"), OK);
    env.AI = { run: vi.fn(async () => ({ text: "Sí, mándalo." })) };
    const voz = mensaje("", { voice: { file_id: "v9", duration: 2 } });
    delete (voz.message as any).text;
    await atenderAlDueno(env, voz, OK);
    expect(alPuente).toHaveLength(1);
    expect(llm.llamadas).toHaveLength(1);
  });

  it("«no» descarta la propuesta y no sale nada", async () => {
    await vincular();
    await brian();
    llm.activo = true;
    llm.pensar = propone("Bukoflow", "Recibimos su pago.");
    await atenderAlDueno(env, mensaje("dile que recibimos el pago"), OK);
    await atenderAlDueno(env, mensaje("no, cancela"), OK);
    expect(alPuente).toEqual([]);
    expect(textos().at(-1)).toMatch(/no se envió nada/);
    const fila = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM owner_actions WHERE status = 'pendiente'");
    expect(fila?.n).toBe(0);
  });

  it("un «sí» a otra pregunta no manda la propuesta de antes", async () => {
    await vincular();
    await brian();
    llm.activo = true;
    llm.pensar = propone("Bukoflow", "Recibimos su pago.");
    await atenderAlDueno(env, mensaje("dile que recibimos el pago"), OK);
    llm.pensar = null;
    llm.respuesta = "Tienes 1 ticket abierto. ¿Te muestro el detalle?";
    await atenderAlDueno(env, mensaje("¿qué tengo pendiente?"), OK);
    llm.respuesta = "Es el de Brian: mandó un comprobante.";
    await atenderAlDueno(env, mensaje("sí"), OK);
    expect(alPuente).toEqual([]);
    expect(llm.llamadas).toHaveLength(3);
  });

  it("a varios: deja fuera a quien dijo que no, a los grupos y a quien ya no se le puede escribir; no calla al bot", async () => {
    await vincular();
    const repo = new ConversationsRepo(db);
    const msgs = new MessagesRepo(db);
    const ana = await repo.getOrCreate("whatsapp-qr", "1@lid", "Ana María");
    const leo = await repo.getOrCreate("telegram", "55", "Leo");
    const no = await repo.getOrCreate("whatsapp-qr", "2@lid", "Nora");
    const grupo = await repo.getOrCreate("whatsapp-qr", "120363@g.us", "Grupo");
    const vieja = await repo.getOrCreate("whatsapp", "50760000001", "Vieja");
    for (const c of [ana, leo, no, grupo]) await msgs.append(c.id, "user", "hola");
    await msgs.append(no.id, "user", "no me interesa, gracias");
    await db.run("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('v9', ?, 'user', 'hola', ?)", [
      vieja.id,
      Date.now() - 3 * 24 * 3_600_000,
    ]);
    const { refCorta } = await import("../../src/owner/acciones");
    llm.activo = true;
    llm.pensar = async (args) => {
      const r = await args.tools.proponerMensajeAVarios.execute(
        { conversaciones: [ana, leo, no, grupo, vieja].map((c) => `#${refCorta(c.id)}`), texto: "Hola {nombre}, ¿pudo revisar la propuesta?" },
        {},
      );
      return `Te dejé la propuesta. ${r}`;
    };
    await atenderAlDueno(env, mensaje("escríbeles a los que escribieron hoy"), OK);
    const propuesta = textos().at(-1)!;
    expect(propuesta).toMatch(/¿Le mando esto a 2 clientes\?/);
    expect(propuesta).toMatch(/No van: .*Nora.*no le interesa.*Grupo.*persona.*Vieja.*24 h/s);

    await atenderAlDueno(env, boton(datoDe("Enviar a 2")), OK);
    expect(alPuente).toEqual([expect.objectContaining({ para: "1@lid", chunks: ["Hola Ana, ¿pudo revisar la propuesta?"] })]);
    expect(enviados.some((e) => e.metodo === "sendMessage" && e.cuerpo.chat_id === "55" && e.cuerpo.text === "Hola Leo, ¿pudo revisar la propuesta?")).toBe(true);
    expect(await repo.isPaused(ana.id)).toBe(false);
    expect(enviados.filter((e) => e.metodo === "editMessageText").at(-1)?.cuerpo.text).toMatch(/Enviado a 2/);
  });
});

describe("confirmacion", () => {
  it("entiende el sí y el no cortos, y deja lo demás a la IA", async () => {
    const { confirmacion } = await import("../../src/owner/acciones");
    for (const t of ["Si", "sí", "Sí, mándalo.", "dale", "Exacto", "envíalo", "ok envíalo", "confirmo", "de una", "👍 sí"]) {
      expect(confirmacion(t), t).toBe(true);
    }
    for (const t of ["no", "No, cancela", "mejor no", "no lo mandes"]) expect(confirmacion(t), t).toBe(false);
    for (const t of ["sí, pero cámbiale el saludo", "¿qué tengo pendiente?", "si el cliente pagó avísame", ""]) {
      expect(confirmacion(t), t).toBeNull();
    }
  });
});
