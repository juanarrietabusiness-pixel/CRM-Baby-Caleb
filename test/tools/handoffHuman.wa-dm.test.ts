import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { handoffHumanTool } from "../../src/tools/handoffHuman";

/**
 * Task 9.1 — owner notification on handoff (Pro).
 *
 * The handoff tool always creates a D1 ticket. On top of that it pings the
 * owner. WhatsApp (Twilio) is a business-INITIATED message outside any 24h
 * session window, so it MUST go through an approved Content Template
 * (ContentSid + ContentVariables) — free-text `Body` is rejected by WhatsApp.
 * Failures in the notification must NOT break ticket creation.
 */

let env: any;
let convId: string;
let fetchSpy: any;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  const db = new Db(d1 as any);
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "owner-test");
  convId = conv.id;
  env = {
    DB: d1,
    OWNER_EMAIL: "hugo@hugohair.com",
    BUSINESS_NAME: "Hugo Hair",
    DASHBOARD_BASE_URL: "https://dash.test",
    BOT_TIER: "pro",
    OWNER_WA_NUMBER: "+5215588889999",
    TWILIO_ACCOUNT_SID: "ACxxx",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_WA_FROM: "+5215511112222",
    TWILIO_HANDOFF_CONTENT_SID: "HXtemplate",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handoffHumanTool — owner WhatsApp notification (Pro)", () => {
  it("sends a Twilio WA message via Content Template (ContentSid, never free-text Body)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sid: "SMxxx" }), { status: 201 }),
    );
    const tool = handoffHumanTool(env, () => convId);
    await tool.execute!(
      { reason: "complejo", summary: "cliente quiere reembolso", category: "billing" },
      {} as any,
    );
    const twilioCall = fetchSpy.mock.calls.find((c: any[]) =>
      String(c[0]).includes("api.twilio.com"),
    );
    expect(twilioCall).toBeTruthy();
    const body = String((twilioCall![1] as RequestInit).body);
    expect(body).toContain("ContentSid=HXtemplate"); // approved template, not Body
    expect(body).toContain("ContentVariables");
    expect(body).not.toContain("Body="); // free text is forbidden for business-initiated WA
  });

  it("does NOT send WhatsApp when no approved template SID is configured", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const { TWILIO_HANDOFF_CONTENT_SID, ...noTemplate } = env;
    const tool = handoffHumanTool(noTemplate, () => convId);
    const result = await tool.execute!(
      { reason: "x", summary: "y", category: "other" },
      {} as any,
    );
    expect((result as any).ticketId).toBeTruthy();
    const twilioCall = fetchSpy.mock.calls.find((c: any[]) =>
      String(c[0]).includes("api.twilio.com"),
    );
    expect(twilioCall).toBeUndefined();
  });

  it("still returns ticketId and swallows notification errors (no throw)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("twilio down"));
    const tool = handoffHumanTool(env, () => convId);
    const result = await tool.execute!(
      { reason: "x", summary: "y", category: "other" },
      {} as any,
    );
    expect((result as any).ticketId).toBeTruthy();
  });
});
