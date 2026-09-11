import { Agent } from "agents";
import { streamText } from "ai";
import type { SystemModelMessage } from "ai";
import type { Env } from "./env";
import { Db } from "./db/client";
import { ConversationsRepo } from "./db/conversations";
import { MessagesRepo } from "./db/messages";
import { isPro } from "./config";
import { resolveAgentConfig } from "./settings-loader";
import { buildTools } from "./tools";
import { buildMultimodalUserMessage } from "./media/vision";
import { chunkReply } from "./replies/chunker";
import { pickAdapter } from "./replies/sender";
import { selectModel } from "./upgrade/modelSelector";
import type { Tier } from "./upgrade/modelSelector";
import { monthIaCostUsd, applyBudgetGuard } from "./budget";
import { CustomerFactsRepo } from "./db/facts";
import { TicketsRepo } from "./db/tickets";
import { notifyOwner } from "./tools/handoffHuman";
import { createModel } from "./llm/provider";
import { costOfUsage } from "./pricing";
import type { ArchivoNoLegible, ChannelId } from "./channels/shared";

export interface SupportAgentState {
  conversationId: string | null;
  channel: string;
  channelUserId: string;
  pendingMessages: { text: string; receivedAt: number }[];
  lastAlarmAt: number;
  lastUserLang: string;
  toolCallsInLast2Turns: number;
  lastSearchKbScore: number;
  imageRetryCount: number;
}

export interface AgentIncomingPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  /**
   * Un archivo que el bot no puede leer y que igual tiene que llegar a una
   * persona: un PDF con el comprobante de una transferencia, un video, un
   * sticker. Antes los canales los descartaban en silencio —ni mensaje
   * guardado, ni ticket, ni respuesta— y desde afuera parecía que el negocio
   * había dejado a la clienta en visto.
   */
  fileKind?: ArchivoNoLegible;
  isOwnerMessage?: boolean;
}

/**
 * Marca interna: "en este turno llegó un archivo que el bot NO puede revisar".
 *
 * Existe porque la escalada de archivos miraba solo `[IMAGE_URL: …]`, así que
 * una nota de voz se transcribía con Whisper y entraba al modelo como si la
 * clienta la hubiera escrito: sin ticket, sin aviso a la dueña. Y la base de
 * conocimiento le promete a la clienta justo lo contrario ("el archivo no le
 * llega al bot: el sistema lo retiene y crea el ticket solo").
 *
 * Nunca debe llegar al modelo: se quita del texto antes de armar el turno.
 */
export const RE_ARCHIVO = /\n?\[ARCHIVO: (audio|documento|video)\]/;
const RE_IMAGEN = /\n?\[IMAGE_URL: .+?\]/;

/** Quita las marcas internas de un mensaje guardado. */
export function limpiarMarcas(texto: string): string {
  return texto.replace(RE_IMAGEN, "").replace(RE_ARCHIVO, "").trim();
}

export class SupportAgent extends Agent<Env, SupportAgentState> {
  initialState: SupportAgentState = {
    conversationId: null,
    channel: "",
    channelUserId: "",
    pendingMessages: [],
    lastAlarmAt: 0,
    lastUserLang: "es",
    toolCallsInLast2Turns: 0,
    lastSearchKbScore: 1,
    imageRetryCount: 0,
  };

