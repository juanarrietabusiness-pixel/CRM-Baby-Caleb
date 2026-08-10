// Shared UX module for non-technical owners (e.g. a barbershop owner).
//
// Every "technical" setting is presented as 2-3 selectable cards, each with an
// inline SVG icon + short label + one-line description in plain Spanish.
//
// This module is PURE DATA. It must NOT import anything from admin/views or Hono
// so it can be consumed both by the Pro dashboard and the Starter mini-panel.
//
// `value` is what we persist in the `settings` table (always TEXT). The helpers
// valueToLevel / levelToValue map a stored value back to the option that owns it
// and back again, so the UI can highlight the right card.

import { SETTING_KEYS } from "../db/settings";

export interface ControlOption {
  /** Persisted value (the raw setting value stored in D1). */
  value: string;
  /** Short human label shown on the card (Spanish). */
  label: string;
  /** One-line description in plain Spanish. */
  desc: string;
  /** Inline 24x24 SVG, stroke=currentColor, no external deps. */
  svg: string;
}

export interface ControlDef {
  /** The settings key this control writes to. */
  key: string;
  /** Friendly section title for the card group. */
  title: string;
  /** One-line helper text shown above the cards. */
  help: string;
  options: ControlOption[];
}

// --- SVG icons (24x24, stroke currentColor, simple) --------------------------

const SVG_SMILE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;

const SVG_BRIEFCASE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;

const SVG_CONFETTI = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l6-14 8 8-14 6z"/><path d="M14 6l1-2"/><path d="M18 8l2-1"/><path d="M19 13l2 1"/></svg>`;

const SVG_BOLT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

const SVG_CLOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>`;

const SVG_TURTLE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15a7 7 0 0 1 14 0"/><path d="M5 15h14"/><path d="M19 13l2-1"/><path d="M5 13l-2-1"/><path d="M8 15v3"/><path d="M16 15v3"/></svg>`;

const SVG_ONE_BUBBLE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.32L3 21l1.18-9A8.5 8.5 0 1 1 21 11.5z"/></svg>`;

const SVG_TWO_BUBBLES = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a4 4 0 0 1-4 4H7l-3 2 .5-3.5A4 4 0 0 1 4 9V6a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4z"/><path d="M17 8a4 4 0 0 1 3 3.9V14a3 3 0 0 1-1 2l2 2-3-1h-2a3 3 0 0 1-3-3"/></svg>`;

const SVG_MANY_BUBBLES = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/><path d="M21 11.5a8.38 8.38 0 0 1-9 8.32L3 21l1.18-9A8.5 8.5 0 1 1 21 11.5z"/></svg>`;

const SVG_FEATHER = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`;

const SVG_SCALE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M3 11l2-4 2 4a2 2 0 0 1-4 0z"/><path d="M17 11l2-4 2 4a2 2 0 0 1-4 0z"/><path d="M8 21h8"/></svg>`;

const SVG_BRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 4 9c0 1 .5 1.8 1.2 2.3A2.6 2.6 0 0 0 4 13.5 2.5 2.5 0 0 0 7 16v1a2 2 0 0 0 2 2V4z"/><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 20 9c0 1-.5 1.8-1.2 2.3A2.6 2.6 0 0 1 20 13.5 2.5 2.5 0 0 1 17 16v1a2 2 0 0 1-2 2V4z"/></svg>`;

const SVG_GREEN_DOT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`;

const SVG_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

// --- Control definitions -----------------------------------------------------

export const TONE_CONTROL: ControlDef = {
  key: SETTING_KEYS.tone,
  title: "Tono",
  help: "Cómo le habla el bot a sus clientes.",
  options: [
    {
      value: "cálido y cercano",
      label: "Cálido",
      desc: "Amable y cercano, como un amigo.",
      svg: SVG_SMILE,
    },
    {
      value: "formal y profesional",
      label: "Formal",
      desc: "Serio y profesional, trato de usted.",
      svg: SVG_BRIEFCASE,
    },
    {
      value: "divertido y relajado",
      label: "Divertido",
      desc: "Relajado y con buen humor.",
      svg: SVG_CONFETTI,
    },
  ],
};

