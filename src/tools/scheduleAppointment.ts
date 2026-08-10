import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

const CALCOM_API = "https://api.cal.com/v1";

export function scheduleAppointmentTool(env: Env, _getConversationId: () => string | null) {
  return tool({
    description:
      "Agenda una cita usando Cal.com. Necesitas eventTypeId (el dueño lo configura en Cal.com), fecha/hora, nombre y email del cliente.",
    inputSchema: z.object({
      eventTypeId: z.number().int().describe("Cal.com event type ID"),
      startTime: z.string().describe("ISO datetime, e.g. 2026-06-01T17:00:00Z"),
      attendeeName: z.string(),
      attendeeEmail: z.string().email(),
      notes: z.string().optional(),
    }),
    execute: async ({ eventTypeId, startTime, attendeeName, attendeeEmail, notes }) => {
      if (!env.CALCOM_API_KEY) return { error: "calcom_not_configured" as const };
      try {
        const res = await fetch(`${CALCOM_API}/bookings?apiKey=${env.CALCOM_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventTypeId,
            start: startTime,
            responses: { name: attendeeName, email: attendeeEmail, notes: notes ?? "" },
          }),
        });
        if (!res.ok) return { error: "calcom_failed" as const, status: res.status };
        const body = (await res.json()) as any;
        return { bookingId: body.id, status: body.status };
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
