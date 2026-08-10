# Cómo contribuir — PanaClaw Bot

¡Gracias por mejorar la plantilla! Esto es de la comunidad, para la comunidad: si tú
encuentras (o arreglas) algo, todos los miembros se benefician.

## ¿Encontraste un bug o tienes una idea? → Abre un Issue
**No necesitas saber programar.** Ve a la pestaña **Issues → New issue**, elige
"🐛 Reportar un problema" o "💡 Proponer una idea", y llena las casillas. Con eso ya
ayudas un montón.

> 💡 Si usas Claude Code, antes de reportar puedes correr `/cliente-misterioso` o pedirle
> "diagnostica mi bot" — a veces te dice qué es al instante.

## ¿Quieres mandar un arreglo? → Pull Request (vía fork)
1. Dale **Fork** a este repo (botón arriba a la derecha).
2. En tu fork, crea una rama y haz tu cambio. Si usas Claude Code, pídele que lo haga y que
   corra `pnpm test` + `pnpm typecheck` antes.
3. Abre un **Pull Request** hacia `main` de este repo, explicando **qué cambia y por qué**.
4. El CI corre los tests solo. Un maintainer lo revisa y lo mergea. (Tú no mergeas directo —
   así protegemos la plantilla de todos.)

### Reglas
- **No toques `member/`** (es la config de cada quien). Cambios solo en `src/`, `test/`,
  `skill/` o documentación.
- **Un PR = un solo tema.** Enfocado y chico = se revisa y mergea más rápido.
- Si tu **agente** abrió el PR, **revisa el diff tú mismo** antes — tú eres responsable.
- **Nada de secrets ni API keys** en el código (van como `wrangler secret`).

## Dudas rápidas
Mejor en **[Discussions](https://github.com/abrinay1997-stack/CRM-PANACLAW/discussions)**. Los issues aquí son para bugs e ideas
sobre la plantilla.
