// ¿Puede el bot LEER los DMs de Instagram preguntándole a Meta?
//
// El webhook de Instagram tiene un techo: con acceso estándar, Meta solo lo
// dispara cuando quien escribe tiene un rol en la app. Por eso los DMs de la
// dueña entran y los de las clientas no.
//
// Pero leer las conversaciones de la PROPIA cuenta es otra cosa: son datos del
// dueño, no del que escribe, y esa regla no aplica. Es lo que hace la Bandeja
// del calendario —`/{page-id}/conversations?platform=instagram`— y por eso ahí
// se ven los mensajes de todo el mundo sin pasar por la revisión de Meta.
//
// Esto comprueba ESE camino con el token del bot, antes de construir nada
// encima. Solo lee: no envía ni un mensaje, y ni siquiera pide el texto de las
// conversaciones — con los ids, las fechas y los usuarios alcanza para saber si
// el camino existe.
import type { Env } from "../env";
import { graphVersion } from "./graph";
import type { DiagCheck, DiagStatus } from "./whatsappDiag";

export interface InstagramReadDiagnosis {
  checks: DiagCheck[];
  verdict: DiagStatus;
  checkedAt: number;
}

interface GraphErr {
  message?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
}

/** Códigos de Graph que son "vuelve a intentar", no "no tienes permiso". */
// -2 es el "Timeout" de Graph: la consulta tardó demasiado del lado de Meta.
// No dice nada de permisos, así que se reintenta como cualquier tropiezo.
const TRANSITORIOS = [-2, 1, 2, 4, 17, 32, 341, 613, 9004];

interface LeidoError {
  text: string;
  code?: number;
  transient: boolean;
}

