import { describe, it, expect } from "vitest";
import { graphVersion, GRAPH_API_VERSION } from "../../src/channels/graph";

describe("graphVersion", () => {
  it("usa la versión del código cuando no hay override", () => {
    expect(graphVersion({})).toBe(GRAPH_API_VERSION);
  });

  it("permite subir de versión sin tocar código", () => {
    expect(graphVersion({ GRAPH_API_VERSION: "v27.0" })).toBe("v27.0");
    expect(graphVersion({ GRAPH_API_VERSION: " v26.0 " })).toBe("v26.0");
  });

  it("ignora valores basura para no romper todas las llamadas a Meta", () => {
    for (const bad of ["26", "latest", "", "v26", "'v26.0'"]) {
      expect(graphVersion({ GRAPH_API_VERSION: bad })).toBe(GRAPH_API_VERSION);
    }
  });
});
