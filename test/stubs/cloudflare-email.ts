// Stub for the virtual `cloudflare:email` module (only available inside the
// workerd runtime). The `agents` package imports `EmailMessage` at module-load
// time; this stub lets that import resolve under Node/Vitest. Email is never
// exercised in these tests.

export class EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: unknown;
  constructor(from: string, to: string, raw: unknown) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}