async function graphError(res: Response): Promise<LeidoError> {
  const body = await res.text().catch(() => "");
  try {
    const err = (JSON.parse(body) as { error?: GraphErr }).error;
    if (err?.message) {
      const code = err.code ? ` (código ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "";
      return {
        text: `${err.message}${code}`,
        code: err.code,
        transient: Boolean(err.is_transient) || TRANSITORIOS.includes(Number(err.code)) || res.status >= 500,
      };
    }
  } catch {
    /* no era JSON */
  }
  return { text: body.slice(0, 300) || `HTTP ${res.status}`, transient: res.status >= 500 };
}

/** Un permiso denegado se arregla distinto que un límite de peticiones. */
function esPermiso(code?: number): boolean {
  return code === 10 || (typeof code === "number" && code >= 200 && code < 300);
}

interface Participante {
  id?: string;
  username?: string;
  name?: string;
}

interface Conversacion {
  id?: string;
  updated_time?: string;
  participants?: { data?: Participante[] };
  messages?: { data?: { id?: string; created_time?: string; from?: { id?: string } }[] };
}

/** Un error 100 por permisos nombra el permiso que falta: se lo decimos. */
function fixDeError(err: LeidoError): string {
  if (err.transient) return "Meta limitó las peticiones o tuvo un tropiezo. Reintenta en unos minutos.";
  if (err.code === 190) {
    return "El token venció o fue revocado. Genera el de la Página otra vez y guárdalo como META_PAGE_ACCESS_TOKEN.";
  }
  if (err.code === 100 && /pages_read_engagement|Page Public/i.test(err.text)) {
    return "Al token le falta pages_read_engagement, así que el otorgamiento de la Página a la app es mínimo. Ese otorgamiento se hace con un inicio de sesión de Facebook que pida los permisos; regenerar el token no lo arregla.";
  }
  if (esPermiso(err.code) || err.code === 100) {
    return "Al token le faltan permisos sobre esta Página. Hay que hacer el otorgamiento con un inicio de sesión que pida instagram_basic, instagram_manage_messages, pages_messaging, pages_read_engagement y pages_manage_metadata.";
  }
  return "Comprueba que META_PAGE_ACCESS_TOKEN sea el token de la Página Baby Caleb, generado por la app Baby Cale CRM.";
}

interface DatosToken {
  scopes: string[];
  /** Id de la Página (o del usuario) dueña del token. */
  profileId?: string;
  appId?: string;
  /** "PAGE" | "USER" | … */
  type?: string;
  /** Epoch en segundos; 0 = no caduca. */
  expiresAt?: number;
  error?: string;
}

/**
 * Una sola consulta a `debug_token`, que es el "Access Token Debugger" de Meta.
 * Es la única pregunta que NO necesita permisos sobre la Página: habla del
 * token en sí. Por eso de aquí sale tanto quién es el dueño como qué permisos
 * lleva — leer `/me` ya pide `pages_read_engagement`, y si falta, esconde todo
 * lo demás.
 */
async function leerToken(env: Env, token: string): Promise<DatosToken> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return { scopes: [], error: (await graphError(res)).text };
    const json = (await res.json().catch(() => ({}))) as {
      data?: { scopes?: string[]; profile_id?: string; app_id?: string; type?: string; expires_at?: number };
    };
    const d = json.data ?? {};
    return {
      scopes: d.scopes ?? [],
      profileId: d.profile_id ? String(d.profile_id) : undefined,
      appId: d.app_id ? String(d.app_id) : undefined,
      type: d.type,
      expiresAt: typeof d.expires_at === "number" ? d.expires_at : undefined,
    };
  } catch (e: any) {
    return { scopes: [], error: e?.message ?? String(e) };
  }
}

/** La app a la que pertenece el token del bot, para detectar un token ajeno. */
const APP_DEL_BOT = "2099638607582456"; // Baby Cale CRM

/** Paso 1 — de quién es el token, sin pedirle permiso a nadie. */
function checkDeQuien(datos: DatosToken, propios: Set<string>): DiagCheck {
  const label = "De quién es el token";
  if (datos.error || !datos.profileId) {
    return {
      id: "token",
      label,
      status: "skip",
      detail: datos.error ? `Meta no quiso describir el token: ${datos.error}` : "Meta no dijo de quién es el token.",
    };
  }
  propios.add(datos.profileId);
  const tipo = datos.type === "PAGE" ? "de una Página" : `de tipo ${datos.type ?? "desconocido"}`;
  const app =
    datos.appId && datos.appId !== APP_DEL_BOT
      ? ` ⚠ Lo emitió la app ${datos.appId}, que NO es Baby Cale CRM (${APP_DEL_BOT}).`
      : "";
  // Un token que caduca es una bomba de tiempo: el bot deja de contestar el día
  // que expira, sin que nadie toque nada.
  const caduca =
    datos.expiresAt && datos.expiresAt > 0
      ? ` Caduca el ${new Date(datos.expiresAt * 1000).toLocaleDateString("es-PA")}.`
      : " No caduca.";
  return {
    id: "token",
    label,
    status: app ? "warn" : "ok",
    detail: `Token ${tipo}, id ${datos.profileId}.${caduca}${app}`,
    fix: app ? "Genera el token desde la app Baby Cale CRM, que es la que tiene el webhook del bot." : undefined,
  };
}

/**
 * ¿A qué campos está suscrita la app en ESTA Página?
 *
 * Es distinto de tener el webhook configurado en el panel de Meta: lo que
 * gobierna la entrega es `subscribed_fields` de la Página. Si ahí no está
 * `messages`, Meta no manda los mensajes entrantes por mucho que el webhook
 * esté verde — y el síntoma sería justo el nuestro, porque los ecos y recibos
 * viajan por otra vía.
 *
 * El calendario suscribe sus Páginas por API al encender la bandeja; en el CRM
 * se hizo a mano desde el panel. No tiene por qué haber quedado igual.
 */
async function checkSuscripcion(env: Env, token: string): Promise<DiagCheck> {
  const label = "Campos suscritos de la Página";
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/me/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    return { id: "suscripcion", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` };
  }
  if (!res.ok) {
    const err = await graphError(res);
    return {
      id: "suscripcion",
      label,
      status: err.transient ? "warn" : "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: fixDeError(err),
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; name?: string; subscribed_fields?: string[] }[];
  };
  const apps = json.data ?? [];
  if (apps.length === 0) {
    return {
      id: "suscripcion",
      label,
      status: "fail",
      detail: "NINGUNA app está suscrita a esta Página.",
      fix: "Sin suscripción Meta no manda nada. Hay que suscribir la Página a la app con el campo messages.",
    };
  }
  const mia = apps.find((a) => a.id === APP_DEL_BOT) ?? apps[0];
  const campos = mia.subscribed_fields ?? [];
  const nombre = mia.name ?? mia.id ?? "la app";
  if (!campos.includes("messages")) {
    return {
      id: "suscripcion",
      label,
      status: "fail",
      detail: `"${nombre}" está suscrita a: ${campos.join(", ") || "ningún campo"}. NO incluye "messages".`,
      fix: "Aquí está el problema: sin el campo messages en la suscripción de la Página, Meta no entrega los mensajes entrantes aunque el webhook esté bien. Hay que suscribir la Página con messages.",
    };
  }
  const otras = apps.length > 1 ? ` Hay ${apps.length} apps suscritas.` : "";
  return {
    id: "suscripcion",
    label,
    status: "ok",
    detail: `"${nombre}" suscrita a: ${campos.join(", ")}.${otras}`,
  };
}

