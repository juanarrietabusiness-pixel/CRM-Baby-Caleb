export type ChannelId = "manychat" | "telegram" | "twilio" | "messenger" | "instagram" | "whatsapp";

/**
 * Archivo que el bot no puede leer y que igual tiene que llegar a una persona.
 * Sin esto, un PDF o un video caían en el `continue` de cada adaptador y el
 * mensaje desaparecía entero: ni guardado, ni ticket, ni respuesta.
 */
export type ArchivoNoLegible = "audio" | "documento" | "video";

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  fileKind?: ArchivoNoLegible;
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
