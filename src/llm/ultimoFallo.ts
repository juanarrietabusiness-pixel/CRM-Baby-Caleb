// El último fallo REAL del modelo, a la vista en Config.
//
// Cuando el modelo falla, el cliente recibe «Algo falló de mi lado» y el error de
// verdad —lo que contestó el proveedor— solo iba a console.error, es decir, a los
// logs de Cloudflare: el 7-oct-2026 Muse Spark pasó «Probar mi configuración» y
// falló en cada mensaje real, y nadie sin terminal podía ver por qué. Aquí se
// guarda ese error (recortado y sin llaves) para que Config lo muestre.

import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

export interface FalloLlm {
  /** Cuándo pasó (ms). */
  cuando: number;
  proveedor: string;
  modelo: string;
  /** Lo que devolvió el proveedor, sin llaves y recortado. */
  mensaje: string;
  /** ¿Otro intento (o el modelo de respaldo) terminó contestando? */
  recuperado: boolean;
  /** El modelo de respaldo que contestó, si fue otro. */
  respaldo?: string;
}

const MAX_MENSAJE = 500;

/** Una llave de IA tal cual: nunca debe quedar guardada ni mostrarse. */
const LLAVE_SUELTA = /\b(?:sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,})/g;

/**
 * El error como texto corto: nombre, código HTTP, mensaje y el cuerpo que
 * devolvió el proveedor. Los secretos del entorno (y cualquier cosa con forma de
 * llave) se tapan: algunos proveedores repiten la llave en su mensaje de error.
 */
export function describirError(e: unknown, secretos: (string | undefined)[] = []): string {
  const err = e as { name?: unknown; message?: unknown; statusCode?: unknown; responseBody?: unknown; cause?: unknown };
  const partes: string[] = [];
  if (typeof err?.statusCode === "number") partes.push(`HTTP ${err.statusCode}`);
  const mensaje = typeof err?.message === "string" ? err.message : String(e);
  partes.push(mensaje);
  if (typeof err?.responseBody === "string" && err.responseBody.trim() && !mensaje.includes(err.responseBody.trim())) {
    partes.push(err.responseBody.trim());
  }
  const causa = (err?.cause as { message?: unknown } | undefined)?.message;
  if (typeof causa === "string" && causa && !mensaje.includes(causa)) partes.push(`(causa: ${causa})`);

  let texto = partes.join(" — ").replace(/\s+/g, " ");
  for (const s of secretos) {
    const k = (s ?? "").trim();
    if (k.length >= 8) texto = texto.split(k).join("***");
  }
  texto = texto.replace(LLAVE_SUELTA, "***");
  return texto.length > MAX_MENSAJE ? `${texto.slice(0, MAX_MENSAJE)}…` : texto;
}

/** Las llaves que el entorno puede tener, para taparlas en un mensaje. */
export function secretosDelEntorno(env: Env, llaveGuardada?: string): (string | undefined)[] {
  return [
    env.META_API_KEY,
    env.MODEL_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.OPENAI_API_KEY,
    env.XAI_API_KEY,
    llaveGuardada,
  ];
}

/** Guarda el fallo. Nunca lanza: es un extra y no puede romper la atención. */
export async function anotarFalloLlm(env: Env, fallo: FalloLlm): Promise<void> {
  try {
    await new SettingsRepo(new Db(env.DB)).set(SETTING_KEYS.ultimoFalloLlm, JSON.stringify(fallo));
  } catch (e) {
    console.warn("[ultimoFallo] no se pudo guardar el fallo del modelo:", e);
  }
}

/** El fallo guardado, o null si no hay o está roto. */
export function leerFalloLlm(settings: Record<string, string>): FalloLlm | null {
  const crudo = settings[SETTING_KEYS.ultimoFalloLlm];
  if (!crudo) return null;
  try {
    const f = JSON.parse(crudo) as Partial<FalloLlm>;
    if (typeof f.cuando !== "number" || typeof f.mensaje !== "string") return null;
    return {
      cuando: f.cuando,
      proveedor: String(f.proveedor ?? ""),
      modelo: String(f.modelo ?? ""),
      mensaje: f.mensaje,
      recuperado: f.recuperado === true,
      respaldo: typeof f.respaldo === "string" ? f.respaldo : undefined,
    };
  } catch {
    return null;
  }
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
export function haceCuanto(cuando: number, ahora: number = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - cuando) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
