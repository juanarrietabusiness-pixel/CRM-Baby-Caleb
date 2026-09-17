// Puente de WhatsApp por QR — `juancitoads-bot-wa`.
//
// Worker APARTE del bot, a propósito. El bot se despliega con un solo
// `wrangler deploy`: si el contenedor se le colgara encima, una imagen que no
// construye bloquearía publicar un cambio de la base de conocimiento. Aquí, lo
// peor que pasa es que WhatsApp se cae y el bot sigue publicándose.
//
// Tres trabajos:
//   1. Sostener el contenedor prendido y dejarlo observable.
//   2. Hacer de puente a D1 — el contenedor no tiene bindings, así que guarda
//      sus credenciales llamando aquí por HTTPS con un token.
//   3. Pasar los mensajes: los entrantes hacia el webhook del CRM, los
//      salientes hacia el contenedor.
//
// ── Por qué esto extiende `Container` y ya no usa la API cruda ─────────────
//
// La versión anterior decía: "no usa `@cloudflare/containers`: la API cruda de
// `ctx.container` alcanza y evita una dependencia más en la ruta crítica". Esa
// decisión es la que tuvo el canal caído.
//
// El 17-sep-2026 escuchamos el Worker tres minutos con el panel cerrado:
// CERO eventos. Ni un latido. El canal no estaba degradado, estaba apagado —
// y con él, 89 arranques de contenedor contra 76 latidos en dos horas y media.
//
// La causa está en el código de Cloudflare, no en el nuestro:
//
//     // do not remove this, container DOs ALWAYS need an alarm right now.
//
// Su `alarm()` DUERME DENTRO del propio manejador y al despertar la vuelve a
// armar con `setAlarm(Date.now())`: siempre hay una alarma en vuelo, y eso es
// lo que mantiene el Durable Object residente en memoria. El contenedor vive
// mientras vive su DO.
//
// El nuestro hacía su trabajo y RETORNABA. Entre latido y latido no quedaba
// ninguna alarma en vuelo, el DO se desalojaba, y el contenedor se iba con él.
// El retroceso exponencial alargaba esos huecos hasta quince minutos.
//
// Por eso la dependencia entra: no es un envoltorio de conveniencia, es la
// gestión del ciclo de vida. Sostener un socket permanente sin ella significa
// reimplementar ese bucle, que es exactamente lo que la librería ya hace bien.

import type { DurableObject } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import {
  autorizado,
  huella,
  pedazos,
  tokenEsApto,
  tokenPresentado,
  veredictoDeSalud,
  latidoVencido,
  reinicioPedido,
  FILAS_POR_IDA,
  LATIDOS_ANTES_DE_REINICIAR,
  VIGILANCIA_S,
} from "./comun";

export interface Env {
  WA: DurableObjectNamespace<PuenteWa>;
  DB: D1Database;
  /** URL pública de ESTE Worker. El contenedor vuelve a entrar por aquí. */
  PUENTE_BASE_URL: string;
  /** Service binding al Worker del bot. Ver la nota del wrangler.toml. */
  CRM?: Fetcher;
  /** Ruta del webhook del bot. El salto va por el binding, no por esta URL. */
  CRM_WEBHOOK_URL: string;
  /** Secret compartido. Solo ASCII — ver `tokenEsApto`. */
  WA_TOKEN: string;
}

const PUERTO_CONTENEDOR = 8080;

/** Cuántas pre-keys se conservan al podar. Ver `/api/podar`. */
const PRE_KEYS_A_CONSERVAR = 1000;

interface Diario {
  arrancadoEn: string;
  latidos: number;
  arranquesContenedor: number;
  ultimoArranque: string | null;
  ultimaMuerteVista: string | null;
  fallosSeguidos: number;
  /**
   * Cuándo se vigiló por última vez. Es la señal que faltaba el 16-sep-2026:
   * el canal llevaba horas mudo y el panel lo mostraba como si nada.
   */
  ultimoLatidoEn: number | null;
  /** Vigilancias seguidas con el contenedor prendido pero WhatsApp caído. */
  desconectadoSeguidos: number;
  /** La última vez que se vio el socket de WhatsApp realmente abierto. */
  ultimaConexionVista: string | null;
  /** Cuántas veces hubo que destruir el contenedor para recuperarlo. */
  reiniciosForzados: number;
  /** Lo último que impidió vigilar, si algo lo impidió. */
  ultimoFalloDelLatido: string | null;
  /** Por qué murió el contenedor la última vez, según el propio runtime. */
  ultimaSalida: string | null;
}

