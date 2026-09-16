// Lógica pura del puente de WhatsApp: autenticación, huellas y esperas.
//
// Vive aparte del Worker a propósito. Todo lo de aquí es determinista y sin
// red, así que se puede probar en CI — y cada función de este archivo existe
// porque un fallo real nos costó una tarde. Los tests están en
// `test/puente-wa/comun.test.ts` y son el candado para que no vuelvan.

/** Espera base entre latidos del Durable Object, con el contenedor sano. */
export const LATIDO_MS = 60_000;

/**
 * Cuatro caracteres derivados de una cadena. Sirve para COMPARAR dos secretos
 * sin exponer ninguno — por ejemplo, para ver en una página de diagnóstico si
 * el token que tiene el contenedor es el mismo que valida el Worker.
 *
 * No es criptográfica y no pretende serlo: es un identificador de igualdad.
 */
export function huella(s: string): string {
  // FNV-1a de 32 bits, y se devuelve ENTERA. Una versión anterior recortaba a
  // cuatro caracteres y colisionaba con facilidad: "abcdefghij" y "abcdefghik"
  // daban la misma huella. Una huella que colisiona es peor que no tener
  // ninguna — diría "los dos lados tienen el mismo token" cuando no lo tienen,
  // y mandaría el diagnóstico siguiente al lugar equivocado.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

export type ViaDelToken = "cabecera-b64" | "query" | "nada";

/**
 * De dónde vino el token y cuál era.
 *
 * El contenedor lo manda SIEMPRE en base64, nunca en claro, y esa no es una
 * precaución de más: Node escribe el valor de una cabecera en latin-1 —un byte
 * por code unit— y el runtime de Cloudflare lo lee como UTF-8. Un solo carácter
 * fuera de ASCII viaja como byte suelto, que es UTF-8 inválido, y llega
 * convertido en el carácter de reemplazo. Como la sustitución es uno a uno, el
 * largo NO cambia: el token llega del mismo tamaño y con distinto contenido, y
 * el 401 resultante no delata nada.
 *
 * Por `?t=` en la URL no ocurre, porque ahí el valor viaja en porcentajes — por
 * eso una persona entraba bien y el contenedor no.
 */
export function tokenPresentado(request: Request): { via: ViaDelToken; valor: string } {
  const b64 = request.headers.get("x-wa-token-b64");
  if (b64 !== null) {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return { via: "cabecera-b64", valor: new TextDecoder().decode(bytes) };
    } catch {
      return { via: "cabecera-b64", valor: "" };
    }
  }
  const deQuery = new URL(request.url).searchParams.get("t");
  if (deQuery !== null) return { via: "query", valor: deQuery };
  return { via: "nada", valor: "" };
}

/** Comparación de tiempo constante. Un token no se compara con `===`. */
export function tokensIguales(presentado: string, esperado: string): boolean {
  if (presentado.length !== esperado.length || esperado.length === 0) return false;
  let diferencia = 0;
  for (let i = 0; i < presentado.length; i++) {
    diferencia |= presentado.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diferencia === 0;
}

export function autorizado(request: Request, esperado: string): boolean {
  return tokensIguales(tokenPresentado(request).valor, esperado);
}

/**
 * Cuánto esperar hasta el próximo latido, según cuántos seguidos encontraron el
 * contenedor caído.
 *
 * Relevantar cada minuto un contenedor que se cae al arrancar es lo que hizo
 * que Cloudflare dejara de entregar instancias ("There is no container instance
 * that can be provided to this Durable Object"). Insistir más rápido retrasa la
 * recuperación en vez de acelerarla.
 */
export function proximoLatido(fallosSeguidos: number): number {
  const fallos = Number.isFinite(fallosSeguidos) ? Math.max(0, fallosSeguidos) : 0;
  if (fallos === 0) return LATIDO_MS;
  return Math.min(LATIDO_MS * 2 ** fallos, 15 * 60_000);
}

/**
 * Un token apto para viajar hacia el contenedor: solo ASCII imprimible.
 *
 * Se valida al desplegar y se reporta en el diagnóstico. Un token con una ñ o
 * una tilde pasa toda prueba manual hecha por navegador —la URL lo codifica
 * bien— y falla únicamente en la máquina, que es el peor lugar donde puede
 * fallar. Mejor rechazarlo de entrada que perseguir el síntoma después.
 */
export function tokenEsApto(token: string): { apto: boolean; motivo?: string } {
  if (token.length < 24) return { apto: false, motivo: "demasiado corto (mínimo 24)" };
  if (!/^[\x21-\x7E]+$/.test(token)) {
    return { apto: false, motivo: "tiene caracteres fuera de ASCII imprimible" };
  }
  return { apto: true };
}

/**
 * Cuántas filas van en cada ida a D1 dentro de una misma petición del lote.
 *
 * El viaje caro es el del contenedor al puente, y ese ya es uno solo. Estas
 * idas ocurren dentro del Worker, a milisegundos de D1, así que partirlas para
 * no pasarse de los límites de una consulta no cuesta prácticamente nada.
 */
export const FILAS_POR_IDA = 90;

/**
 * Parte una lista en grupos de `tamano`, sin perder ni repetir elementos.
 *
 * Trivial de escribir y trivial de equivocar: un off-by-one aquí se traduce en
 * llaves de cifrado que nunca se guardan, y eso no se nota como un error — se
 * nota como un WhatsApp que se vincula y al rato deja de funcionar. Por eso
 * está aparte y con pruebas propias.
 */
export function pedazos<T>(lista: T[], tamano: number): T[][] {
  if (tamano < 1) throw new Error("El tamaño del pedazo tiene que ser al menos 1.");
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano));
  return salida;
}