  /**
   * Called by the Worker fetch handler when a webhook arrives for this user.
   * Buffers the message, schedules/resets an alarm.
   */
  async ingest(payload: AgentIncomingPayload): Promise<{ acknowledged: true }> {
    const db = new Db(this.env.DB);
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate(
      payload.channel,
      payload.channelUserId,
      payload.displayName,
    );
    this.setState({
      ...this.state,
      channel: payload.channel,
      channelUserId: payload.channelUserId,
      conversationId: conv.id,
    });

    // Owner intervened → pause the bot, do NOT process this as user input
    if (payload.isOwnerMessage) {
      const pausedUntil = Date.now() + 60 * 60 * 1000;
      await convs.setPausedUntil(conv.id, pausedUntil);
      return { acknowledged: true };
    }

    // If paused, ignore (bot stays silent)
    if (await convs.isPaused(conv.id)) {
      return { acknowledged: true };
    }

    // Guardrail anti-spam: el mismo mensaje por 3ª vez entre los últimos 5 →
    // la conversación descansa 1 hora, sin respuesta y sin gastar LLM.
    if (payload.text && !payload.audioUrl && !payload.imageUrl) {
      try {
        const { isRepeatSpam, SPAM_SNOOZE_MS, isOverDailyCap, DAILY_CAP_SNOOZE_MS, DAILY_CAP_MESSAGE } =
          await import("./spam");
        if (await isRepeatSpam(db, conv.id, payload.text)) {
          await convs.setPausedUntil(conv.id, Date.now() + SPAM_SNOOZE_MS);
          console.warn(`[spam-guard] conv ${conv.id} en cooldown 1h (mensaje repetido)`);
          return { acknowledged: true };
        }
        // Tope diario de turnos: despedida amable UNA vez + descanso 12h. La
        // pausa garantiza que no se repita (los siguientes mensajes mueren en
        // isPaused antes de llegar aquí).
        if (await isOverDailyCap(db, conv.id)) {
          await convs.setPausedUntil(conv.id, Date.now() + DAILY_CAP_SNOOZE_MS);
          await new MessagesRepo(db).append(conv.id, "assistant", DAILY_CAP_MESSAGE);
          const channel = payload.channel as ChannelId;
          await pickAdapter(channel).sendReply(
            { channel, channelUserId: payload.channelUserId, chunks: [DAILY_CAP_MESSAGE] },
            this.env,
          );
          console.warn(`[spam-guard] conv ${conv.id} tope diario de turnos → descanso 12h`);
          return { acknowledged: true };
        }
      } catch (e) {
        // El guard es un extra, nunca la ruta crítica: si falla, se responde normal.
        console.warn("[spam-guard] check failed:", e);
      }
    }

    // Process media (audio → transcription, image → Pro-gated multimodal marker)
    let processedText = payload.text ?? "";
    let hasImage = false;

    if (payload.audioUrl) {
      try {
        const { transcribeAudio } = await import("./media/transcribe");
        const result = await transcribeAudio(payload.audioUrl, this.env);
        processedText = result.text || "(audio sin transcripción)";
      } catch (e) {
        console.error("[ingest] transcription failed:", e);
        processedText = "(no pude entender el audio)";
      }
      // Se sigue transcribiendo —el equipo lo lee en la Bandeja y en el
      // ticket—, pero queda marcado: con `escalar_media` encendido, la
      // transcripción NO se le pasa al modelo. El contenido de una nota de voz
      // es el archivo, y el negocio prometió que un archivo lo revisa una
      // persona. Un "ya le hice el Yappy" por voz no lo confirma un bot.
      processedText += "\n[ARCHIVO: audio]";
    }

    // Documento, video, sticker o un audio que no es nota de voz (Telegram
    // manda los archivos de música como `audio`, sin URL que transcribir): no
    // hay nada que leer, pero tiene que existir el mensaje para que se abra el
    // ticket y alguien conteste. La condición mira `audioUrl`, no el tipo: si
    // ya se transcribió arriba, la marca ya está puesta.
    if (payload.fileKind && !payload.audioUrl) {
      const comoSeLlama =
        payload.fileKind === "video"
          ? "un video"
          : payload.fileKind === "audio"
            ? "un audio"
            : "un documento";
      processedText =
        (processedText || `(La clienta envió ${comoSeLlama})`) +
        `\n[ARCHIVO: ${payload.fileKind}]`;
    }

    if (payload.imageUrl) {
      hasImage = true;
      // Pro-only: if free tier, strip the image and inform the bot owner-side
      if (!isPro(this.env)) {
        processedText =
          (processedText || "") +
          "\n(El cliente mandó una imagen, pero tu plan no soporta análisis de imágenes.)";
      } else {
        processedText =
          (processedText || "(imagen sin caption)") +
          `\n[IMAGE_URL: ${payload.imageUrl}]`;
      }
    }

    // Append to buffer (we always persist the client's message)
    const pending = [
      ...this.state.pendingMessages,
      { text: processedText, receivedAt: Date.now() },
    ];
    this.setState({
      ...this.state,
      pendingMessages: pending,
      imageRetryCount: hasImage ? 0 : this.state.imageRetryCount,
    });

    // Resolve effective config (D1 settings overlaid on env defaults).
    // We need at least bot_paused (to decide whether to reply) and the buffer.
    const cfg = await resolveAgentConfig(this.env, []);

    // Owner paused the bot via the dashboard → keep the message buffered but
    // stay silent: do NOT arm the alarm, so alarm() never runs.
    if (cfg.botPaused) {
      return { acknowledged: true };
    }

    // Schedule buffer processing via the agents SDK scheduler.
    // The SDK overrides alarm() to dispatch named callbacks from its
    // cf_agents_schedules table, so raw ctx.storage.setAlarm() alone won't
    // invoke our code. We upsert a fixed 'msg-buffer' row (so rapid messages
    // debounce to a single fire) and set the raw alarm as the trigger.
    const alarmAt = Date.now() + cfg.bufferMs;
    const alarmAtSec = Math.floor(alarmAt / 1000);
    this.sql`
      INSERT OR REPLACE INTO cf_agents_schedules
        (id, callback, payload, type, time, created_at)
      VALUES
        ('msg-buffer', 'processBuffer', '{}', 'delayed', ${alarmAtSec}, unixepoch())
    `;
    await this.ctx.storage.setAlarm(alarmAt);
    this.setState({ ...this.state, lastAlarmAt: alarmAt });

    return { acknowledged: true };
  }

