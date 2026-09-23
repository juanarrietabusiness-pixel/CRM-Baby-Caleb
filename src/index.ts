import { Hono } from "hono";
import type { Env } from "./env";
import type { ChannelAdapter } from "./channels/shared";
import { contestarMiId, mensajeDeTelegram, type TgUpdate } from "./channels/telegram";
import { atenderAlDueno } from "./owner/consola";
import { webhookConfiable } from "./owner/telegram";
import { manychatAdapter } from "./channels/manychat";
import { twilioAdapter } from "./channels/twilio";
import { parseMetaEvents, verifyMetaSignature } from "./channels/meta";
import { parseWhatsAppEvents, serveWhatsAppMedia } from "./channels/whatsapp";
import { whatsappQrAdapter, parseRespuestaPropia } from "./channels/whatsappQr";
import { registrarRespuestaDelTelefono } from "./takeover";
import { adminApp } from "./admin/routes";
import { purgeOldMessages } from "./crons/purgeOldMessages";
import { reindexAll } from "./kb/docs";
import { analyzeConversations } from "./insights/analyzer";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { detectKind } from "./learn/fieldPath";
import { saveCapture, isLearnMode } from "./learn/mapping";
import { tokensMatch } from "./http-auth";
import { apiApp } from "./api";
import { renderPrivacyPolicy, renderTerms, renderDataDeletion } from "./legal";

export { SupportAgent } from "./agent";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("ok", 200));

