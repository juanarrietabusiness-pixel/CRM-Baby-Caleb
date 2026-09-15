// Baileys dentro de un contenedor de Cloudflare — el lado que sostiene el socket.
//
// El protocolo de WhatsApp Web no tiene webhooks: si nadie sostiene la conexión,
// los mensajes no llegan. Por eso esto es un contenedor y no un Worker.
//
// La diferencia de fondo contra la versión que corre en Railway es dónde viven
// las credenciales: aquí NO tocan el disco, porque el disco del contenedor es
// descartable. Van a D1 a través del Worker puente. Está medido: se destruyó el
// contenedor y volvió autenticado sin pedir QR.
//
// Cada `try` de este archivo tiene un incidente detrás. Ver
// docs/bitacora-whatsapp-qr.md antes de "simplificar" alguno.

import http from "node:http";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";

const PUERTO = Number(process.env.PORT || 8080);
const PUENTE = process.env.PUENTE_URL;
const TOKEN = process.env.PUENTE_TOKEN;
const SILENCIO = pino({ level: "silent" });

if (!PUENTE || !TOKEN) {
  console.error("Faltan PUENTE_URL o PUENTE_TOKEN — sin ellos no hay dónde guardar la sesión.");
  process.exit(1);
}

// ── Estado observable ──────────────────────────────────────────────────────

const estado = {
  conexion: "arrancando", // arrancando | esperando-qr | conectada | cerrada | desvinculada
  arrancadoEn: new Date().toISOString(),
  vinculadoComo: null,
  reconexiones: 0,
  mensajesRecibidos: 0,
  mensajesEnviados: 0,
  ultimoError: null,
  credencialesVenianDeD1: false,
  // Diagnóstico del puente. Nunca el token: solo su largo y su huella, que
  // alcanzan para comparar los dos lados sin exponer el secreto.
  puenteUrl: PUENTE,
  tokenLargo: TOKEN.length,
  tokenHuella: huella(TOKEN),
};

/** Mismo algoritmo que `puente-wa/src/comun.ts`. Si difiere, no sirve. */
function huella(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

let qrActual = null;

// ── Que un error no mate el proceso ────────────────────────────────────────
//
// No es cosmético: fue el fallo que convirtió un 401 recuperable en un ciclo de
// caídas. Una promesa rechazada sin capturar mata el proceso en Node 22; el
// contenedor moría, la alarma lo relevantaba, volvía a morir, y Cloudflare dejó
// de entregar instancias. Un contenedor que se cae no deja ver por qué se cayó.

process.on("unhandledRejection", (e) => {
  estado.ultimoError = `promesa sin capturar: ${e?.message ?? e}`;
  console.error("unhandledRejection:", e);
});

process.on("uncaughtException", (e) => {
  estado.ultimoError = `excepción sin capturar: ${e?.message ?? e}`;
  console.error("uncaughtException:", e);
});

// ── El puente ──────────────────────────────────────────────────────────────

// El token viaja en base64, nunca en claro. Node escribe el valor de una
// cabecera en latin-1 y el runtime de Cloudflare lo lee como UTF-8: un carácter
// fuera de ASCII llega convertido en el de reemplazo, uno por uno, así que el
// largo NO cambia y el 401 no delata nada. Medido: huella 1im7 en ambos lados y
// 1mxu en lo que llegaba.
const TOKEN_B64 = Buffer.from(TOKEN, "utf8").toString("base64");

async function puente(ruta, init = {}) {
  return fetch(`${PUENTE}${ruta}`, {
    ...init,
    headers: { ...(init.headers || {}), "x-wa-token-b64": TOKEN_B64 },
  });
}

/** El cuerpo del error, recortado. El Worker explica ahí por qué rechazó. */
async function porQue(r) {
  try {
    return (await r.text()).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return "";
  }
}

async function kvGet(clave) {
  const r = await puente(`/puente/kv?clave=${encodeURIComponent(clave)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kvGet(${clave}) → ${r.status} · ${await porQue(r)}`);
  return JSON.parse(await r.text(), BufferJSON.reviver);
}

async function kvSet(clave, valor) {
  const r = await puente(`/puente/kv?clave=${encodeURIComponent(clave)}`, {
    method: "PUT",
    body: JSON.stringify(valor, BufferJSON.replacer),
  });
  if (!r.ok) throw new Error(`kvSet(${clave}) → ${r.status} · ${await porQue(r)}`);
}

async function kvDel(clave) {
  await puente(`/puente/kv?clave=${encodeURIComponent(clave)}`, { method: "DELETE" });
}

/**
 * El almacén POR LOTES. Una petición, muchas claves.
 *
 * Esto no es una optimización: es lo que hace que el canal se pueda vincular.
 * Al emparejar, WhatsApp exige subir 812 llaves de un solo uso; Baileys las
 * entrega al almacén en UNA llamada y enseguida las relee todas. Sirviéndolas
 * de a una son ~1.600 viajes al puente, y Baileys corta la operación a los 30 s
 * (UPLOAD_TIMEOUT). Medido contra D1: 17 escrituras por segundo, o sea ~95 s.
 * El emparejamiento moría a mitad de camino y el teléfono quedaba vinculado
 * contra un dispositivo que nunca terminó de instalarse.
 *
 * Los valores viajan ya serializados con el replacer de Baileys, que es quien
 * sabe convertir sus Buffer. El puente los guarda como texto sin mirarlos.
 */
async function kvLote({ leer, escribir, borrar }) {
  const r = await puente("/puente/kv-lote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leer, escribir, borrar }),
  });
  if (!r.ok) throw new Error(`kvLote → ${r.status} · ${await porQue(r)}`);
  return r.json();
}

