import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { Env } from "../env";
import type { Tier } from "../upgrade/modelSelector";

/**
 * LLM provider abstraction.
 *
 * The bot's chat brain can run on Anthropic (default), OpenAI, xAI or Meta
 * (Muse Spark). Model selection is decoupled into TIERS ("fast" = cheap
 * default, "smart" = upgrade); each provider maps a tier to a concrete model id
 * (env-overridable). Embeddings and voice transcription stay on Cloudflare
 * Workers AI regardless of this setting.
 */
export type LlmProvider = "anthropic" | "openai" | "xai" | "meta";

export const PROVEEDORES: readonly LlmProvider[] = ["anthropic", "openai", "xai", "meta"];

const esProveedor = (v: string): v is LlmProvider => (PROVEEDORES as readonly string[]).includes(v);

const ANTHROPIC_DEFAULTS: Record<Tier, string> = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-4-5-20250929",
};

const OPENAI_DEFAULTS: Record<Tier, string> = {
  fast: "gpt-4o-mini",
  smart: "gpt-4o",
};

const XAI_DEFAULTS: Record<Tier, string> = {
  fast: "grok-4-fast-non-reasoning",
  smart: "grok-4",
};

// ── Meta (Muse Spark) ───────────────────────────────────────────────────────
//
// Igual que en la aplicación de calendarios (worker/lib/anthropic.js): la API
// de Meta habla el formato de mensajes de Anthropic en
// `https://api.meta.ai/v1/messages`, así que se le habla con el MISMO cliente
// de Anthropic del AI SDK, apuntado a otra base y con otra llave.
//
// Los dos modelos y lo que cuestan (≈ por millón de tokens, sep-2026):
// - `muse-spark-1.3`: 1,25 $ / 4,25 $. Meta NO entrena con lo que se le manda.
// - `muse-spark-1.2-contributor`: ≈ 0,10 $ / 0,20 $. Es barato PORQUE Meta
//   entrena con lo que recibe: aquí eso son las conversaciones de las clientas,
//   con nombres, teléfonos y direcciones. Por eso nunca es el de por defecto.

export const MODELO_MUSE = "muse-spark-1.3";
export const MODELO_MUSE_CONTRIBUIDOR = "muse-spark-1.2-contributor";
/**
 * Tokens de respuesta de la prueba de «Probar mi configuración». Meta rechaza
 * `max_tokens` por debajo de 16 («The number must be >= 16») y la prueba pedía 8:
 * la llave llegaba bien y la prueba fallaba igual. 32 deja holgura si el modelo
 * antepone algo a la respuesta.
 */
export const MAX_TOKENS_DE_PRUEBA = 32;
export const META_BASE_URL = "https://api.meta.ai/v1";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

const META_DEFAULTS: Record<Tier, string> = {
  fast: MODELO_MUSE,
  smart: MODELO_MUSE,
};

export const esMuse = (id: string | undefined): boolean => /^muse-/i.test(String(id ?? "").trim());

/** ¿Este modelo es el que entrena con lo que recibe? */
export const entrenaConLosDatos = (id: string | undefined): boolean => /contributor/i.test(String(id ?? ""));

/**
 * La llave de la IA de Meta: `META_API_KEY`, o `MODEL_API_KEY`, que es como la
 * llama la documentación de Meta (son los dos nombres que acepta también la
 * aplicación de calendarios, para que el mismo valor sirva en los dos Workers).
 *
 * NO es `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET` ni `INSTAGRAM_ACCESS_TOKEN`:
 * esos son de Messenger e Instagram (la Graph API) y no abren la IA. Se leen en
 * otro sitio y jamás se mandan a `api.meta.ai`; hay una prueba que lo vigila.
 */
export function llaveMeta(env: Env): string | undefined {
  const k = (env.META_API_KEY ?? "").trim() || (env.MODEL_API_KEY ?? "").trim();
  return k || undefined;
}

/**
 * Owner overrides from the dashboard (D1 `settings`): provider, BYO API key
 * and/or a concrete model id. Anything empty falls back to env behavior.
 * Load with `loadLlmOverrides()` (settings-loader) and pass to createModel.
 */
export interface LlmOverrides {
  provider?: string;
  apiKey?: string;
  model?: string;
}

/** Models offered in the dashboard picker. */
export const CURATED_MODELS: { id: string; label: string; provider: LlmProvider }[] = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 · rápido y barato", provider: "anthropic" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 · equilibrado", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 · el mejor equilibrio", provider: "anthropic" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 · máxima inteligencia", provider: "anthropic" },
  { id: "gpt-4o-mini", label: "GPT-4o mini · rápido y barato", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o · equilibrado", provider: "openai" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini · rápido", provider: "openai" },
  { id: "gpt-4.1", label: "GPT-4.1 · más capaz", provider: "openai" },
  { id: "grok-4-fast-non-reasoning", label: "Grok 4 Fast · rápido y barato", provider: "xai" },
  { id: "grok-3-mini", label: "Grok 3 mini · económico", provider: "xai" },
  { id: "grok-4", label: "Grok 4 · más capaz", provider: "xai" },
  { id: MODELO_MUSE, label: "Muse Spark 1.3 · Meta, sin entrenar con sus datos", provider: "meta" },
  {
    id: MODELO_MUSE_CONTRIBUIDOR,
    label: "Muse Spark Contributor · Meta, el más barato — ⚠ Meta entrena con las conversaciones",
    provider: "meta",
  },
];

