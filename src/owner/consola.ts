// La consola del dueño por Telegram — la mitad que faltaba.
//
// Hasta ahora Telegram era de una sola vía: el bot mandaba un "🚨 Nuevo ticket"
// y para hacer cualquier cosa había que abrir el panel. Y ni eso llegaba: sin
// OWNER_TELEGRAM_CHAT_ID el aviso no salía, y el panel mostraba "⚠ HANDOFF SIN
// AVISO". Ahora el dueño también le habla al CRM:
//
//   · responde sobre un aviso → el texto le llega a la clienta;
//   · toca un botón → devuelve al bot, pausa, confirma una venta;
//   · escribe un comando → /pendientes, /stock, /venta NAT-M 2…;
//   · escribe con sus palabras → un asistente interno lo entiende.
//
// Todo lo que entra por aquí ya pasó por `esElDueno`: solo el chat vinculado
// llega a esta consola. Lo demás sigue siendo una clienta.

import type { Env } from "../env";
import {
  canjearCodigo,
  chatDelDueno,
  desvincular,
  enModoCliente,
  esElDueno,
  ponerModoCliente,
  protegerConsola,
} from "./dueno";
import {
  anotarAviso,
  buscarConversaciones,
  confirmacion,
  conversacionDelAviso,
  descartarPropuesta,
  nombreDe,
  propuestaPendiente,
  refCorta,
  responderACliente,
  tomarAccion,
} from "./acciones";
import { contestarBoton, editar, enviar, escribiendo } from "./telegram";
import { anotar, historial, olvidar } from "./memoria";
import { entenderAlDueno, type Entrada } from "./cerebro";
import { pendientes } from "./pendientes";
import { EXTENSIONES } from "./extensiones";
import { devolverAlBot, pausarPorHumano } from "../takeover";
import type { Contexto, Respuesta } from "./tipos";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { resolveTelegramFileUrl } from "../channels/telegram";

export interface TgMensaje {
  message_id: number;
  from?: { id: number; first_name?: string; is_bot?: boolean };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string };
  photo?: { file_id: string; width?: number; height?: number }[];
  document?: { file_id: string; mime_type?: string; file_name?: string };
}

export interface TgBoton {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}

export interface TgUpdate {
  update_id?: number;
  message?: TgMensaje;
  callback_query?: TgBoton;
}

function ayuda(env: Env): string {
  return [
    `🤖 Consola de ${env.BUSINESS_NAME}`,
    "",
    "Aquí le llegan los avisos: clientas que piden una persona, pagos, comprobantes, interesadas.",
    "↩️ Toque «Responder» sobre un aviso y su texto le llega a la clienta (y el bot se calla ahí).",
    "",
    "💬 Conversaciones",
    "/pendientes — tickets abiertos y chats que atiende una persona",
    "/bot #ref — devolver una conversación al bot",
    "/pausar #ref — pausar el bot en una conversación",
    "/responder #ref texto — escribirle a una clienta",
    "",
    ...EXTENSIONES.flatMap((e) => [...e.ayuda, ""]),
    "🧪 /cliente — probar el bot como si fuera una clienta (/dueno para volver)",
    "🧹 /nuevo — que el asistente olvide lo que veníamos hablando",
    "",
    "También puede escribirme o mandarme una nota de voz con sus palabras —«¿qué tengo pendiente?», «¿quién escribió hoy?», «devuélvele lo de Ana al bot»— o una foto (una lista, una factura). Me acuerdo de lo que venimos hablando.",
  ].join("\n");
}

async function mandar(ctx: Contexto, respuestas: Respuesta[]): Promise<void> {
  for (const r of respuestas) {
    await anotar(ctx.env, ctx.chatId, "consola", r.texto);
    const id = await enviar(ctx.env, ctx.chatId, r.texto, r.teclado);
    if (id !== null && r.conversationId) await anotarAviso(ctx.env, ctx.chatId, id, r.conversationId);
  }
}

