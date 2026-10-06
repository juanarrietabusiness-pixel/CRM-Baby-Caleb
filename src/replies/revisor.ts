// El revisor: lo que la respuesta NO puede decir, comprobado ANTES de enviarla.
//
// El prompt le dice al modelo cómo comportarse, y casi siempre le hace caso.
// El "casi" es lo que cuesta: del 29-sep al 6-oct-2026, con todas las reglas
// escritas, el bot le dijo a una clienta "le confirmo que recibimos su abono
// total de $57.50" porque ella escribió que ya había pagado; le dio la
// dirección de retiro que la dueña había mandado quitar; tuteó a otra; le dejó
// "(precio del producto)" a una tercera; y "actualizó" un pedido que ya había
// salido. Ninguna regla faltaba: faltaba alguien que mirara la respuesta antes
// de mandarla.
//
// Esto es ese alguien, y es deliberadamente tonto: expresiones regulares y
// aritmética, sin IA. Así no cuesta nada, no tarda nada y no se equivoca de la
// misma manera que el modelo al que revisa. Solo busca lo que se puede
// comprobar sin entender la conversación; lo demás sigue siendo del prompt.
//
// Lo que encuentra no se tira: se le devuelve al modelo UNA vez para que la
// rehaga (src/agent.ts). Si un problema "bloquea" sigue ahí después, la
// respuesta no sale y la conversación pasa a una persona.

export type Gravedad = "corrige" | "bloquea";

export interface Problema {
  codigo: string;
  gravedad: Gravedad;
  /** El trozo de la respuesta que lo disparó, para el modelo y para los logs. */
  frase: string;
  /** Qué está mal y cómo se arregla, en palabras que el modelo pueda seguir. */
  explicacion: string;
}

export interface ContextoRevision {
  formaDeTrato?: "usted" | "tu" | "vos";
  /**
   * Textos donde un monto tiene respaldo: lo que devolvieron las tools en este
   * turno, el system prompt y los mensajes recientes de la conversación. Un
   * monto de la respuesta que no salga de aquí (ni de sumar o multiplicar los
   * de aquí) es un monto inventado.
   */
  respaldoMontos?: string[];
  /** Frases del negocio que no pueden salir nunca (member/config.local.ts). */
  frasesProhibidas?: { frase: string; motivo: string }[];
  /**
   * Lo que escribió la clienta en este turno. Una frase prohibida que ELLA dijo
   * no se le está revelando: si vive en Altos de Curundú, repetir su barrio no
   * es dar la dirección de retiro.
   */
  textoDeLaClienta?: string;
}

/** Sin tildes ni mayúsculas, con los espacios colapsados. */
export const normalizar = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

interface Regla {
  codigo: string;
  gravedad: Gravedad;
  patrones: RegExp[];
  explicacion: string;
  /**
   * Sobre el texto en minúsculas CON tildes. Hace falta cuando la tilde es lo
   * único que separa lo prohibido de lo correcto: "agendé" (ya lo hice) contra
   * "agende" (que usted agende), "aparté" contra "aparte" (el delivery va aparte).
   */
  conTildes?: boolean;
  /**
   * Si la oración es una condición o una regla general ("si abona antes de la
   * 1, sale hoy", "cuando recibimos su comprobante, una persona lo valida"), no
   * es una promesa ni una confirmación: es lo que dice la base de conocimiento.
   */
  admiteCondicional?: boolean;
}

/** Palabras que convierten una oración en condición o regla general. */
const CONDICIONAL =
  /\b(si|cuando|una vez|en cuanto|apenas|despues de que|hasta que|antes de que|al recibir|antes de la|antes de las|con (el |su )?(abono|pago))\b/;

/**
 * El principio de la oración que contiene la posición `i`. Un punto no corta si
 * es de "a.m."/"p.m." ni si va entre cifras ("$2.50"): "antes de la 1:00 p.m.,
 * sale hoy" es una sola oración, y es una regla.
 */
