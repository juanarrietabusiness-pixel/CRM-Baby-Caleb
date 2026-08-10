import { describe, it, expect } from "vitest";
import {
  parseJudgeVerdict,
  scoreResults,
  buildJudgePrompt,
  summarize,
  JUDGE_MODEL,
  DEFAULT_THRESHOLD,
  type EvalFixture,
  type EvalResult,
} from "../../scripts/eval-bot-live";

// Estos tests validan SOLO la lógica pura de scoring/parsing del runner.
// El "juez" está mockeado como strings de salida — cero red, cero env vars.

describe("parseJudgeVerdict (judge mockeado)", () => {
  it("parsea JSON puro de aprobación", () => {
    const out = parseJudgeVerdict('{"passed": true, "reason": "Agendó la cita."}');
    expect(out).toEqual({ passed: true, reason: "Agendó la cita." });
  });

  it("parsea JSON puro de rechazo", () => {
    const out = parseJudgeVerdict('{"passed": false, "reason": "No usó la tool."}');
    expect(out).toEqual({ passed: false, reason: "No usó la tool." });
  });

  it("extrae JSON embebido en texto del juez", () => {
    const raw = `Mi veredicto es el siguiente:\n{"passed": true, "reason": "Correcto"} ¡listo!`;
    expect(parseJudgeVerdict(raw)).toEqual({ passed: true, reason: "Correcto" });
  });

  it("fail-closed cuando no hay JSON", () => {
    const out = parseJudgeVerdict("El bot estuvo bien creo");
    expect(out.passed).toBe(false);
    expect(out.reason).toMatch(/JSON/i);
  });

  it("fail-closed con JSON malformado", () => {
    const out = parseJudgeVerdict('{"passed": true, "reason": ');
    expect(out.passed).toBe(false);
  });

  it("fail-closed cuando falta el campo passed", () => {
    const out = parseJudgeVerdict('{"reason": "olvidé el passed"}');
    expect(out.passed).toBe(false);
    expect(out.reason).toMatch(/passed/i);
  });

  it("fail-closed cuando passed no es booleano", () => {
    const out = parseJudgeVerdict('{"passed": "yes", "reason": "string en vez de bool"}');
    expect(out.passed).toBe(false);
  });

  it("fail-closed con string vacío", () => {
    expect(parseJudgeVerdict("").passed).toBe(false);
    expect(parseJudgeVerdict("   ").passed).toBe(false);
  });

  it("usa razón por defecto cuando reason está vacío", () => {
    const out = parseJudgeVerdict('{"passed": true, "reason": ""}');
    expect(out).toEqual({ passed: true, reason: "(sin razón)" });
  });
});

describe("scoreResults (umbral 85%)", () => {
  const mk = (n: number, pass: number): EvalResult[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      passed: i < pass,
      reason: "x",
    }));

  it("calcula pass-rate correctamente", () => {
    const s = scoreResults(mk(20, 17));
    expect(s.total).toBe(20);
    expect(s.passed).toBe(17);
    expect(s.failed).toBe(3);
    expect(s.passRate).toBeCloseTo(0.85, 5);
  });

  it("85% exacto cumple el umbral por defecto", () => {
    const s = scoreResults(mk(20, 17));
    expect(s.meetsThreshold).toBe(true);
    expect(s.threshold).toBe(DEFAULT_THRESHOLD);
  });

  it("por debajo de 85% NO cumple el umbral", () => {
    const s = scoreResults(mk(20, 16)); // 80%
    expect(s.meetsThreshold).toBe(false);
  });

  it("100% cumple", () => {
    expect(scoreResults(mk(10, 10)).meetsThreshold).toBe(true);
  });

  it("lista vacía no cumple (evita 0/0=NaN pasando)", () => {
    const s = scoreResults([]);
    expect(s.passRate).toBe(0);
    expect(s.meetsThreshold).toBe(false);
  });

  it("respeta un umbral custom", () => {
    const s = scoreResults(mk(10, 9), 0.95);
    expect(s.meetsThreshold).toBe(false);
    const s2 = scoreResults(mk(10, 9), 0.9);
    expect(s2.meetsThreshold).toBe(true);
  });
});

describe("buildJudgePrompt", () => {
  const fix: EvalFixture = {
    id: "agenda-cita",
    userMessage: "quiero agendar para mañana",
    rubric: "debe ofrecer agendar y pedir la hora",
    expectedToolCall: "checkAvailability",
  };

  it("incluye id, mensaje, rúbrica, tool y respuesta del bot", () => {
    const p = buildJudgePrompt(fix, "Claro, ¿a qué hora te queda bien?");
    expect(p).toContain("agenda-cita");
    expect(p).toContain("quiero agendar para mañana");
    expect(p).toContain("debe ofrecer agendar");
    expect(p).toContain("checkAvailability");
    expect(p).toContain("¿a qué hora te queda bien?");
    expect(p).toContain('"passed"');
  });

  it("muestra 'ninguna' cuando no hay tool esperada", () => {
    const p = buildJudgePrompt({ ...fix, expectedToolCall: null }, "hola");
    expect(p).toContain("ninguna");
  });
});

describe("summarize", () => {
  it("renderiza marcas de pass/fail y el veredicto final", () => {
    const summary = scoreResults([
      { id: "a", passed: true, reason: "ok" },
      { id: "b", passed: false, reason: "mal" },
    ]);
    const text = summarize(summary);
    expect(text).toContain("✓ a");
    expect(text).toContain("✗ b");
    expect(text).toContain("1/2");
    expect(text).toMatch(/FAIL/);
  });
});

describe("constantes del runner", () => {
  it("usa Sonnet 4.x como juez", () => {
    expect(JUDGE_MODEL).toBe("claude-sonnet-4-5-20250929");
  });
  it("umbral por defecto = 0.85", () => {
    expect(DEFAULT_THRESHOLD).toBe(0.85);
  });
});
