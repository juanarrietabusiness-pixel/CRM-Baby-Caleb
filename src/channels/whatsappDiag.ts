// Diagnóstico del canal WhatsApp OFICIAL (Cloud API de Meta).
//
// La tarjeta verde de /admin/conexiones solo dice "los secrets existen". No dice
// si Meta te está mandando los mensajes, y ese es justo el fallo más común: el
// webhook queda bien configurado pero la app NUNCA queda SUSCRITA a la cuenta de
// WhatsApp (WABA), así que Meta no hace ni un POST y en los logs del Worker no
// aparece nada — ni un error, nada. Silencio.
//
// Esto pregunta a Meta de verdad, en cuatro pasos, y traduce la respuesta a algo
// accionable:
//   1. Secrets    — ¿está todo puesto en Cloudflare?
//   2. Token      — ¿el token sirve y ve ESE número? (aquí salen los vencidos)
//   3. Suscripción— ¿la app está suscrita a la WABA? (si no: no llegan mensajes)
//   4. Webhook    — ¿la URL pública contesta el handshake de Meta?
import type { Env } from "../env";
import { graphVersion } from "./graph";

export type DiagStatus = "ok" | "fail" | "warn" | "skip";

export interface DiagCheck {
  id: string;
  label: string;
  status: DiagStatus;
  /** Qué se encontró, en una línea, en español simple. */
  detail: string;
  /** Qué hacer para arreglarlo (solo cuando algo falla). */
  fix?: string;
}

export interface WhatsAppDiagnosis {
  checks: DiagCheck[];
  /** "fail" si algo está roto, "warn" si hay dudas, "ok" si todo pasó. */
  verdict: DiagStatus;
  checkedAt: number;
}

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

