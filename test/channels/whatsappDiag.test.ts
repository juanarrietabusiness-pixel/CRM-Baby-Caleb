import { describe, it, expect, vi, afterEach } from "vitest";
import { diagnoseWhatsAppCloud } from "../../src/channels/whatsappDiag";

const FULL = {
  WHATSAPP_PHONE_NUMBER_ID: "PHONE_ID",
  WHATSAPP_ACCESS_TOKEN: "tok",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: "s3cr3t",
  DASHBOARD_BASE_URL: "https://bot.example.workers.dev",
} as any;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Enruta cada fetch según la URL para no depender del orden de las llamadas. */
function mockGraph(handlers: {
  phone?: () => Response;
  subscribed?: () => Response;
  webhook?: (url: string) => Response;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/subscribed_apps")) return handlers.subscribed?.() ?? jsonRes({ data: [] });
      if (url.includes("/webhooks/whatsapp")) {
        const challenge = new URL(url).searchParams.get("hub.challenge") ?? "";
        return handlers.webhook?.(url) ?? new Response(challenge, { status: 200 });
      }
      return handlers.phone?.() ?? jsonRes({ display_phone_number: "+507 6000-0000", platform_type: "CLOUD_API" });
    }),
  );
}

function check(diag: Awaited<ReturnType<typeof diagnoseWhatsAppCloud>>, id: string) {
  const c = diag.checks.find((x) => x.id === id);
  if (!c) throw new Error(`falta el chequeo ${id}`);
  return c;
}

afterEach(() => vi.unstubAllGlobals());

describe("diagnoseWhatsAppCloud", () => {
  it("da veredicto ok cuando token, suscripción y webhook responden bien", async () => {
    mockGraph({
      subscribed: () => jsonRes({ data: [{ whatsapp_business_api_data: { name: "Juancito Ads" } }] }),
    });
    const diag = await diagnoseWhatsAppCloud({ ...FULL, WHATSAPP_WABA_ID: "WABA" });
    expect(diag.verdict).toBe("ok");
    expect(check(diag, "secrets").status).toBe("ok");
    expect(check(diag, "token").status).toBe("ok");
    expect(check(diag, "subscription").status).toBe("ok");
    expect(check(diag, "webhook").status).toBe("ok");
  });

  it("marca fail cuando NINGUNA app está suscrita a la WABA (no llegan mensajes)", async () => {
    mockGraph({ subscribed: () => jsonRes({ data: [] }) });
    const diag = await diagnoseWhatsAppCloud({ ...FULL, WHATSAPP_WABA_ID: "WABA" });
    const sub = check(diag, "subscription");
    expect(sub.status).toBe("fail");
    expect(sub.detail).toMatch(/Ninguna app está suscrita/);
    expect(sub.fix).toMatch(/messages/);
    expect(diag.verdict).toBe("fail");
  });

  it("sin WHATSAPP_WABA_ID no puede comprobar la suscripción y lo dice", async () => {
    mockGraph({});
    const diag = await diagnoseWhatsAppCloud(FULL);
    const sub = check(diag, "subscription");
    expect(sub.status).toBe("skip");
    expect(sub.fix).toMatch(/WHATSAPP_WABA_ID/);
    expect(diag.verdict).toBe("warn");
  });

  it("traduce el token vencido (código 190) a una instrucción concreta", async () => {
    mockGraph({
      phone: () =>
        jsonRes({ error: { message: "Error validating access token: Session has expired", code: 190 } }, 401),
    });
    const diag = await diagnoseWhatsAppCloud(FULL);
    const tok = check(diag, "token");
    expect(tok.status).toBe("fail");
    expect(tok.fix).toMatch(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("avisa si el número no corre en Cloud API", async () => {
    mockGraph({ phone: () => jsonRes({ display_phone_number: "+507 6000-0000", platform_type: "ON_PREMISE" }) });
    const diag = await diagnoseWhatsAppCloud(FULL);
    expect(check(diag, "token").status).toBe("warn");
  });

  it("falla el webhook si la URL no devuelve el reto de Meta", async () => {
    mockGraph({ webhook: () => new Response("forbidden", { status: 403 }) });
    const diag = await diagnoseWhatsAppCloud(FULL);
    expect(check(diag, "webhook").status).toBe("fail");
  });

  it("con secrets faltantes no llama a Meta y señala cuáles poner", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const diag = await diagnoseWhatsAppCloud({ DASHBOARD_BASE_URL: "https://bot.example.workers.dev" } as any);
    const secrets = check(diag, "secrets");
    expect(secrets.status).toBe("fail");
    expect(secrets.detail).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(check(diag, "token").status).toBe("skip");
    expect(fetchSpy).not.toHaveBeenCalled(); // sin verify token, ni el webhook se prueba
  });
});
