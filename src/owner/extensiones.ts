// Lo que ESTE negocio le suma a la consola del dueño.
//
// Baby Caleb vende desde un catálogo con stock por bodega, así que su consola
// también maneja el inventario; y la dueña decide desde aquí a quién le hace
// seguimiento el bot y quién ya compró. Un negocio sin catálogo deja esta
// lista vacía.
import type { ExtensionDeConsola } from "./tipos";
import { inventario } from "./inventario";
import { seguimiento } from "./seguimiento";

export const EXTENSIONES: ExtensionDeConsola[] = [inventario, seguimiento];