/**
 * El equivalente de `useMultiFileAuthState`, pero contra D1.
 *
 * Baileys guarda dos cosas: `creds`, que es la identidad del dispositivo
 * vinculado, y las llaves de sesión de Signal. Mientras `creds` sobreviva, no
 * hay QR nuevo — es exactamente lo que hace viable este canal.
 */
async function useD1AuthState() {
  const guardadas = await kvGet("creds");
  const creds = guardadas || initAuthCreds();
  estado.credencialesVenianDeD1 = Boolean(guardadas);

  return {
    state: {
      creds,
      keys: {
        // Una sola petición para TODAS las ids. Baileys pide de a cientos.
        get: async (tipo, ids) => {
          const salida = {};
          if (!ids.length) return salida;

          const { valores } = await kvLote({ leer: ids.map((id) => `${tipo}-${id}`) });

          for (const id of ids) {
            const crudo = valores[`${tipo}-${id}`];
            if (crudo == null) {
              salida[id] = null;
              continue;
            }
            // El reviver de Baileys es el que reconstruye sus Buffer. El puente
            // devuelve el texto tal como se guardó, sin interpretarlo.
            let valor = JSON.parse(crudo, BufferJSON.reviver);
            // Caso especial documentado por Baileys: esta llave tiene que
            // volver como mensaje de protobuf, no como objeto pelado.
            if (tipo === "app-state-sync-key" && valor) {
              valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            }
            salida[id] = valor;
          }
          return salida;
        },
        // Idem al escribir: el lote entero en una petición. Es el camino por el
        // que pasan las 812 llaves del emparejamiento.
        set: async (datos) => {
          const escribir = {};
          const borrar = [];
          for (const tipo in datos) {
            for (const id in datos[tipo]) {
              const valor = datos[tipo][id];
              const clave = `${tipo}-${id}`;
              if (valor) escribir[clave] = JSON.stringify(valor, BufferJSON.replacer);
              else borrar.push(clave);
            }
          }
          if (!Object.keys(escribir).length && !borrar.length) return;
          await kvLote({ escribir, borrar });
        },
      },
    },
    saveCreds: () => kvSet("creds", creds),
  };
}

// ── El socket ──────────────────────────────────────────────────────────────

let socket = null;
let generacion = 0;
let reconexionProgramada = false;
let intentosReconexion = 0;

