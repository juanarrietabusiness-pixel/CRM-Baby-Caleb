import { describe, it, expect } from "vitest";
import {
  normalizarTelefono,
  extraerEmail,
  contactosParaMeta,
  contactosACsv,
  type Contacto,
} from "../../src/db/publicos";

// Meta descarta la fila entera si el teléfono no está en formato
// internacional, así que más vale no mandarlo que mandarlo mal.
describe("normalizarTelefono", () => {
  it("un móvil panameño de 8 dígitos sale con +507", () => {
    expect(normalizarTelefono("61234567")).toBe("+50761234567");
    expect(normalizarTelefono("6123-4567")).toBe("+50761234567");
    expect(normalizarTelefono("6123 4567")).toBe("+50761234567");
  });

  it("respeta el país si ya viene", () => {
    expect(normalizarTelefono("+507 6123 4567")).toBe("+50761234567");
    expect(normalizarTelefono("50761234567")).toBe("+50761234567");
    expect(normalizarTelefono("+1 305 555 1234")).toBe("+13055551234");
  });

  it("entiende el identificador de WhatsApp", () => {
    expect(normalizarTelefono("50761234567@s.whatsapp.net")).toBe("+50761234567");
  });

  it("un id de Instagram NO es un teléfono", () => {
    // 17 dígitos: ningún teléfono del mundo llega ahí.
    expect(normalizarTelefono("17841471553036144")).toBe("");
  });

  it("lo que no parece teléfono se descarta", () => {
    expect(normalizarTelefono("")).toBe("");
    expect(normalizarTelefono("hola")).toBe("");
    expect(normalizarTelefono("123")).toBe("");
  });
});

describe("extraerEmail", () => {
  it("lo saca de un texto suelto", () => {
    expect(extraerEmail("escríbeme a Ana.Perez+bebe@Gmail.com porfa")).toBe("ana.perez+bebe@gmail.com");
  });
  it("sin correo devuelve vacío", () => {
    expect(extraerEmail("61234567")).toBe("");
    expect(extraerEmail(null)).toBe("");
  });
});

/** D1 de juguete que devuelve las filas del JOIN. */
function dbCon(filas: unknown[]) {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return { async all() { return { results: filas }; }, async first() { return null; }, async run() { return {}; } };
          },
          async all() { return { results: filas }; },
          async first() { return null; },
          async run() { return {}; },
        };
      },
    },
  } as any;
}

function conv(extra: Record<string, unknown> = {}) {
  return {
    channel: "instagram",
    channel_user_id: "17841471553036144",
    display_name: "Ana",
    started_at: 1_000,
    last_message_at: 2_000,
    lead_name: null,
    contact: null,
    lead_status: null,
    compras: 0,
    pagos: 0,
    ...extra,
  };
}

describe("contactosParaMeta", () => {
  it("deja fuera a quien no tiene teléfono ni correo", async () => {
    // Una conversación de Instagram sin contacto: Meta no puede cruzarla.
    expect(await contactosParaMeta(dbCon([conv()]))).toHaveLength(0);
  });

  it("en WhatsApp el identificador ES el teléfono", async () => {
    const r = await contactosParaMeta(
      dbCon([conv({ channel: "whatsapp", channel_user_id: "50761234567@s.whatsapp.net" })]),
    );
    expect(r).toHaveLength(1);
    expect(r[0].telefono).toBe("+50761234567");
  });

  it("marca que compró por cualquiera de las tres señales", async () => {
    const base = { channel: "whatsapp", channel_user_id: "61234567" };
    const porCompra = await contactosParaMeta(dbCon([conv({ ...base, compras: 1 })]));
    const porPago = await contactosParaMeta(dbCon([conv({ ...base, pagos: 1 })]));
    const porLead = await contactosParaMeta(dbCon([conv({ ...base, lead_status: "sold" })]));
    expect([porCompra[0].compro, porPago[0].compro, porLead[0].compro]).toEqual([true, true, true]);
  });

  it("la misma persona por dos canales sale UNA vez, y conserva la compra", async () => {
    const filas = [
      conv({ channel: "instagram", channel_user_id: "178414", contact: "61234567", compras: 1, lead_name: "Ana" }),
      conv({ channel: "whatsapp", channel_user_id: "61234567", compras: 0, last_message_at: 9_000 }),
    ];
    const r = await contactosParaMeta(dbCon(filas));
    expect(r).toHaveLength(1);
    expect(r[0].compro).toBe(true);
    expect(r[0].nombre).toBe("Ana");
    expect(r[0].ultimaActividad).toBe(9_000);
  });

  it("segmenta compradoras e interesadas", async () => {
    const filas = [
      conv({ channel: "whatsapp", channel_user_id: "61111111", compras: 1 }),
      conv({ channel: "whatsapp", channel_user_id: "62222222" }),
    ];
    expect(await contactosParaMeta(dbCon(filas), "compradoras")).toHaveLength(1);
    expect(await contactosParaMeta(dbCon(filas), "interesadas")).toHaveLength(1);
    expect(await contactosParaMeta(dbCon(filas), "todas")).toHaveLength(2);
  });
});

describe("contactosACsv", () => {
  const c: Contacto = {
    telefono: "+50761234567",
    email: "ana@gmail.com",
    nombre: "Ana María Pérez",
    canal: "whatsapp",
    primerContacto: Date.UTC(2026, 0, 15),
    ultimaActividad: Date.UTC(2026, 9, 24),
    compro: true,
  };

  it("usa los nombres de columna que espera Meta", () => {
    expect(contactosACsv([])).toBe("phone,email,fn,canal,primer_contacto,ultima_actividad,compro\n");
  });

  it("manda solo el nombre de pila, en minúsculas, como pide Meta", () => {
    expect(contactosACsv([c])).toContain('"ana"');
    expect(contactosACsv([c])).not.toContain("María");
  });

  it("escribe las fechas legibles y la marca de compra", () => {
    const linea = contactosACsv([c]).split("\n")[1];
    expect(linea).toContain('"+50761234567"');
    expect(linea).toContain('"2026-01-15"');
    expect(linea).toContain('"2026-10-24"');
    expect(linea.endsWith(",si")).toBe(true);
  });

  it("escapa las comillas en vez de romper el archivo", () => {
    expect(contactosACsv([{ ...c, nombre: 'Ana "La Jefa"' }])).toContain('"ana"');
  });
});
