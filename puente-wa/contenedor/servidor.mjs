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
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  initAuthCreds,
  jidNormalizedUser,
  BufferJSON,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import {
  archivoDe,
  crearRegistroDeEnvios,
  esRespuestaDelTelefono as esRespuestaPropiaDePersona,
  textoDe,
  tipoDe,
} from "./propios.mjs";

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
  // Desde cuándo lleva en ese estado. El vigilante lo necesita para no pisarle
  // el trabajo a una reconexión que ya está en marcha.
  conexionDesde: Date.now(),
  arrancadoEn: new Date().toISOString(),
  vinculadoComo: null,
  reconexiones: 0,
  // Lo que el vigilante tuvo que rescatar. Si este número crece, algo más de
  // fondo está mal y conviene mirarlo — no es normal necesitar rescates.
  rescatesDelVigilante: 0,
  ultimaVigilancia: null,
  proximoIntentoEn: null,
  mensajesRecibidos: 0,
  mensajesEnviados: 0,
  // Mensajes que salieron del número del negocio SIN que los mandara el bot:
  // la dueña contestando desde el teléfono. Cada uno pausa esa conversación.
  respuestasDelTelefono: 0,
  // Notas de voz e imágenes descargadas y reenviadas al CRM.
  archivosRecibidos: 0,
  ultimoError: null,
  credencialesVenianDeD1: false,
  // Cuántos códigos se han emitido. Si sube y nadie vincula, el QR de la
  // pantalla se está muriendo antes de que lo escaneen.
  qrGenerados: 0,
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
/** Cuándo se generó el QR que está en memoria, y cuántos van. */
let qrEn = 0;
let qrGenerados = 0;

/**
 * Cuánto vale un QR antes de estar muerto.
 *
 * WhatsApp rota el `ref` del emparejamiento cada ~20 s y lo invalida al minuto.
 * Servir uno vencido no da error: el teléfono lo lee, intenta emparejar contra
 * un `ref` que ya no existe y muestra **"Revisa tu conexión y vuelve a
 * intentarlo"** — un mensaje que culpa a la red del dueño cuando el problema
 * está de este lado. Eso fue exactamente lo que pasó el 16-sep-2026 en Baby
 * Caleb: se escaneaba un código muerto y la base de sesión quedaba en cero.
 *
 * 45 s deja margen para el refresco de 5 s del panel y para que a alguien le dé
 * tiempo de apuntar la cámara.
 */
const QR_VENCE_MS = 45_000;

/** El QR solo si todavía sirve. Uno vencido es peor que ninguno. */
function qrVigente() {
  if (!qrActual) return null;
  if (Date.now() - qrEn > QR_VENCE_MS) {
    qrActual = null;
    return null;
  }
  return qrActual;
}

/**
 * Cambiar de estado por aquí SIEMPRE. `conexionDesde` es lo que le permite al
 * vigilante distinguir "se acaba de caer y ya hay una reconexión en camino" de
 * "lleva minutos caído y nadie va a hacer nada".
 */
function ponerConexion(valor) {
  if (estado.conexion === valor) return;
  estado.conexion = valor;
  estado.conexionDesde = Date.now();
}

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
/** Verdadero mientras el arranque inicial siga reintentando por su cuenta. */
let arrancando = true;

/**
 * Cada cuánto se revisa a sí mismo. Mismo valor que `VIGILANTE_MS` en
 * `puente-wa/src/comun.ts` — el contenedor no comparte build con el Worker, así
 * que la constante se repite. Si cambia allá, cambia aquí.
 */
