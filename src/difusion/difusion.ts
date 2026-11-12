// La difusión: UN mensaje de la dueña a las clientas que preguntaron por algo,
// mandado de a poco.
//
// Nació el 12-nov-2026. Bajó el precio de los wipes Dany Baby y la dueña quiso
// avisarles a todas las que habían preguntado en los últimos dos meses. La
// consola le contestó que había UNA: sus herramientas miraban los leads
// anotados, los nombres y las últimas dos semanas, y ninguna leía lo que las
// clientas escribieron. Eran 233. Y aunque las hubiera encontrado, el envío a
// varios manda 25 de golpe — y por el WhatsApp de código QR, que no es la API
// oficial, doscientos mensajes iguales en un rato es como se pierde el número.
//
// Por eso esto:
//   · La audiencia sale de lo que las clientas ESCRIBIERON (`buscarPorTema`),
//     con la misma regla de a quién no se le escribe que el resto de la consola.
//   · El envío lo hace el cron de cada hora, en el horario del seguimiento,
//     unas pocas por corrida y con minutos entre una y otra (`runDifusiones`).
//   · Sale como mensaje del EQUIPO (rol `owner`, igual que el envío a varios):
//     si la clienta contesta, el bot la atiende; y el seguimiento automático no
//     arranca por esto, porque «la última en escribir fue una persona».
//
// Nada sale sin el ▶️ de la dueña, y el ⏸ la para en cualquier momento.

import type { Env } from "../env";
import { Db } from "../db/client";
import type { Conversation } from "../db/conversations";
import { resolveAgentConfig } from "../settings-loader";
import { channelLabel } from "../channels/labels";
import { cargarAjustes } from "../followup/ajustes";
import { enHorario } from "../followup/run";
import { motivoConSusMensajes, personalizar, responderACliente } from "../owner/acciones";
import { chatDelDueno } from "../owner/dueno";
import { enviar as enviarTelegram } from "../owner/telegram";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Cuántas por día, si la dueña no dice otra cosa. Pensado para no levantar sospechas en WhatsApp. */
export const POR_DIA_POR_DEFECTO = 40;
export const POR_DIA_MAXIMO = 60;
/** Por corrida (una por hora): así un día nunca se va en una sola ráfaga. */
const POR_CORRIDA_MAXIMO = 6;
/** Entre un mensaje y el siguiente, en la misma corrida. */
const ESPERA_ENTRE_MENSAJES: [number, number] = [45_000, 90_000];
/** Si la clienta escribió hace menos de esto, está conversando: se le deja para otra corrida. */
const CONVERSANDO = 2 * HORA;

// ── A quién ───────────────────────────────────────────────────────────────

export interface Persona {
  conv: Conversation;
  /** Por qué no se le escribe, o null si se puede. */
  motivo: string | null;
  /** Tiene una compra registrada (compra anotada, venta o ticket de pago). */
  compro: boolean;
}

/** "Dany,  danny , wipes de agua" → ["dany", "danny", "wipes de agua"]. Sin repetidas ni de 1-2 letras. */
export function limpiarPalabras(palabras: string[]): string[] {
  const vistas = new Set<string>();
  for (const p of palabras) {
    const t = p.trim().toLowerCase().replace(/\s+/g, " ");
    if (t.length >= 3) vistas.add(t);
  }
  return [...vistas].slice(0, 12);
}

const comoLike = (p: string) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function enTrozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Las conversaciones donde la CLIENTA escribió alguna de las palabras en los
 * últimos `dias`. Lee lo que ellas escribieron — no los leads anotados, que
 * son pocos, ni lo que contestó el bot, que nombra el catálogo entero cuando
 * le preguntan «¿qué tienen?».
 *
 * Pocas consultas para cientos de clientas: D1 cobra cada consulta contra el
 * tope de la corrida, así que las conversaciones, sus mensajes y sus compras se
 * leen en lotes.
 */