export class PuenteWa extends Container<Env> {
  /** El puerto donde escucha `servidor.mjs`. */
  defaultPort = PUERTO_CONTENEDOR;

  /**
   * Cuánto aguanta el contenedor sin actividad antes de que la librería lo
   * apague.
   *
   * Largo a propósito. El valor por defecto son 10 minutos y está pensado para
   * un contenedor que atiende peticiones: si nadie pide nada, sobra. Aquí el
   * trabajo del contenedor es justamente NO recibir peticiones — sostiene un
   * socket con WhatsApp y se queda callado. Una noche sin mensajes es el modo
   * de operación normal, no una señal de que sobre.
   *
   * Aun así no basta con ponerlo largo: `vigilar()` renueva la actividad
   * explícitamente. Ver ahí por qué.
   */
  sleepAfter = "6h";

  /** Baileys tiene que salir a wss://web.whatsapp.com. */
  enableInternet = true;

  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    // Va en el constructor y no como campo porque depende de `env`, que no
    // existe hasta que el DO se construye.
    this.envVars = {
      PORT: String(PUERTO_CONTENEDOR),
      PUENTE_URL: env.PUENTE_BASE_URL,
      PUENTE_TOKEN: env.WA_TOKEN,
    };
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  /**
   * ¿El contenedor ya estaba prendido cuando PEDIMOS arrancarlo?
   *
   * Campo de instancia y no de almacenamiento a propósito: solo tiene que
   * sobrevivir el tramo entre el `startAndWaitForPorts()` y el `onStart()` que
   * la librería dispara al final de ese mismo `await`. Ver `#arrancar()`.
   */
  #yaEstabaPrendido = false;

