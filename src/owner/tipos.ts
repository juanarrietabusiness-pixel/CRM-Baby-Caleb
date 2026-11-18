import type { Env } from "../env";
import type { Teclado } from "./telegram";

/** Un mensaje de la consola hacia el dueño. */
export interface Respuesta {
  texto: string;
  teclado?: Teclado;
  /** Conversación de la que habla: se anota para que "Responder" le llegue a ella. */
  conversationId?: string | null;
}

export interface Contexto {
  env: Env;
  /** El chat de Telegram del dueño. */
  chatId: string;
  /** Cómo queda firmado lo que haga: `telegram:<chat id>`. */
  actor: string;
}

/**
 * Lo que un negocio le agrega a la consola del dueño. La consola de base
 * atiende tickets y conversaciones; Baby Caleb le suma el inventario. En un
 * negocio sin catálogo la lista de extensiones va vacía y nada más cambia.
 */
export interface ExtensionDeConsola {
  nombre: string;
  /** Líneas para /ayuda. */
  ayuda: string[];
  /** `/venta NAT-M 2` → comandos.venta(ctx, "NAT-M 2"). */
  comandos: Record<string, (ctx: Contexto, args: string) => Promise<Respuesta[]>>;
  /** Lo que hace cada botón (kind de owner_actions). */
  acciones: Record<string, (ctx: Contexto, payload: Record<string, unknown>) => Promise<Respuesta>>;
  /** Herramientas para entender lo que el dueño escribe con sus palabras. */
  herramientas?: (ctx: Contexto, salida: Respuesta[]) => Record<string, unknown>;
  /** Qué más sabe hacer, para el prompt del asistente del dueño. */
  instrucciones?: string;
  /** Botones extra en el aviso de una conversación (p. ej. "Registrar venta"). */
  botonesDeAviso?: (ctx: Contexto, conversationId: string) => Promise<{ texto: string; data: string }[]>;
}
