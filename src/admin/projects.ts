// Selector de proyectos (multi-bot): cada instancia puede declarar a sus
// "hermanas" en la env var PEER_BOTS (JSON: [{"name":"...","url":"https://…/admin"}]).
// El header del panel muestra un dropdown para brincar entre proyectos — cada
// bot conserva su propia base de datos y su propio login; esto es navegación,
// no fusión de datos. Ideal para agencias con un bot por cliente.
import type { Env } from "../env";

export interface PeerBot {
  name: string;
  url: string;
}

export function parsePeerBots(env: Env): PeerBot[] {
  const raw = (env.PEER_BOTS ?? "").trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (p): p is PeerBot =>
          p && typeof p.name === "string" && typeof p.url === "string" && /^https?:\/\//.test(p.url),
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
