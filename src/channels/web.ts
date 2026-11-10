import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../env";

/**
 * `CanalWeb`: lo que el sitio web puede pedirle al CRM (F3.6).
 *
 * Hasta hoy el chat de la web era otro bot: su propio modelo (Groq), su propio
 * texto con los precios escritos dentro, y ninguna conexión con el CRM. Eso
 * significaba dos cosas, y las dos se vieron:
 *
 *  1. **Decía cosas distintas que el bot de WhatsApp.** Misma clienta, misma
 *     pregunta, dos respuestas — incluido un producto descatalogado que el
 *     chat de la web seguía ofreciendo con precio.
 *  2. **Esas conversaciones no existían.** No entraban en la bandeja, no
 *     generaban lead, y la dueña no podía intervenir ni pausarlas.
 *
 * Ahora la web entra por aquí y es el MISMO agente: misma base de
 * conocimiento, mismas herramientas, mismo revisor, mismo trato de usted, y la
 * conversación aparece en la bandeja como cualquier otra.
 *
 * Va por service binding: no sale a internet, no lleva token y no se puede
 * llamar desde fuera de la cuenta. Por eso aquí no hay autenticación — la da
 * el binding — y por eso lo que importa es QUÉ se expone: solo mandar un
 * mensaje. Desde la web no se puede leer una conversación ajena, ni listar
 * clientas, ni tocar el inventario.
 */

/** Lo que la web manda. Una sesión del navegador y un texto, nada más. */
export interface MensajeDeLaWeb {
  /**
   * El identificador de la sesión del navegador.
   *
   * Es lo que agrupa los mensajes de una misma persona en una conversación.
   * Lo genera la web y vive en su almacenamiento local: NO es una identidad —
   * nadie ha dicho quién es— y por eso no se cruza con `clientes`. Cuando deje
   * su celular, ahí sí hay una persona.
   */
  readonly sesion: string;
  readonly texto: string;
  /** El nombre, si lo dijo. Solo para que la bandeja no muestre un código. */
  readonly nombre?: string;
}

export type RespuestaDeLaWeb =
  | { readonly ok: true; readonly trozos: string[] }
  | { readonly ok: false; readonly codigo: "entrada_invalida" | "sin_respuesta"; readonly mensaje: string };

/** Una sesión es un identificador opaco, no un texto libre. */
const SESION_VALIDA = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * El tope de lo que se acepta de un navegador.
 *
 * No es una regla de producto: es que esto llega de fuera y acaba en un prompt
 * que se paga por token. Un mensaje más largo que esto no es una clienta
 * preguntando por pañales.
 */
const MAXIMO_CARACTERES = 2000;

export class CanalWeb extends WorkerEntrypoint<Env> {
  async mensajeWeb(entrada: MensajeDeLaWeb): Promise<RespuestaDeLaWeb> {
    const sesion = (entrada?.sesion ?? "").trim();
    const texto = (entrada?.texto ?? "").trim();

    if (!SESION_VALIDA.test(sesion)) {
      return { ok: false, codigo: "entrada_invalida", mensaje: "sesión inválida" };
    }
    if (texto === "" || texto.length > MAXIMO_CARACTERES) {
      return {
        ok: false,
        codigo: "entrada_invalida",
        mensaje: `el mensaje tiene que traer entre 1 y ${MAXIMO_CARACTERES} caracteres`,
      };
    }

    const id = this.env.AGENT.idFromName(`web:${sesion}`);
    const { trozos } = await this.env.AGENT.get(id).responderWeb({
      channel: "web",
      channelUserId: sesion,
      ...(entrada.nombre === undefined ? {} : { displayName: entrada.nombre.slice(0, 80) }),
      text: texto,
    });

    if (trozos.length === 0) {
      // El agente decidió no contestar: la dueña pausó el bot, o un
      // guardarraíl descartó el mensaje. NO es un error del sistema y no se
      // reporta como tal — la pantalla dice que una persona va a responder.
      return {
        ok: false,
        codigo: "sin_respuesta",
        mensaje: "en este momento le responde una persona del equipo",
      };
    }

    return { ok: true, trozos };
  }
}
