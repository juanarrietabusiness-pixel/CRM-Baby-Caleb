import { describe, it, expect } from "vitest";
import {
  validateProduct,
  normalizeCode,
  uniqueCode,
  dollarsToCents,
  centsToInput,
  fmtUSD,
  marginPct,
  disponibilidad,
  SUCURSALES,
  STOCK_BAJO,
  type ProductInput,
} from "../../src/catalog/validation";

const base = (over: Partial<ProductInput> = {}): ProductInput => ({
  code: "NAT-M",
  name: "Pañal Nateen Talla M",
  costPrice: 3200,
  salePrice: 5000,
  active: true,
  stock: [{ branch: SUCURSALES[0], stockQty: 10 }],
  ...over,
});

describe("normalizeCode", () => {
  it("mayúsculas, sin tildes, espacios a guiones", () => {
    expect(normalizeCode("nat rn")).toBe("NAT-RN");
    expect(normalizeCode("  pañal-M  ")).toBe("PANAL-M");
    expect(normalizeCode("NAT__XXL")).toBe("NAT-XXL");
  });

  it("dos formas de escribir el mismo código colapsan en una", () => {
    expect(normalizeCode("nat rn")).toBe(normalizeCode("NAT-RN"));
  });

  it("basura pura queda vacía (la validación la rechaza después)", () => {
    expect(normalizeCode("   ")).toBe("");
    expect(normalizeCode("!!!")).toBe("");
  });
});

describe("uniqueCode", () => {
  it("respeta el código si está libre", () => {
    expect(uniqueCode("NAT-M", ["NAT-RN"])).toBe("NAT-M");
  });
  it("agrega sufijo si ya existe", () => {
    expect(uniqueCode("NAT-M", ["NAT-M"])).toBe("NAT-M-2");
    expect(uniqueCode("NAT-M", ["NAT-M", "NAT-M-2"])).toBe("NAT-M-3");
  });
});

describe("dinero", () => {
  it("dollarsToCents acepta lo que la gente escribe de verdad", () => {
    expect(dollarsToCents("45")).toBe(4500);
    expect(dollarsToCents("45.00")).toBe(4500);
    expect(dollarsToCents("$45.50")).toBe(4550);
    expect(dollarsToCents("29,20")).toBe(2920);
  });

  it("vacío o basura → null, nunca NaN en la base", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("   ")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
  });

  it("ida y vuelta sin perder centavos", () => {
    expect(centsToInput(dollarsToCents("29.20"))).toBe("29.20");
    expect(centsToInput(null)).toBe("");
  });

  it("fmtUSD siempre muestra los dos decimales", () => {
    expect(fmtUSD(4500)).toBe("$45.00");
    expect(fmtUSD(2920)).toBe("$29.20");
  });

  it("marginPct sobre el precio de venta; sin costo devuelve raya", () => {
    expect(marginPct(5000, 3200)).toBe("36%");
    expect(marginPct(4500, null)).toBe("—");
    expect(marginPct(4500, 0)).toBe("—");
  });
});

describe("disponibilidad", () => {
  it("cero es agotado", () => {
    expect(disponibilidad(0)).toBe("agotado");
  });
  it(`debajo de ${STOCK_BAJO} son pocas`, () => {
    expect(disponibilidad(1)).toBe("pocas");
    expect(disponibilidad(STOCK_BAJO - 1)).toBe("pocas");
  });
  it("desde el umbral, disponible", () => {
    expect(disponibilidad(STOCK_BAJO)).toBe("disponible");
    expect(disponibilidad(120)).toBe("disponible");
  });
});

describe("validateProduct", () => {
  it("un producto bien cargado pasa sin avisos", () => {
    const r = validateProduct(base());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("exige código y nombre", () => {
    expect(validateProduct(base({ code: "" })).ok).toBe(false);
    expect(validateProduct(base({ name: "  " })).ok).toBe(false);
  });

  it("el precio de venta tiene que ser mayor a cero", () => {
    const r = validateProduct(base({ salePrice: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("precio de venta");
  });

  it("el costo es opcional", () => {
    expect(validateProduct(base({ costPrice: null })).ok).toBe(true);
  });

  it("rechaza una bodega que no está en la lista", () => {
    const r = validateProduct(base({ stock: [{ branch: "Bodega Inventada", stockQty: 3 }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("no existe");
  });

  it("rechaza la misma bodega dos veces", () => {
    const r = validateProduct(
      base({
        stock: [
          { branch: SUCURSALES[0], stockQty: 3 },
          { branch: SUCURSALES[0], stockQty: 8 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("una sola vez");
  });

  it("rechaza stock negativo o con decimales", () => {
    expect(validateProduct(base({ stock: [{ branch: SUCURSALES[0], stockQty: -1 }] })).ok).toBe(false);
    expect(validateProduct(base({ stock: [{ branch: SUCURSALES[0], stockQty: 2.5 }] })).ok).toBe(false);
  });

  it("activo sin ninguna bodega no se puede guardar; inactivo sí (es un borrador)", () => {
    expect(validateProduct(base({ stock: [] })).ok).toBe(false);
    expect(validateProduct(base({ stock: [], active: false })).ok).toBe(true);
  });

  it("vender por debajo del costo avisa pero deja guardar", () => {
    const r = validateProduct(base({ costPrice: 5000, salePrice: 4500 }));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("por debajo del costo");
  });

  it("un precio absurdo avisa (dedazo de un dígito)", () => {
    const r = validateProduct(base({ salePrice: 450_000, costPrice: null }));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("se sale de lo habitual");
  });

  it("activo con todo en cero avisa que el bot lo dará por agotado", () => {
    const r = validateProduct(base({ stock: [{ branch: SUCURSALES[0], stockQty: 0 }] }));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("agotado");
  });
});
