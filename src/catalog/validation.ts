// Validación del catálogo — funciones puras, sin D1, para poder probarlas
// directo (ver test/catalog/validation.test.ts). Las usa el panel ANTES de
// escribir: un catálogo inconsistente hace que el bot le dé un precio malo a
// una clienta, y eso cuesta plata y credibilidad.
//
// Distinguimos ERRORES de AVISOS a propósito:
//   - error  → no se guarda. El bot quedaría diciendo algo falso.
//   - aviso  → se guarda, pero se le muestra a la dueña para que confirme.
//              Vender por debajo del costo puede ser intencional (liquidación).

/**
 * Las bodegas de Baby Caleb. Es una lista cerrada y se elige de un desplegable,
 * no se escribe: teclear "Bodega Panama Oeste" (sin tilde) donde el resto dice
 * "Bodega Panamá Oeste" crea una bodega fantasma y parte el inventario en dos
 * sin que nadie se entere.
 */
export const SUCURSALES = [
  "Bodega Ciudad de Panamá",
  "Bodega Panamá Oeste",
  "Bodega Ciudad de Panamá Este Línea 2",
] as const;
export type Sucursal = (typeof SUCURSALES)[number];

/**
 * Debajo de esto el bot dice "quedan pocas / últimas", nunca el número exacto.
 * Lo confirmó el dueño: la clienta no necesita saber que quedan 3, necesita
 * saber que si lo quiere lo pida ya.
 */
export const STOCK_BAJO = 5;

/** Rango de cordura en CENTAVOS: $1.00 a $500.00. */
export const PRECIO_MIN_RAZONABLE = 100;
export const PRECIO_MAX_RAZONABLE = 50_000;

export interface StockInput {
  branch: string;
  stockQty: number;
}

export interface ProductInput {
  code: string;
  name: string;
  /** Centavos USD. null = no cargado (es opcional). */
  costPrice: number | null;
  /** Centavos USD. */
  salePrice: number;
  active: boolean;
  stock: StockInput[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const norm = (s: string | null | undefined) => String(s ?? "").trim();

/**
 * Normaliza el código a MAYÚSCULAS-CON-GUIONES, sin tildes ni espacios.
 * "nat rn" y "NAT-RN" tienen que ser el mismo producto: si no, el mismo pañal
 * termina cargado dos veces con stocks distintos.
 */
export function normalizeCode(raw: string): string {
  return norm(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Si el código ya existe, le agrega un sufijo. Lo usa "Duplicar". */
export function uniqueCode(base: string, taken: Iterable<string>): string {
  const raiz = normalizeCode(base) || "PRODUCTO";
  const usados = new Set(taken);
  if (!usados.has(raiz)) return raiz;
  for (let i = 2; i < 1000; i++) {
    const candidato = `${raiz}-${i}`;
    if (!usados.has(candidato)) return candidato;
  }
  return `${raiz}-${Date.now()}`;
}

/** "45.00" / "$45" / "45,50" → 4500 centavos. Vacío o basura → null. */
export function dollarsToCents(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(/[^\d.,-]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 4500 → "$45.00". Panamá usa dólar, con centavos siempre visibles. */
export function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 4500 → "45.00", para rellenar un input del formulario. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/** Margen % redondeado; "—" si no hay costo cargado. */
export function marginPct(salePrice: number, costPrice: number | null): string {
  if (costPrice === null || costPrice === undefined || costPrice <= 0) return "—";
  if (salePrice <= 0) return "—";
  return `${(((salePrice - costPrice) / salePrice) * 100).toFixed(0)}%`;
}

/**
 * Cómo se le cuenta la existencia a la clienta. El bot recibe esta etiqueta y
 * NO el número: si nunca tiene la cifra exacta, no la puede soltar por error.
 */
export type Disponibilidad = "disponible" | "pocas" | "agotado";

export function disponibilidad(stockTotal: number): Disponibilidad {
  if (stockTotal <= 0) return "agotado";
  if (stockTotal < STOCK_BAJO) return "pocas";
  return "disponible";
}

export function validateProduct(input: ProductInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const code = normalizeCode(input.code);
  if (!code) {
    errors.push("El producto necesita un código (ejemplo: NAT-RN).");
  } else if (code.length > 40) {
    errors.push("El código es demasiado largo (máximo 40 caracteres).");
  }

  if (!norm(input.name)) {
    errors.push("El producto necesita un nombre.");
  } else if (norm(input.name).length > 200) {
    errors.push("El nombre es demasiado largo (máximo 200 caracteres).");
  }

  if (!Number.isFinite(input.salePrice) || input.salePrice <= 0) {
    errors.push("El precio de venta debe ser mayor a cero.");
  }
  if (input.costPrice !== null && input.costPrice !== undefined) {
    if (!Number.isFinite(input.costPrice) || input.costPrice < 0) {
      errors.push("El precio de costo no puede ser negativo.");
    }
  }

  // Una bodega no puede aparecer dos veces: dos existencias para el mismo
  // producto en el mismo lugar hacen que el total dependa de cuál gane.
  const vistas = new Set<string>();
  input.stock.forEach((s, i) => {
    const fila = `Fila ${i + 1}`;
    if (!SUCURSALES.includes(s.branch as Sucursal)) {
      errors.push(`${fila}: la bodega "${s.branch}" no existe. Elija una de la lista.`);
    } else if (vistas.has(s.branch)) {
      errors.push(`${fila}: la bodega "${s.branch}" ya está en la lista. Cada bodega va una sola vez.`);
    }
    vistas.add(s.branch);

    if (!Number.isFinite(s.stockQty) || !Number.isInteger(s.stockQty) || s.stockQty < 0) {
      errors.push(`${fila}: la cantidad de stock debe ser un número entero de cero o más.`);
    }
  });

  // Un producto activo sin ninguna bodega es un producto que el bot ofrece y no
  // puede ubicar. Inactivo sí puede estar así: es un borrador.
  if (input.active && input.stock.length === 0) {
    errors.push(
      "Un producto activo necesita al menos una bodega. Agregue una o desactívelo mientras tanto.",
    );
  }

  // ── Avisos: se guarda igual, pero la dueña confirma ──────────────────────
  if (
    Number.isFinite(input.salePrice) &&
    input.salePrice > 0 &&
    (input.salePrice < PRECIO_MIN_RAZONABLE || input.salePrice > PRECIO_MAX_RAZONABLE)
  ) {
    warnings.push(
      `${fmtUSD(input.salePrice)} de precio de venta se sale de lo habitual. Revise que no falte o sobre un dígito.`,
    );
  }
  if (
    input.costPrice !== null &&
    input.costPrice !== undefined &&
    input.costPrice > 0 &&
    Number.isFinite(input.salePrice) &&
    input.salePrice > 0 &&
    input.salePrice < input.costPrice
  ) {
    warnings.push("El precio de venta está por debajo del costo. Si es a propósito, confirme.");
  }

  const total = input.stock.reduce((acc, s) => acc + (Number.isFinite(s.stockQty) ? s.stockQty : 0), 0);
  if (input.active && input.stock.length > 0 && total === 0) {
    warnings.push("Está activo pero sin existencias: el bot lo va a ofrecer como agotado.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