/**
 * Cierra el socket anterior ANTES de abrir otro.
 *
 * Sin esto se arma una tormenta que se alimenta sola: WhatsApp admite una sola
 * conexión por dispositivo vinculado, así que el socket nuevo expulsa al viejo,
 * el viejo dispara su `close`, ese `close` programa otra reconexión, y la
 * siguiente expulsa a la nueva. La conexión nunca se asienta.
 *
 * Quitarle los listeners es igual de importante: un socket muerto sigue
 * emitiendo eventos que pisan el estado compartido.
 */
function cerrarAnterior() {
  if (!socket) return;
  try {
    socket.ev.removeAllListeners();
  } catch {}
  try {
    socket.end(undefined);
  } catch {}
  socket = null;
}

async function conectar() {
  cerrarAnterior();
  const mia = ++generacion;

  const { state, saveCreds } = await useD1AuthState();

  // Consultar la versión del protocolo es una comodidad, NO un requisito:
  // Baileys trae una por defecto. Sin este `try` se vuelve un punto único de
  // fallo — si ese host no responde, la sesión ni se intenta aunque WhatsApp
  // esté perfectamente alcanzable. Pasó: "fetch failed" con las credenciales ya
  // leídas de D1.
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (e) {
    console.error("Versión no consultada; se usa la de la librería:", e.message);
    estado.avisoVersion = `sin consultar (${e.message})`;
  }

  const s = makeWASocket({
    version,
    auth: state,
    logger: SILENCIO,
    // Este nombre NO es decorativo: es lo que la dueña ve en su teléfono, en
    // Dispositivos vinculados, al lado del botón de cerrar sesión. Tiene que
    // decirle algo a ella — si dijera el nombre de la agencia o el del Worker,
    // el dispositivo parecería ajeno y el impulso sensato sería desvincularlo.
    browser: ["Baby Caleb", "Chrome", "3.0"],
    syncFullHistory: false,
  });
  socket = s;

  /** Un socket viejo que todavía emite eventos no tiene voz. */
  const vigente = () => mia === generacion;

  s.ev.on("creds.update", () => {
    if (!vigente()) return;
    saveCreds().catch((e) => {
      estado.ultimoError = `saveCreds: ${e.message}`;
      console.error("saveCreds falló:", e.message);
    });
  });

  s.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (!vigente()) return;

    if (qr) {
      estado.conexion = "esperando-qr";
      qrActual = await QRCode.toDataURL(qr, { width: 512, margin: 2 });
      console.log("QR nuevo disponible.");
    }

    if (connection === "open") {
      estado.conexion = "conectada";
      estado.vinculadoComo = s.user?.id ?? null;
      estado.ultimoError = null;
      intentosReconexion = 0;
      qrActual = null; // ya no sirve, y servirlo sería un riesgo
      console.log(`Conectada como ${estado.vinculadoComo}`);
    }

    if (connection === "close") {
      const causa =
        lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0;
      estado.conexion = "cerrada";
      estado.ultimoError = `cierre ${causa}`;

      if (causa === DisconnectReason.loggedOut) {
        // El teléfono desvinculó el dispositivo. Las credenciales ya no valen, y
        // NO se reconecta: sin sesión, insistir solo genera un QR tras otro.
        console.log("Sesión cerrada desde el teléfono. Limpiando credenciales.");
        await kvDel("creds").catch(() => {});
        estado.vinculadoComo = null;
        estado.conexion = "desvinculada";
        return;
      }

      if (reconexionProgramada) return;
      reconexionProgramada = true;
      estado.reconexiones += 1;

      // 515 (restartRequired) es el reinicio que WhatsApp pide tras vincular: es
      // esperado y se atiende de inmediato. Lo demás espera cada vez más.
      intentosReconexion =
        causa === DisconnectReason.restartRequired ? 0 : intentosReconexion + 1;
      const espera =
        intentosReconexion === 0 ? 1000 : Math.min(3000 * 2 ** (intentosReconexion - 1), 60000);
      console.log(`Reconectando en ${espera} ms (cierre ${causa}).`);

      setTimeout(() => {
        reconexionProgramada = false;
        conectar().catch((e) => {
          estado.ultimoError = `reconectar: ${e.message}`;
          console.error("Fallo al reconectar:", e.message);
        });
      }, espera);
    }
  });

  // Los mensajes entrantes se reenvían al puente, que los pasa al CRM. El
  // contenedor no conoce al bot: así el token del CRM no viaja hasta aquí.
  s.ev.on("messages.upsert", ({ messages, type }) => {
    if (!vigente() || type !== "notify") return;
    for (const msg of messages) {
      if (msg.key?.fromMe) continue;
      estado.mensajesRecibidos += 1;
      reenviar(msg).catch((e) => {
        estado.ultimoError = `reenviar: ${e.message}`;
        console.error("No se pudo reenviar un mensaje:", e.message);
      });
    }
  });
}

