import { describe, it, expect } from "vitest";
import { selectModel, FRUSTRATION_KEYWORDS_BY_LANG } from "../../src/upgrade/modelSelector";

describe("selectModel", () => {
  it("defaults to haiku", () => {
    expect(selectModel({
      toolCallsInLast2Turns: 0,
      lastUserText: "hola",
      lastUserLang: "es",
      hasImage: false,
      imageRetryCount: 0,
      lastSearchKbScore: 0.9,
    })).toBe("fast");
  });

  it("upgrades to sonnet on multi-tool turns", () => {
    expect(selectModel({
      toolCallsInLast2Turns: 4,
      lastUserText: "x",
      lastUserLang: "es",
      hasImage: false,
      imageRetryCount: 0,
      lastSearchKbScore: 0.9,
    })).toBe("smart");
  });

  it("upgrades on frustration keywords ES", () => {
    expect(selectModel({
      toolCallsInLast2Turns: 0,
      lastUserText: "esto no sirve para nada",
      lastUserLang: "es",
      hasImage: false,
      imageRetryCount: 0,
      lastSearchKbScore: 0.9,
    })).toBe("smart");
  });

  it("upgrades on KB miss (low score)", () => {
    expect(selectModel({
      toolCallsInLast2Turns: 0,
      lastUserText: "x",
      lastUserLang: "en",
      hasImage: false,
      imageRetryCount: 0,
      lastSearchKbScore: 0.4,
    })).toBe("smart");
  });

  it("upgrades on image retry", () => {
    expect(selectModel({
      toolCallsInLast2Turns: 0,
      lastUserText: "x",
      lastUserLang: "es",
      hasImage: true,
      imageRetryCount: 1,
      lastSearchKbScore: 0.9,
    })).toBe("smart");
  });
});
