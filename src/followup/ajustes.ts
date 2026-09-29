/**
 * Los ajustes del seguimiento: el COMPORTAMIENTO, no el conocimiento.
 *
 * Viven en D1 (`settings`) y los cambia la dueña desde Telegram (/seguimiento,
 * o con sus palabras: la consola le propone el cambio con un botón). No viven
 * en la base de conocimiento: hasta el 29-sep-2026 la regla "no le des
 * seguimiento a nadie" estaba escrita en el documento «Seguimiento de
 * clientas», y el cron que manda los seguimientos nunca lo leía. Siguió
 * escribiendo 40 veces después de la orden. Aquí la regla es un dato que el cron
 * lee en cada corrida.
 *
 * Vacío o ausente = el valor por defecto de abajo. Un valor inválido también
 * cae al defecto: un ajuste roto no puede dejar al seguimiento escribiendo a
 * cualquier hora.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";

export const CLAVES = {
  activo: "seguimiento_activo", // "1" | "0"
  pasosHoras: "seguimiento_pasos_horas", // "5,72,168": 5 h, 3 días, 7 días
  postcompraDias: "seguimiento_postcompra_dias", // "15"
  postcompraRecordatorios: "seguimiento_postcompra_recordatorios", // "1" | "0"
  dias: "seguimiento_dias", // "1,2,3,4,5": lunes a viernes (0 = domingo)
  horas: "seguimiento_horas", // "8-18": de 8:00 a 17:59
  texto1: "seguimiento_texto_1",
  texto2: "seguimiento_texto_2",
  texto3: "seguimiento_texto_3",
  textoRecompra: "seguimiento_texto_recompra",
} as const;

/** Los textos llevan {saludo}: se cambia por «Buen día» o «Buenas tardes» según la hora. */
export const TEXTOS_POR_DEFECTO = {
  texto1:
    "{saludo}, espero se encuentre bien. ¿Desea algún pedido? Estoy agendando los pedidos de mañana. ¡Estamos a la orden por cualquier consulta! 🙌🏻🙋🏻‍♀️",
  texto2:
    "{saludo}, espero que usted y su bebé se encuentren muy bien 😊 Le escribo por si todavía le interesa su pedido: con gusto le ayudo a elegir la talla o a coordinar el envío. ¡Quedo a la orden! 🙌🏻",
  texto3:
    "{saludo}, espero que estén muy bien 👶🏻✨ Solo quería recordarle que seguimos a la orden por si necesita pañales, toallitas o su fular. Cuando guste, aquí estamos. ¡Que tenga un lindo día!",
  textoRecompra:
    "{saludo}, espero que usted y su bebé se encuentren muy bien 😊 ¿Cómo le fue con su pedido? Si ya le toca reponer, con gusto le agendamos la próxima caja; y si su bebé cambió de peso, le ayudo a revisar la talla. ¡Quedo a la orden! 🙌🏻",
} as const;

export interface AjustesSeguimiento {
  activo: boolean;
  /** Horas de espera antes de cada paso a una interesada (el primero cuenta desde el último mensaje del bot). */
  pasosHoras: number[];
  /** Días que descansa quien compró antes del mensaje de recompra. */
  postcompraDias: number;
  /** Después del de recompra, ¿siguen los recordatorios (pasos 2 en adelante) si no contesta? */
  postcompraRecordatorios: boolean;
  /** Días de la semana en que se escribe (0 = domingo … 6 = sábado). */
  dias: number[];
  /** Desde qué hora y hasta antes de qué hora (hora del negocio). */
  horaDesde: number;
  horaHasta: number;
  textos: { texto1: string; texto2: string; texto3: string; textoRecompra: string };
}

export const POR_DEFECTO: AjustesSeguimiento = {
  activo: true,
  pasosHoras: [5, 72, 168],
  postcompraDias: 15,
  postcompraRecordatorios: true,
  dias: [1, 2, 3, 4, 5],
  horaDesde: 8,
  horaHasta: 18,
  textos: { ...TEXTOS_POR_DEFECTO },
};

