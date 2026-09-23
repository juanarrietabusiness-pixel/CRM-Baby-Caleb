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
import { anotarAviso, buscarConversaciones, conversacionDelAviso, nombreDe, refCorta, responderACliente, tomarAccion } from "./acciones";
import { contestarBoton, editar, enviar } from "./telegram";
import { pendientes } from "./pendientes";
import { entenderAlDueno } from "./cerebro";
import { EXTENSIONES } from "./extensiones";
import { devolverAlBot, pausarPorHumano } from "../takeover";
import type { Contexto, Respuesta } from "./tipos";

export interface TgMensaje {
  message_id: number;
  from?: { id: number; first_name?: string; is_bot?: boolean };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
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
    "",
    "También puede escribir con sus palabras: «¿qué tengo pendiente?», «devuélvele lo de Ana al bot».",
  ].join("\n");
}

async function mandar(ctx: Contexto, respuestas: Respuesta[]): Promise<void> {
  for (const r of respuestas) {
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
  olvidarme: async (ctx) => {
    await desvincular(ctx.env);
    return [{ texto: "Listo: este Telegram ya no recibe los avisos. Para volver, genere un código en el panel (Conexiones → Telegram)." }];
  },
};

// ── Lo que hace cada botón ─────────────────────────────────────────────────

/** Botones que responden sobre su propio mensaje (quitan sus botones). */
const EDITAN_SU_MENSAJE = new Set(["venta", "devolucion", "descartar", "enviar", "deshacer"]);

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
    return r.ok ? { texto: `✅ Enviado a ${r.nombre}.` } : { texto: `❌ ${r.error}` };
  },
  descartar: async () => ({ texto: "❌ Descartado." }),
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
      await editar(env, chatId, cb.message.message_id, `${cb.message.text ?? ""}\n\n${r.texto}`, r.teclado);
      if (r.conversationId) await anotarAviso(env, chatId, cb.message.message_id, r.conversationId);
    } else {
      await mandar(ctx, [r]);
    }
    return true;
  }

  const msg = update.message;
  if (!msg || msg.chat.type !== "private") return false;
  const texto = (msg.text ?? msg.caption ?? "").trim();

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

  // ── Respuesta sobre un aviso: le llega a la clienta ──
  if (msg.reply_to_message) {
    const conv = await conversacionDelAviso(env, chatId, msg.reply_to_message.message_id);
    if (conv) {
      if (!msg.text?.trim()) {
        await mandar(ctx, [{ texto: "Por ahora solo puedo reenviarle texto a la clienta." }]);
        return true;
      }
      const r = await responderACliente(env, conv, msg.text.trim());
      await mandar(ctx, [
        r.ok
          ? { texto: `✅ Enviado a ${r.nombre}. El bot queda en pausa ahí.`, conversationId: conv }
          : { texto: `❌ ${r.error}` },
      ]);
      return true;
    }
  }

  // ── Un comando ──
  const cmd = partirComando(texto);
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

  if (!texto) {
    await mandar(ctx, [{ texto: "Por ahora la consola solo entiende texto. /ayuda para ver qué puede hacer." }]);
    return true;
  }

  // ── Con sus palabras ──
  await mandar(ctx, await entenderAlDueno(ctx, texto));
  return true;
}

/** ¿Hay un dueño vinculado? (para el panel y para los avisos) */
export async function hayDuenoVinculado(env: Env): Promise<boolean> {
  return !!env.TELEGRAM_BOT_TOKEN && !!(await chatDelDueno(env));
}
