import { describe, it, expect } from "vitest";
import {
  renderSystemPrompt,
  systemPromptFromEnv,
  type SystemPromptInput,
} from "../src/system-prompt";

const input: SystemPromptInput = {
  botName: "Asistente",
  businessName: "Barbería Centro",
  language: "es",
  businessContext: "Horarios: Lun-Sáb 10am-8pm\nUbicación: Monterrey",
  toolList: ["searchKb", "handoffHuman", "pauseBot"],
};

describe("renderSystemPrompt", () => {
  it("contains all 10 sections", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<business_context>");
    expect(prompt).toContain("<identity_and_voice>");
    expect(prompt).toContain("<core_principles>");
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("<escalation_rules>");
    expect(prompt).toContain("<style_guide>");
    expect(prompt).toContain("<anti_patterns>");
  });

  it("replaces every placeholder (none left)", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("}}");
  });

  it("interpolates language, bot name and business name", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("es");
    expect(prompt).toContain("Asistente");
    expect(prompt).toContain("Barbería Centro");
  });

  it("renders tool list as bullet lines", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("- handoffHuman");
    expect(prompt).toContain("- pauseBot");
  });

  it("injects business context", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("Horarios: Lun-Sáb 10am-8pm");
  });

  it("inserts nichoPlaybook when provided and empty string when omitted", () => {
    const withPlaybook = renderSystemPrompt({
      ...input,
      nichoPlaybook: "<diagnostic_playbooks>X</diagnostic_playbooks>",
    });
    expect(withPlaybook).toContain("<diagnostic_playbooks>X</diagnostic_playbooks>");
    // omitted -> the placeholder is gone, replaced by ""
    const withoutPlaybook = renderSystemPrompt(input);
    expect(withoutPlaybook).not.toContain("{{NICHO_PLAYBOOK}}");
  });
});

// El bot llegó a ofrecer "cremas y lociones" —productos inexistentes— ante un
// "¿qué tienen disponible?". La regla dejó de ser un consejo en la descripción
// de la tool y pasó al system prompt, que va en cada turno.
describe("<fuentes_de_verdad>", () => {
  const conCatalogo = { ...input, toolList: ["searchKb", "catalogQuery", "handoffHuman"] };

  it("obliga a consultar el catálogo antes de hablar de productos", () => {
    const prompt = renderSystemPrompt(conCatalogo);
    expect(prompt).toContain("<fuentes_de_verdad>");
    expect(prompt).toContain("REGLA INQUEBRANTABLE");
    expect(prompt).toContain("Siempre, sin excepción");
    expect(prompt).toContain("NO EXISTE");
  });

  it("cubre la pregunta general y la venta por volumen", () => {
    const prompt = renderSystemPrompt(conCatalogo);
    expect(prompt).toContain("¿qué tienen?");
    expect(prompt).toContain("`cantidad`");
    expect(prompt).toContain("maximoDisponible");
  });

  it("solo promete las fuentes que están activas", () => {
    // Sin catalogQuery (tool apagada desde el panel) no se menciona el catálogo:
    // prometerlo haría que el modelo intente llamar algo que no existe.
    const soloKb = renderSystemPrompt(input);
    expect(soloKb).toContain("<fuentes_de_verdad>");
    expect(soloKb).toContain("searchKb");
    expect(soloKb).not.toContain("catalogQuery");
    expect(soloKb).toContain("una sola fuente");

    expect(renderSystemPrompt(conCatalogo)).toContain("exactamente dos fuentes");
  });

  it("se omite entero si no hay ninguna fuente de verdad activa", () => {
    const sinFuentes = renderSystemPrompt({ ...input, toolList: ["handoffHuman"] });
    expect(sinFuentes).not.toContain("<fuentes_de_verdad>");
    expect(sinFuentes).not.toContain("{{");
  });
});

describe("systemPromptFromEnv", () => {
  it("pulls botName/businessName/language from env", () => {
    const env = {
      BOT_NAME: "Bot",
      BUSINESS_NAME: "Acme",
      BOT_LANGUAGE: "en",
    } as any;
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx here");
    expect(prompt).toContain("Bot");
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("en");
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("ctx here");
  });
});
