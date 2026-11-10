import type { CatalogProduct } from "../db/catalog";
import { CatalogRepo } from "../db/catalog";
import { Db } from "../db/client";
import type { Env } from "../env";

/**
 * De dónde sale el catálogo: de la D1 del CRM o del sistema de Baby Caleb.
 *
 * ESTE ARCHIVO ES EL TRASPASO. El sistema (`babycaleb-sistema`) pasa a ser el
 * dueño del catálogo, las existencias y las zonas, y el CRM deja de tener los
 * suyos. Pero el bot está atendiendo clientas AHORA, así que el cambio no se
 * hace de golpe: se hace con un interruptor.
 *
 *     CATALOGO_FUENTE = "d1"       ← lo de siempre. Es el valor POR OMISIÓN.
 *     CATALOGO_FUENTE = "sistema"  ← el catálogo sale del sistema.
 *
 * Mientras la variable no esté puesta, o diga cualquier otra cosa, el bot se
 * comporta EXACTAMENTE como hoy. Eso es a propósito: un despliegue que cambia
 * la fuente de verdad sin que nadie lo decida es la forma más rápida de que una
 * clienta reciba un precio equivocado. Y volver atrás es cambiar una variable,
 * no desplegar.
 *
 * La interfaz es la que el bot ya usaba (`search` / `listActive` de
 * `CatalogRepo`), para que quien la consume no tenga que saber de dónde viene
 * lo que recibe.
 */

export type NombreDeFuente = "d1" | "sistema";

export interface FuenteCatalogo {
  readonly nombre: NombreDeFuente;
  /**
   * `cantidad`, si viene, hace que cada producto traiga `pedido`: si alcanza,
   * y si no, cuánto es lo máximo. Es la única vía por la que un número de
   * inventario llega al bot, y solo cuando NO alcanza.
   */
  search(query: string, limit?: number, cantidad?: number): Promise<CatalogProduct[]>;
  listActive(limit?: number, cantidad?: number): Promise<CatalogProduct[]>;
}

/** Lo que el sistema devuelve por RPC (03-contratos §3). */
export interface VariantePublica {
  codigo: string;
  slug: string;
  nombre: string;
  talla: string | null;
  pesoMinLb: number | null;
  pesoMaxLb: number | null;
  unidadesPorCaja: number;
  precioCents: number;
  disponibilidad: "disponible" | "pocas" | "agotado";
  pedido?: { cantidadPedida: number; alcanza: boolean; maximoDisponible?: number };
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; codigo: string; mensaje: string };

/** El entrypoint del sistema, visto desde aquí. */
export interface SistemaBinding {
  buscarCatalogo(q: string, limite?: number, cantidad?: number): Promise<Resultado<VariantePublica[]>>;
  listarCatalogo(cantidad?: number): Promise<Resultado<VariantePublica[]>>;
  cotizarEnvio(textoZona: string): Promise<
    Resultado<
      | { zona: string; tarifaCents: number | null; requierePagoTotal: boolean }
      | { zona: null; sugerencias: string[] }
    >
  >;
}

// ---------------------------------------------------------------------------
// La fuente de siempre
// ---------------------------------------------------------------------------

class FuenteD1 implements FuenteCatalogo {
  readonly nombre = "d1" as const;
  constructor(private readonly repo: CatalogRepo) {}

  async search(query: string, limit = 8, _cantidad?: number): Promise<CatalogProduct[]> {
    // La cobertura no se calcula aquí: `catalogQuery` ya la saca de
    // `stockTotal`, que esta fuente sí trae. Se ignora a propósito para que las
    // dos fuentes devuelvan lo mismo y el único cambio sea de dónde viene.
    return await this.repo.search(query, limit);
  }

  async listActive(limit = 50, _cantidad?: number): Promise<CatalogProduct[]> {
    return await this.repo.listActive(limit);
  }
}

// ---------------------------------------------------------------------------
// La fuente nueva
// ---------------------------------------------------------------------------

