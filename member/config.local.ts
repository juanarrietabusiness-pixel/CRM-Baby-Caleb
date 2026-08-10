// member/config.local.ts
// Business-specific configuration. Edited by the member (or by the skill
// /configurar-mi-chatbot). NEVER overwritten on template update.
//
// This is a stub with example values. Replace with your real business info.

export const memberConfig = {
  businessName: "Mi Negocio Ejemplo",
  botName: "Asistente",
  language: "es" as "es" | "en",
  tier: "pro" as "free" | "pro",
  timezone: "America/Mexico_City",
  contactEmail: "contacto@minegocio.example",
};

export type MemberConfig = typeof memberConfig;

// Business context consumed by src/businessContext.ts to render the
// <business_context> section of the system prompt. Edit freely.
export const businessConfig = {
  hours: "Lun-Sáb 10am-8pm. Domingo cerrado.",
  services: [
    { name: "Corte", price: 250 },
    { name: "Barba", price: 200 },
    { name: "Corte + Barba", price: 400 },
  ],
  location: "Av. Constitución 145, Centro, Monterrey",
  paymentMethods: ["efectivo", "transferencia", "tarjeta"],
  contactPhone: "81 1234 5678",
  customFields: {
    // member can add any string keys
  } as Record<string, string>,
};

// Product catalog consumed by src/tools/catalogQuery.ts (Pro tier).
// Member fills via skill. Example:
//   { name: "Pan dulce", price: 25, description: "Concha tradicional", sku: "PD-01" }
export const catalog: { name: string; price: number; description?: string; sku?: string }[] = [];