// Parse the provider payload via the channel adapter, derive the per-user DO id
// (channel + ':' + channelUserId), and forward the normalized message to the
// SupportAgent's `/ingest` endpoint. The DO buffers + schedules the alarm.
async function routeToAgent(c: { req: { raw: Request }; env: Env; text: (t: string, s: number) => Response }, adapter: ChannelAdapter) {
  try {
    const env = c.env;
    const msg = await adapter.parseIncoming(c.req.raw, env);
    const doId = env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
    const stub = env.AGENT.get(doId);
    // Call the agent directly via RPC. Do NOT use stub.fetch(): the `agents` SDK
    // intercepts the Durable Object fetch and expects partyserver namespace/room
    // headers, so an ad-hoc fetch to /ingest fails to connect. RPC invokes the
    // method directly — it buffers the message and schedules the alarm.
    await stub.ingest(msg);
    // Twilio treats the webhook's HTTP body as a reply to send. The real reply
    // is delivered asynchronously via the REST API, so ack with empty TwiML
    // (`<Response></Response>`) to tell Twilio to send nothing. Other channels
    // ignore the body, so a plain "ok" is fine for them.
    if (msg.channel === "twilio") {
      return new Response("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
    return c.text("ok", 200);
  } catch (e: any) {
    console.error("webhook error:", e);
    return c.text(`err: ${e?.message ?? e}`, 500);
  }
}

// Telegram tiene DOS públicos en el mismo bot: las clientas y el dueño. Lo del
// dueño —sus comandos, sus botones, sus respuestas sobre un aviso, el código
// que lo vincula— lo atiende la consola y no llega al agente. Siempre 200:
// un 500 hace que Telegram reintente el mismo update una y otra vez.
app.post("/webhooks/telegram", async (c) => {
  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.text("ok", 200);
  }
  try {
    const confiable = await webhookConfiable(c.env, c.req.header("x-telegram-bot-api-secret-token"));
    if (await atenderAlDueno(c.env, update as any, { confiable })) return c.text("ok", 200);
    if (await contestarMiId(update, c.env)) return c.text("ok", 200);
    // Botones, ediciones, altas en grupos: nada que contestar.
    if (!update.message) return c.text("ok", 200);
    const msg = await mensajeDeTelegram(update, c.env);
    const doId = c.env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
    await c.env.AGENT.get(doId).ingest(msg);
  } catch (e) {
    console.error("telegram webhook error:", e);
  }
  return c.text("ok", 200);
});
app.post("/webhooks/manychat", (c) => routeToAgent(c, manychatAdapter));
// WhatsApp (Twilio): rutea el mensaje entrante al bot de clientes (Claude). El
// body se lee UNA vez; ack con TwiML vacío para que Twilio no reenvíe el cuerpo
// como mensaje.
app.post("/webhooks/twilio", async (c) => {
  let msg;
  try {
    msg = await twilioAdapter.parseIncoming(c.req.raw, c.env);
  } catch (e) {
    console.error("twilio parse error:", e);
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  const doId = c.env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
  await c.env.AGENT.get(doId).ingest(msg).catch((e) => console.error("ingest:", e));
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
});

// --- WhatsApp por QR (canal alterno, vía el puente `juancitoads-bot-wa`) ----
//
// Aquí NO llega WhatsApp: llega el puente, que es quien sostiene el socket. Por
// eso no hay firma de Meta que validar — se valida el token compartido, que es
// el mismo secret que el puente presenta.
//
// Fail-closed como /kb/reindex: si WA_TOKEN faltara, un token vacío NO debe
// abrir la puerta. La comparación es de tiempo constante.
function tokenDelPuenteValido(c: { req: { header: (n: string) => string | undefined }; env: Env }): boolean {
  const provided = c.req.header("x-wa-token") ?? "";
  const expected = c.env.WA_TOKEN ?? "";
  return !!expected && tokensMatch(provided, expected);
}

app.post("/webhooks/whatsapp-qr", async (c) => {
  if (!tokenDelPuenteValido(c)) return c.text("no autorizado", 401);

  let msg;
  try {
    msg = await whatsappQrAdapter.parseIncoming(c.req.raw, c.env);
  } catch (e) {
    console.error("whatsapp-qr parse error:", e);
    // 400 y no 200: el puente lo anota en su estado. Un mensaje que se pierde
    // en silencio es peor que un error visible.
    return c.text("no se pudo leer el mensaje", 400);
  }

  const doId = c.env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
  await c.env.AGENT.get(doId).ingest(msg).catch((e) => console.error("ingest:", e));
  return c.json({ ok: true });
});

// La dueña contestó desde el teléfono del negocio (o desde WhatsApp Web): el
// bot se calla en esa conversación. Ver src/takeover.ts.
app.post("/webhooks/whatsapp-qr/propio", async (c) => {
  if (!tokenDelPuenteValido(c)) return c.text("no autorizado", 401);
  let datos;
  try {
    datos = parseRespuestaPropia(await c.req.json());
  } catch (e) {
    console.error("whatsapp-qr propio parse error:", e);
    return c.text("no se pudo leer el mensaje", 400);
  }
  const r = await registrarRespuestaDelTelefono(c.env, datos);
  if (r.accion === "pausada") {
    console.log(`[whatsapp-qr] una persona contestó desde el teléfono — ${r.conversationId} en pausa`);
  }
  return c.json({ ok: true, ...r });
});

// --- Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat) --------
// GET = handshake de verificación de Meta: devuelve hub.challenge si el
// hub.verify_token coincide con nuestro secreto. Se llama una vez al configurar
// el webhook en la app de Meta.
app.get("/webhooks/meta", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token && token === c.env.META_VERIFY_TOKEN) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

// POST = eventos de mensajes. Meta firma el cuerpo con el App Secret; validamos
// la firma (fail-closed) antes de procesar. Un POST puede traer varios mensajes
// (varias páginas/usuarios): rutea cada uno a su Durable Object. Responde 200
// rápido para que Meta no reintente.
app.post("/webhooks/meta", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  // Messenger (app de Facebook) e Instagram (IG Login) pueden firmar con App
  // Secrets DISTINTOS aunque sea la misma app de Meta. Aceptamos la firma si
  // cuadra con cualquiera de los dos secretos configurados (fail-closed si con
  // ninguno). Así un solo webhook /webhooks/meta sirve para ambos canales.
  const valid =
    (!!c.env.META_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.META_APP_SECRET))) ||
    (!!c.env.INSTAGRAM_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.INSTAGRAM_APP_SECRET)));
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  // Kill-switch del canal oficial de Instagram (IG_OFFICIAL="off"): se ignora
  // TODO lo de IG por esta vía (DMs) — el bot de IG vive únicamente en ManyChat
  // (decisión de diseño). Messenger (object === "page") no se ve
  // afectado. Para reactivar: quitar la var y redeploy.
  if ((body as { object?: string }).object === "instagram" && c.env.IG_OFFICIAL === "off") {
    return c.text("EVENT_RECEIVED", 200);
  }

  for (const msg of parseMetaEvents(body as any)) {
    // Anti-duplicado: cuando IG_DM_SOURCE="manychat", los DMs de Instagram
    // entran SOLO por el webhook de ManyChat — el canal oficial los ignora
    // (si no, cada DM se procesa DOBLE: 2x LLM, 2x respuestas al lead y
    // colisiones de rate limit en ráfagas de historias).
    if (msg.channel === "instagram" && c.env.IG_DM_SOURCE === "manychat") continue;
    const doId = c.env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
    await c.env.AGENT.get(doId).ingest(msg);
  }
  return c.text("EVENT_RECEIVED", 200);
});

