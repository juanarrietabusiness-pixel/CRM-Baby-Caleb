import type { NichePack } from "./types";

// Pack por defecto = comportamiento actual del bot (soporte & ventas genérico).
// Es lo que ve un bot sin BOT_NICHE o con un nicho desconocido. No re-etiqueta
// nada ni fuerza tono/playbook: el dashboard sigue diciendo "Leads".
export const generico: NichePack = {
  id: "generico",
  recordSingular: "Lead",
  recordPlural: "Leads",
  navLabel: "Leads",
  navIcon: "user-plus",
  kpiLabel: "Leads captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Vendido", lost: "Perdido" },
  columns: [],
  playbook: "",
  defaultTone: "",
  kbDocs: [],
};