/**
 * Decide which provider to use. Explicit LLM_PROVIDER wins; otherwise, if only
 * an OpenAI key is set, use OpenAI; default to Anthropic.
 */
export function resolveProvider(env: Env): LlmProvider {
  const explicit = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "anthropic") return "anthropic";
  // BUG FIX 2026-07-12: faltaba la rama xai — LLM_PROVIDER="xai" caía al
  // default (anthropic), dejando a Grok como mero fallback todo el tiempo.
  if (explicit === "xai") return "xai";
  if (explicit === "meta") return "meta";
  if (!env.ANTHROPIC_API_KEY && env.OPENAI_API_KEY) return "openai";
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.XAI_API_KEY && llaveMeta(env)) return "meta";
  return "anthropic";
}

/** Resolve the concrete model id for a provider + tier (env-overridable). */
export function modelIdFor(env: Env, provider: LlmProvider, tier: Tier): string {
  if (provider === "openai") {
    const smart = env.OPENAI_MODEL_SMART?.trim() || OPENAI_DEFAULTS.smart;
    const fast = env.OPENAI_MODEL_FAST?.trim() || OPENAI_DEFAULTS.fast;
    return tier === "smart" ? smart : fast;
  }
  if (provider === "xai") {
    return tier === "smart" ? XAI_DEFAULTS.smart : XAI_DEFAULTS.fast;
  }
  if (provider === "meta") {
    const smart = env.META_MODEL_SMART?.trim() || META_DEFAULTS.smart;
    const fast = env.META_MODEL_FAST?.trim() || META_DEFAULTS.fast;
    return tier === "smart" ? smart : fast;
  }
  const smart = env.ANTHROPIC_MODEL_SMART?.trim() || ANTHROPIC_DEFAULTS.smart;
  const fast = env.ANTHROPIC_MODEL_FAST?.trim() || ANTHROPIC_DEFAULTS.fast;
  return tier === "smart" ? smart : fast;
}

export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  /** AI SDK LanguageModel instance, ready to pass to streamText/generateText. */
  model: any;
  /**
   * Only Anthropic supports the ephemeral prompt-cache breakpoint we use. Meta
   * habla el mismo formato, pero no se sabe que acepte `cache_control`: no se
   * le manda.
   */
  supportsPromptCache: boolean;
}

/** env API key for a provider. */
function envKeyFor(env: Env, provider: LlmProvider): string | undefined {
  if (provider === "openai") return env.OPENAI_API_KEY;
  if (provider === "xai") return env.XAI_API_KEY;
  if (provider === "meta") return llaveMeta(env);
  return env.ANTHROPIC_API_KEY;
}

/**
 * ¿Esto parece una API key de alguno de los proveedores?
 *
 * No valida que la llave funcione —eso lo hace "Probar mi configuración"—,
 * solo que no sea otra cosa. Existe por un caso real: el navegador autocompletó
 * el campo de la llave (tipo contraseña) con la contraseña del panel, y quedó
 * guardada en D1 como llave de IA. Con ella, cada respuesta del bot habría
 * terminado en "Algo falló de mi lado".
 */
export function pareceLlaveDeIa(llave: string, proveedor?: LlmProvider): boolean {
  const k = llave.trim();
  if (k.length < 20 || /\s/.test(k)) return false;
  if (proveedor === "anthropic") return k.startsWith("sk-ant-");
  if (proveedor === "openai") return k.startsWith("sk-") && !k.startsWith("sk-ant-");
  if (proveedor === "xai") return k.startsWith("xai-");
  if (proveedor === "meta") return pareceLlaveDeMeta(k);
  return /^(sk-|xai-)/.test(k);
}

/**
 * La llave de la IA de Meta no tiene un prefijo publicado, así que se acepta
 * por descarte: lo que NO es de otro proveedor de IA ni un token de la Graph
 * API. Ese segundo descarte es el que importa en este CRM: el panel ya pide el
 * token de la Página (EAA…) y el de Instagram (IGAA…/IGQ…) para los canales, y
 * pegar uno de esos aquí lo mandaría a `api.meta.ai` en cada mensaje.
 */
export function pareceLlaveDeMeta(llave: string): boolean {
  const k = llave.trim();
  if (k.length < 20 || /\s/.test(k)) return false;
  if (/^(sk-|xai-)/.test(k)) return false; // de Anthropic, OpenAI o xAI
  if (/^(EAA|IGAA|IGQ)/.test(k)) return false; // tokens de Messenger / Instagram
  return true;
}

/**
 * Build the AI SDK model for the given tier. Dashboard overrides (BYO key /
 * provider / concrete model) win over env. Si el dueño eligió un proveedor
 * para el que no hay NINGUNA llave (ni suya ni del sistema), caemos al default
 * del env — el bot nunca se queda mudo por una config incompleta.
 */
