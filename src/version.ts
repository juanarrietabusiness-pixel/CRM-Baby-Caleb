import pkg from "../package.json";

/**
 * Bot version — same source of truth as the deploy-time `.bot-version` artifact
 * (the `version:write` script writes `package.json`'s version to `.bot-version`).
 * Exposed at runtime through `GET /api/health`.
 */
export const BOT_VERSION: string = pkg.version;
