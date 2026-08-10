import { describe, it, expect } from "vitest";
import { checkBasicCredentials, ADMIN_USERNAME } from "../../src/admin/auth";
import type { Env } from "../../src/env";

const env = { DASHBOARD_PASSWORD: "secret123" } as unknown as Env;

/** base64("admin:secret123") === "YWRtaW46c2VjcmV0MTIz" */
const validHeader = "Basic YWRtaW46c2VjcmV0MTIz";

describe("checkBasicCredentials", () => {
  it("accepts the correct admin:secret123 header", () => {
    expect(checkBasicCredentials(validHeader, env)).toBe(true);
  });

  it("is case-insensitive on the Basic scheme keyword", () => {
    expect(checkBasicCredentials("basic YWRtaW46c2VjcmV0MTIz", env)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const header = `Basic ${btoa(`${ADMIN_USERNAME}:wrongpass`)}`;
    expect(checkBasicCredentials(header, env)).toBe(false);
  });

  it("rejects a wrong username", () => {
    const header = `Basic ${btoa("root:secret123")}`;
    expect(checkBasicCredentials(header, env)).toBe(false);
  });

  it("rejects an absent header", () => {
    expect(checkBasicCredentials(undefined, env)).toBe(false);
    expect(checkBasicCredentials(null, env)).toBe(false);
    expect(checkBasicCredentials("", env)).toBe(false);
  });

  it("rejects a malformed header (no Basic scheme)", () => {
    expect(checkBasicCredentials("Bearer YWRtaW46c2VjcmV0MTIz", env)).toBe(false);
    expect(checkBasicCredentials("YWRtaW46c2VjcmV0MTIz", env)).toBe(false);
  });

  it("rejects a payload that decodes without a colon separator", () => {
    const header = `Basic ${btoa("adminsecret123")}`;
    expect(checkBasicCredentials(header, env)).toBe(false);
  });

  it("uses the FIRST colon so passwords containing colons still work", () => {
    const colonEnv = { DASHBOARD_PASSWORD: "a:b:c" } as unknown as Env;
    const header = `Basic ${btoa("admin:a:b:c")}`;
    expect(checkBasicCredentials(header, colonEnv)).toBe(true);
  });
});