const VIGILANTE_MS = 30_000;

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
      ponerConexion("esperando-qr");
      qrActual = await QRCode.toDataURL(qr, { width: 512, margin: 2 });
      qrEn = Date.now();
      qrGenerados += 1;
      estado.qrGenerados = qrGenerados;
      console.log(`QR nuevo disponible (#${qrGenerados}).`);
    }

    if (connection === "open") {
      ponerConexion("conectada");
      estado.vinculadoComo = s.user?.id ?? null;
      estado.ultimoError = null;
      intentosReconexion = 0;
      qrActual = null; // ya no sirve, y servirlo sería un riesgo
      console.log(`Conectada como ${estado.vinculadoComo}`);
    }

    if (connection === "close") {
      const causa =
        lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0;
      ponerConexion("cerrada");
      estado.ultimoError = `cierre ${causa}`;

      if (causa === DisconnectReason.loggedOut) {
        // El teléfono desvinculó el dispositivo. Las credenciales ya no valen, y
        // NO se reconecta: sin sesión, insistir solo genera un QR tras otro.
        console.log("Sesión cerrada desde el teléfono. Limpiando credenciales.");
        await kvDel("creds").catch(() => {});
        estado.vinculadoComo = null;
        ponerConexion("desvinculada");
        return;
      }

      programarReconexion(causa);
    }
  });

  // Los mensajes entrantes se reenvían al puente, que los pasa al CRM. El
  // contenedor no conoce al bot: así el token del CRM no viaja hasta aquí.
  s.ev.on("messages.upsert", ({ messages, type }) => {
    if (!vigente()) return;
    for (const msg of messages) {
      // Un mensaje propio es del bot o de una persona usando el teléfono del
      // negocio. Hasta el 23-sep-2026 se tiraban todos, y el bot seguía
      // contestando encima de la dueña: los dos le escribían a la misma
      // clienta a la vez. Ver `esRespuestaDelTelefono`.
      if (msg.key?.fromMe) {
        if (!esRespuestaDelTelefono(msg)) continue;
        estado.respuestasDelTelefono += 1;
        avisarRespuestaPropia(s, msg).catch((e) => {
          estado.ultimoError = `propio: ${e.message}`;
          console.error("No se pudo avisar una respuesta del teléfono:", e.message);
        });
        continue;
      }
      // Lo de otros solo en vivo: `append` es historial que llega al
      // reconectar, y contestarlo sería responder mensajes viejos.
      if (type !== "notify") continue;
      estado.mensajesRecibidos += 1;
      reenviar(msg).catch((e) => {
        estado.ultimoError = `reenviar: ${e.message}`;
        console.error("No se pudo reenviar un mensaje:", e.message);
      });
    }
  });
}

// ── Lo que manda el bot contra lo que manda una persona ────────────────────
// La regla vive en propios.mjs, que se prueba sin socket. Aquí solo se usa.

const enviadosPorElBot = crearRegistroDeEnvios();

function esRespuestaDelTelefono(msg) {
  return esRespuestaPropiaDePersona(msg, {
    enviados: enviadosPorElBot,
    yo: [socket?.user?.id, socket?.user?.lid],
  });
}

/**
 * Los nombres del chat que conocemos. WhatsApp está pasando a identificadores
 * LID, y el mismo chat puede venir como `507…@s.whatsapp.net` o como `…@lid`
 * según el mensaje. Se mandan todos: el CRM usa el que ya tenga conversación.
 */
async function nombresDelChat(s, msg) {
  const nombres = [msg.key?.remoteJid, msg.key?.remoteJidAlt].filter(Boolean);
  const mapa = s.signalRepository?.lidMapping;
  for (const jid of [...nombres]) {
    try {
      if (jid.endsWith("@lid") && mapa?.getPNForLID) nombres.push(await mapa.getPNForLID(jid));
      else if (jid.endsWith("@s.whatsapp.net") && mapa?.getLIDForPN) nombres.push(await mapa.getLIDForPN(jid));
    } catch {
      // El mapa es una ayuda, no un requisito: con el jid original alcanza casi siempre.
    }
  }
  return [...new Set(nombres.filter(Boolean).map((j) => jidNormalizedUser(j)))];
}

async function avisarRespuestaPropia(s, msg) {
  const r = await puente("/puente/propio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jids: await nombresDelChat(s, msg),
      texto: textoDe(msg),
      tipo: tipoDe(msg),
      enviadoEn: Number(msg.messageTimestamp ?? 0) * 1000 || Date.now(),
    }),
  });
  if (!r.ok) throw new Error(`propio → ${r.status} · ${await porQue(r)}`);
}

