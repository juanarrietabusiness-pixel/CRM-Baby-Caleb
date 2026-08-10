import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  evalScenarios,
  expectedTools,
  scenariosByLang,
  scenariosByCategory,
  type EvalScenario,
} from "../../scripts/eval-scenarios";
import { buildFixtures } from "../../scripts/generate-fixtures";

const LANGS = ["es", "en", "pt"] as const;
const TIERS = ["free", "pro"] as const;
const CATEGORIES = [
  "faq",
  "lead-capture",
  "booking",
  "handoff",
  "frustration",
  "out-of-scope",
  "image-input",
  "voice-input",
] as const;

describe("eval-scenarios fixtures", () => {
  it("contains exactly 20 scenarios", () => {
    expect(evalScenarios).toHaveLength(20);
  });

  it("has unique ids", () => {
    const ids = evalScenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every scenario is well-formed", () => {
    for (const s of evalScenarios as EvalScenario[]) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(LANGS).toContain(s.lang);
      expect(TIERS).toContain(s.tier);
      expect(CATEGORIES).toContain(s.category);
      expect(s.userMessage.trim().length).toBeGreaterThan(0);
      expect(s.rubric.trim().length).toBeGreaterThan(0);
      // expectedToolCall is either null or a non-empty string
      expect(s.expectedToolCall === null || s.expectedToolCall.length > 0).toBe(true);
    }
  });

  it("covers all three languages", () => {
    for (const lang of LANGS) {
      expect(scenariosByLang(lang).length).toBeGreaterThan(0);
    }
  });

  it("covers every required category", () => {
    for (const cat of CATEGORIES) {
      expect(scenariosByCategory(cat).length).toBeGreaterThan(0);
    }
  });

  it("covers both tiers", () => {
    for (const tier of TIERS) {
      expect(evalScenarios.some((s) => s.tier === tier)).toBe(true);
    }
  });

  it("exposes the expected core tool names", () => {
    expect(expectedTools).toContain("searchKb");
    expect(expectedTools).toContain("captureLead");
    expect(expectedTools).toContain("handoffHuman");
    expect(expectedTools).toContain("scheduleAppointment");
  });
});

describe("generate-fixtures buildFixtures", () => {
  it("returns [] for a missing KB dir (no crash)", () => {
    const missing = join(tmpdir(), "kb-does-not-exist-" + Date.now());
    expect(buildFixtures(missing)).toEqual([]);
  });

  it("ignores dotfiles like .gitkeep (empty KB stays empty)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-empty-"));
    writeFileSync(join(dir, ".gitkeep"), "");
    expect(buildFixtures(dir)).toEqual([]);
  });

  it("builds one chunk per text doc with a title", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-text-"));
    writeFileSync(join(dir, "hours.md"), "# Horarios\nLun-Vie 9-18.");
    writeFileSync(join(dir, "notes.txt"), "Entrega el mismo día.");
    const out = buildFixtures(dir);
    expect(out).toHaveLength(2);
    const hours = out.find((c) => c.source === "hours.md");
    expect(hours?.title).toBe("Horarios");
    expect(hours?.content).toContain("Lun-Vie");
    const notes = out.find((c) => c.source === "notes.txt");
    expect(notes?.title).toBe("notes.txt");
  });

  it("expands a JSON array into one chunk per entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-json-"));
    writeFileSync(
      join(dir, "faq.json"),
      JSON.stringify([
        { id: "q1", title: "Pago", content: "Aceptamos efectivo." },
        { title: "Envío", text: "Envío gratis arriba de $500." },
      ]),
    );
    const out = buildFixtures(dir);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("q1");
    expect(out[0].content).toContain("efectivo");
    expect(out[1].content).toContain("Envío gratis");
  });

  it("recurses into subdirectories", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-nested-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "deep.md"), "# Deep\nnested doc");
    const out = buildFixtures(dir);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("sub/deep.md");
  });
});
