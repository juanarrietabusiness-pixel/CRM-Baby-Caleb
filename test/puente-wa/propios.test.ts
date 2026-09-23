import { describe, it, expect } from "vitest";
// @ts-expect-error — módulo .mjs del contenedor, sin tipos: se prueba tal cual corre.
import * as propios from "../../puente-wa/contenedor/propios.mjs";

const {
  crearRegistroDeEnvios,
  esRespuestaDelTelefono,
  tipoDe,
  textoDe,
  sinDispositivo,
  RESPUESTA_VIGENTE_MS,
  archivoDe,
  ARCHIVO_MAXIMO,
} = propios as any;

const AHORA = 1_790_000_000_000;
const YO = ["50760000000:7@s.whatsapp.net", "99999999999:7@lid"];

function propio(extra: Record<string, unknown> = {}, message: unknown = { conversation: "Hola, ya le mando" }) {
  return {
    key: { fromMe: true, id: "3A1234567890ABCDEF", remoteJid: "245161514766536@lid" },
    messageTimestamp: Math.floor(AHORA / 1000) - 5,
    message,
    ...extra,
  };
}

describe("esRespuestaDelTelefono — la dueña contestó desde el teléfono", () => {
  it("un texto propio que el bot NO mandó es una respuesta de una persona", () => {
    const enviados = crearRegistroDeEnvios();
    expect(esRespuestaDelTelefono(propio(), { enviados, yo: YO, ahora: AHORA })).toBe(true);
  });

  it("el eco de lo que mandó el bot NO cuenta: su id quedó anotado antes de enviar", () => {
    const enviados = crearRegistroDeEnvios();
    enviados.anotar("3EB0BOT", AHORA);
    const eco = propio({ key: { fromMe: true, id: "3EB0BOT", remoteJid: "245161514766536@lid" } });
    expect(esRespuestaDelTelefono(eco, { enviados, yo: YO, ahora: AHORA })).toBe(false);
  });

  it("lo que escribe la clienta (fromMe = false) no es asunto de esta regla", () => {
    const enviados = crearRegistroDeEnvios();
    const deElla = propio({ key: { fromMe: false, id: "X", remoteJid: "245161514766536@lid" } });
    expect(esRespuestaDelTelefono(deElla, { enviados, yo: YO, ahora: AHORA })).toBe(false);
  });

  it("una reacción o un borrado no es tomar la conversación", () => {
    const enviados = crearRegistroDeEnvios();
    const reaccion = propio({}, { reactionMessage: { text: "❤️" } });
    const borrado = propio({}, { protocolMessage: { type: 0 } });
    expect(esRespuestaDelTelefono(reaccion, { enviados, yo: YO, ahora: AHORA })).toBe(false);
    expect(esRespuestaDelTelefono(borrado, { enviados, yo: YO, ahora: AHORA })).toBe(false);
  });

  it("una foto o un audio de la dueña SÍ cuentan", () => {
    const enviados = crearRegistroDeEnvios();
    const foto = propio({}, { imageMessage: { caption: "así llega" } });
    const audio = propio({}, { audioMessage: {} });
    expect(esRespuestaDelTelefono(foto, { enviados, yo: YO, ahora: AHORA })).toBe(true);
    expect(esRespuestaDelTelefono(audio, { enviados, yo: YO, ahora: AHORA })).toBe(true);
  });

  it("ni grupos, ni estados, ni la nota a uno mismo", () => {
    const enviados = crearRegistroDeEnvios();
    const conJid = (remoteJid: string) => propio({ key: { fromMe: true, id: "3A9", remoteJid } });
    expect(esRespuestaDelTelefono(conJid("1203630@g.us"), { enviados, yo: YO, ahora: AHORA })).toBe(false);
    expect(esRespuestaDelTelefono(conJid("status@broadcast"), { enviados, yo: YO, ahora: AHORA })).toBe(false);
    expect(esRespuestaDelTelefono(conJid("50760000000@s.whatsapp.net"), { enviados, yo: YO, ahora: AHORA })).toBe(
      false,
    );
  });

  it("lo que la dueña mandó hace horas no pausa nada al reconectar", () => {
    const enviados = crearRegistroDeEnvios();
    const viejo = propio({ messageTimestamp: Math.floor((AHORA - RESPUESTA_VIGENTE_MS - 60_000) / 1000) });
    expect(esRespuestaDelTelefono(viejo, { enviados, yo: YO, ahora: AHORA })).toBe(false);
  });

  it("desenvuelve los mensajes temporales antes de mirar el tipo", () => {
    const temporal = propio({}, { ephemeralMessage: { message: { extendedTextMessage: { text: "hola" } } } });
    expect(tipoDe(temporal)).toBe("extendedTextMessage");
    expect(textoDe(temporal)).toBe("hola");
  });
});