  /**
   * `startAndWaitForPorts()`, pero contando arranques de verdad.
   *
   * Todos los arranques que pedimos nosotros pasan por aquí, y no es una
   * envoltura de adorno. La librería llama `onStart()` al final de CADA
   * `startAndWaitForPorts()`, sin mirar si hizo falta arrancar algo: su
   * `startContainerIfNotRunning()` es un no-op cuando el contenedor ya corría,
   * y el `onStart()` que viene después no lo es.
   *
   * Con la vigilancia cada 30 s eso son 120 "arranques" por hora de un
   * contenedor que no se cayó ni una vez. Y no es cosmético: la cuenta de
   * arranques contra la de latidos es LA señal con la que encontramos el fallo
   * del 17-sep-2026 —89 arranques contra 76 latidos en dos horas y media, que
   * es como se vio que el Durable Object se desalojaba—. Una señal que sube
   * sola no sirve para diagnosticar nada.
   *
   * La bandera se limpia al salir, y por eso los arranques que dispara
   * `containerFetch()` sí se cuentan: ésa solo arranca cuando el contenedor NO
   * estaba corriendo, así que ahí `onStart()` siempre significa un arranque
   * real.
   */
  async #arrancar(): Promise<void> {
    this.#yaEstabaPrendido = this.ctx.container?.running === true;
    try {
      await this.startAndWaitForPorts();
    } finally {
      this.#yaEstabaPrendido = false;
    }
  }

  override async onStart(): Promise<void> {
    // Ya estaba arriba: esto no fue un arranque, fue una comprobación.
    if (this.#yaEstabaPrendido) return;

    const diario = await this.#diario();
    diario.arranquesContenedor += 1;
    diario.ultimoArranque = new Date().toISOString();
    await this.ctx.storage.put("diario", diario);
    console.log("contenedor arriba");
  }

  /**
   * Por qué murió, en el diario y en el log.
   *
   * Durante dos horas el contenedor se apagó 89 veces y NADA decía por qué:
   * el diario solo sabía que lo había encontrado caído. `exitCode` y `reason`
   * los da el runtime, y son justo lo que convierte "se cayó otra vez" en una
   * causa.
   */
  override async onStop({ exitCode, reason }: { exitCode: number; reason: string }): Promise<void> {
    const diario = await this.#diario();
    diario.ultimaMuerteVista = new Date().toISOString();
    diario.ultimaSalida = `código ${exitCode} · ${reason}`;
    await this.ctx.storage.put("diario", diario);
    console.log(`contenedor abajo: código ${exitCode} · ${reason}`);
  }

  override onError(error: unknown): unknown {
    const motivo = error instanceof Error ? error.message : String(error);
    console.error("contenedor:", motivo);
    return error;
  }

  // ── La vigilancia ────────────────────────────────────────────────────────

  /**
   * El relevo del viejo `alarm()`, con dos diferencias que importan.
   *
   * Va por `schedule()` y NO sobrescribiendo `alarm()`: el manejador de alarma
   * de la librería es lo que mantiene vivo al Durable Object —y con él al
   * contenedor—, así que pisarlo rompe justo la pieza que sostiene todo. La
   * propia librería lo pide: "we strongly recommend using this instead of the
   * `alarm` handler".
   *
   * Y renueva la actividad a mano. La librería la renueva sola cuando llega una
   * petición al contenedor, pero a éste no le llega ninguna: sostiene un socket
   * y se queda callado. `renewActivityTimeout()` está documentado para
   * exactamente este caso — "useful for background tasks that don't involve
   * container requests".
   *
   * Sin retroceso, a propósito. Esperar cada vez más tras cada fallo es lo
   * correcto para algo que se reintenta; para un socket que debe estar siempre
   * abierto es al revés, y fue parte de por qué las noches quedaban mudas.
   */
  async vigilar(): Promise<void> {
    // Primero lo que no puede faltar: la próxima vigilancia queda pedida antes
    // de cualquier cosa que pueda fallar. Es la misma lección que nos costó una
    // noche entera cuando `setAlarm` era la última línea.
    await this.#asegurarVigilancia();

    const diario = await this.#diario();
    diario.latidos += 1;
    diario.ultimoLatidoEn = Date.now();
    diario.ultimoFalloDelLatido = null;

    try {
      // Que el contenedor esté vivo y con el puerto listo. Idempotente: si ya
      // lo está, no cuesta nada — y `#arrancar()` se encarga de que tampoco
      // cuente como un arranque en el diario.
      await this.#arrancar();

      // La actividad se renueva aunque WhatsApp esté caído: lo que se está
      // diciendo es "este contenedor sigue haciendo falta", no "está sano".
      this.renewActivityTimeout();

      const conexion = await this.#conexionDelContenedor();
      const veredicto = veredictoDeSalud(conexion);

      if (veredicto === "sano") {
        diario.desconectadoSeguidos = 0;
        diario.ultimaConexionVista = new Date().toISOString();
        await this.ctx.storage.put("diario", diario);
        return;
      }

      if (veredicto === "esperando-a-una-persona") {
        // Sin vincular o esperando el QR. No es un fallo y NO se reinicia:
        // reiniciar aquí genera un código nuevo y le tumba al dueño el que está
        // mirando en la pantalla.
        diario.desconectadoSeguidos = 0;
        await this.ctx.storage.put("diario", diario);
        return;
      }

      // ── Prendido pero mudo ────────────────────────────────────────────────
      diario.desconectadoSeguidos += 1;

      if (diario.desconectadoSeguidos >= LATIDOS_ANTES_DE_REINICIAR) {
        // El martillo. Sale gratis en credenciales —viven en D1, está medido— y
        // cuesta una resincronización.
        diario.reiniciosForzados += 1;
        diario.desconectadoSeguidos = 0;
        await this.ctx.storage.put("diario", diario);
        await this.destroy();
        await this.#arrancar();
        return;
      }

      // Lo barato primero: pedirle que reconecte. Es idempotente.
      await this.ctx.storage.put("diario", diario);
      await this.#pedirReconexion();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      diario.ultimoFalloDelLatido = motivo;
      await this.ctx.storage.put("diario", diario).catch(() => {});
      console.error("vigilancia:", motivo);
    }
  }

  /**
   * Encadena la próxima vigilancia. Nunca lanza: es la pieza que no puede faltar.
   *
   * ESTE es el único sitio del archivo que programa, y no por gusto: cada
   * llamada a `schedule()` agrega una tarea, así que dos dueños serían dos
   * cadenas, y dos cadenas se multiplican. `onStart()` y `matar()` a propósito
   * no programan; el cron solo revive cuando la cadena ya se cortó.
   */
  async #asegurarVigilancia(): Promise<void> {
    try {
      await this.schedule(VIGILANCIA_S, "vigilar");
    } catch (e) {
      console.error("no se pudo programar la vigilancia:", e);
    }
  }

  // ── Lo que llama el Worker ───────────────────────────────────────────────

  /**
   * Lo destruye Y lo hace volver. Al volver debe reconectar desde D1, sin QR.
   *
   * `reinicioPedido()` explica por qué se limpian esos campos: un reinicio
   * pedido por una persona es un punto y aparte, no la continuación de la
   * racha anterior.
   */
  async matar(): Promise<Diario> {
    const diario = { ...(await this.#diario()), ...reinicioPedido(new Date()) };
    await this.ctx.storage.put("diario", diario);
    try {
      await this.destroy();
    } catch {
      // Destruir algo que ya no existe no es un error que valga propagar.
    }
    await this.#arrancar();
    return diario;
  }

  async diario(): Promise<Diario> {
    return this.#diario();
  }

  /**
   * Lo llama el cron. NO vigila por su cuenta: solo revive la cadena si se
   * cortó.
   *
   * La distinción no es un detalle. `schedule()` agrega una tarea CADA vez que
   * se le llama, así que un cron que vigilara siempre haría nacer una cadena
   * nueva por minuto: a la hora habría sesenta vigilando en paralelo, cada una
   * arrancando contenedores. Programar tiene un solo dueño —`vigilar()`— y
   * esto es el desfibrilador, no un segundo corazón.
   *
   * La señal de que se cortó es la misma que mira el panel: un `ultimoLatidoEn`
   * vencido. Sin latido previo también entra, que es el arranque en frío.
   */
  async despertar(): Promise<void> {
    const diario = await this.#diario();
    const nuncaLatió = diario.ultimoLatidoEn === null;
    if (!nuncaLatió && !latidoVencido(diario.ultimoLatidoEn, Date.now())) return;
    console.log("el cron encontró la vigilancia detenida; la reanuda");
    await this.vigilar();
  }

  // ── Interno ──────────────────────────────────────────────────────────────

  /** Qué dice el contenedor de sí mismo. `null` si no contesta. */
  async #conexionDelContenedor(): Promise<string | null> {
    try {
      const r = await this.containerFetch("http://contenedor/estado");
      if (!r.ok) return null;
      const cuerpo = (await r.json()) as { conexion?: string };
      return cuerpo.conexion ?? null;
    } catch {
      // Un contenedor prendido que no contesta ES un contenedor caído, y así se
      // cuenta: `veredictoDeSalud(null)` da "caido".
      return null;
    }
  }

  async #pedirReconexion(): Promise<void> {
    try {
      await this.containerFetch("http://contenedor/reconectar", { method: "POST" });
    } catch (e) {
      console.error("no se pudo pedir la reconexión:", e);
    }
  }

  async #diario(): Promise<Diario> {
    const guardado = await this.ctx.storage.get<Partial<Diario>>("diario");
    const base: Diario = {
      arrancadoEn: new Date().toISOString(),
      latidos: 0,
      arranquesContenedor: 0,
      ultimoArranque: null,
      ultimaMuerteVista: null,
      fallosSeguidos: 0,
      ultimoLatidoEn: null,
      desconectadoSeguidos: 0,
      ultimaConexionVista: null,
      reiniciosForzados: 0,
      ultimoFalloDelLatido: null,
      ultimaSalida: null,
    };
    if (!guardado) return base;
    // Un diario escrito por una versión anterior no trae los campos nuevos. Sin
    // estos respaldos, el primer `+= 1` daría NaN y ese NaN viajaría al panel.
    return {
      ...base,
      ...guardado,
      latidos: guardado.latidos ?? 0,
      arranquesContenedor: guardado.arranquesContenedor ?? 0,
      fallosSeguidos: guardado.fallosSeguidos ?? 0,
      desconectadoSeguidos: guardado.desconectadoSeguidos ?? 0,
      reiniciosForzados: guardado.reiniciosForzados ?? 0,
      ultimoLatidoEn: guardado.ultimoLatidoEn ?? null,
    };
  }
}

