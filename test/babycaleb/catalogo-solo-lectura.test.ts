/**
 * La pestaña Catálogo cuando el dueño del dato es el sistema (F3.3).
 *
 * El plan pide el «interruptor del CRM en solo lectura» para el traspaso
 * (docs/plan/08-operacion.md §Traspaso del catálogo), y el motivo es concreto:
 * si las lecturas vienen del sistema y las escrituras se quedaran en esta D1,
 * la dueña cambiaría un precio aquí, vería «Guardado», y el bot seguiría
 * cotizando el del sistema. Un guardado que parece funcionar y no llega a
 * ninguna parte es peor que un «no se puede», porque nadie va a buscar el
 * error: la pantalla dijo que sí.
 */
import { describe, it, expect } from "vitest";
import { adminApp } from "../../src/admin/routes";
import { ADMIN_USERNAME } from "../../src/admin/auth";
import type { Env } from "../../src/env";
import type { SistemaBinding, VariantePublica } from "../../src/catalog/fuente";

const PASSWORD = "secret123";
const auth = {
  Authorization: `Basic ${Buffer.from(`${ADMIN_USERNAME}:${PASSWORD}`).toString("base64")}`,
};

const req = (path: string, init?: RequestInit) => new Request(`https://bot.test${path}`, init);

/** D1 de mentira: contesta vacío a todo. Con el sistema como fuente no se toca. */
const dbVacia = () =>
  ({
    prepare: () => {
      const stmt: Record<string, unknown> = {};
      stmt.bind = () => stmt;
      stmt.first = async () => null;
      stmt.all = async () => ({ results: [] });
      stmt.run = async () => ({});
      return stmt;
    },
  }) as unknown as D1Database;

const VARIANTE: VariantePublica = {
  codigo: "NAT-M",
  slug: "panales-nateen-nat-m",
  nombre: "Pañal Nateen Talla M — caja de 144",
  talla: "M",
  pesoMinLb: 8,
  pesoMaxLb: 19,
  unidadesPorCaja: 144,
  precioCents: 5000,
  disponibilidad: "pocas",
};

const sistema = (sobre: Partial<SistemaBinding> = {}): SistemaBinding => ({
  async buscarCatalogo() {
    return { ok: true, datos: [VARIANTE] };
  },
  async listarCatalogo() {
    return { ok: true, datos: [VARIANTE] };
  },
  async cotizarEnvio() {
    return { ok: true, datos: { zona: "Tocumen", tarifaCents: 800, requierePagoTotal: false } };
  },
  ...sobre,
});

const env = (extra: Partial<Env> = {}): Env =>
  ({
    DB: dbVacia(),
    DASHBOARD_PASSWORD: PASSWORD,
    BUSINESS_NAME: "Baby Caleb",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    ...extra,
  }) as unknown as Env;

const conSistema = (sobre: Partial<SistemaBinding> = {}) =>
  env({ CATALOGO_FUENTE: "sistema", SISTEMA: sistema(sobre) as never });

// Las rutas que escriben, tal como existen hoy.
const ESCRITURAS: Array<[string, RequestInit]> = [
  ["/catalogo/nuevo", { method: "GET" }],
  ["/catalogo/NAT-M/editar", { method: "GET" }],
  ["/catalogo/guardar", { method: "POST" }],
  ["/catalogo/NAT-M/activo", { method: "POST" }],
  ["/catalogo/NAT-M/duplicar", { method: "POST" }],
  ["/catalogo/NAT-M/borrar", { method: "POST" }],
];

describe("con la D1 como dueña, nada cambia", () => {
  it("el listado sigue trayendo el editor", async () => {
    const res = await adminApp.fetch(req("/catalogo", { headers: auth }), env());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Nuevo producto");
    expect(html).not.toContain("Solo lectura");
  });

  it("y las rutas que escriben NO están bloqueadas", async () => {
    for (const [ruta, init] of ESCRITURAS) {
      const res = await adminApp.fetch(req(ruta, { ...init, headers: auth }), env());
      expect(res.status, `${init.method} ${ruta}`).not.toBe(409);
    }
  });
});

