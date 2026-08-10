// Un "niche pack" personaliza el bot para un giro (restaurante, inmobiliaria…)
// sin forkear el código: BOT_NICHE elige el pack y éste re-etiqueta el dashboard,
// define columnas propias (que viven en lead.metadata JSON), aporta el playbook
// del giro para el prompt y un tono por defecto. Agregar un nicho = un archivo.

export interface NicheColumn {
  /** Llave dentro de lead.metadata (JSON) de donde sale el valor. */
  key: string;
  /** Encabezado que se muestra en la tabla. */
  label: string;
}

export interface NichePack {
  /** id estable = valor de BOT_NICHE (ej. "restaurante"). */
  id: string;
  /** Cómo se llama UN registro capturado (singular/plural) — re-etiqueta "Lead". */
  recordSingular: string;
  recordPlural: string;
  /** Item del nav lateral (reemplaza "Leads"). */
  navLabel: string;
  /** Ícono lucide del nav. */
  navIcon: string;
  /** KPI del Resumen (reemplaza "Leads captados"). */
  kpiLabel: string;
  /**
   * Re-etiqueta los 4 estados canónicos del lead para el pipeline del giro.
   * El enum de la columna `status` NO cambia (new|contacted|sold|lost) — solo
   * su presentación, así no hay migración ni se rompe el handler de estados.
   */
  statusLabels: { new: string; contacted: string; sold: string; lost: string };
  /** Columnas extra que se leen de lead.metadata (JSON), en orden. */
  columns: NicheColumn[];
  /** Playbook del giro que rellena {{NICHO_PLAYBOOK}} en el system prompt. */
  playbook: string;
  /** Tono por defecto si el dueño no eligió uno en el panel. */
  defaultTone: string;
  /** Docs de KB sugeridos para el setup del giro. */
  kbDocs: string[];
}