// --- WhatsApp OFICIAL (Cloud API de Meta, sin Twilio/BSP) -------------------
// GET = handshake de verificación (igual que Meta). Acepta el WHATSAPP_VERIFY_TOKEN
// propio o, si no se configuró, cae al META_VERIFY_TOKEN (misma app de Meta).
app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = c.env.WHATSAPP_VERIFY_TOKEN || c.env.META_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) {
    return c.text(challenge ?? "", 200);
  }
  console.error(
    `whatsapp verify: handshake rechazado (${!expected ? "no hay WHATSAPP_VERIFY_TOKEN ni META_VERIFY_TOKEN" : !token ? "Meta no mandó hub.verify_token" : "el token no coincide con el guardado"}).`,
  );
  return c.text("forbidden", 403);
});

// POST = mensajes entrantes. Firma X-Hub-Signature-256 con el App Secret de
// WhatsApp (o el de Meta si comparten app). Un POST puede traer varios mensajes.
app.post("/webhooks/whatsapp", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  const secret = c.env.WHATSAPP_APP_SECRET || c.env.META_APP_SECRET;
  // Rechazar en silencio es lo peor que puede pasar aquí: el dueño ve "no llegan
  // los mensajes", los logs solo muestran un 403 pelado y no hay forma de saber
  // si fue el secret equivocado o si Meta ni siquiera llamó. Se logea el motivo.
  if (!secret) {
    console.error("whatsapp webhook: sin WHATSAPP_APP_SECRET ni META_APP_SECRET — todo POST se rechaza.");
    return c.text("bad signature", 403);
  }
  if (!(await verifyMetaSignature(raw, sig, secret))) {
    console.error(
      `whatsapp webhook: firma inválida (${sig ? "X-Hub-Signature-256 no coincide" : "sin cabecera X-Hub-Signature-256"}) — el App Secret guardado no es el de la app que envía.`,
    );
    return c.text("bad signature", 403);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error("whatsapp webhook: body no es JSON válido.");
    return c.text("bad json", 400);
  }
  const origin = c.env.DASHBOARD_BASE_URL || new URL(c.req.url).origin;
  const msgs = await parseWhatsAppEvents(body as any, c.env, origin);
  // Meta manda MUCHOS POST de recibos (sent/delivered/read) sin ningún mensaje.
  // Dejar rastro de ellos distingue "Meta no llama" de "Meta llama pero no era
  // un mensaje" — que es exactamente la duda cuando el canal parece muerto.
  if (msgs.length === 0) {
    console.log("whatsapp webhook: POST sin mensajes procesables (recibos de estado u otro campo).");
  }
  for (const msg of msgs) {
    const doId = c.env.AGENT.idFromName(`${msg.channel}:${msg.channelUserId}`);
    await c.env.AGENT.get(doId).ingest(msg);
  }
  return c.text("EVENT_RECEIVED", 200);
});

// Proxy FIRMADO del media entrante de WhatsApp Cloud (audio/imagen). Hace el
// media públicamente fetchable (para transcribe/vision) sin exponer el token.
app.get("/webhooks/whatsapp/media/:id", (c) =>
  serveWhatsAppMedia(c.req.param("id"), c.req.query("exp") ?? null, c.req.query("sig") ?? null, c.env),
);

// Universal webhook LEARN endpoint. When learn mode is ON for `:channel`, this
// captures a real payload (classified by media kind) so the bot can later infer
// where each field lives — instead of hardcoding one app's contract. It NEVER
// runs the LLM; it only observes. When learn mode is OFF it returns 409 so the
// caller knows nothing was captured.
app.post("/webhooks/learn/:channel", async (c) => {
  const channel = c.req.param("channel");
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  const repo = new SettingsRepo(new Db(c.env.DB));
  const kind = detectKind(payload);

  if (!(await isLearnMode(repo, channel))) {
    return c.json({ ok: false, error: "learn mode off" }, 409);
  }

  await saveCapture(repo, channel, kind, payload);
  return c.json({ ok: true, captured: kind, channel }, 200);
});

// Páginas legales PÚBLICAS (sin contraseña). Meta las exige para poner la app
// en producción: Configuración básica → Política de privacidad, Términos del
// servicio y Eliminación de datos de usuario. Ver src/legal.ts.
app.get("/privacidad", (c) => c.html(renderPrivacyPolicy(c.env)));
app.get("/terminos", (c) => c.html(renderTerms(c.env)));
app.get("/eliminar-datos", (c) => c.html(renderDataDeletion(c.env)));

