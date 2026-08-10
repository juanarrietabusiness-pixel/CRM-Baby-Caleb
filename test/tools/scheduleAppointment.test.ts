import { describe, it, expect, vi } from "vitest";
import { scheduleAppointmentTool } from "../../src/tools/scheduleAppointment";

describe("scheduleAppointmentTool", () => {
  it("creates Cal.com booking via API", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 12345, status: "ACCEPTED" }), { status: 201 }),
    ) as any;
    const env = { CALCOM_API_KEY: "fake", BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      {
        eventTypeId: 100,
        startTime: "2026-06-01T17:00:00Z",
        attendeeName: "María",
        attendeeEmail: "maria@x.com",
      },
      {} as any,
    )) as { bookingId: number; status: string };
    expect(result.bookingId).toBe(12345);
  });

  it("returns error when Cal.com fails", async () => {
    global.fetch = vi.fn(async () => new Response("err", { status: 400 })) as any;
    const env = { CALCOM_API_KEY: "fake", BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      {
        eventTypeId: 100,
        startTime: "2026-06-01T17:00:00Z",
        attendeeName: "María",
        attendeeEmail: "maria@x.com",
      },
      {} as any,
    )) as { error: string };
    expect(result.error).toBe("calcom_failed");
  });

  it("returns calcom_not_configured when no API key", async () => {
    global.fetch = vi.fn() as any;
    const env = { BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      {
        eventTypeId: 100,
        startTime: "2026-06-01T17:00:00Z",
        attendeeName: "María",
        attendeeEmail: "maria@x.com",
      },
      {} as any,
    )) as { error: string };
    expect(result.error).toBe("calcom_not_configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