function oracionEn(texto: string, i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    const c = texto[j];
    if (c === "\n" || c === "!" || c === "?") return texto.slice(j + 1, i);
    if (c !== ".") continue;
    const alrededor = texto.slice(Math.max(0, j - 3), j + 3);
    if (/[ap]\.m/.test(alrededor) || /\d\.\d/.test(texto.slice(j - 1, j + 2))) continue;
    return texto.slice(j + 1, i);
  }
  return texto.slice(0, i);
}

// Los patrones van sobre el texto NORMALIZADO (sin tildes, en minúsculas),
// salvo los de las reglas con `conTildes`.
const REGLAS: Regla[] = [
  {
    codigo: "pago-confirmado",
    gravedad: "bloquea",
    patrones: [
      /\b(recibimos|recibi|hemos recibido|ya recibimos|ya tenemos|ya nos llego|nos llego)\s+(su|el|tu)\s+(pago|abono|comprobante|transferencia|deposito|yappy)/,
      /\b(pago|abono|comprobante|transferencia|deposito)\s+(ya\s+)?(esta|fue|ha sido|quedo|queda)\s+(confirmad|recibid|verificad|validad|aprobad)/,
      /\b(pago|abono|deposito)\s+(confirmado|recibido|verificado|aprobado)\b/,
      /\ble confirmo (que )?(ya )?(recibimos|su pago|su abono|el pago|el abono|su comprobante)/,
    ],
    admiteCondicional: true,
    explicacion:
      "Diste por recibido o confirmado un pago. No ves cuentas ni comprobantes: aunque la clienta diga " +
      "que ya pagó, dile que una persona del equipo lo verifica y le confirma, y llama handoffHuman.",
  },
  {
    codigo: "pedido-tocado",
    gravedad: "corrige",
    conTildes: true,
    admiteCondicional: true,
    patrones: [
      /(?<![\p{L}])(agendé|aparté|reservé|separé|despaché|le agendo|se lo agendo|lo agendo|le aparto|se la aparto|le reservo)(?![\p{L}])/u,
      /(?<![\p{L}])(su|el) pedido (ya )?(queda|quedó|está) (actualizado|confirmado|agendado|apartado|reservado|listo|cambiado)(?![\p{L}])/u,
      /(?<![\p{L}])queda(n)? (agendad|apartad|reservad)/u,
    ],
    explicacion:
      "Dijiste que agendaste, apartaste, cambiaste o confirmaste un pedido. No puedes: lo hace una persona " +
      "del equipo. Dilo así (\"una persona del equipo se lo agenda\"), y si la clienta ya pagó o quiere " +
      "cambiar un pedido hecho, llama handoffHuman.",
  },
  {
    codigo: "promesa-de-entrega",
    gravedad: "corrige",
    patrones: [
      /\b(llega|llegara|llegaria|le llega|sale|saldra|se lo llevan|se la llevan|lo recoge|lo recoja|lo recogen|se lo entregan)\s+(hoy|manana|esta tarde|esta noche|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/,
      /\b(le escriben|le contactan|se comunica|se comunican|le responden|le confirman)\s+(con usted\s+)?hoy mismo\b/,
    ],
    admiteCondicional: true,
    explicacion:
      "Prometiste un día u hora para ESE pedido. No tienes la agenda de entregas. Puedes decir la regla " +
      "general tal como sale de searchKb, como regla y no como promesa, o que una persona le confirma.",
  },
  {
    codigo: "hueco-de-plantilla",
    gravedad: "corrige",
    patrones: [
      /\((precio|monto|total|costo)( del [a-z ]{3,25})?\)/,
      /\[(nombre|precio|monto|zona|talla|producto|cliente)[^\]]{0,25}\]/,
      /\{\{|\}\}/,
    ],
    explicacion:
      "Dejaste un hueco de plantilla en lugar del dato. Consulta la tool que lo tiene (catalogQuery, " +
      "cotizarEnvio, searchKb) o no lo menciones.",
  },
  {
    codigo: "datos-bancarios",
    gravedad: "corrige",
    patrones: [/\b(el )?(nombre|titular|numero) de la cuenta (es|seria)\b/, /\bla cuenta (es|esta) a nombre de\b/],
    explicacion:
      "Diste (o inventaste) datos de una cuenta bancaria. No los tienes: si los piden, una persona del " +
      "equipo los da; llama handoffHuman.",
  },
  {
    codigo: "manda-a-otro-canal",
    gravedad: "corrige",
    patrones: [/\b(nos llama|nos llame|llamenos|llamarnos|nos escribe al|escribanos al|marque al)\b/],
    explicacion:
      "Mandaste a la clienta a llamar o escribir a otro canal para seguir. Si hace falta una persona, eso " +
      "es handoffHuman: así el equipo se entera y el pedido queda registrado.",
  },
];

