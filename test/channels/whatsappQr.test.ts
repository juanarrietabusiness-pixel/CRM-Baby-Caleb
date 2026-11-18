import { describe, it, expect, vi, afterEach } from "vitest";
import { whatsappQrAdapter, esJidDeGrupo, esChatDeUnaPersona } from "../../src/channels/whatsappQr";
import { pickAdapter } from "../../src/replies/sender";
import type { Env } from "../../src/env";

const env = {
  WA_PUENTE_URL: "https://puente.ejemplo",
  WA_TOKEN: "token-de-prueba-1234567890abcdef",
} as unknown as Env;

function entrante(cuerpo: unknown): Request {
  return new Request("https://bot.ejemplo/webhooks/whatsapp-qr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("parseIncoming", () => {
  it("normaliza un mensaje del puente", async () => {
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({
        de: "5215555550000@s.whatsapp.net",
        nombre: "Ana",
        texto: "hola",
        tipo: "conversation",
        recibidoEn: 1_700_000_000_000,
      }),
      env,
    );

    expect(msg.channel).toBe("whatsapp-qr");
    expect(msg.text).toBe("hola");
    expect(msg.displayName).toBe("Ana");
    expect(msg.receivedAt).toBe(1_700_000_000_000);
    expect(msg.isOwnerMessage).toBe(false);
  });

  it("conserva el JID COMPLETO como channelUserId", async () => {
    // No se le quita el sufijo a propósito: es lo que hay que devolverle al
    // puente para responder, y el de `@lid` no se puede reconstruir si se pierde.
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({ de: "82953669472492@lid", texto: "hey", recibidoEn: 1 }),
      env,
    );
    expect(msg.channelUserId).toBe("82953669472492@lid");
  });

  it("rechaza un mensaje sin remitente en vez de inventarse uno", async () => {
    await expect(
      whatsappQrAdapter.parseIncoming(entrante({ de: null, texto: "hola" }), env),
    ).rejects.toThrow(/sin remitente/i);
  });

  it("una foto que el contenedor no pudo descargar no llega vacía: dice qué era", async () => {
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({ de: "1@s.whatsapp.net", texto: null, tipo: "imageMessage", recibidoEn: 1 }),
      env,
    );
    expect(msg.text).toMatch(/mandó una imagen/);
    expect(msg.imageUrl).toBeUndefined();
    expect(msg.channelUserId).toBe("1@s.whatsapp.net");
  });

  it("una reacción o un mensaje de protocolo llega sin nada (la ruta no lo pasa al agente)", async () => {
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({ de: "1@s.whatsapp.net", texto: null, tipo: "reactionMessage", recibidoEn: 1 }),
      env,
    );
    expect(msg.text ?? msg.audioUrl ?? msg.imageUrl).toBeUndefined();
  });
});