export async function buscarPorTema(env: Env, palabras: string[], dias: number, ahora = Date.now()): Promise<Persona[]> {
  const ps = limpiarPalabras(palabras);
  if (!ps.length) return [];
  const db = new Db(env.DB);
  const desde = ahora - dias * DIA;
  const ids = (
    await db.all<{ id: string }>(
      `SELECT DISTINCT conversation_id AS id FROM messages
        WHERE role = 'user' AND created_at >= ? AND (${ps.map(() => "content LIKE ? ESCAPE '\\'").join(" OR ")})`,
      [desde, ...ps.map(comoLike)],
    )
  ).map((r) => r.id);
  if (!ids.length) return [];

  const convs: Conversation[] = [];
  const suyos = new Map<string, { content: string; created_at: number }[]>();
  for (const lote of enTrozos(ids, 90)) {
    const marcas = lote.map(() => "?").join(", ");
    convs.push(...(await db.all<Conversation>(`SELECT * FROM conversations WHERE id IN (${marcas})`, lote)));
    const msgs = await db.all<{ conversation_id: string; content: string; created_at: number }>(
      `SELECT conversation_id, content, created_at FROM messages
        WHERE role = 'user' AND conversation_id IN (${marcas}) ORDER BY created_at DESC`,
      lote,
    );
    for (const m of msgs) {
      const l = suyos.get(m.conversation_id) ?? [];
      l.push(m);
      suyos.set(m.conversation_id, l);
    }
  }
  const compraron = new Set<string>();
  for (const lote of enTrozos(ids, 30)) {
    const marcas = lote.map(() => "?").join(", ");
    const filas = await db.all<{ id: string }>(
      `SELECT conversation_id AS id FROM compras WHERE conversation_id IN (${marcas})
       UNION SELECT conversation_id FROM stock_movements WHERE kind = 'venta' AND undone_at IS NULL AND conversation_id IN (${marcas})
       UNION SELECT conversation_id FROM tickets WHERE category = 'billing' AND conversation_id IN (${marcas})`,
      [...lote, ...lote, ...lote],
    );
    for (const f of filas) compraron.add(f.id);
  }

  return convs
    .map((conv) => ({
      conv,
      motivo: motivoConSusMensajes(conv, suyos.get(conv.id) ?? [], ahora),
      compro: compraron.has(conv.id),
    }))
    .sort((a, b) => b.conv.last_message_at - a.conv.last_message_at);
}

