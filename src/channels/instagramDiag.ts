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
const TRANSITORIOS = [1, 2, 4, 17, 32, 341, 613, 9004];

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

/**
 * Paso 1 — ¿el token sirve, de qué Página es y tiene Instagram colgando?
 * Devuelve también los ids propios, para no contarlos como interlocutores.
 */
async function checkToken(
  env: Env,
  token: string,
): Promise<{ check: DiagCheck; propios: Set<string> }> {
  const label = "Token de la Página e Instagram vinculado";
  const propios = new Set<string>();
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/me?fields=id,name,instagram_business_account{id,username}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e: any) {
    return {
      check: { id: "token", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` },
      propios,
    };
  }
  if (!res.ok) {
    const err = await graphError(res);
    return {
      check: {
        id: "token",
        label,
        status: err.transient ? "warn" : "fail",
        detail: `Meta rechazó la consulta: ${err.text}`,
        fix: err.transient
          ? "Meta limitó las peticiones o tuvo un tropiezo. Reintenta en unos minutos."
          : err.code === 190
            ? "El token venció o fue revocado. Genera el de la Página otra vez en Meta y guárdalo como META_PAGE_ACCESS_TOKEN."
            : "Comprueba que META_PAGE_ACCESS_TOKEN sea el token de la Página Baby Caleb, generado por la app Baby Cale CRM.",
      },
      propios,
    };
  }
  const page = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    instagram_business_account?: { id?: string; username?: string };
  };
  if (page.id) propios.add(String(page.id));
  const ig = page.instagram_business_account;
  if (ig?.id) propios.add(String(ig.id));
  if (!ig?.id) {
    return {
      check: {
        id: "token",
        label,
        status: "fail",
        detail: `El token sirve y es de la Página "${page.name ?? page.id}", pero NO trae cuenta de Instagram vinculada.`,
        fix: "Vincula la cuenta de Instagram a esa Página y vuelve a generar el token con instagram_basic e instagram_manage_messages.",
      },
      propios,
    };
  }
  return {
    check: {
      id: "token",
      label,
      status: "ok",
      detail: `Página "${page.name ?? page.id}" con Instagram @${ig.username ?? ig.id} vinculado.`,
    },
    propios,
  };
}

/**
 * Paso 2 — la prueba de verdad: pedir las conversaciones de Instagram. Si
 * vuelven conversaciones de gente que no es la cuenta, el camino de "preguntar"
 * funciona con acceso estándar y el bot puede dejar de depender del webhook.
 */
async function checkConversaciones(env: Env, token: string, propios: Set<string>): Promise<DiagCheck> {
  const label = "Lectura de conversaciones de Instagram";
  // Sin `message`: para saber si el camino existe bastan ids, fechas y quién es.
  const fields = "id,updated_time,participants,messages.limit(1){id,created_time,from}";
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/me/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=25`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e: any) {
    return { id: "conversaciones", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` };
  }
  if (!res.ok) {
    const err = await graphError(res);
    if (err.transient) {
      return {
        id: "conversaciones",
        label,
        status: "warn",
        detail: `Meta no contestó esta vez: ${err.text}`,
        fix: "Es un límite de peticiones o un tropiezo de Meta, NO un permiso denegado. Vuelve a probar en unos minutos.",
      };
    }
    return {
      id: "conversaciones",
      label,
      status: "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: esPermiso(err.code)
        ? "Al token le falta instagram_manage_messages. Regenera el token de la Página otorgando instagram_basic, instagram_manage_messages, pages_messaging y pages_manage_metadata."
        : "Comprueba que la cuenta de Instagram esté vinculada a esta Página y que el token sea de esta app.",
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
  const { check: tokenCheck, propios } = await checkToken(env, token);
  checks.push(tokenCheck);
  if (tokenCheck.status === "fail") {
    return { checks, verdict: "fail", checkedAt: Date.now() };
  }
  checks.push(await checkConversaciones(env, token, propios));
  const verdict: DiagStatus = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  return { checks, verdict, checkedAt: Date.now() };
}
