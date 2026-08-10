import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calcomConfigured,
  calcomTimeZone,
  resolveEventTypeId,
  getAvailableSlots,
  createBooking,
  DEFAULT_TZ,
} from "../../src/integrations/calcom";
import type { Env } from "../../src/env";

const env = (over: Partial<Env> = {}) => ({ ...over }) as unknown as Env;

afterEach(() => vi.restoreAllMocks());

describe("calcomConfigured", () => {
  it("false sin API key", () => {
    expect(calcomConfigured(env({ CALCOM_EVENT_TYPE_ID: "1" }))).toBe(false);
  });
  it("false con key pero sin event type", () => {
    expect(calcomConfigured(env({ CALCOM_API_KEY: "cal_x" }))).toBe(false);
  });
  it("true con key + event type id", () => {
    expect(calcomConfigured(env({ CALCOM_API_KEY: "cal_x", CALCOM_EVENT_TYPE_ID: "12" }))).toBe(true);
  });
  it("true con key + mapa de event types", () => {
    expect(calcomConfigured(env({ CALCOM_API_KEY: "cal_x", CALCOM_EVENT_TYPES: '{"corte":10}' }))).toBe(true);
  });
});

describe("calcomTimeZone", () => {
  it("default America/Mexico_City", () => {
    expect(calcomTimeZone(env())).toBe(DEFAULT_TZ);
  });
  it("respeta CALCOM_TIMEZONE", () => {
    expect(calcomTimeZone(env({ CALCOM_TIMEZONE: "America/Bogota" }))).toBe("America/Bogota");
  });
  it("usa BOT_TIMEZONE cuando no hay CALCOM_TIMEZONE", () => {
    expect(calcomTimeZone(env({ BOT_TIMEZONE: "America/Panama" }))).toBe("America/Panama");
  });
  it("CALCOM_TIMEZONE gana sobre BOT_TIMEZONE", () => {
    expect(
      calcomTimeZone(env({ BOT_TIMEZONE: "America/Panama", CALCOM_TIMEZONE: "Europe/Madrid" })),
    ).toBe("Europe/Madrid");
  });
  it("ignora un BOT_TIMEZONE en blanco", () => {
    expect(calcomTimeZone(env({ BOT_TIMEZONE: "   " }))).toBe(DEFAULT_TZ);
  });
});

describe("resolveEventTypeId", () => {
  it("usa el default numérico", () => {
    expect(resolveEventTypeId(env({ CALCOM_EVENT_TYPE_ID: "99" }))).toBe(99);
  });
  it("hace match por palabra en el mapa", () => {
    const e = env({ CALCOM_EVENT_TYPES: '{"corte":10,"barba":20}' });
    expect(resolveEventTypeId(e, "quiero un corte + barba")).toBe(10);
    expect(resolveEventTypeId(e, "arreglo de barba")).toBe(20);
  });
  it("sin match usa el primero del mapa", () => {
    expect(resolveEventTypeId(env({ CALCOM_EVENT_TYPES: '{"corte":10}' }), "algo raro")).toBe(10);
  });
  it("null sin config", () => {
    expect(resolveEventTypeId(env(), "corte")).toBeNull();
  });
});

describe("getAvailableSlots", () => {
  it("arma la URL, manda la versión correcta y aplana los slots", async () => {
    const fetchMock = vi.fn(async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            "2026-07-20": [
              { start: "2026-07-20T09:00:00.000-06:00" },
              { start: "2026-07-20T10:00:00.000-06:00" },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await getAvailableSlots(env({ CALCOM_API_KEY: "cal_x" }), 10, "2026-07-20", "America/Mexico_City");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.slots).toEqual(["2026-07-20T09:00:00.000-06:00", "2026-07-20T10:00:00.000-06:00"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v2/slots?eventTypeId=10");
    expect(String(url)).toContain("start=2026-07-20");
    expect(String(url)).toContain("end=2026-07-21"); // ventana de un día
    expect((init as any).headers["cal-api-version"]).toBe("2024-09-04");
  });

  it("devuelve error si la API falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await getAvailableSlots(env({ CALCOM_API_KEY: "cal_x" }), 10, "2026-07-20", "UTC");
    expect(res.ok).toBe(false);
  });

  it("no llama a la API sin key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await getAvailableSlots(env(), 10, "2026-07-20", "UTC");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createBooking", () => {
  it("hace POST con la versión de bookings y regresa el id", async () => {
    const fetchMock = vi.fn(async (_url: any, _init: any) =>
      new Response(JSON.stringify({ status: "success", data: { id: 555, uid: "abc", status: "accepted" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await createBooking(env({ CALCOM_API_KEY: "cal_x" }), {
      eventTypeId: 10,
      start: "2026-07-20T15:00:00Z",
      name: "Ana",
      email: "ana@example.com",
      timeZone: "America/Mexico_City",
      phone: "+52 55 000",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bookingId).toBe(555);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v2/bookings");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers["cal-api-version"]).toBe("2026-02-25");
    const body = JSON.parse((init as any).body);
    expect(body.eventTypeId).toBe(10);
    expect(body.attendee.email).toBe("ana@example.com");
    expect(body.attendee.phoneNumber).toBe("+52 55 000");
  });

  it("error http → ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const res = await createBooking(env({ CALCOM_API_KEY: "cal_x" }), {
      eventTypeId: 10,
      start: "2026-07-20T15:00:00Z",
      name: "Ana",
      email: "ana@example.com",
      timeZone: "UTC",
    });
    expect(res.ok).toBe(false);
  });
});