/** El conteo que ve la dueña: cuántas, por dónde, a cuántas se les puede escribir y cuántas compraron. */
export function resumenDeAudiencia(personas: Persona[], palabras: string[], dias: number): string {
  const ps = limpiarPalabras(palabras);
  const titulo = `Escribieron «${ps.join("», «")}» en los últimos ${dias} días: ${personas.length} ${personas.length === 1 ? "persona" : "personas"}.`;
  if (!personas.length) return titulo;
  const si = personas.filter((p) => !p.motivo);
  const porCanal = new Map<string, number>();
  for (const p of si) porCanal.set(channelLabel(p.conv.channel), (porCanal.get(channelLabel(p.conv.channel)) ?? 0) + 1);
  const porMotivo = new Map<string, number>();
  for (const p of personas) if (p.motivo) porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + 1);
  const compraron = personas.filter((p) => p.compro).length;
  return [
    titulo,
    `• Se les puede escribir: ${si.length}${si.length ? ` (${[...porCanal].map(([c, n]) => `${c} ${n}`).join(" · ")})` : ""}`,
    porMotivo.size
      ? `• No se les puede escribir: ${personas.length - si.length} — ${[...porMotivo].map(([m, n]) => `${m} (${n})`).join(", ")}`
      : "",
    `• Con compra registrada: ${compraron} · sin compra: ${personas.length - compraron}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── La difusión ───────────────────────────────────────────────────────────

export type EstadoDifusion = "borrador" | "activa" | "pausada" | "terminada" | "descartada";

export interface Difusion {
  id: string;
  texto: string;
  tema: string;
  por_dia: number;
  estado: EstadoDifusion;
  creada_en: number;
  empezada_en: number | null;
  terminada_en: number | null;
}

export interface Conteo {
  pendientes: number;
  enviados: number;
  saltados: number;
  errores: number;
}

/** La que está en marcha o en pausa (hay una sola a la vez), o null. */
export async function difusionEnCurso(env: Env): Promise<Difusion | null> {
  return new Db(env.DB).first<Difusion>(
    "SELECT * FROM difusiones WHERE estado IN ('activa', 'pausada') ORDER BY creada_en DESC LIMIT 1",
  );
}

export async function difusionPorId(env: Env, id: string): Promise<Difusion | null> {
  return new Db(env.DB).first<Difusion>("SELECT * FROM difusiones WHERE id = ?", [id]);
}

/** El borrador: la difusión y su lista, en `borrador`. No sale nada hasta `cambiarEstado(…, 'activa')`. */
export async function crearBorrador(
  env: Env,
  d: { texto: string; tema: string; porDia: number; conversaciones: string[] },
  ahora = Date.now(),
): Promise<Difusion> {
  const db = new Db(env.DB);
  const id = crypto.randomUUID();
  const porDia = Math.max(1, Math.min(POR_DIA_MAXIMO, Math.round(d.porDia)));
  await db.run(
    "INSERT INTO difusiones (id, texto, tema, por_dia, estado, creada_en) VALUES (?, ?, ?, ?, 'borrador', ?)",
    [id, d.texto, d.tema, porDia, ahora],
  );
  const stmt = env.DB.prepare(
    "INSERT OR IGNORE INTO difusion_envios (difusion_id, conversation_id, estado) VALUES (?, ?, 'pendiente')",
  );
  for (const lote of enTrozos(d.conversaciones, 50)) await env.DB.batch(lote.map((c) => stmt.bind(id, c)));
  return (await difusionPorId(env, id))!;
}

/**
 * Mueve el estado. Solo los pasos que tienen sentido: un borrador se empieza o
 * se descarta; una activa se pausa; una pausada se reanuda. Devuelve false si
 * la difusión ya no estaba donde el botón creía (un botón viejo).
 */
export async function cambiarEstado(env: Env, id: string, a: EstadoDifusion, ahora = Date.now()): Promise<boolean> {
  const desde: Record<string, EstadoDifusion[]> = {
    activa: ["borrador", "pausada"],
    pausada: ["activa"],
    descartada: ["borrador"],
    terminada: ["activa", "pausada"],
  };
  const permitidos = desde[a] ?? [];
  if (!permitidos.length) return false;
  if (a === "activa") {
    // Una sola a la vez: dos difusiones juntas son el doble de mensajes al día.
    const otra = await difusionEnCurso(env);
    if (otra && otra.id !== id) return false;
  }
  const r = await new Db(env.DB).run(
    `UPDATE difusiones SET estado = ?,
        empezada_en = CASE WHEN ? = 'activa' AND empezada_en IS NULL THEN ? ELSE empezada_en END,
        terminada_en = CASE WHEN ? = 'terminada' THEN ? ELSE terminada_en END
      WHERE id = ? AND estado IN (${permitidos.map(() => "?").join(", ")})`,
    [a, a, ahora, a, ahora, id, ...permitidos],
  );
  return (r.meta.changes ?? 0) > 0;
}

export async function conteo(env: Env, id: string): Promise<Conteo> {
  const filas = await new Db(env.DB).all<{ estado: string; n: number }>(
    "SELECT estado, COUNT(*) AS n FROM difusion_envios WHERE difusion_id = ? GROUP BY estado",
    [id],
  );
  const de = (e: string) => filas.find((f) => f.estado === e)?.n ?? 0;
  return { pendientes: de("pendiente"), enviados: de("enviado") + de("enviando"), saltados: de("saltado"), errores: de("error") };
}

/** Cuántas salen por corrida (una por hora) para llegar a `porDia` en el horario. */
export function porCorrida(porDia: number, horaDesde: number, horaHasta: number): number {
  const horas = Math.max(1, horaHasta - horaDesde);
  return Math.max(1, Math.min(POR_CORRIDA_MAXIMO, Math.ceil(porDia / horas)));
}

/** Cuántos días le faltan, a ese ritmo. Para que la dueña sepa qué esperar. */
export function diasQueFaltan(pendientes: number, porDia: number): number {
  return Math.max(1, Math.ceil(pendientes / Math.max(1, porDia)));
}

// ── El envío (cron de cada hora) ──────────────────────────────────────────

export interface ResultadoDifusion {
  enviados: number;
  saltados: number;
  errores: number;
  terminada: boolean;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDifusiones(
  env: Env,
  opts: { now?: number; espera?: (ms: number) => Promise<void>; esperaMs?: [number, number] } = {},
): Promise<ResultadoDifusion> {
  const now = opts.now ?? Date.now();
  const espera = opts.espera ?? esperar;
  const [esperaMin, esperaMax] = opts.esperaMs ?? ESPERA_ENTRE_MENSAJES;
  const nada: ResultadoDifusion = { enviados: 0, saltados: 0, errores: 0, terminada: false };

  const db = new Db(env.DB);
  const d = await db.first<Difusion>("SELECT * FROM difusiones WHERE estado = 'activa' ORDER BY empezada_en LIMIT 1");
  if (!d) return nada;

  // El mismo horario que el seguimiento: la dueña lo cambia con /seguimiento.
  const aj = await cargarAjustes(env);
  if (!enHorario(env, now, aj)) return nada;
  // El bot apagado a propósito no manda nada, tampoco esto.
  if ((await resolveAgentConfig(env, [])).botPaused) return nada;

  // «Hoy» = desde que abrió el horario de hoy: lo de ayer en la tarde no cuenta.
  const hora = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: env.BOT_TIMEZONE || "America/Panama", hour: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .find((p) => p.type === "hour")?.value ?? aj.horaDesde,
  );
  const abrio = now - (Math.max(0, hora - aj.horaDesde) + 1) * HORA;
  const hoy =
    (
      await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM difusion_envios WHERE difusion_id = ? AND estado IN ('enviado', 'enviando') AND enviado_en >= ?",
        [d.id, abrio],
      )
    )?.n ?? 0;
  const limite = Math.min(porCorrida(d.por_dia, aj.horaDesde, aj.horaHasta), d.por_dia - hoy);

  const r = { ...nada };
  if (limite > 0) {
    const candidatas = await db.all<Conversation>(
      `SELECT c.* FROM difusion_envios e JOIN conversations c ON c.id = e.conversation_id
        WHERE e.difusion_id = ? AND e.estado = 'pendiente'
        ORDER BY c.last_message_at DESC LIMIT ?`,
      [d.id, limite * 3 + 5],
    );
    const marcar = (convId: string, estado: string, motivo: string | null, cuando: number | null) =>
      db.run("UPDATE difusion_envios SET estado = ?, motivo = ?, enviado_en = ? WHERE difusion_id = ? AND conversation_id = ?", [
        estado,
        motivo,
        cuando,
        d.id,
        convId,
      ]);

    for (const c of candidatas) {
      if (r.enviados >= limite) break;
      // La está atendiendo una persona: ella sabrá si le cuenta.
      if (c.paused_until && c.paused_until > now) {
        await marcar(c.id, "saltado", "la estaba atendiendo una persona", null);
        r.saltados++;
        continue;
      }
      // Está conversando ahora mismo: un anuncio en medio estorba. Otra corrida.
      if (now - c.last_message_at < CONVERSANDO) continue;
      // Lo que dijo desde que se armó la lista también cuenta («no me interesa»).
      const suyos = await db.all<{ content: string; created_at: number }>(
        "SELECT content, created_at FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 200",
        [c.id],
      );
      const motivo = motivoConSusMensajes(c, suyos, now);
      if (motivo) {
        await marcar(c.id, "saltado", motivo, null);
        r.saltados++;
        continue;
      }
      // Claim antes de enviar: dos corridas cruzadas no le escriben dos veces.
      const claim = await db.run(
        "UPDATE difusion_envios SET estado = 'enviando', enviado_en = ? WHERE difusion_id = ? AND conversation_id = ? AND estado = 'pendiente'",
        [now, d.id, c.id],
      );
      if ((claim.meta.changes ?? 0) === 0) continue;
      if (r.enviados + r.errores > 0) await espera(esperaMin + Math.random() * (esperaMax - esperaMin));
      const envio = await responderACliente(env, c.id, personalizar(d.texto, c), { pausar: false });
      if (envio.ok) {
        await marcar(c.id, "enviado", null, now);
        r.enviados++;
      } else {
        // Se queda en error y no se reintenta: mejor una de menos que una repetida.
        await marcar(c.id, "error", envio.error.slice(0, 300), now);
        r.errores++;
      }
    }
  }

  const c = await conteo(env, d.id);
  if (c.pendientes === 0 && (await cambiarEstado(env, d.id, "terminada", now))) {
    r.terminada = true;
    const chat = await chatDelDueno(env);
    if (chat && env.TELEGRAM_BOT_TOKEN) {
      await enviarTelegram(
        env,
        chat,
        `📣 Terminó la difusión «${d.tema}».\n• Les llegó a: ${c.enviados}\n• Quedaron fuera: ${c.saltados}` +
          (c.errores ? `\n• No salió (falló el canal): ${c.errores}` : "") +
          "\nLas que contesten las atiende el bot.",
      ).catch((e) => console.error("[difusion] no se pudo avisar que terminó:", e));
    }
  }
  if (r.enviados || r.errores) console.log(`[difusion] ${d.id} enviados=${r.enviados} saltados=${r.saltados} errores=${r.errores}`);
  return r;
}
