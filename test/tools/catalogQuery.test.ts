import { describe, it, expect, vi } from "vitest";

// Mock the member config import
vi.mock("../../member/config.local", () => ({
  catalog: [
    { name: "Concha", price: 25, description: "Pan dulce clásico" },
    { name: "Pan de muerto", price: 45, description: "Solo en temporada" },
  ],
}));

import { catalogQueryTool } from "../../src/tools/catalogQuery";

describe("catalogQueryTool", () => {
  it("returns matching products by fuzzy name", async () => {
    const tool = catalogQueryTool({} as any);
    const result = (await tool.execute!({ query: "concha" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Concha");
  });

  it("returns empty matches when nothing matches", async () => {
    const tool = catalogQueryTool({} as any);
    const result = (await tool.execute!({ query: "xyzabc" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(0);
  });
});
