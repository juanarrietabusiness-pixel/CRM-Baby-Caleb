/**
 * Borrar una conversación: qué se va y, sobre todo, qué se queda.
 *
 * El dueño lo pidió por dos motivos. Uno, poder probar el bot en limpio: el
 * agente mete los últimos 20 mensajes en cada respuesta, así que una
 * conversación larga arrastra su propio estilo y el bot termina copiándose a sí
 * mismo. Dos, su clienta va a querer borrar chats para no acumularlos.
 *
 * El riesgo obvio de una función así es que se lleve por delante una venta.
 * Por eso la mitad de este archivo comprueba lo que NO se borra.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { TicketsRepo } from "../../src/db/tickets";
import { CustomerFactsRepo } from "../../src/db/facts";

let db: Db;
let convs: ConversationsRepo;
const CONV = "telegram:111";
const OTRA = "telegram:222";

beforeEach(async () => {
  const mf = await createTestMiniflare();
  db = new Db((await mf.getD1Database("DB")) as never);
  convs = new ConversationsRepo(db);

  for (const id of [CONV, OTRA]) {
    const [canal, usuario] = id.split(":");
    await convs.getOrCreate(canal, usuario);
    const msgs = new MessagesRepo(db);
    await msgs.append(id, "user", "hola");
    await msgs.append(id, "assistant", "buenas, ¿en qué le ayudo?");
    await new CustomerFactsRepo(db).addMany(id, [`nombre del chat ${id}`]);
  }
});

const contar = async (tabla: string, id: string) =>
  (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla} WHERE conversation_id = ?`, [id]))
    ?.n ?? 0;

describe("lo que se borra", () => {
  it("los mensajes del chat", async () => {
    expect(await contar("messages", CONV)).toBe(2);
    const r = await convs.deleteConversation(CONV);
    expect(r.mensajes).toBe(2);
    expect(await contar("messages", CONV)).toBe(0);
  });

  it("lo que el bot había aprendido de esa persona", async () => {
    // Importa más de lo que parece: los datos recordados se inyectan en el
    // prompt como bloque <cliente>. Un borrado a medias seguiría influyendo.
    expect(await contar("customer_facts", CONV)).toBe(1);
    await convs.deleteConversation(CONV);
    expect(await contar("customer_facts", CONV)).toBe(0);
  });

  it("la conversación misma", async () => {
    await convs.deleteConversation(CONV);
    expect(await convs.getById(CONV)).toBeNull();
  });
});

describe("lo que NO se borra", () => {
  it("el lead sobrevive, solo pierde el vínculo", async () => {
    // Un pedido existió aunque la dueña borre el chat. Borrarlo con el chat
    // sería destruir una venta por limpiar la bandeja.
    await new LeadsRepo(db).create({
      conversationId: CONV,
      channelUserId: "111",
      name: "Yulilka",
      contact: "69103347",
      intent: "30 cajas talla L",
    });
    await convs.deleteConversation(CONV);

    const leads = await db.all<{ name: string; conversation_id: string | null }>(
      "SELECT name, conversation_id FROM leads",
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe("Yulilka");
    expect(leads[0].conversation_id).toBeNull();
  });

  it("el ticket sobrevive, solo pierde el vínculo", async () => {
    await new TicketsRepo(db).create({
      conversationId: CONV,
      category: "other",
      summary: "pedido de 70 cajas a tres destinos",
      transcript: "",
    });
    await convs.deleteConversation(CONV);

    const tickets = await db.all<{ summary: string; conversation_id: string | null }>(
      "SELECT summary, conversation_id FROM tickets",
    );
    expect(tickets).toHaveLength(1);
    expect(tickets[0].summary).toContain("70 cajas");
    expect(tickets[0].conversation_id).toBeNull();
  });

  it("las OTRAS conversaciones quedan intactas", async () => {
    await convs.deleteConversation(CONV);
    expect(await convs.getById(OTRA)).not.toBeNull();
    expect(await contar("messages", OTRA)).toBe(2);
    expect(await contar("customer_facts", OTRA)).toBe(1);
  });
});

describe("detalles que evitan sustos", () => {
  it("borrar un chat que no existe no truena", async () => {
    await expect(convs.deleteConversation("telegram:no-existe")).resolves.toEqual({ mensajes: 0 });
  });

  it("borrar dos veces tampoco", async () => {
    await convs.deleteConversation(CONV);
    await expect(convs.deleteConversation(CONV)).resolves.toEqual({ mensajes: 0 });
  });

  it("el mismo id vuelve a servir después de borrarlo", async () => {
    // La clienta escribe otra vez desde el mismo Telegram: tiene que empezar de
    // cero, no resucitar el chat viejo.
    await convs.deleteConversation(CONV);
    await convs.getOrCreate("telegram", "111");
    expect(await convs.getById(CONV)).not.toBeNull();
    expect(await contar("messages", CONV)).toBe(0);
  });
});