/** Formas de tú y de vos que no tienen lectura de usted. Sobre el texto normalizado. */
// Sin "estas" (también es "estas cajas") ni formas que compartan con usted.
const TUTEO =
  /\b(tu|tus|te|ti|contigo|tienes|puedes|quieres|necesitas|prefieres|deseas|eres|recibiste|enviaste|pagaste|hiciste|avisame|escribeme|dime|mandame|cuentame|ayudarte|atenderte|confirmarte|enviarte|escribirte|vos|tenes|queres|podes|sabes)\b|\bqueda atent[oa]\b/;

/**
 * Lo que sí puede llevar "tu" sin estar tuteando: el eslogan, que se cita tal
 * cual ("En Baby Caleb Panamá pensamos en cada etapa de tu bebé").
 */
const CITAS_PERMITIDAS = [/pensamos en cada etapa de tu bebe/g];

/** Montos en dólares: "$50", "$ 2.50", "$1,200.00". */
const MONTO = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

/** Centavos de cada monto en un texto. */
export function montosEn(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(MONTO)) {
    const enteros = Number(m[1].replace(/,/g, ""));
    const decimales = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    if (Number.isFinite(enteros)) out.push(enteros * 100 + decimales);
  }
  return out;
}

/**
 * ¿Se puede llegar a este monto con los que tienen respaldo? Un total de verdad
 * es "precio × cajas + envío", "total − abono" o la suma de dos o tres cosas.
 * Se prueban esas formas y nada más: si hiciera falta una cuenta más rebuscada
 * para justificar un número, ese número no salió de los datos.
 */
export function montoRespaldado(objetivo: number, base: Set<number>): boolean {
  if (objetivo === 0 || base.has(objetivo)) return true;
  const b = [...base].filter((x) => x > 0);
  const productos = new Set<number>();
  for (const x of b) for (let k = 1; k <= 100; k++) productos.add(x * k);
  if (productos.has(objetivo)) return true;
  for (const p of productos) {
    for (const y of b) {
      if (p + y === objetivo || p - y === objetivo) return true;
      for (const z of b) {
        if (p + y + z === objetivo || p + y - z === objetivo) return true;
      }
    }
  }
  return false;
}

/** Un fragmento alrededor de una coincidencia, para mostrarle al modelo qué dijo. */
function fragmento(texto: string, normal: string, indice: number, largo: number): string {
  // El texto normalizado tiene la misma longitud que el original salvo por los
  // espacios colapsados; para un recorte que se lea, basta con el normalizado.
  const desde = Math.max(0, indice - 30);
  return normal.slice(desde, indice + largo + 30).trim() || texto.slice(0, 80);
}

