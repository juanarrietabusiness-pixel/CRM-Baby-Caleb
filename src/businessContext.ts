import { businessConfig } from "../member/config.local";

export type BusinessConfig = typeof businessConfig;

export function renderBusinessContext(cfg: BusinessConfig = businessConfig): string {
  // Cada línea es opcional: si el miembro saltó ese dato en el onboarding, no la
  // metemos (evita "Servicios y precios:" o "Métodos de pago:" vacíos en el prompt).
  const lines: string[] = [];
  if (cfg.hours) lines.push(`Horarios: ${cfg.hours}`);
  if (cfg.services?.length) {
    lines.push(`Servicios y precios:\n${cfg.services.map((s) => `${s.name}: $${s.price}`).join("\n")}`);
  }
  if (cfg.location) lines.push(`Ubicación: ${cfg.location}`);
  if (cfg.paymentMethods?.length) lines.push(`Métodos de pago: ${cfg.paymentMethods.join(", ")}`);
  if (cfg.contactPhone) lines.push(`Teléfono: ${cfg.contactPhone}`);
  for (const [k, v] of Object.entries(cfg.customFields ?? {})) {
    if (v) lines.push(`${k}: ${v}`);
  }
  return lines.join("\n");
}
