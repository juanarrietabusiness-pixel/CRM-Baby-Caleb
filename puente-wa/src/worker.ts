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
  FILAS_POR_IDA,
  LATIDO_MS,
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
}

export class PuenteWa extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container) {
      return json(500, { error: "Este Worker no tiene contenedor configurado." });
    }
    await this.#asegurarEncendido();

    const url = new URL(request.url);
    const destino = `http://contenedor${url.pathname}${url.search}`;
    const puerto = this.ctx.container.getTcpPort(PUERTO_CONTENEDOR);

    // Con tope de tiempo por intento. Sin él, un contenedor que acepta la
    // conexión pero no contesta deja la petición colgada — y entonces la propia
    // pantalla de diagnóstico se cuelga, justo cuando más falta hace.
    let ultimoFallo = "";
    for (let intento = 0; intento < 5; intento++) {
      try {
        const respuesta = await puerto.fetch(destino, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          signal: AbortSignal.timeout(2500),
        });
        await this.#marcarSano();
        return respuesta;
      } catch (e) {
        ultimoFallo = e instanceof Error ? e.message : String(e);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return json(503, { error: "El contenedor no respondió a tiempo.", detalle: ultimoFallo });
  }

  /** Lo destruye. Al volver debe reconectar desde D1, sin QR. */
  async matar(): Promise<Diario> {
    const diario = await this.#diario();
    diario.ultimaMuerteVista = new Date().toISOString();
    await this.ctx.storage.put("diario", diario);
    this.ctx.container?.destroy("reinicio pedido desde el panel");
    return diario;
  }

  async diario(): Promise<Diario> {
    return this.#diario();
  }

  /**
   * El latido. Mantiene vivo al Durable Object —y con él al contenedor— y lo
   * vuelve a levantar si se cayó.
   */
  async alarm(): Promise<void> {
    const diario = await this.#diario();
    diario.latidos += 1;

    if (this.ctx.container && !this.ctx.container.running) {
      diario.ultimaMuerteVista = new Date().toISOString();
      diario.fallosSeguidos += 1;
      await this.ctx.storage.put("diario", diario);
      await this.#encender();
    } else {
      diario.fallosSeguidos = 0;
      await this.ctx.storage.put("diario", diario);
    }

    await this.ctx.storage.setAlarm(Date.now() + proximoLatido(diario.fallosSeguidos));
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
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + LATIDO_MS);
    }
  }

  async #encender(): Promise<void> {
    const diario = await this.#diario();
    diario.arranquesContenedor += 1;
    diario.ultimoArranque = new Date().toISOString();
    await this.ctx.storage.put("diario", diario);

    this.ctx.container!.start({
      env: {
        PORT: String(PUERTO_CONTENEDOR),
        PUENTE_URL: this.env.PUENTE_BASE_URL,
        PUENTE_TOKEN: this.env.WA_TOKEN,
      },
      // Baileys tiene que salir a wss://web.whatsapp.com.
      enableInternet: true,
    });
  }

  async #diario(): Promise<Diario> {
    const guardado = await this.ctx.storage.get<Diario>("diario");
    if (!guardado) {
      return {
        arrancadoEn: new Date().toISOString(),
        latidos: 0,
        arranquesContenedor: 0,
        ultimoArranque: null,
        ultimaMuerteVista: null,
        fallosSeguidos: 0,
      };
    }
    // Un diario escrito por una versión anterior no trae el campo. Sin este
    // `?? 0`, el primer `+= 1` daría NaN y `setAlarm(NaN)` dejaría al
    // contenedor sin latido para siempre — un fallo mudo justo en la pieza que
    // existe para recuperarse de fallos.
    return { ...guardado, fallosSeguidos: guardado.fallosSeguidos ?? 0 };
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
