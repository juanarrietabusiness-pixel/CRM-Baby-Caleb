import { SettingsRepo } from "../db/settings";

// A LearnedMapping describes WHERE in an incoming webhook payload each piece of
// data lives, expressed as dot/bracket field paths (see fieldPath.ts). It is
// learned per-channel from a real captured payload instead of being hardcoded,
// so the bot can auto-configure for ManyChat, n8n, Make, custom webhooks, etc.
export interface LearnedMapping {
  idPath?: string;
  textPath?: string;
  audioPath?: string;
  imagePath?: string;
  channelPath?: string;
  sendType?: string;
}

// Settings-key conventions (all stored as a single TEXT value via SettingsRepo):
//   map:<channel>            -> JSON.stringify(LearnedMapping)
//   learn:<channel>:<kind>   -> JSON.stringify(raw captured payload)
//   learn:<channel>:until    -> learn-mode expiration timestamp in ms (as string)
const mappingKey = (channel: string): string => `map:${channel}`;
const captureKey = (channel: string, kind: string): string =>
  `learn:${channel}:${kind}`;
const learnUntilKey = (channel: string): string => `learn:${channel}:until`;

// ---- Learned mapping persistence -------------------------------------------

export async function saveLearnedMapping(
  repo: SettingsRepo,
  channel: string,
  mapping: LearnedMapping,
): Promise<void> {
  await repo.set(mappingKey(channel), JSON.stringify(mapping));
}

export async function loadLearnedMapping(
  repo: SettingsRepo,
  channel: string,
): Promise<LearnedMapping | null> {
  const raw = await repo.get(mappingKey(channel));
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as LearnedMapping;
  } catch {
    return null;
  }
}

// ---- Captured raw payload persistence --------------------------------------

export async function saveCapture(
  repo: SettingsRepo,
  channel: string,
  kind: string,
  rawPayload: unknown,
): Promise<void> {
  await repo.set(captureKey(channel, kind), JSON.stringify(rawPayload));
}

export async function loadCapture(
  repo: SettingsRepo,
  channel: string,
  kind: string,
): Promise<unknown | null> {
  const raw = await repo.get(captureKey(channel, kind));
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// ---- Learn mode (auto-expiring by timestamp) -------------------------------

// `now` is injectable so tests can drive expiration without touching the clock.
export async function isLearnMode(
  repo: SettingsRepo,
  channel: string,
  now: number = Date.now(),
): Promise<boolean> {
  const raw = await repo.get(learnUntilKey(channel));
  if (raw == null) return false;
  const until = Number(raw);
  if (!Number.isFinite(until)) return false;
  return until > now;
}

export async function startLearnMode(
  repo: SettingsRepo,
  channel: string,
  minutes: number = 15,
  now: number = Date.now(),
): Promise<void> {
  const until = now + minutes * 60000;
  await repo.set(learnUntilKey(channel), String(until));
}

export async function stopLearnMode(
  repo: SettingsRepo,
  channel: string,
): Promise<void> {
  await repo.set(learnUntilKey(channel), "0");
}
