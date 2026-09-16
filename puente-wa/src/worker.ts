// Puente de WhatsApp por QR — `juancitoads-bot-wa`.
//
// Worker APARTE del bot, a propósito. El bot se despliega con un solo
// `wrangler deploy`: si el contenedor se le colgara encima, una imagen que no
// construye bloquearía publicar un cambio de la base de conocimiento. Aquí, lo
// peor que pasa es que WhatsApp se cae y el bot sigue publicándose.
//
// Tres trabajos:
//   1. Sostener el contenedor prendido (alarma) y dejarlo observable.
//   2. Hacer de puente a D1 — el contenedor no tiene bindings, así que guarda
//      sus credenciales llamando aquí por HTTPS con un token.
//   3. Pasar los mensajes: los entrantes hacia el webhook del CRM, los
//      salientes hacia el contenedor.
//
// No usa `@cloudflare/containers`: la API cruda de `ctx.container` alcanza y
// evita una dependencia más en la ruta crítica de un canal de producción.

import { DurableObject } from "cloudflare:workers";
import {
  autorizado,
  huella,
  pedazos,
  proximoLatido,
  tokenEsApto,
  tokenPresentado,
  veredictoDeSalud,
  latidoVencido,
  puedeArrancar,
  contraElContenedor,
  FILAS_POR_IDA,
  LATIDO_MS,
  LATIDOS_ANTES_DE_REINICIAR,
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

/**
 * Lo mínimo entre dos `container.start()`.
 *
 * Existe por el fallo del 16-sep-2026 en Baby Caleb: 16 arranques en 17
 * minutos con `max_instances = 1`, y el QR nunca llegaba a servir para nada.
 *
 * La causa era el propio panel. `#asegurarEncendido()` corre en CADA petición
 * al Durable Object, y la tarjeta se refresca cada 5 s pidiendo dos cosas
 * —estado y QR—. Mientras el contenedor arranca, `running` sigue en false
 * durante varios segundos, así que cada refresco volvía a llamar a `start()`.
 * El panel se reiniciaba el contenedor a sí mismo en bucle y Baileys nunca
 * alcanzaba a asentar la sesión: el teléfono escaneaba un código cuyo socket
 * ya no existía y WhatsApp respondía "Revisa tu conexión y vuelve a
 * intentarlo", culpando a la red del dueño.
 *
 * 15 s es más que el arranque de la imagen y mucho más que el refresco del
 * panel, así que un arranque en curso ya no se pisa a sí mismo.
 */
const ARRANQUE_MIN_MS = 15_000;

interface Diario {
  arrancadoEn: string;
  latidos: number;
  arranquesContenedor: number;
  ultimoArranque: string | null;
  ultimaMuerteVista: string | null;
  fallosSeguidos: number;
  /**
   * Cuándo latió por última vez. Es la señal que faltaba el 16-sep-2026: la
   * alarma se había apagado y NADA lo decía — el panel mostraba el canal como
   * si todo estuviera bien mientras llevaba horas mudo.
   */
  ultimoLatidoEn: number | null;
  /** Latidos seguidos con el contenedor prendido pero WhatsApp desconectado. */
  desconectadoSeguidos: number;
  /** La última vez que se vio el socket de WhatsApp realmente abierto. */
  ultimaConexionVista: string | null;
  /** Cuántas veces el latido tuvo que destruir el contenedor para recuperarlo. */
  reiniciosForzados: number;
  /** Lo último que impidió latir, si algo lo impidió. */
  ultimoFalloDelLatido: string | null;
}

export class PuenteWa extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container) {
      return json(500, { error: "Este Worker no tiene contenedor configurado." });
    }
    await this.#asegurarEncendido();

    const url = new URL(request.url);
    const destino = `http://contenedor${url.pathname}${url.search}`;

    // El cuerpo se lee UNA vez, aquí, y se reutiliza en cada intento.
    //
    // Antes se pasaba `request.body` —un ReadableStream— dentro del bucle. El
    // primer intento lo consume y los demás revientan con "This ReadableStream
    // is disturbed", así que de los cinco reintentos solo existía el primero
    // para cualquier POST. Y los reintentos son justamente lo que salva a un
    // contenedor frío: con el panel abierto acertaba el primero y todo parecía
    // bien; con el panel cerrado se perdía la respuesta del bot con un 503.
    const sinCuerpo = request.method === "GET" || request.method === "HEAD";
    const cuerpo = sinCuerpo ? undefined : await request.arrayBuffer();

    // Con tope de tiempo por intento. Sin él, un contenedor que acepta la
    // conexión pero no contesta deja la petición colgada — y entonces la propia
    // pantalla de diagnóstico se cuelga, justo cuando más falta hace.
    const { respuesta, ultimoFallo } = await contraElContenedor(
      (datos, topeMs) =>
        this.#alContenedor(
          destino,
          { method: request.method, headers: request.headers, body: datos },
          topeMs,
        ),
      cuerpo,
      { intentos: 5, esperaMs: 500, dormir: (ms) => new Promise((r) => setTimeout(r, ms)) },
    );

    if (respuesta) {
      await this.#marcarSano();
      return respuesta;
    }
    return json(503, { error: "El contenedor no respondió a tiempo.", detalle: ultimoFallo });
  }

  /** Lo destruye. Al volver debe reconectar desde D1, sin QR. */
  async matar(): Promise<Diario> {
    const diario = await this.#diario();
    diario.ultimaMuerteVista = new Date().toISOString();
    await this.ctx.storage.put("diario", diario);
    try {
      this.ctx.container?.destroy("reinicio pedido desde el panel");
    } catch {
      // Destruir algo que ya no existe no es un error que valga propagar.
    }
    // El reinicio a mano también re-arma el latido: si la alarma se había
    // perdido, el botón del panel la devuelve sin que nadie tenga que saberlo.
    await this.#asegurarAlarma(LATIDO_MS);
    return diario;
  }

  async diario(): Promise<Diario> {
    return this.#diario();
  }

  /**
   * El latido. Mantiene vivo al Durable Object —y con él al contenedor— y lo
   * vuelve a levantar si se cayó.
   *
   * ESTE MÉTODO NO PUEDE LANZAR, y el orden de sus dos mitades no es
   * cosmético. `setAlarm` va PRIMERO, antes de cualquier cosa que pueda
   * fallar, y el trabajo va entero dentro de un `try`.
   *
   * El 16-sep-2026 el canal se quedó mudo una noche entera por no hacerlo así.
   * `alarm()` es lo único que programa la alarma siguiente, y `setAlarm` era la
   * ÚLTIMA línea: bastaba con que `container.start()` lanzara —"ya está
   * corriendo" en una carrera contra el panel, o "There is no container
   * instance that can be provided to this Durable Object"— para que la línea
   * nunca se ejecutara. Cloudflare reintenta una alarma que lanza unas pocas
   * veces y después se rinde. Sin alarma no hay alarma siguiente: la cadena se
   * corta y el único camino de vuelta es una petición entrante, o sea que
   * alguien abra el panel. Eso fue exactamente lo que pasó.
   */
  async alarm(): Promise<void> {
    // 1) Re-armar ANTES que nada. Con el retroceso del estado anterior, que
    //    puede quedar un latido desfasado — es un precio ridículo comparado con
    //    quedarse sin latido para siempre.
    const previo = await this.#diario().catch(() => null);
    await this.#programarSiguiente(previo?.fallosSeguidos ?? 0);

    // 2) El trabajo. Si algo aquí lanza se anota y se sigue: la alarma ya está
    //    puesta y el siguiente latido lo volverá a intentar.
    try {
      await this.#latir();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error("latido:", motivo);
      try {
        const diario = await this.#diario();
        diario.ultimoFalloDelLatido = motivo;
        await this.ctx.storage.put("diario", diario);
      } catch {
        // Si ni siquiera se puede anotar el fallo, no se insiste: lo que
        // importa —la alarma siguiente— ya quedó programado arriba.
      }
    }
  }

  /**
   * Un latido: ¿está prendido el contenedor, y está WhatsApp conectado?
   *
   * Las DOS preguntas, no solo la primera. La versión anterior se conformaba
   * con `container.running` y daba por sano un contenedor prendido con el
   * socket de Baileys muerto. El propio código ya sabía que `running` miente
   * —lo dice el comentario de `#marcarSano()`— y aun así lo usaba para decidir.
   */
  async #latir(): Promise<void> {
    const diario = await this.#diario();
    diario.latidos += 1;
    diario.ultimoLatidoEn = Date.now();
    diario.ultimoFalloDelLatido = null;

    // ── Primera pregunta: ¿hay proceso? ────────────────────────────────────
    if (!this.ctx.container || !this.ctx.container.running) {
      diario.ultimaMuerteVista = new Date().toISOString();
      diario.fallosSeguidos += 1;
      diario.desconectadoSeguidos = 0;
      await this.ctx.storage.put("diario", diario);
      await this.#encender();
      await this.#programarSiguiente(diario.fallosSeguidos);
      return;
    }

    diario.fallosSeguidos = 0;

    // ── Segunda pregunta: ¿hay WhatsApp? ───────────────────────────────────
    const conexion = await this.#conexionDelContenedor();
    const veredicto = veredictoDeSalud(conexion);

    if (veredicto === "sano") {
      diario.desconectadoSeguidos = 0;
      diario.ultimaConexionVista = new Date().toISOString();
      await this.ctx.storage.put("diario", diario);
      await this.#programarSiguiente(0);
      return;
    }

    if (veredicto === "esperando-a-una-persona") {
      // Sin vincular o esperando el QR. No es un fallo y NO se reinicia:
      // reiniciar aquí genera un código nuevo y le tumba al dueño el que está
      // mirando en la pantalla.
      diario.desconectadoSeguidos = 0;
      await this.ctx.storage.put("diario", diario);
      await this.#programarSiguiente(0);
      return;
    }

    // ── Caído: prendido pero mudo. Esto es lo que antes pasaba inadvertido ──
    diario.desconectadoSeguidos += 1;

    if (diario.desconectadoSeguidos >= LATIDOS_ANTES_DE_REINICIAR) {
      // El martillo. Sale gratis en credenciales —viven en D1, está medido— y
      // cuesta una resincronización. Después de cinco minutos mudo, vale.
      diario.reiniciosForzados += 1;
      diario.desconectadoSeguidos = 0;
      diario.ultimaMuerteVista = new Date().toISOString();
      await this.ctx.storage.put("diario", diario);
      try {
        this.ctx.container.destroy("el canal llevaba minutos sin conexión a WhatsApp");
      } catch (e) {
        console.error("no se pudo destruir el contenedor:", e);
      }
      await this.#programarSiguiente(0);
      return;
    }

    // Lo barato primero: pedirle al contenedor que reconecte. Es idempotente y
    // no cuesta nada si ya lo estaba intentando.
    await this.ctx.storage.put("diario", diario);
    await this.#pedirReconexion();
    await this.#programarSiguiente(0);
  }

  /** Qué dice el contenedor de sí mismo. `null` si no contesta. */
  async #conexionDelContenedor(): Promise<string | null> {
    try {
      const r = await this.#alContenedor("http://contenedor/estado", { method: "GET" }, 5000);
      if (!r.ok) return null;
      const cuerpo = (await r.json()) as { conexion?: string };
      return cuerpo.conexion ?? null;
    } catch {
      // Un contenedor prendido que no contesta ES un contenedor caído, y así se
      // cuenta: `veredictoDeSalud(null)` da "caido".
      return null;
    }
  }

  /** Empuja una reconexión. Un fallo aquí no puede tumbar el latido. */
  async #pedirReconexion(): Promise<void> {
    try {
      await this.#alContenedor("http://contenedor/reconectar", { method: "POST" }, 5000);
    } catch (e) {
      console.error("no se pudo pedir la reconexión:", e);
    }
  }

  /** Una sola ida al contenedor, con tope de tiempo. */
  async #alContenedor(destino: string, init: RequestInit, ms: number): Promise<Response> {
    // `init.body` nunca es un stream: quien llama ya lo materializó. Ver el
    // comentario del cuerpo reutilizable en `fetch()`.
    const puerto = this.ctx.container!.getTcpPort(PUERTO_CONTENEDOR);
    return puerto.fetch(destino, { ...init, signal: AbortSignal.timeout(ms) });
  }

  /**
   * Responder es la ÚNICA señal fiable de salud. `running` se pone en true
   * apenas arranca, antes de que el proceso escuche el puerto.
   */
  async #marcarSano(): Promise<void> {
    const diario = await this.#diario();
    if (diario.fallosSeguidos === 0) return;
    diario.fallosSeguidos = 0;
    await this.ctx.storage.put("diario", diario);
  }

  async #asegurarEncendido(): Promise<void> {
    if (!this.ctx.container!.running) await this.#encender();
    await this.#asegurarAlarma(LATIDO_MS);
  }

  /** Pone la alarma si no hay ninguna. Nunca lanza. */
  async #asegurarAlarma(enMs: number): Promise<void> {
    try {
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + enMs);
      }
    } catch (e) {
      console.error("no se pudo asegurar la alarma:", e);
    }
  }

  /** Programa el siguiente latido. Nunca lanza: es la pieza que no puede faltar. */
  async #programarSiguiente(fallosSeguidos: number): Promise<void> {
    try {
      await this.ctx.storage.setAlarm(Date.now() + proximoLatido(fallosSeguidos));
    } catch (e) {
      console.error("no se pudo programar el latido:", e);
    }
  }

  async #encender(): Promise<void> {
    const diario = await this.#diario();

    // Un arranque ya en camino no se pisa. Sin esto, el refresco del panel
    // reinicia el contenedor cada 5 segundos y nunca termina de levantar.
    if (!puedeArrancar(diario.ultimoArranque, Date.now(), ARRANQUE_MIN_MS)) return;

    diario.arranquesContenedor += 1;
    diario.ultimoArranque = new Date().toISOString();
    await this.ctx.storage.put("diario", diario);

    // Dentro de un try: `start()` lanza si el contenedor YA está corriendo —una
    // carrera contra una petición del panel basta— y también cuando Cloudflare
    // no tiene instancia que entregar. Antes ese throw subía hasta `alarm()` y
    // se llevaba por delante el latido entero. Ver el comentario de `alarm()`.
    try {
      this.ctx.container!.start({
        env: {
          PORT: String(PUERTO_CONTENEDOR),
          PUENTE_URL: this.env.PUENTE_BASE_URL,
          PUENTE_TOKEN: this.env.WA_TOKEN,
        },
        // Baileys tiene que salir a wss://web.whatsapp.com.
        enableInternet: true,
      });
    } catch (e) {
      console.error("no se pudo encender el contenedor:", e);
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
    };
    if (!guardado) return base;
    // Un diario escrito por una versión anterior no trae los campos nuevos. Sin
    // estos respaldos, el primer `+= 1` daría NaN y `setAlarm(NaN)` dejaría al
    // contenedor sin latido para siempre — un fallo mudo justo en la pieza que
    // existe para recuperarse de fallos.
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