function lista(v: string | undefined, min: number, max: number): number[] | null {
  if (!v?.trim()) return null;
  const nums = v.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n) || n < min || n > max)) return null;
  return nums;
}

/** Lee los ajustes de un snapshot de `settings`. Nunca truena. */
export function ajustesDe(s: Record<string, string>): AjustesSeguimiento {
  const pasos = lista(s[CLAVES.pasosHoras], 1, 24 * 60);
  const dias = lista(s[CLAVES.dias], 0, 6);
  const postDias = Number(s[CLAVES.postcompraDias]);
  const horas = s[CLAVES.horas]?.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  const desde = horas ? Number(horas[1]) : NaN;
  const hasta = horas ? Number(horas[2]) : NaN;
  const horasOk = Number.isInteger(desde) && Number.isInteger(hasta) && desde >= 0 && hasta <= 24 && desde < hasta;
  const texto = (k: keyof typeof TEXTOS_POR_DEFECTO) => s[CLAVES[k]]?.trim() || TEXTOS_POR_DEFECTO[k];
  return {
    activo: s[CLAVES.activo] !== "0",
    pasosHoras: pasos && pasos.length <= 5 ? pasos : POR_DEFECTO.pasosHoras,
    postcompraDias: Number.isInteger(postDias) && postDias >= 1 && postDias <= 120 ? postDias : POR_DEFECTO.postcompraDias,
    postcompraRecordatorios: s[CLAVES.postcompraRecordatorios] !== "0",
    dias: dias ? [...new Set(dias.map(Math.trunc))].sort() : POR_DEFECTO.dias,
    horaDesde: horasOk ? desde : POR_DEFECTO.horaDesde,
    horaHasta: horasOk ? hasta : POR_DEFECTO.horaHasta,
    textos: { texto1: texto("texto1"), texto2: texto("texto2"), texto3: texto("texto3"), textoRecompra: texto("textoRecompra") },
  };
}

export async function cargarAjustes(env: Env): Promise<AjustesSeguimiento> {
  try {
    return ajustesDe(await new SettingsRepo(new Db(env.DB)).all());
  } catch {
    return POR_DEFECTO;
  }
}

/** Un cambio pedido por la dueña. Solo lo que venga se cambia. */
export interface CambioDeAjustes {
  activo?: boolean;
  pasosHoras?: number[];
  postcompraDias?: number;
  postcompraRecordatorios?: boolean;
  dias?: number[];
  horaDesde?: number;
  horaHasta?: number;
  texto1?: string;
  texto2?: string;
  texto3?: string;
  textoRecompra?: string;
}