// Admin dashboard — Basic Auth guarded sub-app mounted at /admin/*.
app.route("/admin", adminApp);

// Control-plane API — Bearer-guarded (CONTROL_PLANE_TOKEN) read-only sub-app
// mounted at /api/* for a future hosted control plane (health + metrics).
app.route("/api", apiApp);

// KB reindex — rehace el índice de Vectorize. Protegido por el secret
// KB_REINDEX_TOKEN vía la cabecera X-Reindex-Token. Lo dispara el deploy
// (.github/workflows/deploy.yml) después de publicar el Worker.
//
// Llama a reindexAll, NO a reindexKb: reindexKb solo sube los .md versionados
// en member/kb/ e ignoraba tanto los documentos escritos desde /admin/kb como
// la purga de los retirados. Es decir, este endpoint —el que corre después de
// cada deploy— dejaba fuera justo lo que hay que limpiar. El botón "reindexar"
// del panel sí usaba reindexAll, así que los dos caminos daban índices
// distintos según por dónde se entrara.
app.post("/kb/reindex", async (c) => {
  const provided = c.req.header("X-Reindex-Token") ?? "";
  const expected = c.env.KB_REINDEX_TOKEN ?? "";
  if (!expected || !tokensMatch(provided, expected)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const r = await reindexAll(c.env);
  return c.json({ ok: true, indexed: r.indexed, purged: r.purged }, 200);
});

app.notFound((c) => c.text("not found", 404));

export default {
  // Bind so Hono keeps its `this` when invoked as `worker.fetch(req, env, ctx)`
  // (both by the Cloudflare runtime and by tests). Passing `app.fetch` unbound
  // loses the receiver and throws "Cannot read properties of undefined".
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Follow-up bot: UN mensaje breve de seguimiento a leads que lo ameritan
    // (venta abierta / 4+ preguntas), dentro de la ventana de 24h y máximo una
    // vez por conversación. Acotado por caps internos.
    const { runFollowups } = await import("./followup/run");
    await runFollowups(env).catch((e) => console.error("followups:", e));

    // Watchdog: si el bot está fallando en cadena (3+ "Algo falló" en 30 min),
    // avisa al dueño por su canal de handoff. Throttle 6h. Lo ÚNICO que debe
    // despertarlo en la noche.
    const { checkBotHealth } = await import("./watchdog");
    await checkBotHealth(env).catch((e) => console.error("watchdog:", e));

    // La firma del webhook de la consola del dueño, por si todavía no está (un
    // dueño que puso su chat id en Cloudflare y aún no recibe avisos). Una sola
    // vez por token; después es una lectura de D1.
    const { protegerConsolaUnaVez } = await import("./owner/dueno");
    await protegerConsolaUnaVez(env);

    // Los trabajos nocturnos SOLO corren en el tick diario (3am UTC) — un tick
    // más frecuente (si el miembro lo configura) no debe purgar/analizar de más.
    if (event.cron && event.cron !== "0 3 * * *") return;

    // Daily cron (wrangler.toml: "0 3 * * *") — purge messages older than 90 days.
    await purgeOldMessages(env);
    // Los botones y avisos de la consola del dueño de hace más de 30 días ya
    // no los toca nadie: se podan para que las tablas no crezcan sin fin.
    try {
      const { purgarAcciones } = await import("./owner/acciones");
      await purgarAcciones(env, Date.now() - 30 * 24 * 60 * 60 * 1000);
    } catch (e) {
      console.error("purga de la consola:", e);
    }
    // Corrida nocturna del Analista de insights (F2). No debe tumbar la purga.
    await analyzeConversations(env, { limit: 50 }).catch((e) => console.error("insights:", e));
    // Flywheel (F5): detecta huecos de KB y lecciones de takeovers → propone
    // mejoras en /admin/mejoras. Corre DESPUÉS del analizador (usa su output).
    const { runFlywheel } = await import("./flywheel/detect");
    await runFlywheel(env).catch((e) => console.error("flywheel:", e));
    // Modo COPILOTO (autonomy_level="copilot"): auto-aplica las mejoras seguras
    // detectadas (lecciones + KB sin huecos). Lo delicado espera al dueño.
    try {
      const level = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.autonomyLevel);
      if (level === "copilot") {
        const { autoApplyPending } = await import("./flywheel/apply");
        await autoApplyPending(env);
      }
    } catch (e) {
      console.error("copiloto:", e);
    }
  },
} satisfies ExportedHandler<Env>;
