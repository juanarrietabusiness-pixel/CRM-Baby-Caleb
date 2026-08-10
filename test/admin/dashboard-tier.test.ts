import { describe, it, expect } from "vitest";
import { layout, renderUpgrade } from "../../src/admin/views/layout";
import type { Env } from "../../src/env";

const envOf = (tier: "free" | "pro") => ({ BOT_TIER: tier }) as unknown as Env;
const page = (tier: "free" | "pro") =>
  layout({ title: "Test", activeTab: "overview", body: "<p>body</p>", env: envOf(tier) });

describe("dashboard tier gating (nav)", () => {
  it("free: los tabs Pro salen bloqueados y apuntan a /admin/upgrade", () => {
    const html = page("free");
    // El item Pro (ej. Insights) no linkea a su vista real, sino al upgrade.
    expect(html).not.toContain('href="/admin/insights"');
    expect(html).toContain('href="/admin/upgrade"');
    expect(html).toContain("PRO"); // badge en el item bloqueado
    expect(html).toContain("Panel · Free");
  });

  it("free: los tabs básicos siguen accesibles", () => {
    const html = page("free");
    for (const href of ["/admin/conversations", "/admin/leads", "/admin/kb", "/admin/conexiones"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("pro: todos los tabs linkean a su vista real, sin badge PRO", () => {
    const html = page("pro");
    for (const href of ["/admin/insights", "/admin/stats", "/admin/costs", "/admin/mejoras", "/admin/campanas"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Panel · Pro");
    expect(html).not.toContain('href="/admin/upgrade"');
  });

  it("sin env (fallback) asume Pro — no oculta nada", () => {
    const html = layout({ title: "T", activeTab: "overview", body: "x" });
    expect(html).toContain('href="/admin/insights"');
  });

  it("renderUpgrade explica cómo encenderlo, sin vender nada", () => {
    const html = renderUpgrade(envOf("free"), "Insights");
    expect(html).toContain("Insights");
    // Es una instrucción de configuración, no un paywall: dice qué editar…
    expect(html).toContain('BOT_TIER = "pro"');
    expect(html).toContain("wrangler.toml");
    expect(html).toContain("ya es tuyo");
    // …y no manda a ningún lado a pagar ni a unirse a nada.
    expect(html).not.toContain("juancitoads.com");
    expect(html).not.toContain("comunidad");
  });
});
