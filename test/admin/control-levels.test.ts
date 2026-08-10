import { describe, it, expect } from "vitest";
import {
  CONTROL_LIST,
  CONTROLS,
  valueToLevel,
  levelToValue,
  TONE_CONTROL,
  SPEED_CONTROL,
  STYLE_CONTROL,
  MODEL_CONTROL,
  STATUS_CONTROL,
} from "../../src/admin/control-levels";
import { SETTING_KEYS } from "../../src/db/settings";

describe("control-levels data", () => {
  it("exposes a control for each settings key with levels", () => {
    expect(Object.keys(CONTROLS).sort()).toEqual(
      [
        SETTING_KEYS.tone,
        SETTING_KEYS.bufferSeconds,
        SETTING_KEYS.maxChunks,
        SETTING_KEYS.modelOverride,
        SETTING_KEYS.botPaused,
      ].sort(),
    );
  });

  it("every control has 2-3 options, each with non-empty label, desc and svg", () => {
    for (const control of CONTROL_LIST) {
      expect(control.options.length).toBeGreaterThanOrEqual(2);
      expect(control.options.length).toBeLessThanOrEqual(3);
      for (const opt of control.options) {
        expect(opt.label.trim().length).toBeGreaterThan(0);
        expect(opt.desc.trim().length).toBeGreaterThan(0);
        expect(opt.value.trim().length).toBeGreaterThan(0);
        expect(opt.svg.trim().length).toBeGreaterThan(0);
        expect(opt.svg).toContain("<svg");
        expect(opt.svg).toContain("currentColor");
      }
    }
  });

  it("option values are unique within each control", () => {
    for (const control of CONTROL_LIST) {
      const values = control.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("valueToLevel / levelToValue round-trips", () => {
  for (const control of [
    TONE_CONTROL,
    SPEED_CONTROL,
    STYLE_CONTROL,
    MODEL_CONTROL,
    STATUS_CONTROL,
  ]) {
    it(`round-trips every option for ${control.key}`, () => {
      for (const opt of control.options) {
        // value -> level -> value
        const level = valueToLevel(control.key, opt.value);
        expect(level).toBe(opt.label);
        expect(levelToValue(control.key, level)).toBe(opt.value);
        // level (label) -> value -> level
        expect(levelToValue(control.key, opt.label)).toBe(opt.value);
        expect(valueToLevel(control.key, levelToValue(control.key, opt.label))).toBe(opt.label);
      }
    });
  }

  it("maps the known speed examples (5 <-> Rápido)", () => {
    expect(valueToLevel(SETTING_KEYS.bufferSeconds, "5")).toBe("Rápido");
    expect(levelToValue(SETTING_KEYS.bufferSeconds, "Rápido")).toBe("5");
  });

  it("falls back to the first option for empty/unknown values", () => {
    expect(valueToLevel(SETTING_KEYS.tone, "")).toBe(TONE_CONTROL.options[0].label);
    expect(valueToLevel(SETTING_KEYS.tone, null)).toBe(TONE_CONTROL.options[0].label);
    expect(valueToLevel(SETTING_KEYS.tone, "xxx")).toBe(TONE_CONTROL.options[0].label);
    expect(levelToValue(SETTING_KEYS.tone, "xxx")).toBe(TONE_CONTROL.options[0].value);
  });

  it("returns null for a key without a card-based control", () => {
    expect(valueToLevel(SETTING_KEYS.botName, "anything")).toBeNull();
    expect(levelToValue(SETTING_KEYS.businessContext, "anything")).toBeNull();
  });
});