/**
 * Programa UNA reconexión, y garantiza que la cadena NO se corte.
 *
 * El 16-sep-2026 el canal se quedó mudo una noche entera por culpa de tres
 * líneas que vivían aquí:
 *
 *     conectar().catch((e) => {
 *       estado.ultimoError = `reconectar: ${e.message}`;
 *       console.error("Fallo al reconectar:", e.message);
 *     });
 *
 * Si `conectar()` rechaza —y puede: lo primero que hace es `kvGet("creds")`, que
 * es un viaje HTTPS al puente— el error se anotaba y **nadie volvía a
 * intentarlo nunca**. El proceso seguía vivo, `container.running` seguía en
 * true, y el latido del Durable Object daba el canal por sano mientras llevaba
 * horas sin contestar.
 *
 * El arranque (`arrancar()`) sí reintenta en un `for(;;)`. La reconexión no.
 * Esa asimetría era el agujero, y el `programarReconexion(causa)` del `catch`
 * es lo que lo cierra.
 */
function programarReconexion(causa) {
  if (reconexionProgramada) return;
  if (estado.conexion === "desvinculada") return; // esto necesita una persona
  reconexionProgramada = true;
  estado.reconexiones += 1;

  // 515 (restartRequired) es el reinicio que WhatsApp pide tras vincular: es
  // esperado y se atiende de inmediato. Lo demás espera cada vez más.
  intentosReconexion = causa === DisconnectReason.restartRequired ? 0 : intentosReconexion + 1;
  const espera =
    intentosReconexion === 0 ? 1000 : Math.min(3000 * 2 ** (intentosReconexion - 1), 60000);
  estado.proximoIntentoEn = new Date(Date.now() + espera).toISOString();
  console.log(`Reconectando en ${espera} ms (cierre ${causa}).`);

  setTimeout(() => {
    reconexionProgramada = false;
    conectar().catch((e) => {
      estado.ultimoError = `reconectar: ${e.message}`;
      console.error("Fallo al reconectar:", e.message);
      // LA línea del arreglo. Sin ella la cadena termina aquí y el canal se
      // queda mudo para siempre sin que nada lo note.
      programarReconexion(causa);
    });
  }, espera);
}

/**
 * ¿El WebSocket sigue de verdad abierto?
 *
 * Conservador a propósito: si no se puede medir, se devuelve `true`. Declarar
 * muerto un socket sano cuesta una reconexión innecesaria y una
 * resincronización entera; equivocarse en el otro sentido solo retrasa el
 * rescate hasta que el latido del Worker lo note.
 */
function socketAbierto() {
  try {
    const ws = socket?.ws;
    if (!ws) return false;
    if (typeof ws.isOpen === "boolean") return ws.isOpen;
    const cual = ws.readyState ?? ws.socket?.readyState;
    if (typeof cual === "number") return cual === 1; // 1 = OPEN
    return true;
  } catch {
    return true;
  }
}

/**
 * El vigilante: la red de seguridad de última instancia.
 *
 * Revisa cada medio minuto que el canal esté donde dice estar. No sustituye al
 * manejador de `connection.update` —ese sigue siendo el camino normal— sino que
 * cubre los casos en los que ese camino no llega a ejecutarse: una promesa que
 * rechazó, un socket que murió sin emitir `close`, un `setTimeout` que se
 * perdió.
 *
 * `esperando-qr` y `desvinculada` se dejan en paz a propósito: no son fallos,
 * son estados que esperan a una persona. Reconectar ahí solo genera un código
 * nuevo y le tumba al dueño el que está mirando en la pantalla.
 */
function vigilar() {
  estado.ultimaVigilancia = new Date().toISOString();

  if (estado.conexion === "desvinculada" || estado.conexion === "esperando-qr") return;

  if (estado.conexion === "conectada") {
    if (socketAbierto()) return;
    // Dice estar conectada y el socket no está abierto: es un zombi, y nadie
    // más lo iba a notar porque `connection.update` nunca llegó a dispararse.
    console.error("El socket dice conectada pero no está abierto. Rescatando.");
    estado.ultimoError = "socket zombi: conectada sin socket abierto";
    estado.rescatesDelVigilante += 1;
    ponerConexion("cerrada");
    programarReconexion(0);
    return;
  }

  // `cerrada` o `arrancando`. Si ya hay algo en camino, no se pisa.
  if (reconexionProgramada || arrancando) return;
  // Y se le da al camino normal el tiempo de hacer su trabajo antes de meterse.
  if (Date.now() - estado.conexionDesde < VIGILANTE_MS) return;

  console.error(`Nadie está reconectando y lleva caída. Rescatando (${estado.conexion}).`);
  estado.rescatesDelVigilante += 1;
  programarReconexion(0);
}