/**
 * Cuánto stock *dice* una etiqueta.
 *
 * El sistema no manda la cantidad exacta: manda «disponible / pocas /
 * agotado». Pero `CatalogProduct` lleva `stockTotal`, y el resto del CRM
 * calcula la etiqueta a partir de ese número.
 *
 * Aquí está la trampa que hay que evitar: traducir «pocas» a un número
 * inventado —un 3, pongamos— sería meter una cifra falsa en el sistema, que es
 * exactamente lo que este proyecto existe para no hacer. Y si ese número se
 * usara para decidir si alcanza para 30, el bot prometería mercancía que no
 * hay.
 *
 * Así que `stockTotal` NO es una cantidad: es el mínimo que esa etiqueta
 * garantiza. «agotado» es 0 porque es cierto; «pocas» es 1 porque lo único que
 * se sabe es que queda algo; «disponible» es el umbral. Con eso la etiqueta
 * vuelve a salir igual —que es para lo que se usa— y ningún número de estos
 * sirve para prometer nada, porque para eso está `pedido`, que viene del
 * sistema con el dato de verdad.
 */
const MINIMO_QUE_GARANTIZA: Record<VariantePublica["disponibilidad"], number> = {
  agotado: 0,
  pocas: 1,
  disponible: 5, // STOCK_BAJO de src/catalog/validation.ts
};

export function aProducto(v: VariantePublica): CatalogProduct {
  const minimo = MINIMO_QUE_GARANTIZA[v.disponibilidad];
  return {
    code: v.codigo,
    name: v.nombre,
    salePrice: v.precioCents,
    // El costo NO viaja por RPC: el sistema no lo manda y aquí no se inventa.
    costPrice: null,
    active: true, // el sistema solo devuelve lo activo y publicado
    // Sin desglose por bodega: el sistema no lo da al bot (es de la dueña).
    stock: [],
    stockTotal: minimo,
    updatedAt: Date.now(),
    ...(v.pedido === undefined ? {} : { pedido: v.pedido }),
  };
}

class FuenteSistema implements FuenteCatalogo {
  readonly nombre = "sistema" as const;
  constructor(private readonly sistema: SistemaBinding) {}

  async search(query: string, limit = 8, cantidad?: number): Promise<CatalogProduct[]> {
    const r = await this.sistema.buscarCatalogo(query, limit, cantidad);
    if (!r.ok) throw new Error(`el sistema no contestó: ${r.codigo} — ${r.mensaje}`);
    return r.datos.map(aProducto);
  }

  async listActive(limit = 50, cantidad?: number): Promise<CatalogProduct[]> {
    const r = await this.sistema.listarCatalogo(cantidad);
    if (!r.ok) throw new Error(`el sistema no contestó: ${r.codigo} — ${r.mensaje}`);
    return r.datos.slice(0, limit).map(aProducto);
  }
}

// ---------------------------------------------------------------------------
// El interruptor
// ---------------------------------------------------------------------------

/**
 * Qué fuente toca, mirando la variable.
 *
 * Falla hacia lo CONOCIDO: si pide «sistema» y el binding no está, se usa la
 * D1 y se avisa por consola. Un bot que se queda mudo porque falta un binding
 * es peor que un bot que sigue contestando con el catálogo de ayer — y el
 * aviso hace que se note.
 */
/**
 * Los nombres que valen para la D1 del CRM.
 *
 * `local` no es un sinónimo de adorno: es el valor que el plan documenta como
 * la VUELTA ATRÁS del traspaso («Vuelta atrás: CATALOGO_FUENTE=local», en
 * docs/plan/08-operacion.md §Traspaso del catálogo). Sin tenerlo aquí, el
 * interruptor de emergencia caía en la rama de «valor desconocido»: funcionaba
 * por el repliegue, avisando en el registro que no lo entendía.
 *
 * Y la vuelta atrás es justo el momento en que nadie quiere una sorpresa ni un
 * aviso que haga dudar de si el cambio surtió efecto.
 */
const NOMBRES_DE_LA_D1 = new Set(["d1", "local"]);

export function fuenteDeCatalogo(env: Env): FuenteCatalogo {
  const quiere = (env.CATALOGO_FUENTE ?? "d1").trim().toLowerCase();

  if (quiere === "sistema") {
    if (env.SISTEMA !== undefined) return new FuenteSistema(env.SISTEMA);
    console.warn(
      JSON.stringify({
        evento: "catalogo_fuente_sin_binding",
        detalle: "CATALOGO_FUENTE=sistema pero falta el service binding SISTEMA; se usa la D1",
      }),
    );
  } else if (!NOMBRES_DE_LA_D1.has(quiere)) {
    console.warn(
      JSON.stringify({ evento: "catalogo_fuente_desconocida", valor: quiere, usando: "d1" }),
    );
  }

  return new FuenteD1(new CatalogRepo(new Db(env.DB)));
}
