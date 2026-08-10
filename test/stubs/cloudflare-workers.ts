// Stub for the virtual `cloudflare:workers` module (only available inside the
// workerd runtime). The `agents` / `partyserver` packages import these classes
// at module-load time, which breaks Node's ESM loader when Vitest imports the
// worker (`src/index.ts`) directly. This stub provides just enough surface for
// those imports to resolve so the Hono router under test can load. The real
// behavior of these base classes is exercised inside Miniflare, not here.

export class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// `agents` extends `Agent` (which extends a server base) and reads `AgentContext`.
export class Agent<Env = unknown, State = unknown> extends DurableObject<Env> {
  state!: State;
  initialState!: State;
  setState(state: State): void {
    this.state = state;
  }
}

export class AgentContext {}

export class WorkerEntrypoint<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

export const env: Record<string, unknown> = {};
