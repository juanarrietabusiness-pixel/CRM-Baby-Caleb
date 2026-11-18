import { describe, it, expect, vi } from "vitest";
import { CanalWeb, type MensajeDeLaWeb } from "../../src/channels/web";
import { pickAdapter } from "../../src/replies/sender";
import type { Env } from "../../src/env";

/**
 * El canal web (F3.6): la frontera entre el sitio y el agente.
 *
 * Lo que se vigila aquí no es que el bot conteste bien —eso es del agente— es
 * QUÉ SE DEJA ENTRAR. Al otro lado de este binding está un navegador
 * cualquiera: lo que llegue acaba en un prompt que se paga por token y en una
 * conversación que la dueña va a leer en su bandeja.
 */

let ultimaLlamada: unknown = null;

function env(trozos: string[] = ["Hola, con gusto le ayudo."]): Env {
  const stub = {
    responderWeb: vi.fn(async (payload: unknown) => {
      ultimaLlamada = payload;
      return { trozos };
    }),
  };
  return {
    AGENT: {
      idFromName: vi.fn((n: string) => ({ nombre: n, toString: () => n })),
      get: vi.fn(() => stub),
    },
  } as unknown as Env;
}

const pedir = (entrada: Partial<MensajeDeLaWeb>, e: Env = env()) =>
  new CanalWeb({} as never, e).mensajeWeb(entrada as MensajeDeLaWeb);

const SESION = "abc123XY_-def456";

describe("lo que se deja entrar", () => {
  it("una sesión y un texto normales pasan", async () => {
    const r = await pedir({ sesion: SESION, texto: "¿Qué talla le toca a mi bebé?" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trozos).toEqual(["Hola, con gusto le ayudo."]);
  });

  it("una sesión que no parece una sesión NO pasa", async () => {
    // Es un identificador opaco, no un texto libre. Sin esto, la «sesión» es
    // texto de fuera que acaba formando el nombre del Durable Object.
    for (const mala of ["", "corta", "con espacios aquí", "a".repeat(65), "../../otro", "<script>"]) {
      const r = await pedir({ sesion: mala, texto: "hola" });
      expect(r.ok, `aceptó: ${mala}`).toBe(false);
      if (!r.ok) expect(r.codigo).toBe("entrada_invalida");
    }
  });

  it("un mensaje vacío o de solo espacios NO pasa", async () => {
    for (const vacio of ["", "   ", "\n\n"]) {
      const r = await pedir({ sesion: SESION, texto: vacio });
      expect(r.ok, `aceptó: ${JSON.stringify(vacio)}`).toBe(false);
    }
  });

  it("y uno larguísimo tampoco", async () => {
    // No es una regla de producto: esto llega de fuera y se paga por token.
    // Un mensaje de 2001 caracteres no es una clienta preguntando por pañales.
    expect((await pedir({ sesion: SESION, texto: "a".repeat(2001) })).ok).toBe(false);
    expect((await pedir({ sesion: SESION, texto: "a".repeat(2000) })).ok).toBe(true);
  });

  it("una entrada sin nada no revienta: contesta que es inválida", async () => {
    expect((await pedir({})).ok).toBe(false);
  });
});

describe("a qué conversación va", () => {
  it("la sesión decide el Durable Object, con prefijo del canal", async () => {
    const e = env();
    await pedir({ sesion: SESION, texto: "hola" }, e);
    expect((e.AGENT.idFromName as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(`web:${SESION}`);
  });

  it("el mensaje llega marcado como del canal web", async () => {
    await pedir({ sesion: SESION, texto: "hola", nombre: "Ana" });
    expect(ultimaLlamada).toMatchObject({
      channel: "web",
      channelUserId: SESION,
      displayName: "Ana",
      text: "hola",
    });
  });

  it("sin nombre, no se manda un displayName vacío", async () => {
    await pedir({ sesion: SESION, texto: "hola" });
    expect(ultimaLlamada).not.toHaveProperty("displayName");
  });

  it("un nombre larguísimo se recorta, no se rechaza", async () => {
    // El nombre es cosmético —sale en la bandeja— así que recortar es mejor
    // que negarle la respuesta a alguien por cómo escribió su nombre.
    await pedir({ sesion: SESION, texto: "hola", nombre: "N".repeat(500) });
    expect((ultimaLlamada as { displayName: string }).displayName).toHaveLength(80);
  });
});

describe("cuando el agente decide no contestar", () => {
  it("no es un error del sistema: se dice que responde una persona", async () => {
    // Pasa cuando la dueña pausó el bot desde el panel, o cuando un
    // guardarraíl descartó el mensaje. Tratarlo como fallo haría que la
    // pantalla enseñara «algo salió mal» justo cuando todo salió como debía.
    const r = await pedir({ sesion: SESION, texto: "hola" }, env([]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("sin_respuesta");
      expect(r.mensaje).toContain("una persona");
    }
  });
});

describe("el canal web no se envía", () => {
  it("pedirle un adaptador revienta, y dice por qué", async () => {
    // `web` SÍ es un canal conocido: lo que no tiene es a dónde empujar. Si el
    // error dijera «canal desconocido», mandaría a quien lo lea a buscar un
    // adaptador que no falta.
    expect(() => pickAdapter("web")).toThrow(/vuelve por la misma petición/);
  });

  it("los demás canales siguen teniendo el suyo", async () => {
    for (const c of ["telegram", "whatsapp", "twilio", "manychat", "messenger", "instagram"] as const) {
      expect(() => pickAdapter(c), c).not.toThrow();
    }
  });
});
