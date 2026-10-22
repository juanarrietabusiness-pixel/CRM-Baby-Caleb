import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diagnoseInstagramRead } from "../../src/channels/instagramDiag";

// Lo que importa de esta comprobación es que distinga tres respuestas de Meta
// que se parecen y significan cosas MUY distintas:
//   • un límite de peticiones  → reintenta, no concluye nada (warn)
//   • un permiso denegado      → al token le falta instagram_manage_messages (fail)
//   • conversaciones de verdad → el camino de preguntar funciona (ok)
const PAGE = {
  id: "1122334455",
  name: "Baby Caleb",
  instagram_business_account: { id: "17841471553036144", username: "babycalebpanama" },
};

function env(extra: Record<string, unknown> = {}) {
  return { META_PAGE_ACCESS_TOKEN: "page-token", ...extra } as any;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Responde `me` con la Página, deja que el test decida el de conversaciones y,
 * por defecto, hace que Meta no revele los permisos del token (el caso en que
 * `debug_token` no sirve y manda la prueba de las conversaciones).
 */
function stubFetch(conversaciones: () => Response, permisos?: () => Response, suscripcion?: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/conversations")) return conversaciones();
      if (u.includes("debug_token")) return permisos ? permisos() : json({}, 400);
      if (u.includes("subscribed_apps")) {
        return suscripcion
          ? suscripcion()
          : json({ data: [{ id: "2099638607582456", name: "Baby Cale CRM", subscribed_fields: ["messages"] }] });
      }
      return json(PAGE);
    }),
  );
}

const CUATRO = ["instagram_basic", "instagram_manage_messages", "pages_messaging", "pages_manage_metadata"];
const TODOS = [...CUATRO, "pages_read_engagement"];