/** Valida y guarda. Devuelve el error en palabras, o null si quedó guardado. */
export async function guardarAjustes(env: Env, c: CambioDeAjustes): Promise<string | null> {
  const repo = new SettingsRepo(new Db(env.DB));
  const actual = ajustesDe(await repo.all());
  const escribir: [string, string][] = [];

  if (c.activo !== undefined) escribir.push([CLAVES.activo, c.activo ? "1" : "0"]);
  if (c.pasosHoras !== undefined) {
    if (!c.pasosHoras.length || c.pasosHoras.length > 5 || c.pasosHoras.some((h) => !(h >= 1 && h <= 24 * 60))) {
      return "Los pasos van de 1 a 5, cada uno entre 1 hora y 60 días.";
    }
    escribir.push([CLAVES.pasosHoras, c.pasosHoras.map((h) => Math.round(h)).join(",")]);
  }
  if (c.postcompraDias !== undefined) {
    if (!(Number.isInteger(c.postcompraDias) && c.postcompraDias >= 1 && c.postcompraDias <= 120)) {
      return "Los días después de la compra van de 1 a 120.";
    }
    escribir.push([CLAVES.postcompraDias, String(c.postcompraDias)]);
  }
  if (c.postcompraRecordatorios !== undefined) {
    escribir.push([CLAVES.postcompraRecordatorios, c.postcompraRecordatorios ? "1" : "0"]);
  }
  if (c.dias !== undefined) {
    if (!c.dias.length || c.dias.some((d) => !(Number.isInteger(d) && d >= 0 && d <= 6))) {
      return "Los días de la semana van de 0 (domingo) a 6 (sábado).";
    }
    escribir.push([CLAVES.dias, [...new Set(c.dias)].sort().join(",")]);
  }
  if (c.horaDesde !== undefined || c.horaHasta !== undefined) {
    const desde = c.horaDesde ?? actual.horaDesde;
    const hasta = c.horaHasta ?? actual.horaHasta;
    if (!(Number.isInteger(desde) && Number.isInteger(hasta) && desde >= 0 && hasta <= 24 && desde < hasta)) {
      return "El horario va de 0 a 24 y la hora de inicio tiene que ser antes que la de cierre.";
    }
    escribir.push([CLAVES.horas, `${desde}-${hasta}`]);
  }
  for (const k of ["texto1", "texto2", "texto3", "textoRecompra"] as const) {
    const t = c[k];
    if (t === undefined) continue;
    if (t.trim().length > 1000) return "Un mensaje de seguimiento no puede pasar de 1000 caracteres.";
    // Vacío = volver al texto de siempre.
    escribir.push([CLAVES[k], t.trim()]);
  }

  for (const [k, v] of escribir) await repo.set(k, v);
  return null;
}

const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "5 horas", "3 días", "36 horas". */
export function comoTiempo(horas: number): string {
  if (horas % 24 === 0) return horas === 24 ? "1 día" : `${horas / 24} días`;
  return horas === 1 ? "1 hora" : `${horas} horas`;
}

function comoDias(dias: number[]): string {
  const l = [...dias].sort();
  if (l.join() === "1,2,3,4,5") return "lunes a viernes";
  if (l.join() === "1,2,3,4,5,6") return "lunes a sábado";
  if (l.length === 7) return "todos los días";
  return l.map((d) => NOMBRE_DIA[d]).join(", ");
}

/** Los ajustes en palabras, para /seguimiento y para el asistente de la dueña. */
export function describirAjustes(a: AjustesSeguimiento): string {
  const pasos = a.pasosHoras.map(comoTiempo);
  const recordatorios = a.pasosHoras.slice(1).map(comoTiempo);
  return [
    a.activo ? "🔁 Seguimiento automático: ENCENDIDO" : "⏹ Seguimiento automático: APAGADO (no sale ninguno)",
    "",
    "A quién: solo a las interesadas —las que preguntaron por un producto, un precio, una talla o un envío— y que dejaron de contestar.",
    `Cuándo: ${pasos.join(", luego ")}${pasos.length > 1 ? " (cada uno contado desde el anterior)" : ""}. Si contesta, empieza de nuevo; al terminar, se para.`,
    `Horario: ${comoDias(a.dias)}, de ${a.horaDesde}:00 a ${a.horaHasta}:00.`,
    "",
    `Quien ya compró: no recibe seguimiento comercial por ${a.postcompraDias} días. Ese día le llega el de recompra` +
      (a.postcompraRecordatorios && recordatorios.length
        ? ` y, si no contesta, los recordatorios (${recordatorios.join(", luego ")}).`
        : ", y nada más."),
    "Cuenta como compra: el botón «✅ Compró» o /compro, una venta registrada (/venta o «Registrar venta»), un ticket de pago o comprobante, o que ella diga que ya compró o ya pagó.",
    "",
    "Nunca: a quien dijo que no le interesa o que no le escriban, a una conversación que atiende una persona o con ticket abierto, ni si la última en escribir fue una persona del equipo.",
  ].join("\n");
}