describe("registro de envíos del bot", () => {
  it("se poda solo: no crece con los días", () => {
    const r = crearRegistroDeEnvios();
    for (let i = 0; i < 2500; i++) r.anotar(`id-${i}`, AHORA + i);
    expect(r.tamano).toBeLessThanOrEqual(2000);
    expect(r.tiene("id-2499")).toBe(true);
    expect(r.tiene("id-0")).toBe(false);
  });

  it("olvida lo de hace más de una hora", () => {
    const r = crearRegistroDeEnvios();
    r.anotar("viejo", AHORA);
    r.anotar("nuevo", AHORA + 2 * 60 * 60 * 1000);
    expect(r.tiene("viejo")).toBe(false);
    expect(r.tiene("nuevo")).toBe(true);
  });
});

describe("sinDispositivo", () => {
  it("quita el sufijo de dispositivo para comparar el propio número", () => {
    expect(sinDispositivo("50760000000:7@s.whatsapp.net")).toBe("50760000000@s.whatsapp.net");
    expect(sinDispositivo("245161514766536@lid")).toBe("245161514766536@lid");
  });
});

describe("el contenedor usa la regla", () => {
  it("servidor.mjs genera el id ANTES de enviar y lo anota", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("puente-wa/contenedor/servidor.mjs", "utf8");
    const envio = src.slice(src.indexOf('url.pathname === "/enviar"'));
    const anota = envio.indexOf("enviadosPorElBot.anotar(messageId)");
    const envia = envio.indexOf("socket.sendMessage(");
    expect(anota).toBeGreaterThan(-1);
    expect(envia).toBeGreaterThan(anota);
    expect(envio).toContain("{ messageId })");
  });

  it("la imagen copia propios.mjs: sin él el contenedor no arranca", async () => {
    const { readFileSync } = await import("node:fs");
    const docker = readFileSync("puente-wa/contenedor/Dockerfile", "utf8");
    expect(docker).toMatch(/COPY [^\n]*propios\.mjs/);
  });
});

describe("archivoDe — la nota de voz o la foto que hay que descargar", () => {
  const de = (message: unknown) => ({ key: { remoteJid: "1@s.whatsapp.net" }, message });

  it("una nota de voz es audio, con su mime sin parámetros", () => {
    expect(archivoDe(de({ audioMessage: { mimetype: "audio/ogg; codecs=opus", fileLength: 9000, ptt: true } }))).toEqual({
      clase: "audio",
      mime: "audio/ogg",
      tamano: 9000,
      descargable: true,
    });
  });

  it("una foto (también dentro de un mensaje temporal) es imagen", () => {
    const r = archivoDe(de({ ephemeralMessage: { message: { imageMessage: { mimetype: "image/jpeg", caption: "mi pago" } } } }));
    expect(r).toMatchObject({ clase: "imagen", mime: "image/jpeg", descargable: true });
    expect(textoDe(de({ ephemeralMessage: { message: { imageMessage: { caption: "mi pago" } } } }))).toBe("mi pago");
  });

  it("un texto, un sticker o un video no se descargan", () => {
    expect(archivoDe(de({ conversation: "hola" }))).toBeNull();
    expect(archivoDe(de({ stickerMessage: {} }))).toBeNull();
    expect(archivoDe(de({ videoMessage: {} }))).toBeNull();
  });

  it("pasado el tope, no se descarga (se reenvía sin el archivo)", () => {
    expect(archivoDe(de({ audioMessage: { fileLength: ARCHIVO_MAXIMO + 1 } })).descargable).toBe(false);
  });

  it("servidor.mjs descarga el archivo y lo manda con el mensaje, con la leyenda de la foto", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("puente-wa/contenedor/servidor.mjs", "utf8");
    const reenviar = src.slice(src.indexOf("async function reenviar"), src.indexOf("async function descargarArchivo"));
    expect(reenviar).toContain("media: await descargarArchivo(msg)");
    expect(reenviar).toContain("texto: textoDe(msg)");
    expect(src).toMatch(/import makeWASocket, \{[^}]*downloadMediaMessage/);
  });
});