setInterval(() => {
  // Dentro de un try: una excepción aquí mataría el intervalo, y el vigilante
  // que se muere en silencio es peor que no tener vigilante.
  try {
    vigilar();
  } catch (e) {
    estado.ultimoError = `vigilante: ${e.message}`;
    console.error("El vigilante falló:", e.message);
  }
}, VIGILANTE_MS);

/** Manda el mensaje entrante al puente. Un fallo aquí se anota, no se traga. */
async function reenviar(msg) {
  const r = await puente("/puente/entrante", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      de: msg.key?.remoteJid ?? null,
      nombre: msg.pushName ?? null,
      // Con la leyenda de una foto y sin las envolturas de "temporal".
      texto: textoDe(msg),
      tipo: tipoDe(msg),
      media: await descargarArchivo(msg),
      recibidoEn: Date.now(),
      crudo: msg,
    }),
  });
  if (!r.ok) throw new Error(`entrante → ${r.status} · ${await porQue(r)}`);
}

/**
 * La nota de voz o la imagen, en base64, o null. Nunca lanza: si la descarga
 * falla, el mensaje igual se reenvía y el CRM dice qué era (mejor que perderlo).
 */
async function descargarArchivo(msg) {
  const archivo = archivoDe(msg);
  if (!archivo) return null;
  if (!archivo.descargable) {
    estado.ultimoError = `archivo de ${archivo.tamano} bytes: pasa del tope, se reenvió sin él`;
    return null;
  }
  try {
    const bytes = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: SILENCIO, reuploadRequest: socket?.updateMediaMessage },
    );
    estado.archivosRecibidos += 1;
    return { clase: archivo.clase, mime: archivo.mime, base64: Buffer.from(bytes).toString("base64") };
  } catch (e) {
    estado.ultimoError = `descargar ${archivo.clase}: ${e.message}`;
    console.error(`No se pudo descargar ${archivo.clase}:`, e.message);
    return null;
  }
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
    const vigente = qrVigente();
    return json(200, {
      qr: vigente,
      // La edad es el diagnóstico: un QR de 90 segundos explica por qué el
      // teléfono dice "Revisa tu conexión" sin que nada más falle.
      edadMs: vigente ? Date.now() - qrEn : null,
      generados: qrGenerados,
      estado: estado.conexion,
      ultimoError: estado.ultimoError,
    });
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
        // El id se genera y se anota ANTES de enviar: es lo que distingue el
        // eco de este mensaje de una respuesta escrita desde el teléfono.
        const messageId = generateMessageIDV2(socket.user?.id);
        enviadosPorElBot.anotar(messageId);
        await socket.sendMessage(cuerpo.para, { text: String(cuerpo.chunks[i]) }, { messageId });
        estado.mensajesEnviados += 1;
      }
      return json(200, { ok: true, enviados: cuerpo.chunks.length });
    } catch (e) {
      estado.ultimoError = `enviar: ${e.message}`;
      return json(500, { error: e.message });
    }
  }

  // La empuja el latido del Durable Object cuando ve el contenedor prendido
  // pero WhatsApp desconectado. Es idempotente: si ya hay una reconexión en
  // camino, no hace nada. Lo barato antes que el martillo de destruir el
  // contenedor entero.
  if (url.pathname === "/reconectar" && req.method === "POST") {
    if (estado.conexion === "desvinculada") {
      return json(409, {
        error: "El numero esta desvinculado. Hay que escanear un codigo nuevo.",
        estado: estado.conexion,
      });
    }
    programarReconexion(0);
    return json(200, {
      ok: true,
      estado: estado.conexion,
      programada: reconexionProgramada,
      proximoIntentoEn: estado.proximoIntentoEn,
    });
  }

  if (url.pathname === "/logout" && req.method === "POST") {
    try {
      await socket?.logout();
    } catch {}
    await kvDel("creds").catch(() => {});
    ponerConexion("desvinculada");
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
      // A partir de aquí el vigilante manda: el bucle de arranque ya no está
      // reintentando, así que dejar de avisarlo lo dejaría sin red.
      arrancando = false;
      return;
    } catch (e) {
      intentos += 1;
      estado.ultimoError = `${e.message} (intento ${intentos})`;
      console.error(`No se pudo arrancar (intento ${intentos}):`, e.message);
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (intentos - 1), 60000)));
    }
  }
})();
