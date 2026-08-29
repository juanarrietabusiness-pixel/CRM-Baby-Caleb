/**
 * Config de Tailwind para generar `public/admin.css`.
 *
 * Antes esto vivía como un objeto `tailwind.config` en línea dentro de
 * layout.ts, que leía el compilador de Tailwind en el navegador
 * (`cdn.tailwindcss.com`). Ese script bloqueaba el primer pintado y además
 * recorría el HTML y generaba el CSS en el teléfono del usuario, en cada carga.
 * Ahora la hoja se genera aquí, una vez, con `pnpm css:build`.
 *
 * Los colores NO se escriben aquí: salen de src/admin/views/tokens.json, el
 * mismo archivo que alimenta el bloque :root del shell. Un solo sitio.
 *
 * `content` apunta a todo lo que puede escribir una clase de Tailwind. Si
 * aparece una vista nueva fuera de estas rutas, sus clases no se generan y se
 * verá sin estilos — añádela aquí.
 */
const t = require("./src/admin/views/tokens.json");
const c = t.colors;

module.exports = {
  content: [
    "./src/admin/**/*.ts",
    "./src/niches/**/*.ts",
  ],
  theme: {
    extend: {
      colors: {
        bg: c.bg,
        panel: c.panel,
        panel2: c.panel2,
        raise: c.raise,
        line: c.line,
        linelit: c.linelit,
        accent: { DEFAULT: c.accent, soft: c["accent-soft"] },
        accent2: c["accent-2"],
        onaccent: c["on-accent"],
        cream: c.cream,
        muted: c.muted,
        dim: c.dim,
        ok: c.ok,
        info: c.info,
        warn: c.warn,
        bad: c.bad,
        violet: c.violet,
      },
      fontFamily: {
        display: t.fonts.display.split(","),
        sans: t.fonts.body.split(","),
        mono: t.fonts.mono.split(","),
      },
    },
  },
};