  /**
   * Called by the agents SDK scheduler when the msg-buffer task fires.
   * Processes accumulated messages as one input, runs the LLM loop, and
   * sends the chunked reply over the channel adapter.
   */
  async processBuffer(): Promise<void> {
    const buffered = [...this.state.pendingMessages];
    this.setState({ ...this.state, pendingMessages: [] });
    if (buffered.length === 0) return;

    const combined = buffered.map((m) => m.text).join("\n").trim();
    if (!combined) return;

    const db = new Db(this.env.DB);
    const msgs = new MessagesRepo(db);
    const convs = new ConversationsRepo(db);
    const convId = this.state.conversationId;
    if (!convId) {
      console.warn("[SupportAgent.processBuffer] no conversation_id in state");
      return;
    }

    // Persist user message
    await msgs.append(convId, "user", combined);
    await convs.touchLastMessage(convId);

    // Load history (last 20)
    const history = await msgs.lastN(convId, 20);

    // Tools y config ANTES de armar los mensajes: la config decide si al
    // modelo se le enseña o no un archivo entrante.
    const tools = buildTools({
      env: this.env,
      getConversationId: () => convId,
    });
    const toolNames = Object.keys(tools);
    const cfg = await resolveAgentConfig(this.env, toolNames);

    const aiMessages: any[] = history.slice(0, -1).map((m) => ({
      role: (m.role === "tool"
        ? "user"
        : m.role === "owner"
          ? "assistant"
          : m.role) as "user" | "assistant",
      // Sin esto, las marcas internas viajan al modelo como texto crudo en cada
      // turno siguiente — incluida la URL firmada del proxy de media, que el
      // modelo podría llegar a escribirle a la clienta.
      content: limpiarMarcas(m.content),
    }));

    /**
     * El último mensaje, con imagen o sin ella.
     *
     * Con `escalar_media` encendido, la imagen NO se le pasa al modelo — y eso
     * es deliberado, no una omisión. El negocio que lo enciende es el que
     * recibe comprobantes de pago: si el modelo ve la captura del Yappy, puede
     * contestar "veo su pago, coordino la entrega" y dar por bueno un pago que
     * nadie verificó.
     *
     * La instrucción de escalar ya existía en la base de conocimiento, pero
     * decía "el bot no puede ver ni interpretar archivos". Era falso: sí podía.
     * Una regla que el modelo puede comprobar que es falsa es una regla débil.
     * Ahora es cierta, porque el dato no llega.
     */
    const lastUserMsg = history[history.length - 1];
    let mediaEscalada = false;
    let tipoArchivo = "un archivo";
    if (lastUserMsg) {
      const imgMatch = lastUserMsg.content.match(/\[IMAGE_URL: (.+?)\]/);
      const fileMatch = lastUserMsg.content.match(RE_ARCHIVO);
      const cleanText = limpiarMarcas(lastUserMsg.content);
      if (imgMatch && isPro(this.env) && !cfg.escalarMedia) {
        aiMessages.push(buildMultimodalUserMessage(cleanText, imgMatch[1]));
      } else if ((imgMatch || fileMatch) && cfg.escalarMedia) {
        mediaEscalada = true;
        tipoArchivo = imgMatch ? "una imagen" : fileMatch![1] === "audio"
          ? "una nota de voz"
          : fileMatch![1] === "video"
            ? "un video"
            : "un documento";
        /**
         * En un audio, el texto ES el archivo: pasarle la transcripción sería
         * exactamente lo que la base de conocimiento jura que no ocurre. En una
         * imagen o un documento, en cambio, el texto es el pie que la clienta
         * escribió y sí es suyo — ese se conserva.
         */
        const visible =
          fileMatch?.[1] === "audio" ? "(nota de voz)" : cleanText || "(sin texto)";
        aiMessages.push({
          role: "user",
          content:
            `${visible}\n\n[La clienta adjuntó un archivo. NO puedes verlo ni oírlo: ` +
            "ya se creó un ticket y una persona del equipo lo va a revisar. Dígale con calidez " +
            "que lo está pasando con alguien del equipo para revisarlo. NUNCA des por confirmado " +
            "un pago ni describas el archivo: no lo tienes.]",
        });
      } else {
        aiMessages.push({ role: "user", content: cleanText || lastUserMsg.content });
      }
    }

    /**
     * El ticket se crea AQUÍ, no se le pide al modelo que llame handoffHuman.
     *
     * Es la parte que le importa al negocio —que la dueña se entere— y no puede
     * depender de que el modelo obedezca. Ya se vio: con la orden escrita en el
     * prompt, el bot repartió el WhatsApp y no creó ni un ticket.
     */
    if (mediaEscalada) {
      try {
        const ticketId = await new TicketsRepo(db).create({
          conversationId: convId,
          category: "other",
          summary: `La clienta envió ${tipoArchivo}. Requiere revisión humana.`,
          // En una nota de voz, la transcripción es justo lo que la persona
          // necesita leer para atender el caso sin volver a pedir el audio.
          transcript: lastUserMsg ? limpiarMarcas(lastUserMsg.content) : "",
        });
        await convs.setOpenTicket(convId, ticketId);
        await notifyOwner(this.env, {
          reason: "archivo recibido",
          summary: `La clienta envió ${tipoArchivo} que el bot no puede revisar.`,
          ticketId,
        });
      } catch (e) {
        console.error("[SupportAgent] no se pudo crear el ticket del archivo:", e);
      }
    }

    // Honor the dashboard's tool toggles: the prompt already only advertises
    // enabled tools (settings-loader), so the registry must match.
    const enabledTools = Object.fromEntries(
      Object.entries(tools).filter(([name]) => cfg.enabledToolNames.includes(name)),
    );

    // Select tier: honor an explicit override, otherwise auto-select. The active
    // provider (Anthropic default | OpenAI) maps the tier to a concrete model id.
    let tier: Tier =
      cfg.modelOverride === "haiku"
        ? "fast"
        : cfg.modelOverride === "sonnet"
          ? "smart"
          : selectModel({
              toolCallsInLast2Turns: this.state.toolCallsInLast2Turns,
              lastUserText: combined,
              lastUserLang: this.env.BOT_LANGUAGE,
              hasImage: false,
              imageRetryCount: this.state.imageRetryCount,
              lastSearchKbScore: this.state.lastSearchKbScore,
            });

    // Budget guard: at/over the monthly AI budget the bot keeps answering but
    // only on the cheap tier (never goes silent over money).
    if (cfg.monthlyBudgetUsd !== undefined && tier !== "fast") {
      const spent = await monthIaCostUsd(db);
      const guard = applyBudgetGuard(tier, spent, cfg.monthlyBudgetUsd);
      if (guard.downgraded) {
        console.warn(
          `[SupportAgent] monthly budget reached ($${spent.toFixed(2)}/$${cfg.monthlyBudgetUsd}) — downgrading to fast tier`,
        );
      }
      tier = guard.tier;
    }

    const { model, modelId, supportsPromptCache } = createModel(this.env, tier, cfg.llm);

    // Cache the (large, stable) system prompt with an ephemeral cache breakpoint.
    // Only the system block is cached — messages change every turn. Cache hits
    // show up in usage.cachedInputTokens (read below for cost accounting).
    // Prompt caching is Anthropic-only; on OpenAI we send the plain system block.
    const system: SystemModelMessage[] = [
      {
        role: "system",
        content: cfg.systemPrompt,
        ...(supportsPromptCache
          ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
          : {}),
      },
    ];

    // Customer memory (flywheel): facts extracted by the insights analyzer are
    // injected as a small UNCACHED system block, so a returning customer is
    // greeted by a bot that remembers them. The big prompt above stays cached.
    // Memory is an enhancement, never the critical path: if the lookup fails,
    // the reply still goes out.
    try {
      const facts = await new CustomerFactsRepo(db).forConversation(convId, 8);
      if (facts.length > 0) {
        system.push({
          role: "system",
          content: `<cliente>\nLo que ya sabes de este cliente (de conversaciones pasadas):\n${facts
            .map((f) => `- ${f.fact}`)
            .join("\n")}\n</cliente>`,
        });
      }
    } catch (e) {
      console.warn("[SupportAgent] customer facts lookup failed:", e);
    }

    let assistantText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let toolCallCount = 0;
    let toolCallsMade: { toolName: string; input: unknown }[] = [];
    let usedModelId = modelId;

    // Corre el loop del LLM con un modelo dado; deja los resultados en las vars.
    const attempt = async (m: any) => {
      const result = streamText({
        model: m,
        system,
        messages: aiMessages,
        tools: enabledTools,
        stopWhen: ({ steps }) => steps.length >= 6,
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      });
      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
      }
      assistantText = text;
      const usage = await result.usage;
      inputTokens = usage?.inputTokens ?? 0;
      outputTokens = usage?.outputTokens ?? 0;
      cachedTokens = usage?.cachedInputTokens ?? 0;
      const steps = await result.steps;
      toolCallCount = steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0);
      // Persist what the agent DID (not just what it said): tool name + input,
      // feeding the dashboard's thread chips, stats and the Mi Agente counters.
      toolCallsMade = steps.flatMap((s) =>
        (s.toolCalls ?? []).map((tc: any) => ({
          toolName: tc.toolName as string,
          input: tc.input,
        })),
      );
    };

    try {
      await attempt(model);
    } catch (e: any) {
      // FAILOVER con backoff: en ráfagas (historias) el primario suele dar un
      // rate-limit TRANSITORIO — esperar con jitter y reintentar resuelve la
      // mayoría; si no, se prueba el proveedor alterno (también con un segundo
      // intento). El jitter des-sincroniza mensajes que llegaron en el mismo
      // segundo. El bot no puede quedarse mudo el día del evento.
      console.error("[SupportAgent.processBuffer] streamText failed:", e);
      const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const { fallbackModel } = await import("./llm/provider");
      const primary = createModel(this.env, tier, cfg.llm);
      const fb = fallbackModel(this.env, tier, primary.provider);
      let ok = false;

      await backoff(2000 + Math.floor(Math.random() * 1500));
      try {
        await attempt(model);
        ok = true;
      } catch (e1: any) {
        console.error("[SupportAgent.processBuffer] primary retry failed:", e1);
      }

      if (!ok && fb) {
        console.warn(
          `[SupportAgent] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`,
        );
        try {
          await attempt(fb.model);
          usedModelId = fb.modelId;
          ok = true;
        } catch (e2: any) {
          console.error("[SupportAgent.processBuffer] fallback failed:", e2);
          await backoff(2500 + Math.floor(Math.random() * 1500));
          try {
            await attempt(fb.model);
            usedModelId = fb.modelId;
            ok = true;
          } catch (e3: any) {
            console.error("[SupportAgent.processBuffer] fallback retry failed:", e3);
          }
        }
      }

      if (!ok) {
        assistantText = "Disculpe, algo falló de mi lado. Inténtelo de nuevo en un momento.";
      }
    }

    // Persist assistant message (with usage + model_used + tool calls)
    await msgs.append(convId, "assistant", assistantText, {
      modelUsed: usedModelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedTokens,
      toolCalls: toolCallsMade.length > 0 ? toolCallsMade : undefined,
    });

    // Update state for next turn
    this.setState({
      ...this.state,
      toolCallsInLast2Turns: toolCallCount,
    });

    // Chunk + send via the channel adapter
    const chunks = chunkReply(assistantText, cfg.maxChunks);
    const channel = this.state.channel as ChannelId;
    const adapter = pickAdapter(channel);
    await adapter.sendReply(
      {
        channel,
        channelUserId: this.state.channelUserId,
        chunks,
        interChunkDelayMs: cfg.interChunkDelayMs,
      },
      this.env,
    );

    console.log(
      `[SupportAgent.processBuffer] sent ${chunks.length} chunks, model=${usedModelId}, cost=$${costOfUsage(
        usedModelId,
        { input: inputTokens, cached: cachedTokens, output: outputTokens },
      ).toFixed(5)}`,
    );
  }
}