describe("sendReply", () => {
  it("manda todos los chunks en UNA llamada al puente", async () => {
    // Espaciarlos aquí dejaría al Worker esperando sin hacer nada y pagando por
    // ello; el retraso corre donde vive el socket.
    const fetchSpy = vi.fn(async (_req: Request) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchSpy);

    await whatsappQrAdapter.sendReply(
      {
        channel: "whatsapp-qr",
        channelUserId: "5215555550000@s.whatsapp.net",
        chunks: ["uno", "dos", "tres"],
      },
      env,
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const peticion = fetchSpy.mock.calls[0][0];
    expect(peticion.url).toBe("https://puente.ejemplo/api/enviar");
    const cuerpo = (await peticion.json()) as { para: string; chunks: string[] };
    expect(cuerpo.para).toBe("5215555550000@s.whatsapp.net");
    expect(cuerpo.chunks).toEqual(["uno", "dos", "tres"]);
  });

  it("usa el SERVICE BINDING cuando existe, no la URL pública", async () => {
    // Cloudflare rechaza con error 1042 que un Worker llame a otro Worker de la
    // misma cuenta por su URL pública — y el bot y su puente viven SIEMPRE en la
    // misma cuenta. El síntoma era un 404 que parecía "la ruta no existe".
    const fetchSpy = vi.fn(async (_req: Request) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchSpy);
    const bindingFetch = vi.fn(async (_req: Request) => new Response(JSON.stringify({ ok: true })));

    await whatsappQrAdapter.sendReply(
      { channel: "whatsapp-qr", channelUserId: "1@s.whatsapp.net", chunks: ["hola"] },
      { ...env, PUENTE_WA: { fetch: bindingFetch } } as unknown as Env,
    );

    expect(bindingFetch).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    const peticion = bindingFetch.mock.calls[0][0];
    expect(new URL(peticion.url).pathname).toBe("/api/enviar");
  });

  it("manda el token en base64, nunca en claro", async () => {
    // El fallo más caro del piloto: una cabecera HTTP no entrega intacto un
    // token con caracteres fuera de ASCII. Node escribe latin-1, Cloudflare lee
    // UTF-8, y llega del mismo largo con distinto contenido.
    const fetchSpy = vi.fn(async (_req: Request) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchSpy);

    await whatsappQrAdapter.sendReply(
      { channel: "whatsapp-qr", channelUserId: "1@s.whatsapp.net", chunks: ["hola"] },
      env,
    );

    const peticion = fetchSpy.mock.calls[0][0];
    expect(peticion.headers.get("x-wa-token-b64")).toBeTruthy();
    expect(peticion.headers.get("x-wa-token")).toBeNull();
    expect(atob(peticion.headers.get("x-wa-token-b64")!)).toBe(env.WA_TOKEN);
  });

  it("lanza si el puente rechaza, en vez de tragarse la respuesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("sin conexión", { status: 409 })));
    await expect(
      whatsappQrAdapter.sendReply(
        { channel: "whatsapp-qr", channelUserId: "1@s.whatsapp.net", chunks: ["hola"] },
        env,
      ),
    ).rejects.toThrow(/409/);
  });

  it("lanza si falta la configuración, sin intentar la llamada", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      whatsappQrAdapter.sendReply(
        { channel: "whatsapp-qr", channelUserId: "1@s.whatsapp.net", chunks: ["hola"] },
        {} as Env,
      ),
    ).rejects.toThrow(/PUENTE_WA|WA_PUENTE_URL|WA_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("enganche con el resto del bot", () => {
  it("pickAdapter devuelve este adaptador para whatsapp-qr", () => {
    expect(pickAdapter("whatsapp-qr")).toBe(whatsappQrAdapter);
  });

  it("no le roba el canal a la Cloud API oficial", () => {
    // Los dos conviven a propósito: el QR es alterno y puede ser baneado.
    expect(pickAdapter("whatsapp")).not.toBe(whatsappQrAdapter);
  });
});

describe("esJidDeGrupo", () => {
  it("reconoce un grupo", () => {
    expect(esJidDeGrupo("1234-5678@g.us")).toBe(true);
  });

  it("no confunde un chat normal ni un @lid con un grupo", () => {
    expect(esJidDeGrupo("5215555550000@s.whatsapp.net")).toBe(false);
    expect(esJidDeGrupo("82953669472492@lid")).toBe(false);
  });
});

// El 24-sep-2026: el bot "contestaba" los ESTADOS de los contactos. Llegan a
// Baileys como mensajes de `status@broadcast`; el CRM los tomaba por una
// clienta mandando una foto, y la conversación existía en el panel pero no en
// el teléfono.
describe("los estados de WhatsApp no son una conversación", () => {
  it("esChatDeUnaPersona: fuera estados, difusiones, grupos, canales y bots", () => {
    for (const j of [
      "status@broadcast",
      "1234567890@broadcast",
      "120363000000000000@g.us",
      "120363000000000000@newsletter",
      "13135550002@bot",
      "",
      null,
      undefined,
    ]) {
      expect(esChatDeUnaPersona(j), String(j)).toBe(false);
    }
  });

  it("esChatDeUnaPersona: dentro los chats de persona, también los formatos nuevos", () => {
    for (const j of ["5215555550000@s.whatsapp.net", "82953669472492@lid", "573001112233@hosted"]) {
      expect(esChatDeUnaPersona(j), j).toBe(true);
    }
  });

  it("la foto de un estado ni se guarda: llega sin texto ni imagen", async () => {
    const msg = await whatsappQrAdapter.parseIncoming(
      entrante({
        de: "status@broadcast",
        nombre: "Un contacto",
        texto: "de paseo",
        tipo: "imageMessage",
        media: { clase: "imagen", mime: "image/jpeg", base64: "AAAA" },
        recibidoEn: 1,
      }),
      env,
    );
    expect(msg.text).toBeUndefined();
    expect(msg.imageUrl).toBeUndefined();
  });

  it("sendReply se niega a escribirle a status@broadcast (eso PUBLICARÍA un estado)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      whatsappQrAdapter.sendReply(
        { channel: "whatsapp-qr", channelUserId: "status@broadcast", chunks: ["hola"] },
        env,
      ),
    ).rejects.toThrow(/no es el chat de una persona/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("la ruta del webhook lo ignora antes de despertar al agente", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/index.ts", "utf8");
    const ruta = src.slice(src.indexOf('app.post("/webhooks/whatsapp-qr"'));
    const filtro = ruta.indexOf("esChatDeUnaPersona(msg.channelUserId)");
    const agente = ruta.indexOf("AGENT.get(");
    expect(filtro).toBeGreaterThan(-1);
    expect(agente).toBeGreaterThan(filtro);
  });
});