describe("diagnoseInstagramRead", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("sin token no pregunta nada", async () => {
    const d = await diagnoseInstagramRead({} as any);
    expect(d.verdict).toBe("fail");
    expect(d.checks[0].detail).toContain("META_PAGE_ACCESS_TOKEN");
  });

  it("cuenta las conversaciones y a cuántas personas distintas", async () => {
    stubFetch(() =>
      json({
        data: [
          {
            id: "c1",
            updated_time: new Date().toISOString(),
            participants: { data: [{ id: "17841471553036144", username: "babycalebpanama" }, { id: "999", username: "clienta_uno" }] },
          },
          {
            id: "c2",
            updated_time: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
            participants: { data: [{ id: "17841471553036144" }, { id: "888", username: "clienta_dos" }] },
          },
        ],
      }),
    );
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("ok");
    const conv = d.checks.find((c) => c.id === "conversaciones")!;
    expect(conv.status).toBe("ok");
    expect(conv.detail).toContain("2 conversación(es)");
    expect(conv.detail).toContain("2 persona(s)");
    // Solo una está dentro de la ventana de 24 h en que Meta deja responder.
    expect(conv.detail).toContain("1 con actividad en las últimas 24 h");
    expect(conv.detail).toContain("@clienta_uno");
    // La cuenta propia nunca se cuenta como interlocutor.
    expect(conv.detail).not.toContain("babycalebpanama");
  });

  it("un límite de peticiones es warn, no un veredicto", async () => {
    stubFetch(() => json({ error: { message: "User request limit reached", code: 17 } }, 400));
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("warn");
    const conv = d.checks.find((c) => c.id === "conversaciones")!;
    expect(conv.status).toBe("warn");
    expect(conv.fix).toContain("NO un permiso denegado");
  });

  it("un permiso denegado señala el permiso que falta en el token", async () => {
    stubFetch(() =>
      json({ error: { message: "(#10) Application does not have permission for this action", code: 10 } }, 403),
    );
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("fail");
    expect(d.checks.find((c) => c.id === "conversaciones")!.fix).toContain("instagram_manage_messages");
  });

  it("cero conversaciones no es un sí ni un no", async () => {
    stubFetch(() => json({ data: [] }));
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("warn");
    expect(d.checks.find((c) => c.id === "conversaciones")!.fix).toContain("Manda un DM");
  });

  it("sin Instagram vinculado lo dice, pero sigue preguntando lo demás", async () => {
    // El token lee la Página pero no ve Instagram colgando.
    vi.stubGlobal("fetch", vi.fn(async (url: any) =>
      String(url).includes("/conversations")
        ? json({ data: [] })
        : json({ id: "1122334455", name: "Baby Caleb" }),
    ));
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("fail");
    expect(d.checks.find((c) => c.id === "ig")!.detail).toContain("NO ve ninguna cuenta de Instagram");
    // Las cuatro preguntas se hacen igual: frenarse escondía el diagnóstico.
    expect(d.checks.map((c) => c.id)).toEqual(["token", "permisos", "suscripcion", "ig", "conversaciones"]);
  });

  it("el error 100 por pages_read_engagement se traduce al otorgamiento que falta", async () => {
    // Es lo que devolvió Meta de verdad el 22-oct-2026 con el token de la app.
    const err100 = {
      error: {
        message:
          "(#100) Object does not exist, cannot be loaded due to missing permission or reviewable feature, or does not support this operation. This endpoint requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature",
        code: 100,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: any) =>
      String(url).includes("fields=instagram_business_account") ? json(err100, 400) : json({ id: "1", name: "Baby Caleb" }),
    ));
    const d = await diagnoseInstagramRead(env());
    const ig = d.checks.find((c) => c.id === "ig")!;
    // No es "roto": es "no comprobable desde aquí", y no bloquea los DMs.
    expect(ig.status).toBe("warn");
    expect(ig.detail).toContain("pages_read_engagement");
    expect(ig.fix).toContain("No bloquea los DMs");
  });

  it("si el token no lleva instagram_manage_messages, lo dice y explica que regenerarlo no sirve", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: ["instagram_basic", "pages_messaging", "pages_show_list"] } }),
    );
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("fail");
    const permisos = d.checks.find((c) => c.id === "permisos")!;
    expect(permisos.status).toBe("fail");
    expect(permisos.fix).toContain("Regenerarlo no sirve");
    expect(permisos.fix).toContain("otorgamiento");
  });

  it("con todos los permisos dentro, el token pasa", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS } }),
    );
    const d = await diagnoseInstagramRead(env());
    expect(d.checks.find((c) => c.id === "permisos")!.status).toBe("ok");
  });

  // El caso real del 22-oct-2026: tiene el de mensajes de Instagram, que es el
  // que manda, pero le falta el de leer la Página. Eso no bloquea los DMs.
  it("con instagram_manage_messages pero sin pages_read_engagement, avisa sin alarmar", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: CUATRO } }),
    );
    const d = await diagnoseInstagramRead(env());
    const permisos = d.checks.find((c) => c.id === "permisos")!;
    expect(permisos.status).toBe("warn");
    expect(permisos.detail).toContain("pages_read_engagement");
    expect(permisos.fix).toContain("no la mensajería");
  });

  it("dice de quién es el token y si caduca, sin leer la Página", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS, profile_id: "1122334455", app_id: "2099638607582456", type: "PAGE", expires_at: 0 } }),
    );
    const d = await diagnoseInstagramRead(env());
    const quien = d.checks.find((c) => c.id === "token")!;
    expect(quien.status).toBe("ok");
    expect(quien.detail).toContain("de una Página");
    expect(quien.detail).toContain("1122334455");
    expect(quien.detail).toContain("No caduca");
  });

  it("avisa si el token lo emitió otra app", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS, profile_id: "999", app_id: "2501027797085987", type: "PAGE" } }),
    );
    const d = await diagnoseInstagramRead(env());
    const quien = d.checks.find((c) => c.id === "token")!;
    expect(quien.status).toBe("warn");
    expect(quien.detail).toContain("NO es Baby Cale CRM");
  });

  it("si Meta pide una consulta más pequeña, reintenta pidiendo menos", async () => {
    const pequeno = { error: { message: "Please reduce the amount of data you're asking for", code: 1 } };
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("debug_token")) return json({ data: { scopes: TODOS } });
      if (!u.includes("/conversations")) return json({}, 400);
      urls.push(u);
      // Solo la tercera, la más pequeña, pasa.
      return urls.length < 3 ? json(pequeno, 400) : json({ data: [{ id: "c1", updated_time: new Date().toISOString() }] });
    }));
    const d = await diagnoseInstagramRead(env());
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("limit=10");
    expect(urls[2]).toContain("limit=3");
    expect(d.checks.find((c) => c.id === "conversaciones")!.status).toBe("ok");
  });

  it("si Meta no revela los permisos, no concluye nada y deja hablar a la prueba real", async () => {
    stubFetch(() => json({ data: [] }));
    const d = await diagnoseInstagramRead(env());
    expect(d.checks.find((c) => c.id === "permisos")!.status).toBe("skip");
  });

  // Lo que gobierna la entrega no es el webhook del panel, es esto.
  it("si la suscripción de la Página no incluye messages, lo señala como EL problema", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS } }),
      () => json({ data: [{ id: "2099638607582456", name: "Baby Cale CRM", subscribed_fields: ["feed"] }] }),
    );
    const d = await diagnoseInstagramRead(env());
    const s = d.checks.find((c) => c.id === "suscripcion")!;
    expect(s.status).toBe("fail");
    expect(s.detail).toContain('NO incluye "messages"');
    expect(s.fix).toContain("Aquí está el problema");
  });

  it("sin ninguna app suscrita, lo dice sin rodeos", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS } }),
      () => json({ data: [] }),
    );
    const s = (await diagnoseInstagramRead(env())).checks.find((c) => c.id === "suscripcion")!;
    expect(s.status).toBe("fail");
    expect(s.detail).toContain("NINGUNA app");
  });

  it("con messages suscrito, pasa", async () => {
    stubFetch(
      () => json({ data: [] }),
      () => json({ data: { scopes: TODOS } }),
    );
    const s = (await diagnoseInstagramRead(env())).checks.find((c) => c.id === "suscripcion")!;
    expect(s.status).toBe("ok");
    expect(s.detail).toContain("messages");
  });

  it("un token vencido se explica como tal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { message: "Error validating access token", code: 190 } }, 401)),
    );
    const d = await diagnoseInstagramRead(env());
    expect(d.verdict).toBe("fail");
    // Con el token muerto, debug_token tampoco contesta: lo dice la prueba real.
    expect(d.checks.find((c) => c.id === "conversaciones")!.fix).toContain("venció");
  });
});