/**
 * Paso 3 — ¿la Página trae Instagram colgando, visto desde ESTE token? Leer
 * ese campo pide `pages_read_engagement`, así que un fallo aquí dice tanto
 * del otorgamiento como de la vinculación.
 */
async function checkInstagramVinculado(
  env: Env,
  token: string,
  propios: Set<string>,
): Promise<DiagCheck> {
  const label = "Instagram vinculado a la Página";
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/me?fields=instagram_business_account{id,username}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e: any) {
    return { id: "ig", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` };
  }
  if (!res.ok) {
    const err = await graphError(res);
    // Sin `pages_read_engagement` no se puede leer NINGÚN campo de la Página.
    // Eso no bloquea los DMs: es "no comprobable desde aquí", no "roto".
    if (err.code === 100 && /pages_read_engagement|Page Public/i.test(err.text)) {
      return {
        id: "ig",
        label,
        status: "warn",
        detail: "No se puede comprobar desde aquí: al token le falta pages_read_engagement para leer los datos de la Página.",
        fix: "No bloquea los DMs. La vinculación ya se vio en Meta Business Suite; si quieres comprobarla por API, añade pages_read_engagement al otorgamiento.",
      };
    }
    return {
      id: "ig",
      label,
      status: err.transient ? "warn" : "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: fixDeError(err),
    };
  }
  const page = (await res.json().catch(() => ({}))) as {
    instagram_business_account?: { id?: string; username?: string };
  };
  const ig = page.instagram_business_account;
  if (!ig?.id) {
    return {
      id: "ig",
      label,
      status: "fail",
      detail: "El token lee la Página pero NO ve ninguna cuenta de Instagram vinculada.",
      fix: "Vincula la cuenta de Instagram a esa Página y vuelve a generar el token.",
    };
  }
  propios.add(String(ig.id));
  return { id: "ig", label, status: "ok", detail: `Instagram @${ig.username ?? ig.id} vinculado a la Página.` };
}

/**
 * Paso 2 — qué permisos lleva el token POR DENTRO.
 *
 * El generador de tokens de Meta no deja elegir permisos: el token solo lleva
 * lo que la Página ya le concedió a la app. Por eso regenerarlo no arregla
 * nada si el otorgamiento nunca se hizo — y por eso hay que poder VER lo que
 * lleva, sin que nadie tenga que copiar el token a ninguna herramienta.
 *
 * Es lo mismo que hace el "Access Token Debugger" de Meta, aquí adentro.
 * Best-effort: si Meta no deja leer los scopes con este token, se marca como
 * no comprobable y manda la prueba de verdad, que es pedir las conversaciones.
 */
function checkPermisos(datos: DatosToken): DiagCheck {
  const label = "Permisos dentro del token";
  const falta =
    "El token NO lleva instagram_manage_messages. Regenerarlo no sirve: ese generador no deja elegir permisos, solo refleja lo que la Página ya le concedió a la app. Hay que hacer el otorgamiento con un inicio de sesión de Facebook que pida los permisos (Explorador de la API de Graph, o una configuración de Inicio de sesión con Facebook para empresas) y DESPUÉS volver a generar el token.";
  if (datos.scopes.length === 0) {
    return {
      id: "permisos",
      label,
      status: "skip",
      detail: "Meta no devolvió la lista de permisos del token; lo dice la prueba de abajo.",
    };
  }
  // `pages_read_engagement` no sirve para los DMs, pero sin él no se puede leer
  // NADA de la Página — ni su nombre. Por eso va en la lista aunque Meta no lo
  // pida para mensajería.
  const necesarios = [
    "instagram_basic",
    "instagram_manage_messages",
    "pages_messaging",
    "pages_manage_metadata",
    "pages_read_engagement",
  ];
  const faltantes = necesarios.filter((p) => !datos.scopes.includes(p));
  const lleva = `Lleva: ${datos.scopes.join(", ")}.`;
  if (faltantes.includes("instagram_manage_messages")) {
    return { id: "permisos", label, status: "fail", detail: lleva, fix: falta };
  }
  if (faltantes.length > 0) {
    return {
      id: "permisos",
      label,
      status: "warn",
      detail: `${lleva} Le falta: ${faltantes.join(", ")}.`,
      fix: "Tiene el de mensajes de Instagram, que es el que manda para recibir y responder DMs. Los que faltan limitan otras consultas (por ejemplo leer los datos de la Página), no la mensajería.",
    };
  }
  return { id: "permisos", label, status: "ok", detail: `${lleva} Están todos los necesarios.` };
}

/**
 * Paso 3 — la prueba de verdad: pedir las conversaciones de Instagram. Si
 * vuelven conversaciones de gente que no es la cuenta, el camino de "preguntar"
 * funciona con acceso estándar y el bot puede dejar de depender del webhook.
 */
async function checkConversaciones(env: Env, token: string, propios: Set<string>): Promise<DiagCheck> {
  const label = "Lectura de conversaciones de Instagram";
  // Meta rechaza una consulta "demasiado grande" con un código 1 y el mensaje
  // "Please reduce the amount of data you're asking for" — que NO es un
  // permiso denegado: la consulta estaba autorizada. Así que se pide menos y
  // se reintenta, de lo más completo a lo mínimo.
  // Sin `message`: para saber si el camino existe bastan ids, fechas y quién es.
  const intentos = [
    { fields: "id,updated_time,participants,messages.limit(1){id,created_time,from}", limit: 10 },
    { fields: "id,updated_time,participants", limit: 5 },
    { fields: "id,updated_time", limit: 3 },
  ];
  let res!: Response;
  let err!: LeidoError;
  for (const intento of intentos) {
    try {
      res = await fetch(
        `https://graph.facebook.com/${graphVersion(env)}/me/conversations?platform=instagram&fields=${encodeURIComponent(intento.fields)}&limit=${intento.limit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (e: any) {
      return { id: "conversaciones", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` };
    }
    if (res.ok) break;
    err = await graphError(res);
    // Solo tiene sentido reintentar si la queja fue el TAMAÑO de la consulta.
    if (!/reduce the amount of data/i.test(err.text)) break;
  }
  if (!res.ok) {
    // Que Meta pida "menos datos" ya dice algo bueno: la consulta ESTABA
    // autorizada. No es lo mismo que un permiso denegado ni que un límite.
    if (/reduce the amount of data/i.test(err.text)) {
      return {
        id: "conversaciones",
        label,
        status: "warn",
        detail: "Meta pidió una consulta más pequeña y se quejó hasta con la mínima.",
        fix: "Importante: eso NO es un permiso denegado — la consulta está autorizada, solo pesa demasiado. Suele pasar con cuentas con muchas conversaciones. Vuelve a probar en unos minutos.",
      };
    }
    if (err.transient) {
      return {
        id: "conversaciones",
        label,
        status: "warn",
        detail: `Meta no contestó esta vez: ${err.text}`,
        fix: /timeout/i.test(err.text)
          ? "Timeout: la consulta tardó demasiado del lado de Meta, pero ESTABA autorizada. Suele pasar con buzones grandes. Vuelve a probar en unos minutos."
          : "Es un límite de peticiones o un tropiezo de Meta, NO un permiso denegado. Vuelve a probar en unos minutos.",
      };
    }
    return {
      id: "conversaciones",
      label,
      status: "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: esPermiso(err.code)
        ? "Al token le falta instagram_manage_messages. Hay que hacer el otorgamiento con un inicio de sesión que lo pida; regenerar el token no lo arregla."
        : fixDeError(err),
    };
  }
  const json = (await res.json().catch(() => ({}))) as { data?: Conversacion[] };
  const convs = json.data ?? [];
  if (convs.length === 0) {
    return {
      id: "conversaciones",
      label,
      status: "warn",
      detail: "Meta aceptó la consulta pero devolvió 0 conversaciones.",
      fix: "Manda un DM a la cuenta desde otro Instagram y vuelve a probar. Si sigue en 0 con mensajes recientes, este camino no sirve y toca la revisión de Meta.",
    };
  }
  const ahora = Date.now();
  const interlocutores = new Map<string, string>();
  let ultimas24h = 0;
  for (const conv of convs) {
    const otro = (conv.participants?.data ?? []).find((p) => p.id && !propios.has(String(p.id)));
    if (otro?.id) {
      interlocutores.set(String(otro.id), otro.username ? `@${otro.username}` : otro.name || "sin nombre");
    }
    const t = Date.parse(conv.updated_time ?? "");
    if (Number.isFinite(t) && ahora - t < 24 * 60 * 60 * 1000) ultimas24h++;
  }
  const muestra = [...interlocutores.values()].slice(0, 4).join(", ");
  return {
    id: "conversaciones",
    label,
    status: "ok",
    detail:
      `Meta devolvió ${convs.length} conversación(es) de ${interlocutores.size} persona(s); ` +
      `${ultimas24h} con actividad en las últimas 24 h (la ventana en la que Meta deja responder).` +
      (muestra ? ` Por ejemplo: ${muestra}.` : ""),
    fix:
      interlocutores.size > 0
        ? "Si entre esas personas hay alguna SIN rol en la app, el camino está confirmado: el bot puede leer preguntando y dejar de depender solo del webhook."
        : undefined,
  };
}

/**
 * Pregunta a Meta si se pueden leer los DMs de Instagram de la cuenta. Solo
 * lectura: ninguna de las dos llamadas envía mensajes ni cambia nada.
 */
export async function diagnoseInstagramRead(env: Env): Promise<InstagramReadDiagnosis> {
  const checks: DiagCheck[] = [];
  const token = env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!token) {
    checks.push({
      id: "token",
      label: "Token de la Página",
      status: "fail",
      detail: "No hay META_PAGE_ACCESS_TOKEN guardado, así que no hay nada que preguntar.",
      fix: "Genera el token de la Página en la app de Meta y guárdalo: wrangler secret put META_PAGE_ACCESS_TOKEN.",
    });
    return { checks, verdict: "fail", checkedAt: Date.now() };
  }
  // Las cuatro preguntas se hacen SIEMPRE, aunque una falle: cada una dice algo
  // distinto, y la más valiosa —qué permisos lleva el token— no depende de que
  // las otras funcionen. Frenarse en la primera fue esconder el diagnóstico.
  //
  // Las dos primeras salen de una sola consulta a debug_token, que es la única
  // que no necesita permisos sobre la Página.
  const propios = new Set<string>();
  const datos = await leerToken(env, token);
  checks.push(checkDeQuien(datos, propios));
  checks.push(checkPermisos(datos));
  checks.push(await checkSuscripcion(env, token));
  checks.push(await checkInstagramVinculado(env, token, propios));
  checks.push(await checkConversaciones(env, token, propios));
  const verdict: DiagStatus = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  return { checks, verdict, checkedAt: Date.now() };
}
