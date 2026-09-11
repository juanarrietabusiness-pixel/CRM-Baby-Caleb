import { Db } from "./client";

export interface Conversation {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  started_at: number;
  last_message_at: number;
  paused_until: number | null;
  open_ticket_id: string | null;
  metadata: string | null;
}

function makeConvId(channel: string, channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

export class ConversationsRepo {
  constructor(private readonly db: Db) {}

  async getOrCreate(
    channel: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<Conversation> {
    const id = makeConvId(channel, channelUserId);
    const existing = await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
    if (existing) return existing;

    const now = Date.now();
    await this.db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, channel, channelUserId, displayName ?? null, now, now],
    );
    return (await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    ))!;
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
  }

  async setPausedUntil(id: string, until: number | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET paused_until = ? WHERE id = ?",
      [until, id],
    );
  }

  async isPaused(id: string): Promise<boolean> {
    const conv = await this.getById(id);
    if (!conv?.paused_until) return false;
    return conv.paused_until > Date.now();
  }

  async touchLastMessage(id: string, when: number = Date.now()): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET last_message_at = ? WHERE id = ?",
      [when, id],
    );
  }

  /**
   * Borra una conversación y todo su rastro. Irreversible.
   *
   * Lo que se va: los mensajes, lo que el analizador dedujo de ella y lo que el
   * bot había "aprendido" del cliente. Ese último importa más de lo que parece:
   * los datos recordados se inyectan en el prompt como bloque <cliente>, así
   * que una conversación borrada a medias seguiría influyendo en la siguiente.
   *
   * Lo que se QUEDA: los leads y los tickets, desligados de la conversación.
   * Son registros del negocio — un pedido existió aunque la dueña borre el
   * chat, y borrarlo con el chat sería destruir una venta por limpiar la
   * bandeja. El esquema ya lo dice con ON DELETE SET NULL; aquí se hace
   * explícito para no depender de que la base tenga las llaves activadas.
   *
   * Las tablas sin llave foránea (datos del cliente, etiquetas, enlaces,
   * envíos) se borran a mano por la misma razón: si algún día las llaves no
   * están activas, quedarían huérfanas y nadie se enteraría.
   */
  async deleteConversation(id: string): Promise<{ mensajes: number }> {
    const fila = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
      [id],
    );

    // Registros del negocio: sobreviven, solo pierden el vínculo.
    for (const tabla of ["leads", "tickets"]) {
      await this.db.run(
        `UPDATE ${tabla} SET conversation_id = NULL WHERE conversation_id = ?`,
        [id],
      );
    }

    // Todo lo que solo tiene sentido dentro de la conversación.
    for (const tabla of [
      "messages",
      "conversation_insights",
      "customer_facts",
      "conv_labels",
      "keyword_hits",
      "tracked_links",
      "template_sends",
      "followup_sends",
    ]) {
      await this.db.run(`DELETE FROM ${tabla} WHERE conversation_id = ?`, [id]);
    }

    await this.db.run("DELETE FROM conversations WHERE id = ?", [id]);
    return { mensajes: fila?.n ?? 0 };
  }

  async setOpenTicket(id: string, ticketId: string | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET open_ticket_id = ? WHERE id = ?",
      [ticketId, id],
    );
  }
}
