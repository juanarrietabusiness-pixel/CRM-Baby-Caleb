export type ChannelId =
  | "manychat"
  | "telegram"
  | "twilio"
  | "messenger"
  | "instagram"
  | "whatsapp"
  /** WhatsApp vinculado por QR, vía el puente `juancitoads-bot-wa`. Canal ALTERNO:
   *  Baileys no es oficial y el número puede ser baneado, así que la Cloud API
   *  ("whatsapp") se queda conectada como respaldo. */
  | "whatsapp-qr";

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
  receivedAt: number;
  rawPayload: unknown;
}

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  chunks: string[];
  interChunkDelayMs?: number;
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
}
