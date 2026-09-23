// La memoria de la consola del dueño.
//
// Con las clientas el bot recuerda la conversación; con el dueño, no: cada
// mensaje llegaba solo, y "¿y de la M?" o "dile que sí" no significaban nada.
// Los comandos funcionaban porque se bastan a sí mismos; lo que se dice con
// palabras —y más por nota de voz— necesita lo que se habló antes.
//
// Se anota todo lo que pasa por la consola, en los dos sentidos: lo que el
// dueño escribe o dice (y los comandos), y lo que se le contesta (y lo que hizo
// cada botón). El asistente ve lo último, así sabe de qué se viene hablando.

import type { Env } from "../env";

export type Rol = "dueno" | "consola";

/** Cuánto se le muestra al asistente. Más, y el contexto se come la respuesta. */
const TURNOS = 30;
/** Lo de hace más de esto ya es otra conversación. */
const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;
/** Un mensaje largo (un /stock de todo el catálogo) se guarda recortado. */
const LARGO_MAXIMO = 2000;

export async function anotar(env: Env, chatId: string, rol: Rol, contenido: string, ahora = Date.now()): Promise<void> {
  const texto = contenido.trim();
  if (!texto) return;
  try {
    await env.DB.prepare("INSERT INTO owner_chat (chat_id, rol, contenido, created_at) VALUES (?, ?, ?, ?)")
      .bind(chatId, rol, texto.length > LARGO_MAXIMO ? `${texto.slice(0, LARGO_MAXIMO)}…` : texto, ahora)
      .run();
  } catch (e) {
    // La memoria ayuda; no puede tumbar la consola (p. ej. antes de que el
    // esquema cree la tabla).
    console.error("[consola] no se pudo anotar en la memoria:", e);
  }
}

/** Lo último que se habló, del más viejo al más nuevo. */
export async function historial(env: Env, chatId: string, ahora = Date.now()): Promise<{ rol: Rol; contenido: string }[]> {
  try {
    const r = await env.DB.prepare(
      "SELECT rol, contenido FROM owner_chat WHERE chat_id = ? AND created_at >= ? ORDER BY id DESC LIMIT ?",
    )
      .bind(chatId, ahora - VIGENCIA_MS, TURNOS)
      .all<{ rol: Rol; contenido: string }>();
    return (r.results ?? []).reverse();
  } catch {
    return [];
  }
}

/** `/nuevo`: el asistente empieza de cero. */
export async function olvidar(env: Env, chatId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM owner_chat WHERE chat_id = ?").bind(chatId).run();
}

export async function purgarMemoria(env: Env, antesDe: number): Promise<void> {
  await env.DB.prepare("DELETE FROM owner_chat WHERE created_at < ?").bind(antesDe).run();
}

/**
 * El historial como mensajes para el modelo: roles que se alternan y que
 * empiezan por el dueño (lo que piden los proveedores).
 */
export function comoMensajes(h: { rol: Rol; contenido: string }[]): { role: "user" | "assistant"; content: string }[] {
  const salida: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of h) {
    const role = m.rol === "dueno" ? "user" : "assistant";
    const ultimo = salida[salida.length - 1];
    if (ultimo?.role === role) ultimo.content += `\n\n${m.contenido}`;
    else salida.push({ role, content: m.contenido });
  }
  while (salida[0]?.role === "assistant") salida.shift();
  return salida;
}
