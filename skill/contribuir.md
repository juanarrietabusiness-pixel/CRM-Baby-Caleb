---
name: contribuir
description: Reporta un bug o idea (issue) o manda un arreglo (PR) al repo de Juancito Ads desde Claude Code usando el CLI de GitHub (gh). El usuario no programa; tú corres gh. Actívalo con "/contribuir", "reporta este error", "abre un issue", "manda esto como mejora", "manda un PR", "contribuir a Juancito Ads", "sube este arreglo".
---

# Contribuir — issues y PRs desde Claude Code (con `gh`)

Ayudas al usuario a reportar problemas o mandar arreglos al **repo público de Juancito Ads** usando
el CLI de GitHub. Él NO programa: **tú corres `gh`**. Habla en español claro, sin jerga.

## PASO 0 — Verifica `gh` (una sola vez)
1. Corre `gh auth status`. Si NO está logueado, dile: *"Necesito conectar tu GitHub una vez.
   Escribe `! gh auth login` y sigue los pasos (se abre el navegador)."* Espera a que confirme.
2. El repo oficial es **`juanarrietabusiness-pixel/CRM-JuancitoADS`** (público — cualquiera puede abrir issues y PRs).
   Normalmente ya es el `origin` de la carpeta; confírmalo con `git remote -v` y usa ese `owner/repo`.

## Decide el modo
- Quiere **reportar** algo (bug o idea) → **MODO ISSUE**.
- Ya hay un **cambio/arreglo** que quiere mandar → **MODO PR**.
Si no está claro, pregúntale.

## MODO ISSUE (reportar)
1. Junta la info: qué pasó, qué esperaba, cómo reproducirlo, y su setup (canal, proveedor de IA,
   el error/mensaje). Si vienen de `/cliente-misterioso`, reusa ese diagnóstico.
2. **LEE** la plantilla del repo (`.github/ISSUE_TEMPLATE/bug_report.md` para bug, o
   `feature_request.md` para idea) y **llénala** respetando sus secciones.
3. Crea el issue:
   ```
   gh issue create --repo <owner/repo> --title "[BUG] <resumen corto>" --body "<cuerpo llenado>"
   ```
   (Para una idea usa el prefijo `[IDEA]`. Puedes añadir `--label bug` o `--label enhancement`;
   si `gh` se queja de que la etiqueta no existe, reintenta **sin** `--label`.)
4. Dale al miembro el **link** del issue que imprime `gh`. No inventes el número.

## MODO PR (mandar un arreglo)
1. **Asegura que el cambio FUNCIONA**: corre `pnpm test` y `pnpm typecheck`. Si algo falla,
   arréglalo o avisa — NUNCA mandes un PR roto. No toques `member/`.
2. Crea una rama y commitea:
   ```
   git checkout -b fix/<algo-corto>
   git add -A && git commit -m "<mensaje claro>"
   ```
3. **LEE** `.github/PULL_REQUEST_TEMPLATE.md` y llénalo (qué cambia / por qué / cómo lo probaste /
   checklist). Abre el PR:
   ```
   gh pr create --repo <owner/repo> --base main --title "<resumen>" --body "<plantilla llenada>"
   ```
   Si el miembro **no tiene permiso de push** (acceso de lectura), el push fallará. En ese caso
   crea un fork y abre el PR desde ahí:
   ```
   gh repo fork <owner/repo> --clone=false --remote=true
   git push -u origin fix/<algo-corto>      # origin ahora apunta a su fork
   gh pr create --repo <owner/repo> --base main --head <su-usuario>:fix/<algo-corto> \
     --title "<resumen>" --body "<plantilla llenada>"
   ```
4. Dale el **link** del PR. Recuérdale: un maintainer lo revisa y lo mergea — **él no mergea**.

## Reglas (no las rompas)
- **NUNCA** mergees, ni hagas push a `main` del repo oficial. Solo abres issues/PRs.
- **NUNCA** pongas secrets ni API keys en el issue o PR.
- Si **tu agente** abrió el PR, recuérdale al miembro **revisar el diff** — es su responsabilidad.
- Sé conciso: issue/PR claro, enfocado en un solo tema, sin relleno.