/** Manda el mensaje entrante al puente. Un fallo aquí se anota, no se traga. */
async function reenviar(msg) {
  const r = await puente("/puente/entrante", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      de: msg.key?.remoteJid ?? null,
      nombre: msg.pushName ?? null,
      texto:
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        null,
      tipo: Object.keys(msg.message ?? {})[0] ?? null,
      recibidoEn: Date.now(),
      crudo: msg,
    }),
  });
  if (!r.ok) throw new Error(`entrante → ${r.status} · ${await porQue(r)}`);
}

// ── HTTP interno, el que el Worker consulta ────────────────────────────────

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://contenedor");
  const json = (codigo, cuerpo) => {
    res.writeHead(codigo, { "content-type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };

  if (url.pathname === "/estado") return json(200, estado);

  // El error va incluido a propósito: cuando no hay QR ni conexión, el error ES
  // la información, y obligar a abrir otra ruta para verlo es esconderlo justo
  // cuando importa.
  if (url.pathname === "/qr") {
    return json(200, { qr: qrActual, estado: estado.conexion, ultimoError: estado.ultimoError });
  }

  if (url.pathname === "/enviar" && req.method === "POST") {
    try {
      const cuerpo = JSON.parse(await leer(req));
      if (!cuerpo?.para || !Array.isArray(cuerpo.chunks)) {
        return json(400, { error: "Se esperaba { para, chunks: [] }" });
      }
      if (estado.conexion !== "conectada") {
        return json(409, { error: "No hay conexión con WhatsApp.", estado: estado.conexion });
      }
      for (let i = 0; i < cuerpo.chunks.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, cuerpo.esperaMs ?? 1000));
        await socket.sendMessage(cuerpo.para, { text: String(cuerpo.chunks[i]) });
        estado.mensajesEnviados += 1;
      }
      return json(200, { ok: true, enviados: cuerpo.chunks.length });
    } catch (e) {
      estado.ultimoError = `enviar: ${e.message}`;
      return json(500, { error: e.message });
    }
  }

  if (url.pathname === "/logout" && req.method === "POST") {
    try {
      await socket?.logout();
    } catch {}
    await kvDel("creds").catch(() => {});
    estado.conexion = "desvinculada";
    estado.vinculadoComo = null;
    return json(200, { ok: true });
  }

  json(404, { error: "no existe" });
});

function leer(req) {
  return new Promise((resolver, rechazar) => {
    let datos = "";
    req.on("data", (trozo) => (datos += trozo));
    req.on("end", () => resolver(datos));
    req.on("error", rechazar);
  });
}

servidor.listen(PUERTO, () => console.log(`Servidor interno en :${PUERTO}`));

// Arranque con reintentos y espera creciente. Si el puente está caído no sirve
// reintentar cada segundo: se castiga al Worker y no se arregla nada. El proceso
// SIGUE EN PIE, que es lo que permite leer el error desde fuera.
let intentos = 0;

(async function arrancar() {
  for (;;) {
    try {
      await conectar();
      intentos = 0;
      return;
    } catch (e) {
      intentos += 1;
      estado.ultimoError = `${e.message} (intento ${intentos})`;
      console.error(`No se pudo arrancar (intento ${intentos}):`, e.message);
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (intentos - 1), 60000)));
    }
  }
})();