// ── El Worker ──────────────────────────────────────────────────────────────

function json(codigo: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo, null, 2), {
    status: codigo,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Resuelve con `respaldo` si la promesa tarda más de `ms`.
 *
 * No cancela el trabajo de fondo a propósito: el contenedor sigue arrancando y
 * la siguiente consulta —la página se refresca sola— probablemente ya lo
 * encuentre listo. Lo que se evita es que quien pregunta se quede esperando.
 */
function conTope<T>(promesa: Promise<T>, ms: number, respaldo: T): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((resolver) => setTimeout(() => resolver(respaldo), ms)),
  ]);
}

/** Un solo contenedor: dos sockets sobre el mismo número se tumban entre sí. */
function instancia(env: Env) {
  return env.WA.get(env.WA.idFromName("unico"));
}

export default {
  /**
   * El cron. Despierta al Durable Object y le pide una vigilancia.
   *
   * No duplica a la vigilancia interna: la respalda. La de adentro es rápida y
   * barata pero depende de que el DO siga en pie; ésta llega desde fuera
   * aunque el DO se haya desalojado y su cadena de alarmas se haya perdido —
   * que es exactamente lo que dejó el canal mudo una noche entera.
   *
   * No lanza: un cron que revienta no deja rastro útil y no hay a quién
   * devolverle el error.
   */
  async scheduled(_evento: ScheduledController, env: Env): Promise<void> {
    if (!env.WA_TOKEN) return;
    try {
      await instancia(env).despertar();
    } catch (e) {
      console.error("cron:", e instanceof Error ? e.message : String(e));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");

    if (!env.WA_TOKEN) return json(500, { error: "Falta el secret WA_TOKEN." });

    if (!autorizado(request, env.WA_TOKEN)) {
      // El 401 se explica a sí mismo. Quien llama ya conoce su propio token, así
      // que devolverle su largo y su huella no le revela nada — y es lo que
      // hace que un error del contenedor llegue legible hasta el diagnóstico en
      // vez de ser un "401" mudo.
      const { via, valor } = tokenPresentado(request);
      return json(401, {
        error: "Token inválido.",
        via,
        presentadoLargo: valor.length,
        presentadoHuella: valor ? huella(valor) : null,
        esperadoLargo: env.WA_TOKEN.length,
      });
    }

    // ── Puente a D1 · lo llama el contenedor, no una persona ────────────────
    if (url.pathname === "/puente/kv") return kv(request, env, url);

    // El MISMO almacén, pero por lotes. No es una optimización: es lo que hace
    // que el canal se pueda vincular. Al emparejar, WhatsApp exige subir 812
    // llaves de un solo uso y Baileys se las entrega al almacén de una sola
    // vez; servirlas de a una son ~1.600 viajes de ida y vuelta contra un plazo
    // de 30 s que Baileys no negocia. Medido en la prueba de humo: 17 por
    // segundo, o sea unos 95 s. Nunca alcanzaba. Ver la bitácora.
    if (url.pathname === "/puente/kv-lote" && request.method === "POST") {
      return kvLote(request, env);
    }

    // ── Mensajes entrantes · del contenedor hacia el CRM ────────────────────
    //
    // El contenedor no conoce al bot: solo conoce este puente. Así el token del
    // CRM no viaja al contenedor y cambiar el destino no obliga a reconstruir
    // la imagen.
    if (url.pathname === "/puente/entrante" && request.method === "POST") {
      const cuerpo = await request.text();
      const peticion = new Request(
        // Con binding el host da igual: se conserva la ruta, que es lo que el
        // bot enruta. Sin binding se usa la URL pública, que solo funciona si
        // el bot vive en OTRA cuenta de Cloudflare.
        env.CRM ? "https://crm/webhooks/whatsapp-qr" : env.CRM_WEBHOOK_URL,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-wa-token": env.WA_TOKEN },
          body: cuerpo,
        },
      );
      const r = env.CRM ? await env.CRM.fetch(peticion) : await fetch(peticion);
      // Se devuelve el resultado tal cual: si el CRM rechaza, el contenedor lo
      // anota y se ve en el estado, en vez de perderse el mensaje en silencio.
      return json(r.ok ? 200 : 502, { ok: r.ok, estadoDelCrm: r.status });
    }

    const stub = instancia(env);

    // ── Lo que consumirá el panel del CRM (Fase 2/3) ────────────────────────

    if (url.pathname === "/api/estado") {
      // El estado NO puede depender de que el contenedor conteste. Con el
      // contenedor frío, el proxy reintenta hasta 12,5 s; si eso bloqueara la
      // respuesta, quien consulta se rinde antes y se queda sin ninguna de las
      // otras dos fuentes —el diario del DO y las credenciales en D1— que sí
      // están disponibles y ya dicen bastante.
      const [delContenedor, delDo, conteos] = await Promise.all([
        conTope(
          stub.fetch(new Request("http://c/estado")).then((r) => r.json()),
          4000,
          { error: "el contenedor no respondió en 4 s (puede estar arrancando)" },
        ).catch((e) => ({ error: String(e) })),
        stub.diario(),
        contarCredenciales(env),
      ]);
      return json(200, {
        contenedor: delContenedor,
        durableObject: delDo,
        credenciales: conteos,
        // El latido se reporta a sí mismo. El 16-sep-2026 la alarma llevaba
        // horas apagada y el panel no tenía forma de decirlo: mostraba el canal
        // como si todo estuviera bien mientras el bot no contestaba. Con esto,
        // un latido vencido se ve ANTES de que alguien descubra el silencio
        // escribiéndole al bot.
        latido: {
          ultimoEn: delDo.ultimoLatidoEn ? new Date(delDo.ultimoLatidoEn).toISOString() : null,
          vencido: latidoVencido(delDo.ultimoLatidoEn, Date.now()),
          desconectadoSeguidos: delDo.desconectadoSeguidos,
          reiniciosForzados: delDo.reiniciosForzados,
          ultimaConexionVista: delDo.ultimaConexionVista,
          ultimoFallo: delDo.ultimoFalloDelLatido,
        },
        token: {
          largo: env.WA_TOKEN.length,
          huella: huella(env.WA_TOKEN),
          apto: tokenEsApto(env.WA_TOKEN),
        },
      });
    }

    if (url.pathname === "/api/qr") {
      // Con tope por lo mismo: el QR es opcional —puede no haberlo— y no debe
      // dejar colgada la pantalla que lo muestra.
      return conTope(
        stub.fetch(new Request("http://c/qr")),
        4000,
        json(202, { qr: null, estado: "arrancando" }),
      );
    }

    if (url.pathname === "/api/enviar" && request.method === "POST") {
      return stub.fetch(
        new Request("http://c/enviar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: await request.text(),
        }),
      );
    }

    if (url.pathname === "/api/desvincular" && request.method === "POST") {
      return stub.fetch(new Request("http://c/logout", { method: "POST" }));
    }

    if (url.pathname === "/api/reiniciar" && request.method === "POST") {
      const diario = await stub.matar();
      return json(200, {
        ok: true,
        mensaje: "Contenedor reiniciado. Vuelve en menos de un minuto y no debe pedir QR.",
        diario,
      });
    }

    // ── Poda de pre-keys ────────────────────────────────────────────────────
    //
    // A propósito NO es automática. Las pre-keys son material criptográfico:
    // borrar una que todavía haga falta rompe el descifrado de un mensaje
    // pendiente. Baileys ya elimina las que usa; lo que se acumula viene de
    // reconexiones repetidas, que es un síntoma, no la causa.
    //
    // Esto es una válvula de seguridad, conservadora: deja las más recientes y
    // reporta cuántas quitó.
    if (url.pathname === "/api/podar" && request.method === "POST") {
      const r = await env.DB.prepare(
        `DELETE FROM wa_auth
          WHERE clave LIKE 'pre-key-%'
            AND clave NOT IN (
              SELECT clave FROM wa_auth
               WHERE clave LIKE 'pre-key-%'
               ORDER BY actualizado_en DESC
               LIMIT ?
            )`,
      )
        .bind(PRE_KEYS_A_CONSERVAR)
        .run();
      return json(200, {
        ok: true,
        borradas: r.meta.changes ?? 0,
        conservadas: PRE_KEYS_A_CONSERVAR,
      });
    }

    return json(404, { error: "no existe" });
  },
};

