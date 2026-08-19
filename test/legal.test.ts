import { describe, it, expect } from "vitest";
import { renderPrivacyPolicy, renderTerms, renderDataDeletion } from "../src/legal";

const env = {
  BUSINESS_NAME: "Baby Caleb",
  OWNER_EMAIL: "hola@babycaleb.example",
  DASHBOARD_BASE_URL: "https://bot.example.workers.dev",
} as any;

const pages = [
  ["privacidad", renderPrivacyPolicy],
  ["terminos", renderTerms],
  ["eliminar-datos", renderDataDeletion],
] as const;

describe("páginas legales", () => {
  for (const [name, render] of pages) {
    describe(name, () => {
      it("lleva el nombre del negocio y su correo de contacto", () => {
        const html = render(env);
        expect(html).toContain("Baby Caleb");
        expect(html).toContain("mailto:hola@babycaleb.example");
      });

      it("es HTML completo en español y enlaza las otras páginas legales", () => {
        const html = render(env);
        expect(html.startsWith("<!doctype html>")).toBe(true);
        expect(html).toContain('<html lang="es">');
        expect(html).toContain("/privacidad");
        expect(html).toContain("/terminos");
        expect(html).toContain("/eliminar-datos");
      });

      it("no revela secretos aunque estén en el env", () => {
        const html = render({ ...env, WHATSAPP_ACCESS_TOKEN: "TOKEN_SECRETO", DASHBOARD_PASSWORD: "clave" });
        expect(html).not.toContain("TOKEN_SECRETO");
        expect(html).not.toContain("clave");
      });

      it("aguanta un negocio sin correo configurado sin romperse", () => {
        const html = render({ BUSINESS_NAME: "Sin Correo" } as any);
        expect(html).toContain("Sin Correo");
        expect(html).not.toContain("mailto:");
        expect(html).toContain("aún no publicó un correo");
      });

      it("escapa el nombre del negocio para que no inyecte HTML", () => {
        const html = render({ ...env, BUSINESS_NAME: '<script>alert(1)</script>' });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
      });
    });
  }

  it("privacidad dice la retención real de mensajes (90 días)", () => {
    expect(renderPrivacyPolicy(env)).toContain("90 días");
  });

  it("términos avisa de que responde una IA y puede equivocarse", () => {
    const html = renderTerms(env);
    expect(html).toMatch(/inteligencia artificial/i);
    expect(html).toMatch(/errores/i);
  });

  it("eliminar-datos explica qué mandar para identificar al solicitante", () => {
    expect(renderDataDeletion(env)).toMatch(/número de teléfono/i);
  });
});
