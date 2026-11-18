/**
 * Los tipos de `config-de-despliegue.mjs`.
 *
 * El guion es `.mjs` y no `.ts` a propósito: lo importa `ci-deploy.mjs`, que
 * node ejecuta directo durante el despliegue, sin pasar por ningún compilador.
 * Hacerlo TypeScript obligaría a compilar antes de desplegar — un paso más
 * justo en el camino donde un paso más es un sitio más donde fallar.
 *
 * Así que los tipos viven aquí, para que la prueba y el typecheck lo vean.
 */

export interface ConfigDeDespliegue {
  /** El archivo de configuración con el que hay que desplegar. */
  readonly config: string;
  /** Si este negocio declaró un sistema detrás (`member/sistema.json`). */
  readonly conSistema: boolean;
  /** El Worker del sistema, cuando lo hay. */
  readonly worker?: string;
}

export function configDeDespliegue(): ConfigDeDespliegue;
