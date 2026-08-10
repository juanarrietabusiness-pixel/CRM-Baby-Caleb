import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";

export const twilioAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, _env: Env): Promise<IncomingMessage> {
    const form = await request.formData();
    const from = String(form.get("From") ?? "");
    const channelUserId = from.replace(/^whatsapp:/, "");
    const profileName = form.get("ProfileName");
    const body = form.get("Body");
    const numMedia = parseInt(String(form.get("NumMedia") ?? "0"), 10);

    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    if (numMedia > 0) {
      const url = String(form.get("MediaUrl0") ?? "");
      const type = String(form.get("MediaContentType0") ?? "");
      if (type.startsWith("image/")) imageUrl = url;
      else if (type.startsWith("audio/")) audioUrl = url;
    }

    return {
      channel: "twilio",
      channelUserId,
      displayName: profileName ? String(profileName) : undefined,
      text: body ? String(body) : undefined,
      audioUrl,
      imageUrl,
      isOwnerMessage: false, // Twilio webhooks fire only for inbound messages
      receivedAt: Date.now(),
      rawPayload: Object.fromEntries(form.entries()),
    };
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const sid = env.TWILIO_ACCOUNT_SID;
    const tok = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_WA_FROM;
    if (!sid || !tok || !from) throw new Error("Twilio credentials missing");
    const auth = btoa(`${sid}:${tok}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const body = new URLSearchParams({
        From: `whatsapp:${from}`,
        To: `whatsapp:${reply.channelUserId}`,
        Body: reply.chunks[i],
      });
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    }
  },
};
