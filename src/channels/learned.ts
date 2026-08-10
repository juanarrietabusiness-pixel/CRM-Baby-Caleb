import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import { getByPath } from "../learn/fieldPath";
import { loadLearnedMapping, type LearnedMapping } from "../learn/mapping";

// Generic, self-configuring channel adapter.
//
// Unlike `manychatAdapter` (which hardcodes one app's contract), this adapter
// reads a per-channel LEARNED mapping (saved via the learn endpoint + mapping.ts)
// and uses dot/bracket field paths to extract id/text/audio/image/channel from
// ANY payload shape (ManyChat IG/Messenger/WhatsApp, n8n, Make, custom webhooks).
//
// When NO mapping has been learned yet, it FALLS BACK to the known ManyChat
// contract — `id` (subscriber), `last_input_text`, `attachments[]`, and the
// auto-channel `last_growth_tool.channel` — so it works out of the box and the
// learn step is purely additive.
//
// AUTO-CHANNEL DECISION: the auto-channel logic (read the inbound channel from
// the payload and echo it back as the ManyChat `content.type` on the reply)
// lives HERE, in the learned adapter, because this adapter already owns the full
// learned-mapping flow end to end. We intentionally do NOT touch `agent.ts` or
// the plain `manychatAdapter` (it keeps using the static `MANYCHAT_CONTENT_TYPE`
// env var, already shipped).
//
// content.type is resolved at parse time in priority order:
//   1. detected channel from the payload (mapping.channelPath, or the ManyChat
//      `last_growth_tool.channel` fallback)
//   2. mapping.sendType (explicitly learned send type)
//   3. env.MANYCHAT_CONTENT_TYPE
//   4. the adapter's channel name
//   5. "instagram" (el flujo principal de IG)
// and is persisted per channel (settings key `send:<channel>:type`) so the
// stateless `sendReply` can reuse the per-message auto-channel decision.

const MANYCHAT_API = "https://api.manychat.com/fb";

const sendTypeKey = (channel: string): string => `send:${channel}:type`;

interface ManychatFallbackPayload {
  id?: string | number;
  subscriber_id?: string | number;
  first_name?: string;
  last_name?: string;
  last_input_text?: string;
  attachments?: { type: string; payload: { url: string } }[];
  last_growth_tool?: { channel?: string };
}

function repoFrom(env: Env): SettingsRepo {
  return new SettingsRepo(new Db(env.DB));
}

/** Extract a path value as a trimmed non-empty string, or undefined. */
function strAt(payload: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const v = getByPath(payload, path);
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Build an IncomingMessage from a learned mapping. Each field is optional in the
 * mapping; whatever path is present is resolved via getByPath. Returns the
 * message plus the resolved outbound content.type (auto-channel).
 */
function parseWithMapping(
  payload: unknown,
  mapping: LearnedMapping,
  fallbackContentType: string,
): { msg: IncomingMessage; contentType: string } {
  const id = strAt(payload, mapping.idPath);
  const text = strAt(payload, mapping.textPath);
  const audioUrl = strAt(payload, mapping.audioPath);
  const imageUrl = strAt(payload, mapping.imagePath);
  const detectedChannel = strAt(payload, mapping.channelPath);

  const contentType = detectedChannel ?? mapping.sendType ?? fallbackContentType;

  return {
    msg: {
      channel: "manychat",
      channelUserId: String(id ?? ""),
      text: text && text !== "[audio]" ? text : undefined,
      audioUrl,
      imageUrl,
      isOwnerMessage: false,
      receivedAt: Date.now(),
      rawPayload: payload,
    },
    contentType,
  };
}

/**
 * Fallback to the known ManyChat contract when no mapping has been learned.
 * Mirrors `manychatAdapter.parseIncoming`: subscriber in `id` (or
 * `subscriber_id`), text in `last_input_text`, media in `attachments[]`, and the
 * auto-channel in `last_growth_tool.channel`.
 */
function parseFallback(
  payload: unknown,
  fallbackContentType: string,
): { msg: IncomingMessage; contentType: string } {
  const body = (payload ?? {}) as ManychatFallbackPayload;
  const subscriber = body.id ?? body.subscriber_id;
  const displayName =
    [body.first_name, body.last_name].filter(Boolean).join(" ").trim() ||
    undefined;
  const audio = body.attachments?.find((a) => a.type === "audio");
  const image = body.attachments?.find((a) => a.type === "image");
  const detectedChannel = body.last_growth_tool?.channel?.trim() || undefined;

  const contentType = detectedChannel ?? fallbackContentType;

  return {
    msg: {
      channel: "manychat",
      channelUserId: String(subscriber ?? ""),
      displayName,
      text:
        body.last_input_text && body.last_input_text !== "[audio]"
          ? body.last_input_text
          : undefined,
      audioUrl: audio?.payload.url,
      imageUrl: image?.payload.url,
      isOwnerMessage: false,
      receivedAt: Date.now(),
      rawPayload: payload,
    },
    contentType,
  };
}

/**
 * Build a generic, self-configuring ChannelAdapter for `channel` (e.g.
 * "instagram", "whatsapp", "messenger", or any custom app name). The `channel`
 * names the learned-config bucket (settings key `map:<channel>`) and seeds the
 * content.type fallback chain.
 */
export function makeLearnedAdapter(channel: string): ChannelAdapter {
  return {
    async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
      const payload = await request.json();
      const repo = repoFrom(env);
      const mapping = await loadLearnedMapping(repo, channel);
      // Fallback chain seed: static env content type -> the channel name ->
      // "instagram". The per-message detected channel (auto-channel) overrides
      // this inside parseWithMapping / parseFallback when present.
      const fallbackContentType =
        env.MANYCHAT_CONTENT_TYPE ?? channel ?? "instagram";

      const { msg, contentType } = mapping
        ? parseWithMapping(payload, mapping, fallbackContentType)
        : parseFallback(payload, fallbackContentType);

      // Persist the auto-channel decision so the stateless sendReply can echo the
      // same content.type back to ManyChat for this channel bucket.
      await repo.set(sendTypeKey(channel), contentType);
      return msg;
    },

    async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
      const apiKey = env.MANYCHAT_API_KEY;
      if (!apiKey) throw new Error("MANYCHAT_API_KEY not set");

      // content.type: the per-message auto-channel persisted by parseIncoming,
      // else the learned mapping.sendType, else env.MANYCHAT_CONTENT_TYPE, else
      // the channel name, else "instagram".
      const repo = repoFrom(env);
      const [persisted, mapping] = await Promise.all([
        repo.get(sendTypeKey(channel)),
        loadLearnedMapping(repo, channel),
      ]);
      const contentType =
        persisted ??
        mapping?.sendType ??
        env.MANYCHAT_CONTENT_TYPE ??
        channel ??
        "instagram";

      for (let i = 0; i < reply.chunks.length; i++) {
        const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        await fetch(`${MANYCHAT_API}/sending/sendContent`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscriber_id: reply.channelUserId,
            data: {
              version: "v2",
              content: {
                type: contentType,
                messages: [{ type: "text", text: reply.chunks[i] }],
              },
            },
          }),
        });
      }
    },
  };
}