// ── Salud real del canal ───────────────────────────────────────────────────
//
// Todo lo que sigue nació del fallo del 16-sep-2026: el canal se quedó mudo
// una noche entera y volvió solo cuando el dueño abrió el panel. Ver la entrada
// "El latido medía lo que no importaba" en docs/bitacora-whatsapp-qr.md.

/** Cada cuánto el vigilante del contenedor revisa su propio socket. */
export const VIGILANTE_MS = 30_000;

/**
 * Cuántos latidos seguidos con el contenedor prendido pero SIN conexión a
 * WhatsApp antes de destruirlo y levantarlo de cero.
 *
 * Cinco (≈5 min) y no uno: reconectar es lo barato y hay que darle tiempo a
 * que funcione. Destruir el contenedor es el martillo — sale gratis en
 * credenciales porque viven en D1, pero cuesta una resincronización entera.
 */
export const LATIDOS_ANTES_DE_REINICIAR = 5;

/**
 * Cuánto puede tardar un latido en llegar antes de considerar que el latido
 * MISMO está muerto. Tres veces la espera base: un latido perdido es ruido,
 * tres seguidos es que la alarma dejó de existir.
 */
export const LATIDO_VENCIDO_MS = LATIDO_MS * 3;

export type Veredicto = "sano" | "esperando-a-una-persona" | "caido";

/**
 * Qué hacer con lo que contesta el contenedor.
 *
 * Existe aparte y con pruebas porque es EL juicio que el latido se equivocaba
 * en hacer. La versión anterior preguntaba `container.running` —"¿el proceso
 * está prendido?"— cuando lo que importa es "¿WhatsApp está conectado?". Un
 * contenedor prendido con el socket muerto salía sano y el canal se quedaba
 * mudo sin que nada lo notara.
 *
 * `esperando-a-una-persona` no es un estado sano, pero TAMPOCO es un fallo que
 * se arregle reiniciando: si nadie ha escaneado el QR, reiniciar solo genera un
 * código nuevo y le tumba al dueño el que está mirando.
 */
export function veredictoDeSalud(conexion: string | null | undefined): Veredicto {
  if (conexion === "conectada") return "sano";
  if (conexion === "esperando-qr" || conexion === "desvinculada") {
    return "esperando-a-una-persona";
  }
  return "caido";
}

/**
 * ¿El latido está llegando?
 *
 * Es la señal que faltaba el 16-sep: la alarma del Durable Object se había
 * apagado y NADA lo decía — el panel mostraba el canal como si todo estuviera
 * bien. Con esto, un latido vencido se ve en la tarjeta antes de que el dueño
 * descubra el silencio escribiéndole al bot.
 */
export function latidoVencido(ultimoLatidoEn: number | null | undefined, ahora: number): boolean {
  if (!ultimoLatidoEn) return false; // todavía no ha latido ninguna vez
  return ahora - ultimoLatidoEn > LATIDO_VENCIDO_MS;
}