describe("con el sistema como dueño, la pestaña queda en solo lectura", () => {
  it("TODAS las rutas que escriben contestan 409 y dicen dónde se edita", async () => {
    for (const [ruta, init] of ESCRITURAS) {
      const res = await adminApp.fetch(req(ruta, { ...init, headers: auth }), conSistema());
      expect(res.status, `${init.method} ${ruta}`).toBe(409);
      const html = await res.text();
      expect(html, ruta).toContain("El catálogo se edita en el sistema");
    }
  });

  it("y una ruta que todavía no existe TAMBIÉN queda bloqueada", async () => {
    // Esto es lo que hace que el guardia sirva mañana. Un guardia puesto ruta
    // por ruta se olvida en cuanto alguien añada la séptima; este falla
    // cerrado, así que la séptima nace bloqueada sin que nadie se acuerde.
    const res = await adminApp.fetch(
      req("/catalogo/NAT-M/importar-desde-excel", { method: "POST", headers: auth }),
      conSistema(),
    );
    expect(res.status).toBe(409);
  });

  it("el listado enseña lo que ve el bot: precio y etiqueta, SIN cantidad ni costo", async () => {
    const res = await adminApp.fetch(req("/catalogo", { headers: auth }), conSistema());
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("Solo lectura");
    expect(html).toContain("Lo que ve el bot");
    expect(html).toContain("NAT-M");
    expect(html).toContain("$50.00");
    expect(html).toContain("Quedan pocas");

    // Nada de editar.
    expect(html).not.toContain("Nuevo producto");

    // Y sobre todo: NINGUNA cantidad. `aProducto` traduce la etiqueta a un
    // stockTotal de 0, 1 o 5 —el mínimo que esa etiqueta garantiza, no el
    // stock—, y pintarlo aquí sería enseñarle a la dueña una cifra inventada
    // con cara de dato. Esta vista no pasa por ahí.
    expect(html).not.toMatch(/unidades/i);

    // Y ninguna cifra de costo. Esto NO se comprueba buscando la palabra
    // «costo»: el aviso de la propia pantalla la dice —«el costo y la cantidad
    // exacta no se muestran aquí»—, así que un patrón a ciegas caza el texto
    // que explica la regla en vez de una infracción. Lo que se mide es cuántas
    // CIFRAS en dólares salen: con una variante tiene que haber exactamente
    // una, su precio. Una columna de costo añadiría otra.
    expect(html.match(/\$\d/g) ?? []).toHaveLength(1);
    expect(html).toContain("no se muestran aquí");
  });

  it("si falta la conexión, sigue el editor de la D1 —pero avisando", async () => {
    // Sin el binding, `fuenteDeCatalogo` se repliega a la D1: el bot lee ESTA
    // base, así que editarla sí surte efecto y el editor es la pantalla
    // correcta. Lo que no puede pasar es que no se diga nada, porque entonces
    // la dueña cree que el traspaso ya ocurrió.
    const res = await adminApp.fetch(
      req("/catalogo", { headers: auth }),
      env({ CATALOGO_FUENTE: "sistema" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("falta la conexión con el sistema");
    expect(html).toContain("todavía no está en vigor");
    // El editor SIGUE ahí: lo que se edita aquí es lo que el bot lee.
    expect(html).toContain("Nuevo producto");
  });

  it("y con la D1 a secas no aparece ningún aviso de fuente", async () => {
    const res = await adminApp.fetch(req("/catalogo", { headers: auth }), env());
    const html = await res.text();
    expect(html).not.toContain("falta la conexión con el sistema");
  });

  it("si el sistema contesta con error, lo dice con su código", async () => {
    const res = await adminApp.fetch(
      req("/catalogo", { headers: auth }),
      conSistema({
        async listarCatalogo() {
          return { ok: false, codigo: "no_disponible", mensaje: "la base no responde" };
        },
      }),
    );
    const html = await res.text();
    expect(html).toContain("no_disponible");
    expect(html).toContain("la base no responde");
  });
});