/** Revisa una respuesta. Pura: no llama a nada ni escribe nada. */
export function revisarRespuesta(texto: string, ctx: ContextoRevision = {}): Problema[] {
  const problemas: Problema[] = [];
  if (!texto.trim()) return problemas;
  const normal = normalizar(texto);
  const minusculas = texto.toLowerCase().replace(/\s+/g, " ");

  for (const r of REGLAS) {
    const donde = r.conTildes ? minusculas : normal;
    let hallado = false;
    for (const p of r.patrones) {
      const global = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
      for (const m of donde.matchAll(global)) {
        if (m.index === undefined) continue;
        if (r.admiteCondicional && CONDICIONAL.test(normalizar(oracionEn(donde, m.index)))) continue;
        problemas.push({
          codigo: r.codigo,
          gravedad: r.gravedad,
          frase: fragmento(texto, donde, m.index, m[0].length),
          explicacion: r.explicacion,
        });
        hallado = true;
        break;
      }
      if (hallado) break; // una vez por regla basta
    }
  }

  const dichoPorElla = normalizar(ctx.textoDeLaClienta ?? "");
  for (const f of ctx.frasesProhibidas ?? []) {
    const aguja = normalizar(f.frase);
    const i = aguja ? normal.indexOf(aguja) : -1;
    if (i >= 0 && !dichoPorElla.includes(aguja)) {
      problemas.push({
        codigo: "frase-prohibida",
        gravedad: "bloquea",
        frase: fragmento(texto, normal, i, aguja.length),
        explicacion: `Escribiste "${f.frase}", que este negocio no permite: ${f.motivo}. Quítalo.`,
      });
    }
  }

  if (ctx.formaDeTrato === "usted") {
    let sinCitas = normal;
    for (const c of CITAS_PERMITIDAS) sinCitas = sinCitas.replace(c, " ");
    const m = sinCitas.match(TUTEO);
    if (m && m.index !== undefined) {
      problemas.push({
        codigo: "tuteo",
        gravedad: "corrige",
        frase: fragmento(texto, sinCitas, m.index, m[0].length),
        explicacion:
          `Tuteaste ("${m[0]}"). Este negocio trata de USTED siempre: "su", "le", "puede", "necesita", ` +
          '"quede atenta". Reescribe la respuesta entera de usted.',
      });
    }
  }

  if (ctx.respaldoMontos) {
    const base = new Set<number>();
    for (const t of ctx.respaldoMontos) for (const c of montosEn(t)) base.add(c);
    const sueltos = [...new Set(montosEn(texto))].filter((c) => !montoRespaldado(c, base));
    if (sueltos.length > 0) {
      const lista = sueltos.map((c) => `$${(c / 100).toFixed(2)}`).join(", ");
      problemas.push({
        codigo: "monto-sin-respaldo",
        gravedad: "corrige",
        frase: lista,
        explicacion:
          `Dijiste ${lista} y ese monto no salió de ninguna tool ni de la conversación. Si es un precio, ` +
          "consulta catalogQuery; si es un envío, cotizarEnvio; si es una regla (abono, cargos), searchKb. " +
          "Si no lo puedes respaldar, no lo digas.",
      });
    }
  }

  return problemas;
}

/** ¿Alguno de estos problemas impide enviar la respuesta? */
export const hayQueBloquear = (ps: Problema[]): boolean => ps.some((p) => p.gravedad === "bloquea");

/**
 * La nota que se le pasa al modelo para que rehaga la respuesta. Va como un
 * bloque de sistema más, después del prompt: el borrador, qué tiene mal y lo que
 * devolvieron las tools en este turno, para que no tenga que volver a llamarlas.
 */
export function notaDeRevision(borrador: string, problemas: Problema[], datosDeTools: string): string {
  const lista = problemas.map((p, i) => `${i + 1}. [${p.codigo}] «${p.frase}» — ${p.explicacion}`).join("\n");
  return `<revision_de_tu_respuesta>
Tu respuesta NO se envió: rompe reglas del negocio. Reescríbela entera para la clienta,
manteniendo lo que estaba bien, sin estos problemas:

${lista}

Tu borrador era:
"""
${borrador.slice(0, 3000)}
"""
${
  datosDeTools
    ? `\nLo que devolvieron tus tools en este turno (ya están llamadas; si te sirven, úsalas, no las repitas):\n"""\n${datosDeTools.slice(0, 6000)}\n"""\n`
    : ""
}
Escribe SOLO la respuesta corregida, como si fuera la primera. No menciones esta revisión.
</revision_de_tu_respuesta>`;
}

/**
 * Lo que sale cuando la respuesta sigue rompiendo una regla que bloquea después
 * de rehacerla: corto, verdadero y sin compromisos. Quien llama abre el ticket.
 */
export function respuestaSegura(trato?: "usted" | "tu" | "vos"): string {
  if (trato === "tu") return "Gracias por escribirnos. Te paso con una persona del equipo para que te lo confirme por aquí.";
  if (trato === "vos") return "Gracias por escribirnos. Te paso con una persona del equipo para que te lo confirme por acá.";
  return "Gracias por escribirnos. Le paso con una persona del equipo para que se lo confirme por aquí.";
}
