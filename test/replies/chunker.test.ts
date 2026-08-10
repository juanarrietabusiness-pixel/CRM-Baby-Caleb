import { describe, it, expect } from "vitest";
import { chunkReply } from "../../src/replies/chunker";

describe("chunkReply", () => {
  it("returns single chunk for short text", () => {
    expect(chunkReply("Hola María, qué tal")).toEqual(["Hola María, qué tal"]);
  });

  it("splits by paragraph breaks first", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("Hola María.");
    expect(chunks[1]).toBe("¿Te agendo hoy?");
    expect(chunks[2]).toBe("Tengo 5pm o 7pm.");
  });

  it("falls back to sentence split when no paragraphs", () => {
    const text = "Hola María. ¿Te agendo hoy? Tengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("caps at 3 chunks even for long content", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Oración ${i}.`).join(" ");
    const chunks = chunkReply(text);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("preserves total content (no characters lost)", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    const joined = chunks.join(" ").replace(/\s+/g, " ");
    const original = text.replace(/\s+/g, " ");
    expect(joined).toBe(original);
  });
});