export const SPEED_CONTROL: ControlDef = {
  key: SETTING_KEYS.bufferSeconds,
  title: "Velocidad de respuesta",
  help: "Qué tanto espera el bot a que el cliente termine de escribir.",
  options: [
    {
      value: "5",
      label: "Rápido",
      desc: "Responde casi al instante (5 segundos).",
      svg: SVG_BOLT,
    },
    {
      value: "15",
      label: "Normal",
      desc: "Espera un poco por si siguen escribiendo (15 segundos).",
      svg: SVG_CLOCK,
    },
    {
      value: "30",
      label: "Pausado",
      desc: "Espera más para juntar todo el mensaje (30 segundos).",
      svg: SVG_TURTLE,
    },
  ],
};

export const STYLE_CONTROL: ControlDef = {
  key: SETTING_KEYS.maxChunks,
  title: "Estilo de mensajes",
  help: "En cuántas burbujas parte su respuesta.",
  options: [
    {
      value: "1",
      label: "Un mensaje",
      desc: "Todo en una sola burbuja.",
      svg: SVG_ONE_BUBBLE,
    },
    {
      value: "3",
      label: "2-3 cortos",
      desc: "Parte la respuesta en pocas burbujas.",
      svg: SVG_TWO_BUBBLES,
    },
    {
      value: "5",
      label: "Varios cortos",
      desc: "Muchas burbujas cortas, estilo chat.",
      svg: SVG_MANY_BUBBLES,
    },
  ],
};

export const MODEL_CONTROL: ControlDef = {
  key: SETTING_KEYS.modelOverride,
  title: "Cerebro del bot",
  help: "Más barato vs más inteligente.",
  options: [
    {
      value: "haiku",
      label: "Económico",
      desc: "El más barato, ideal para preguntas simples.",
      svg: SVG_FEATHER,
    },
    {
      value: "auto",
      label: "Equilibrado",
      desc: "Elige solo según la dificultad de cada mensaje.",
      svg: SVG_SCALE,
    },
    {
      value: "sonnet",
      label: "Máximo",
      desc: "El más inteligente, para conversaciones complejas.",
      svg: SVG_BRAIN,
    },
  ],
};

export const STATUS_CONTROL: ControlDef = {
  key: SETTING_KEYS.botPaused,
  title: "Estado",
  help: "Encienda o apague el bot (ej. en vacaciones).",
  options: [
    {
      value: "0",
      label: "Activo",
      desc: "El bot responde a sus clientes.",
      svg: SVG_GREEN_DOT,
    },
    {
      value: "1",
      label: "En pausa",
      desc: "El bot no responde (útil en vacaciones).",
      svg: SVG_PAUSE,
    },
  ],
};

// Registry keyed by setting key, for generic lookups by the helpers + UI.
export const CONTROLS: Record<string, ControlDef> = {
  [TONE_CONTROL.key]: TONE_CONTROL,
  [SPEED_CONTROL.key]: SPEED_CONTROL,
  [STYLE_CONTROL.key]: STYLE_CONTROL,
  [MODEL_CONTROL.key]: MODEL_CONTROL,
  [STATUS_CONTROL.key]: STATUS_CONTROL,
};

// Ordered list for rendering the dashboard in a sensible sequence.
export const CONTROL_LIST: ControlDef[] = [
  TONE_CONTROL,
  SPEED_CONTROL,
  STYLE_CONTROL,
  MODEL_CONTROL,
  STATUS_CONTROL,
];

// --- Bidirectional mapping helpers -------------------------------------------

/**
 * Given a setting key and a stored value, return the human label of the option
 * that owns that value. Falls back to the control's first (default) option when
 * the value is empty/unknown. Returns null if the key has no card-based control.
 */
export function valueToLevel(key: string, storedValue: string | null | undefined): string | null {
  const control = CONTROLS[key];
  if (!control) return null;
  const v = (storedValue ?? "").trim();
  const match = control.options.find((o) => o.value === v);
  if (match) return match.label;
  return control.options[0].label;
}

/**
 * Given a setting key and a human label (or raw value), return the value to
 * persist. Accepts either the option label ("Rápido") or the option value ("5").
 * Falls back to the control's first (default) option value. Returns null if the
 * key has no card-based control.
 */
export function levelToValue(key: string, optionLabelOrValue: string | null | undefined): string | null {
  const control = CONTROLS[key];
  if (!control) return null;
  const v = (optionLabelOrValue ?? "").trim();
  const byValue = control.options.find((o) => o.value === v);
  if (byValue) return byValue.value;
  const byLabel = control.options.find((o) => o.label === v);
  if (byLabel) return byLabel.value;
  return control.options[0].value;
}
