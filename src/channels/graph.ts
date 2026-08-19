// Versión de la Graph API de Meta, en UN solo sitio.
//
// Todos los canales de Meta (WhatsApp Cloud, Messenger, Instagram) pegan contra
// `graph.facebook.com/<version>/…`. Meta retira cada versión ~2 años después de
// publicarla: cuando eso pasa, las llamadas empiezan a fallar con
// "Unsupported get/post request" y el bot deja de responder sin que nadie tocara
// el código. Por eso vive aquí y se puede pisar con la var `GRAPH_API_VERSION`
// (wrangler.toml o `wrangler secret put`) sin esperar un release.
export const GRAPH_API_VERSION = "v26.0";

/** Versión a usar: la de `GRAPH_API_VERSION` si es válida (vNN.N), si no la del código. */
export function graphVersion(env: { GRAPH_API_VERSION?: string }): string {
  const v = env.GRAPH_API_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : GRAPH_API_VERSION;
}
