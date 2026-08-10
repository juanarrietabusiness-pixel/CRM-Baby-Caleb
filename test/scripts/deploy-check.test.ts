import { describe, it, expect } from "vitest";
import { validateDeployConfig } from "../../scripts/deploy-check";

describe("validateDeployConfig", () => {
  const full = {
    ANTHROPIC_API_KEY: "sk-x",
    BOT_NAME: "Testi",
    BOT_TIER: "pro",
    DASHBOARD_PASSWORD: "pw",
    TELEGRAM_BOT_TOKEN: "tok",
  };

  it("passes with a complete Pro config", () => {
    expect(validateDeployConfig(full)).toEqual({ ok: true, errors: [] });
  });

  it("passes a Free config without DASHBOARD_PASSWORD", () => {
    const { DASHBOARD_PASSWORD, ...rest } = full;
    expect(validateDeployConfig({ ...rest, BOT_TIER: "free" }).ok).toBe(true);
  });

  it("fails when ANTHROPIC_API_KEY is missing", () => {
    const { ANTHROPIC_API_KEY, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("ANTHROPIC_API_KEY");
  });

  it("fails when no channel is configured", () => {
    const { TELEGRAM_BOT_TOKEN, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("canal");
  });

  it("fails Pro without DASHBOARD_PASSWORD", () => {
    const { DASHBOARD_PASSWORD, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("DASHBOARD_PASSWORD");
  });
});