async function unaConversacion(ctx: Contexto, ref: string): Promise<{ id: string; nombre: string } | Respuesta> {
  if (!ref.trim()) return { texto: "Falta a quién. Ejemplo: /bot #k3f9a (las referencias salen en /pendientes)." };
  const r = await buscarConversaciones(ctx.env, ref, 5);
  if (r.length === 1) return { id: r[0].id, nombre: nombreDe(r[0]) };
  if (r.length === 0) return { texto: `No encontré "${ref}" entre las conversaciones recientes.` };
  return { texto: `Hay varias: ${r.map((c) => `${nombreDe(c)} #${refCorta(c.id)}`).join(" · ")}. Use la #referencia.` };
}

// ── Comandos de base ───────────────────────────────────────────────────────

const COMANDOS: Record<string, (ctx: Contexto, args: string) => Promise<Respuesta[]>> = {
  start: async (ctx) => [{ texto: ayuda(ctx.env) }],
  ayuda: async (ctx) => [{ texto: ayuda(ctx.env) }],
  help: async (ctx) => [{ texto: ayuda(ctx.env) }],
  pendientes: async (ctx) => pendientes(ctx.env),
  bot: async (ctx, args) => {
    const c = await unaConversacion(ctx, args);
    if ("texto" in c) return [c];
    const { ticketsCerrados } = await devolverAlBot(ctx.env, c.id, { quien: "telegram" });
    return [{ texto: `▶️ ${c.nombre} vuelve al bot${ticketsCerrados ? ` · ${ticketsCerrados} ticket cerrado` : ""}.` }];
  },
  pausar: async (ctx, args) => {
    const c = await unaConversacion(ctx, args);
    if ("texto" in c) return [c];
    await pausarPorHumano(ctx.env, c.id, "telegram");
    return [{ texto: `⏸ Bot en pausa en ${c.nombre}. Responda sobre este mensaje para escribirle.`, conversationId: c.id }];
  },
  responder: async (ctx, args) => {
    const [ref, ...resto] = args.trim().split(/\s+/);
    const texto = resto.join(" ").trim();
    if (!texto) return [{ texto: "Formato: /responder #ref su mensaje" }];
    const c = await unaConversacion(ctx, ref ?? "");
    if ("texto" in c) return [c];
    const r = await responderACliente(ctx.env, c.id, texto);
    return [r.ok ? { texto: `✅ Enviado a ${r.nombre}. El bot queda en pausa ahí.`, conversationId: c.id } : { texto: `❌ ${r.error}` }];
  },
  cliente: async (ctx) => {
    await ponerModoCliente(ctx.env, true);
    return [{ texto: "🧪 Modo clienta: lo que escriba ahora lo contesta el bot, como a cualquier clienta. Para volver: /dueno" }];
  },
  dueno: async (ctx) => {
    await ponerModoCliente(ctx.env, false);
    return [{ texto: "👤 Modo dueño. /ayuda para ver qué puede hacer." }];
  },
  miid: async (ctx) => [{ texto: `Su chat id es:\n${ctx.chatId}` }],
  nuevo: async (ctx) => {
    await olvidar(ctx.env, ctx.chatId);
    return [{ texto: "🧹 Listo, empezamos de cero. Los avisos y los comandos siguen igual." }];
  },
  olvidarme: async (ctx) => {
    await desvincular(ctx.env);
    return [{ texto: "Listo: este Telegram ya no recibe los avisos. Para volver, genere un código en el panel (Conexiones → Telegram)." }];
  },
};

// ── Lo que hace cada botón ─────────────────────────────────────────────────

/** Botones que responden sobre su propio mensaje (quitan sus botones). */
const EDITAN_SU_MENSAJE = new Set(["venta", "devolucion", "descartar", "enviar", "enviarVarios", "deshacer", "regla"]);

const ACCIONES: Record<string, (ctx: Contexto, p: Record<string, unknown>) => Promise<Respuesta>> = {
  devolver: async (ctx, p) => {
    const { ticketsCerrados } = await devolverAlBot(ctx.env, String(p.conversationId), { quien: "telegram" });
    return { texto: `▶️ Devuelta al bot${ticketsCerrados ? ` · ${ticketsCerrados} ticket cerrado` : ""}.` };
  },
  pausar: async (ctx, p) => {
    await pausarPorHumano(ctx.env, String(p.conversationId), "telegram");
    return { texto: "⏸ Bot en pausa en esa conversación. Responda sobre el aviso para escribirle.", conversationId: String(p.conversationId) };
  },
  enviar: async (ctx, p) => {
    const r = await responderACliente(ctx.env, String(p.conversationId), String(p.texto));
    return r.ok
      ? { texto: `✅ Enviado a ${r.nombre}. El bot se calla ahí una hora y luego vuelve solo.` }
      : { texto: `❌ No se envió: ${r.error}` };
  },
  enviarVarios: async (ctx, p) => {
    const destinos = Array.isArray(p.destinos) ? (p.destinos as { conversationId: string; texto: string }[]) : [];
    const bien: string[] = [];
    const mal: string[] = [];
    for (const d of destinos) {
      const r = await responderACliente(ctx.env, String(d.conversationId), String(d.texto), { pausar: false });
      if (r.ok) bien.push(r.nombre);
      else mal.push(r.error);
    }
    return {
      texto:
        (bien.length ? `✅ Enviado a ${bien.length}: ${bien.join(", ")}.` : "❌ No salió ninguno.") +
        (mal.length ? `\n❌ Sin enviar (${mal.length}): ${mal.join(" · ")}` : "") +
        (bien.length ? "\nSi contestan, el bot los atiende." : ""),
    };
  },
  descartar: async () => ({ texto: "❌ Descartado." }),
  // Enseñarle algo al bot de clientas: el texto va a la base de conocimiento del
  // panel (la única fuente) y se indexa en el acto.
  regla: async (ctx, p) => {
    const { KbDocsRepo, indexDoc } = await import("../kb/docs");
    const repo = new KbDocsRepo(new Db(ctx.env.DB));
    const texto = String(p.texto).trim();
    const existente = p.docId ? await repo.getById(String(p.docId)) : null;
    let contenido: string;
    if (existente) {
      const reemplazar = p.reemplazar ? String(p.reemplazar) : "";
      contenido =
        reemplazar && existente.content.includes(reemplazar)
          ? existente.content.replace(reemplazar, texto)
          : `${existente.content.trimEnd()}\n\n${texto}`;
    } else {
      contenido = texto;
    }
    const slug = String(p.titulo).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    let id = existente?.id ?? (slug || crypto.randomUUID());
    // Un documento nuevo nunca pisa a otro que ya use ese id.
    if (!existente && (await repo.getById(id))) id = `${id}-${Date.now().toString(36)}`;
    await repo.upsert({ id, title: existente?.title ?? String(p.titulo), content: contenido });
    const doc = await repo.getById(id);
    if (doc) await indexDoc(ctx.env, doc);
    return { texto: `✅ Guardado en «${doc?.title ?? p.titulo}». El bot de clientas lo usa desde ya.` };
  },
};

function accionDe(kind: string) {
  return ACCIONES[kind] ?? EXTENSIONES.find((e) => e.acciones[kind])?.acciones[kind];
}

// ── Entrada ────────────────────────────────────────────────────────────────

/** "/Venta@mi_bot NAT-M 2" → ["venta", "NAT-M 2"]. Tildes fuera: /devolución = /devolucion. */
export function partirComando(texto: string): [string, string] | null {
  const m = texto.trim().match(/^\/([^\s@]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!m) return null;
  const nombre = m[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [nombre, m[2].trim()];
}

/** El código del enlace del panel: "/start dueno_123456" o "/dueno 123456". */
function codigoDeVinculo(texto: string): string | null {
  const m = texto.trim().match(/^\/(?:start\s+dueno_|dueno\s+|vincular\s+)(\d{6})\b/i);
  return m ? m[1] : null;
}

/**
 * Atiende el update si es cosa del dueño. Devuelve true si lo consumió; false
 * si es de una clienta y tiene que seguir hacia el agente.
 */
export async function atenderAlDueno(
  env: Env,
  update: TgUpdate,
  opts: { confiable: boolean },
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  // Sin la firma de Telegram, la consola no ejecuta NADA: ni botones, ni
  // comandos, ni el código de vínculo. Lo que diga venir del dueño se le avisa
  // a su chat real y se descarta; lo de una clienta sigue al agente como siempre.
  //
  // Si el webhook todavía no va firmado (protegerConsolaUnaVez casi siempre lo
  // evita, pero alguien pudo re-registrarlo a mano sin secreto), se registra
  // con el secreto aquí mismo: es inofensivo aunque el update fuera falso
  // —solo reapunta NUESTRO webhook con NUESTRO secreto— y se descarta igual.
  if (!opts.confiable) {
    const cb = update.callback_query;
    if (cb) {
      if (!(await esElDueno(env, cb.from.id))) {
        await contestarBoton(env, cb.id, "Este botón es solo para el dueño del negocio.");
        return true;
      }
      // El botón no se consumió (tomarAccion no corrió): el segundo toque, ya
      // firmado, lo hace.
      const r = await protegerConsola(env);
      await contestarBoton(
        env,
        cb.id,
        r.ok ? "🔒 Activé la protección de su consola. Toque el botón otra vez." : `⚠️ No pude proteger la consola: ${r.error}`,
      );
      return true;
    }
    const m = update.message;
    if (m && (codigoDeVinculo(m.text ?? "") || (await esElDueno(env, m.chat.id)))) {
      const r = await protegerConsola(env);
      await enviar(env, m.chat.id, r.ok ? "🔒 Listo: activé la protección de su consola (el webhook ahora va firmado por Telegram). Vuelva a enviar su mensaje." : "⚠️ Por seguridad, la consola necesita que el webhook de Telegram esté protegido y no pude hacerlo solo: " + r.error + " Abra el panel → Conexiones → Telegram y toque «Enviarme un aviso de prueba».");
      return true;
    }
    return false;
  }

  // ── Un botón ──
  const cb = update.callback_query;
  if (cb) {
    if (!(await esElDueno(env, cb.from.id))) {
      await contestarBoton(env, cb.id, "Este botón es solo para el dueño del negocio.");
      return true;
    }
    const chatId = String(cb.message?.chat.id ?? cb.from.id);
    const ctx: Contexto = { env, chatId, actor: `telegram:${cb.from.id}` };
    const id = cb.data?.startsWith("a:") ? cb.data.slice(2) : null;
    const accion = id ? await tomarAccion(env, id) : null;
    if (!accion) {
      await contestarBoton(env, cb.id, "Eso ya se hizo, se descartó o venció.");
      return true;
    }
    const hacer = accionDe(accion.kind);
    let r: Respuesta;
    try {
      r = hacer ? await hacer(ctx, accion.payload) : { texto: "No sé qué hacer con ese botón." };
    } catch (e) {
      console.error(`[consola] el botón ${accion.kind} falló:`, e);
      r = { texto: "❌ Algo falló al hacerlo. No se aplicó nada que no esté arriba." };
    }
    await contestarBoton(env, cb.id);
    if (EDITAN_SU_MENSAJE.has(accion.kind) && cb.message) {
      // Lo que hizo el botón también es parte de la conversación: "¿y lo de
      // recién?" tiene que saber que la venta se registró.
      // "[hecho]" lo escribe solo el sistema: el asistente sabe que eso pasó
      // de verdad, y si lo imita, sinAccionesFingidas se lo quita.
      await anotar(env, chatId, "consola", `[hecho] ${r.texto}`);
      await editar(env, chatId, cb.message.message_id, `${cb.message.text ?? ""}\n\n${r.texto}`, r.teclado);
      if (r.conversationId) await anotarAviso(env, chatId, cb.message.message_id, r.conversationId);
    } else {
      await mandar(ctx, [r]);
    }
    return true;
  }

  const msg = update.message;
  if (!msg || msg.chat.type !== "private") return false;
  const texto = (msg.text || msg.caption || "").trim();

  // ── El enlace de vinculación del panel. Llega ANTES de que haya dueño. ──
  const codigo = codigoDeVinculo(texto);
  if (codigo) {
    const ok = await canjearCodigo(env, codigo, msg.chat.id);
    await enviar(
      env,
      msg.chat.id,
      ok
        ? `✅ Listo. Este Telegram es ahora el del dueño de ${env.BUSINESS_NAME}: aquí le llegan los avisos y desde aquí puede contestar.\n\n${ayuda(env)}`
        : "Ese código no sirve o ya venció (duran 15 minutos). Genere uno nuevo en el panel: Conexiones → Telegram.",
    );
    return true;
  }

  if (!(await esElDueno(env, msg.chat.id))) return false;

  // Probando el bot como clienta: todo sigue al agente salvo /dueno.
  if (await enModoCliente(env)) {
    const cmd = partirComando(texto);
    if (!cmd || cmd[0] !== "dueno") return false;
  }

  const chatId = String(msg.chat.id);
  const ctx: Contexto = { env, chatId, actor: `telegram:${chatId}` };

  // ── Una nota de voz o una foto: se convierte en algo que la consola entienda ──
  if (msg.voice || msg.audio || msg.photo || msg.document || !partirComando(texto)) await escribiendo(env, chatId);
  let entrada: Entrada;
  try {
    const m = await medioDelDueno(env, msg);
    entrada = { texto: m?.transcripcion ?? texto, porVoz: !!m?.transcripcion, imagen: m?.imagen };
    if (m?.error) {
      await mandar(ctx, [{ texto: m.error }]);
      return true;
    }
  } catch (e) {
    console.error("[consola] no se pudo leer el archivo del dueño:", e);
    await mandar(ctx, [{ texto: "No pude abrir ese archivo. Intente de nuevo o escríbamelo." }]);
    return true;
  }
  if (!entrada.texto && !entrada.imagen) {
    await mandar(ctx, [{ texto: "Eso todavía no lo sé leer. Escríbame, mándeme una nota de voz o una foto. /ayuda para ver qué puedo hacer." }]);
    return true;
  }

  // Lo que dijo el dueño queda en la memoria, venga como venga.
  await anotar(
    env,
    chatId,
    "dueno",
    [entrada.porVoz ? `🎤 ${entrada.texto}` : entrada.texto, entrada.imagen ? "[mandó una foto]" : ""].filter(Boolean).join(" "),
  );

  // Que vea lo que se entendió de su nota de voz: si el oído falló, lo nota.
  const eco: Respuesta[] = entrada.porVoz ? [{ texto: `🎤 «${entrada.texto}»` }] : [];

  // ── Respuesta sobre un aviso ──
  if (msg.reply_to_message) {
    const conv = await conversacionDelAviso(env, chatId, msg.reply_to_message.message_id);
    if (conv) {
      // Texto escrito: le llega a la clienta tal cual, como siempre.
      if (msg.text?.trim()) {
        const r = await responderACliente(env, conv, msg.text.trim());
        await mandar(ctx, [
          r.ok
            ? { texto: `✅ Enviado a ${r.nombre}. El bot queda en pausa ahí.`, conversationId: conv }
            : { texto: `❌ ${r.error}` },
        ]);
        return true;
      }
      // Voz o foto sobre un aviso: es una instrucción sobre ESA conversación.
      // Lo que salga hacia la clienta, el asistente lo propone con botón.
      const c = await new ConversationsRepo(new Db(env.DB)).getById(conv);
      entrada.pista = `Responde sobre el aviso de la conversación de ${c ? nombreDe(c) : "una clienta"} (#${refCorta(conv)}). Si quiere que se le diga algo a ella, propónlo con proponerMensaje.`;
      await mandar(ctx, [...eco, ...(await entenderAlDueno(ctx, entrada))]);
      return true;
    }
  }

  // ── «Sí» / «No» a la propuesta de envío que está esperando ──
  // No pasa por la IA: el 24-sep-2026 un «Sí» escrito terminó en "✅ Mensaje
  // enviado" sin que saliera nada. Aquí el «sí» aprieta el botón de verdad.
  const cmd = entrada.porVoz ? null : partirComando(texto);
  const decision = cmd || entrada.imagen ? null : confirmacion(entrada.texto);
  if (decision !== null) {
    // Solo si lo último que le dijo la consola ES la propuesta: un «sí» a otra
    // pregunta ("¿te muestro los pendientes?") no puede mandar un mensaje.
    const propuesta = (await ultimoDeLaConsolaEsPropuesta(env, chatId)) ? await propuestaPendiente(env) : null;
    if (propuesta) {
      if (!decision) {
        await descartarPropuesta(env, propuesta.id);
        await anotar(env, chatId, "consola", "[hecho] ❌ Propuesta descartada. No se envió nada.");
        await enviar(env, chatId, "❌ Listo, no se envió nada.");
        return true;
      }
      const accion = await tomarAccion(env, propuesta.id);
      const hacer = accion ? accionDe(accion.kind) : null;
      let r: Respuesta;
      try {
        r = accion && hacer ? await hacer(ctx, accion.payload) : { texto: "Esa propuesta ya se envió o se descartó." };
      } catch (e) {
        console.error("[consola] el envío confirmado con palabras falló:", e);
        r = { texto: "❌ Algo falló al enviarlo. Revise el panel antes de reintentar." };
      }
      for (const x of eco) await enviar(env, chatId, x.texto);
      await anotar(env, chatId, "consola", `[hecho] ${r.texto}`);
      await enviar(env, chatId, r.texto, r.teclado);
      return true;
    }
  }

  // ── Un comando ── (escrito; una nota de voz nunca es un comando)
  if (cmd) {
    const [nombre, args] = cmd;
    const f = COMANDOS[nombre] ?? EXTENSIONES.find((e) => e.comandos[nombre])?.comandos[nombre];
    try {
      await mandar(ctx, f ? await f(ctx, args) : [{ texto: `No conozco /${nombre}. /ayuda los lista todos.` }]);
    } catch (e) {
      console.error(`[consola] /${nombre} falló:`, e);
      await mandar(ctx, [{ texto: `❌ /${nombre} falló. Intente de nuevo; si sigue, avísele a quien le da soporte.` }]);
    }
    return true;
  }

  // ── Con sus palabras (escritas, dichas o en una foto) ──
  await mandar(ctx, [...eco, ...(await entenderAlDueno(ctx, entrada))]);
  return true;
}

/** Así empieza toda propuesta de envío (proponerMensaje y proponerMensajeAVarios). */
export const INICIO_DE_PROPUESTA = "✉️ ¿Le mando esto a ";

async function ultimoDeLaConsolaEsPropuesta(env: Env, chatId: string): Promise<boolean> {
  const h = await historial(env, chatId);
  const ultimo = [...h].reverse().find((m) => m.rol === "consola" && !m.contenido.startsWith("🎤 «"));
  return !!ultimo?.contenido.startsWith(INICIO_DE_PROPUESTA);
}

/** Cuánto puede durar una nota de voz del dueño. Whisper cobra por minuto. */
const VOZ_MAXIMA_S = 5 * 60;

/**
 * La nota de voz (transcrita) o la foto que mandó el dueño. null si el mensaje
 * es solo texto; `error` si trae algo que no se puede usar.
 */
async function medioDelDueno(
  env: Env,
  msg: TgMensaje,
): Promise<{ transcripcion?: string; imagen?: { bytes: Uint8Array; mime: string }; error?: string } | null> {
  const token = env.TELEGRAM_BOT_TOKEN!;
  const voz = msg.voice ?? msg.audio;
  if (voz) {
    if ((voz.duration ?? 0) > VOZ_MAXIMA_S) return { error: "Esa nota de voz es muy larga. Mándemela en partes de hasta 5 minutos." };
    const archivo = await descargarDeTelegram(token, voz.file_id);
    if (!archivo) return { error: "No pude descargar la nota de voz. Intente de nuevo." };
    const { transcribirBytes } = await import("../media/transcribe");
    const t = (await transcribirBytes(archivo.bytes, env)).text.trim();
    if (!t) return { error: "No le entendí la nota de voz (salió en blanco). ¿Me la repite o me la escribe?" };
    return { transcripcion: t };
  }
  const foto = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const docImagen = msg.document?.mime_type?.startsWith("image/") ? msg.document : null;
  if (foto || docImagen) {
    const archivo = await descargarDeTelegram(token, (foto ?? docImagen)!.file_id);
    if (!archivo) return { error: "No pude descargar la foto. Intente de nuevo." };
    return { imagen: { bytes: archivo.bytes, mime: docImagen?.mime_type ?? "image/jpeg" } };
  }
  if (msg.document) return { error: "Todavía no leo documentos. Mándeme una foto o una captura, o escríbamelo." };
  return null;
}

async function descargarDeTelegram(token: string, fileId: string): Promise<{ bytes: Uint8Array } | null> {
  const url = await resolveTelegramFileUrl(fileId, token);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** ¿Hay un dueño vinculado? (para el panel y para los avisos) */
export async function hayDuenoVinculado(env: Env): Promise<boolean> {
  return !!env.TELEGRAM_BOT_TOKEN && !!(await chatDelDueno(env));
}