/** Lee el error de Graph de una respuesta fallida y lo deja legible. */
async function graphError(res: Response): Promise<{ text: string; code?: number }> {
  const body = await res.text().catch(() => "");
  try {
    const err = (JSON.parse(body) as { error?: GraphError }).error;
    if (err?.message) {
      const code = err.code ? ` (código ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "";
      return { text: `${err.message}${code}`, code: err.code };
    }
  } catch {
    /* no era JSON: cae al texto crudo */
  }
  return { text: body.slice(0, 300) || `HTTP ${res.status}` };
}

/** Traduce los códigos de Graph que de verdad salen en producción. */
function tokenFix(code?: number): string {
  if (code === 190) {
    return "El token venció o fue revocado. Genera uno nuevo en Meta (usuario del sistema → token permanente) y guárdalo: wrangler secret put WHATSAPP_ACCESS_TOKEN.";
  }
  if (code === 100) {
    return "El WHATSAPP_PHONE_NUMBER_ID no existe o no es el correcto. Cópialo de Meta → WhatsApp → Configuración de la API (es el ID, NO el número de teléfono).";
  }
  if (code === 200 || code === 10) {
    return "Al token le faltan permisos sobre este número. En Meta dale al usuario del sistema el rol sobre la WABA con whatsapp_business_messaging y whatsapp_business_management.";
  }
  return "Revisa en Meta que el token y el Phone Number ID sean los de esta misma cuenta de WhatsApp.";
}

async function checkSecrets(env: Env): Promise<DiagCheck> {
  const has = (v?: string) => Boolean(v && v.trim() !== "");
  const missing = [
    !has(env.WHATSAPP_PHONE_NUMBER_ID) && "WHATSAPP_PHONE_NUMBER_ID",
    !has(env.WHATSAPP_ACCESS_TOKEN) && "WHATSAPP_ACCESS_TOKEN",
    !has(env.WHATSAPP_VERIFY_TOKEN || env.META_VERIFY_TOKEN) && "WHATSAPP_VERIFY_TOKEN",
    !has(env.WHATSAPP_APP_SECRET || env.META_APP_SECRET) && "WHATSAPP_APP_SECRET",
  ].filter(Boolean) as string[];
  return missing.length === 0
    ? { id: "secrets", label: "Secrets en Cloudflare", status: "ok", detail: "Los cuatro están puestos." }
    : {
        id: "secrets",
        label: "Secrets en Cloudflare",
        status: "fail",
        detail: `Falta: ${missing.join(", ")}.`,
        fix: `Guárdalos con: ${missing.map((m) => `wrangler secret put ${m}`).join(" · ")}`,
      };
}

/** ¿El token sirve y ve ESE número? Es la prueba de que puedes ENVIAR. */
async function checkToken(env: Env): Promise<DiagCheck> {
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneId || !token) {
    return {
      id: "token",
      label: "Token y número (envío)",
      status: "skip",
      detail: "Sin Phone Number ID o sin token no hay nada que probar.",
    };
  }
  const fields = "id,display_phone_number,verified_name,quality_rating,platform_type";
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(phoneId)}?fields=${fields}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e: any) {
    return {
      id: "token",
      label: "Token y número (envío)",
      status: "fail",
      detail: `No se pudo hablar con Meta: ${e?.message ?? e}`,
    };
  }
  if (!res.ok) {
    const err = await graphError(res);
    return {
      id: "token",
      label: "Token y número (envío)",
      status: "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: tokenFix(err.code),
    };
  }
  const num = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    platform_type?: string;
  };
  const label = "Token y número (envío)";
  const who = `${num.verified_name ?? "sin nombre"} · ${num.display_phone_number ?? phoneId}`;
  // platform_type dice si el número corre en Cloud API. Si sigue en on-premise o
  // está en otra plataforma, este canal NO es el que hay que usar.
  if (num.platform_type && num.platform_type !== "CLOUD_API") {
    return {
      id: "token",
      label,
      status: "warn",
      detail: `El token sirve (${who}) pero el número corre en ${num.platform_type}, no en CLOUD_API.`,
      fix: "Migra el número a Cloud API en Meta, o usa la tarjeta de WhatsApp (Twilio) en su lugar.",
    };
  }
  const quality = num.quality_rating && num.quality_rating !== "GREEN" ? ` Calidad del número: ${num.quality_rating}.` : "";
  return {
    id: "token",
    label,
    status: "ok",
    detail: `El token sirve y ve el número: ${who}.${quality}`,
  };
}

/** ¿La app está SUSCRITA a la WABA? Sin esto Meta no manda NADA. */
async function checkSubscription(env: Env): Promise<DiagCheck> {
  const label = "Suscripción de la app (recepción)";
  const waba = env.WHATSAPP_WABA_ID?.trim();
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    return { id: "subscription", label, status: "skip", detail: "Sin token no se puede comprobar." };
  }
  if (!waba) {
    return {
      id: "subscription",
      label,
      status: "skip",
      detail: "No sé tu WhatsApp Business Account ID, así que no puedo comprobar la suscripción.",
      fix: "Cópialo de Meta → WhatsApp → Configuración de la API (WhatsApp Business Account ID) y guárdalo: wrangler secret put WHATSAPP_WABA_ID. Es la causa #1 de que no lleguen mensajes.",
    };
  }
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(waba)}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e: any) {
    return { id: "subscription", label, status: "fail", detail: `No se pudo hablar con Meta: ${e?.message ?? e}` };
  }
  if (!res.ok) {
    const err = await graphError(res);
    return {
      id: "subscription",
      label,
      status: "fail",
      detail: `Meta rechazó la consulta: ${err.text}`,
      fix: "Comprueba el WHATSAPP_WABA_ID y que el token tenga el permiso whatsapp_business_management.",
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { whatsapp_business_api_data?: { name?: string; id?: string } }[];
  };
  const apps = json.data ?? [];
  if (apps.length === 0) {
    return {
      id: "subscription",
      label,
      status: "fail",
      detail: "Ninguna app está suscrita a tu cuenta de WhatsApp: por eso Meta no envía los mensajes.",
      fix: "En Meta → WhatsApp → Configuración → Webhooks: pulsa Administrar y suscribe el campo messages. Si el botón ya está, quítalo y vuelve a suscribirlo.",
    };
  }
  const names = apps.map((a) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? "?").join(", ");
  return {
    id: "subscription",
    label,
    status: "ok",
    detail: `Suscrita: ${names}. Meta sí debería estar enviando los mensajes aquí.`,
  };
}

/** ¿La URL pública contesta el handshake tal como lo hace Meta? */
async function checkWebhook(env: Env): Promise<DiagCheck> {
  const label = "URL del webhook (handshake)";
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const expected = env.WHATSAPP_VERIFY_TOKEN || env.META_VERIFY_TOKEN;
  if (!base) {
    return {
      id: "webhook",
      label,
      status: "skip",
      detail: "Sin DASHBOARD_BASE_URL no sé cuál es tu URL pública.",
      fix: "Pon DASHBOARD_BASE_URL en wrangler.toml con la URL de tu Worker.",
    };
  }
  if (!expected) {
    return { id: "webhook", label, status: "skip", detail: "Sin token de verificación no hay handshake que probar." };
  }
  const challenge = `probe${Math.floor(Math.random() * 1e9)}`;
  const url = `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(expected)}&hub.challenge=${challenge}`;
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    if (res.ok && text === challenge) {
      return { id: "webhook", label, status: "ok", detail: `${base}/webhooks/whatsapp responde el handshake de Meta.` };
    }
    return {
      id: "webhook",
      label,
      status: "fail",
      detail: `La URL respondió ${res.status} en vez de devolver el reto.`,
      fix: "Comprueba que en Meta pegaste exactamente esta URL y ESTE mismo token de verificación.",
    };
  } catch (e: any) {
    // El Worker llamándose a sí mismo puede fallar por red/loopback aunque la URL
    // esté perfecta desde fuera: por eso es aviso, no error.
    return {
      id: "webhook",
      label,
      status: "warn",
      detail: `No pude probarla desde aquí (${e?.message ?? e}). Ábrela en el navegador para confirmarla.`,
      fix: `Abre ${url.replace(encodeURIComponent(expected), "TU_TOKEN")} — debe devolver el número del reto.`,
    };
  }
}

/**
 * Corre los cuatro chequeos contra Meta y devuelve el veredicto. No manda
 * mensajes ni cambia nada: solo lee.
 */
export async function diagnoseWhatsAppCloud(env: Env): Promise<WhatsAppDiagnosis> {
  const secrets = await checkSecrets(env);
  // Si faltan secrets, las llamadas a Graph solo devolverían ruido.
  const rest =
    secrets.status === "fail"
      ? [
          { id: "token", label: "Token y número (envío)", status: "skip" as DiagStatus, detail: "Primero completa los secrets." },
          { id: "subscription", label: "Suscripción de la app (recepción)", status: "skip" as DiagStatus, detail: "Primero completa los secrets." },
          await checkWebhook(env),
        ]
      : await Promise.all([checkToken(env), checkSubscription(env), checkWebhook(env)]);
  const checks = [secrets, ...rest];
  const verdict: DiagStatus = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn" || c.status === "skip")
      ? "warn"
      : "ok";
  return { checks, verdict, checkedAt: Date.now() };
}