export function createModel(env: Env, tier: Tier, ov?: LlmOverrides): ResolvedModel {
  const ovModel = (ov?.model ?? "").trim();
  const ovProviderRaw = (ov?.provider ?? "").trim().toLowerCase();

  let provider: LlmProvider | null = esProveedor(ovProviderRaw) ? ovProviderRaw : null;
  // Modelo elegido sin proveedor explícito → dedúcelo del id.
  if (!provider && ovModel) provider = proveedorDelModelo(ovModel);
  if (!provider) provider = resolveProvider(env);

  // Una llave guardada que no es del proveedor elegido (o que no es una llave:
  // ver pareceLlaveDeIa) se ignora y se usa la del sistema. Mandarla igual
  // garantiza un 401 en cada mensaje; ignorarla deja al bot contestando.
  let ovKey = (ov?.apiKey ?? "").trim();
  if (ovKey && !pareceLlaveDeIa(ovKey, provider)) {
    console.warn(`[llm] la API key guardada en el panel no es de "${provider}" — se usa la del sistema`);
    ovKey = "";
  }
  let apiKey = ovKey || envKeyFor(env, provider);
  // Un modelo de OTRO proveedor (Muse con el proveedor en Claude, por ejemplo)
  // no se manda: el proveedor elegido no lo conoce y contestaría 404 en cada
  // mensaje. Se usa el modelo por defecto del proveedor.
  let useOvModel = ovModel && (proveedorReconocido(ovModel) ?? provider) === provider ? ovModel : "";
  if (ovModel && !useOvModel) {
    console.warn(`[llm] el modelo "${ovModel}" no es de "${provider}" — se usa el de por defecto`);
  }
  if (!apiKey) {
    console.warn(`[llm] no API key for provider "${provider}" — falling back to env default`);
    provider = resolveProvider(env);
    apiKey = envKeyFor(env, provider);
    useOvModel = ""; // el modelo elegido era del proveedor sin llave — no aplica
  }

  const modelId = useOvModel || modelIdFor(env, provider, tier);

  if (provider === "openai") {
    const openai = createOpenAI({ apiKey });
    return { provider, modelId, model: openai(modelId), supportsPromptCache: false };
  }

  if (provider === "xai") {
    const xai = createXai({ apiKey });
    return { provider, modelId, model: xai(modelId), supportsPromptCache: false };
  }

  if (provider === "meta") {
    // Bearer (`authToken`) y no `apiKey`: con `apiKey` vacío el SDK busca
    // ANTHROPIC_API_KEY en el entorno por su cuenta, y en este Worker el
    // entorno tiene los secrets (nodejs_compat). Así, la llave de Anthropic
    // jamás puede salir hacia Meta. `x-api-key` va además porque es lo que
    // manda el SDK de Anthropic y la aplicación de calendarios manda las dos.
    const llave = apiKey ?? "";
    const meta = createAnthropic({
      authToken: llave,
      baseURL: (env.META_BASE ?? "").trim().replace(/\/$/, "") || META_BASE_URL,
      headers: { "x-api-key": llave },
      name: "meta.messages",
    });
    return { provider, modelId, model: meta(modelId), supportsPromptCache: false };
  }

  // La base, explícita: si no, el SDK lee ANTHROPIC_BASE_URL del entorno. Es la
  // variable que la documentación de Meta pide poner para usar Muse con el SDK
  // de Anthropic; puesta en este Worker, mandaría la llave de Anthropic a Meta.
  const anthropic = createAnthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });
  return { provider, modelId, model: anthropic(modelId), supportsPromptCache: true };
}

/** El proveedor de un id de modelo que se reconoce por su nombre; null si no. */
function proveedorReconocido(modelId: string): LlmProvider | null {
  const id = modelId.trim();
  if (/^grok/i.test(id)) return "xai";
  if (/^(gpt|chatgpt|o\d)/i.test(id)) return "openai";
  if (esMuse(id)) return "meta";
  if (/^claude/i.test(id)) return "anthropic";
  return null;
}

/** El proveedor al que pertenece un id de modelo (Anthropic si no se reconoce). */
export function proveedorDelModelo(modelId: string): LlmProvider {
  return proveedorReconocido(modelId) ?? "anthropic";
}

/**
 * Plan B ante fallo del proveedor primario (rate limit, 5xx, red): el primer
 * proveedor DISTINTO al que falló que tenga API key en el env, con sus modelos
 * default del tier. null = no hay respaldo configurado.
 */
export function fallbackModel(
  env: Env,
  tier: Tier,
  failedProvider: LlmProvider,
): ResolvedModel | null {
  // Meta va al final: es la red de seguridad cuando hay su llave, nunca el
  // primer respaldo de nadie que no la puso.
  const order: LlmProvider[] = ["anthropic", "openai", "xai", "meta"];
  for (const p of order) {
    if (p === failedProvider) continue;
    if (!envKeyFor(env, p)) continue;
    return createModel(env, tier, { provider: p });
  }
  return null;
}