/**
 * Lee y escribe MUCHAS claves en una sola petición.
 *
 * Nació de un fallo concreto: con el almacén de a una clave por petición, el
 * emparejamiento nunca terminaba. Baileys sube 812 llaves de un solo uso al
 * vincular, las entrega en una sola llamada al almacén y luego las relee todas;
 * de a una eso son ~1.600 viajes, y Baileys corta a los 30 s. Medido: 17 por
 * segundo. No llegaba ni a la mitad.
 *
 * Los valores viajan como texto JSON ya serializado. El puente NO los
 * interpreta: Baileys serializa sus Buffer con un reviver propio y volver a
 * parsear aquí solo abriría la puerta a corromperlos.
 */
async function kvLote(request: Request, env: Env): Promise<Response> {
  let cuerpo: { leer?: string[]; escribir?: Record<string, string>; borrar?: string[] };
  try {
    cuerpo = await request.json();
  } catch {
    return json(400, { error: "El cuerpo no es JSON." });
  }

  const valores: Record<string, string | null> = {};

  if (cuerpo.leer?.length) {
    for (const grupo of pedazos(cuerpo.leer, FILAS_POR_IDA)) {
      const huecos = grupo.map(() => "?").join(",");
      const { results } = await env.DB.prepare(
        `SELECT clave, valor FROM wa_auth WHERE clave IN (${huecos})`,
      )
        .bind(...grupo)
        .all<{ clave: string; valor: string }>();
      for (const fila of results) valores[fila.clave] = fila.valor;
    }
    // Las que no existen se devuelven como null EXPLÍCITO. Baileys distingue
    // "no la tengo" de "no pregunté", y omitirlas confundiría las dos.
    for (const clave of cuerpo.leer) if (!(clave in valores)) valores[clave] = null;
  }

  let escritas = 0;
  let borradas = 0;

  const paresEscribir = Object.entries(cuerpo.escribir ?? {});
  if (paresEscribir.length) {
    const ahora = Date.now();
    for (const grupo of pedazos(paresEscribir, FILAS_POR_IDA)) {
      await env.DB.batch(
        grupo.map(([clave, valor]) =>
          env.DB.prepare(
            `INSERT INTO wa_auth (clave, valor, actualizado_en) VALUES (?, ?, ?)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
          ).bind(clave, valor, ahora),
        ),
      );
      escritas += grupo.length;
    }
  }

  if (cuerpo.borrar?.length) {
    for (const grupo of pedazos(cuerpo.borrar, FILAS_POR_IDA)) {
      const huecos = grupo.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM wa_auth WHERE clave IN (${huecos})`)
        .bind(...grupo)
        .run();
      borradas += grupo.length;
    }
  }

  return json(200, { ok: true, leidas: Object.keys(valores).length, escritas, borradas, valores });
}

async function kv(request: Request, env: Env, url: URL): Promise<Response> {
  const clave = url.searchParams.get("clave");
  if (!clave) return json(400, { error: "Falta ?clave=" });

  if (request.method === "GET") {
    const fila = await env.DB.prepare("SELECT valor FROM wa_auth WHERE clave = ?")
      .bind(clave)
      .first<{ valor: string }>();
    if (!fila) return new Response("no existe", { status: 404 });
    return new Response(fila.valor, { headers: { "content-type": "application/json" } });
  }

  if (request.method === "PUT") {
    await env.DB.prepare(
      `INSERT INTO wa_auth (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
      .bind(clave, await request.text(), Date.now())
      .run();
    return json(200, { ok: true });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM wa_auth WHERE clave = ?").bind(clave).run();
    return json(200, { ok: true });
  }

  return json(405, { error: "método no permitido" });
}

/**
 * Cuántas credenciales hay y de cuándo. Es el mejor testigo externo de que el
 * canal está vivo: `creds` con fecha reciente y filas `lid-mapping` significan
 * socket abierto y autenticado, y se leen desde fuera sin tocar el contenedor.
 */
async function contarCredenciales(env: Env) {
  const filas = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN clave LIKE 'pre-key-%' THEN 1 ELSE 0 END) AS preKeys,
       MAX(CASE WHEN clave = 'creds' THEN actualizado_en END) AS credsEn
     FROM wa_auth`,
  ).first<{ total: number; preKeys: number; credsEn: number | null }>();

  return {
    total: filas?.total ?? 0,
    preKeys: filas?.preKeys ?? 0,
    credsActualizadaEn: filas?.credsEn ? new Date(filas.credsEn).toISOString() : null,
    vinculado: Boolean(filas?.credsEn),
  };
}
