import { describe, it, expect } from "vitest";
import { getByPath, inferPath, detectKind } from "../../src/learn/fieldPath";

// A realistic ManyChat-style payload (as a ManyChat/n8n flow sends it).
const manychatPayload = {
  id: 1234567890,
  subscriber_id: 1234567890,
  first_name: "Ana",
  last_name: "Perez",
  last_input_text: "hola, cuanto cuesta?",
  last_growth_tool: {
    channel: "instagram",
    id: "gt_42",
  },
  attachments: [
    {
      type: "audio",
      payload: { url: "https://cdn.manychat.com/voice/abc123.ogg" },
    },
  ],
  custom_fields: {
    email: "ana@example.com",
  },
};

describe("getByPath", () => {
  it("reads a top-level scalar", () => {
    expect(getByPath(manychatPayload, "id")).toBe(1234567890);
    expect(getByPath(manychatPayload, "last_input_text")).toBe("hola, cuanto cuesta?");
  });

  it("reads a nested object value", () => {
    expect(getByPath(manychatPayload, "last_growth_tool.channel")).toBe("instagram");
    expect(getByPath(manychatPayload, "custom_fields.email")).toBe("ana@example.com");
  });

  it("reads through array index segments", () => {
    expect(getByPath(manychatPayload, "attachments.0.type")).toBe("audio");
    expect(getByPath(manychatPayload, "attachments.0.payload.url")).toBe(
      "https://cdn.manychat.com/voice/abc123.ogg",
    );
  });

  it("supports bracket notation for indices and keys", () => {
    expect(getByPath(manychatPayload, "attachments[0].payload.url")).toBe(
      "https://cdn.manychat.com/voice/abc123.ogg",
    );
    expect(getByPath(manychatPayload, "attachments[0][type]")).toBe("audio");
    expect(getByPath(manychatPayload, "last_growth_tool['channel']")).toBe("instagram");
    expect(getByPath(manychatPayload, 'last_growth_tool["channel"]')).toBe("instagram");
  });

  it("reads a wrapped body.* path", () => {
    const wrapped = { body: { id: "u_99", text: "hey" } };
    expect(getByPath(wrapped, "body.id")).toBe("u_99");
    expect(getByPath(wrapped, "body.text")).toBe("hey");
  });

  it("returns undefined for missing segments", () => {
    expect(getByPath(manychatPayload, "nope")).toBeUndefined();
    expect(getByPath(manychatPayload, "last_growth_tool.missing")).toBeUndefined();
    expect(getByPath(manychatPayload, "attachments.5.payload.url")).toBeUndefined();
  });

  it("returns undefined when traversing into a primitive", () => {
    // last_input_text is a string; .length is a real property but we don't
    // expose primitive props — traversal stops at the non-object.
    expect(getByPath(manychatPayload, "id.foo")).toBeUndefined();
    expect(getByPath(manychatPayload, "last_input_text.0.bar")).toBeUndefined();
  });

  it("handles null / undefined inputs gracefully", () => {
    expect(getByPath(null, "id")).toBeUndefined();
    expect(getByPath(undefined, "id")).toBeUndefined();
    expect(getByPath({}, "")).toBeUndefined();
    expect(getByPath(manychatPayload, "")).toBeUndefined();
  });

  it("indexes into a bare array root", () => {
    const arr = [{ url: "a" }, { url: "b" }];
    expect(getByPath(arr, "0.url")).toBe("a");
    expect(getByPath(arr, "1.url")).toBe("b");
    expect(getByPath(arr, "2.url")).toBeUndefined();
  });

  it("returns null-valued leaves as null (not undefined)", () => {
    const o = { a: { b: null } };
    expect(getByPath(o, "a.b")).toBeNull();
  });
});

describe("inferPath", () => {
  it("finds the path of a known subscriber id (number target)", () => {
    expect(inferPath(manychatPayload, 1234567890)).toBe("id");
  });

  it("matches numbers against string targets (and vice versa)", () => {
    // target given as string, stored as number
    expect(inferPath(manychatPayload, "1234567890")).toBe("id");
    // target given with surrounding whitespace
    expect(inferPath(manychatPayload, "  1234567890  ")).toBe("id");
  });

  it("finds the path of the input text", () => {
    expect(inferPath(manychatPayload, "hola, cuanto cuesta?")).toBe("last_input_text");
  });

  it("finds the channel inside a nested object", () => {
    expect(inferPath(manychatPayload, "instagram")).toBe("last_growth_tool.channel");
  });

  it("finds the path of an attachment url (array + nested)", () => {
    expect(inferPath(manychatPayload, "https://cdn.manychat.com/voice/abc123.ogg")).toBe(
      "attachments.0.payload.url",
    );
  });

  it("returns the FIRST matching path in DFS order", () => {
    // "dup" appears in two places; DFS hits a.b before c.
    const dup = { a: { b: "dup" }, c: "dup" };
    expect(inferPath(dup, "dup")).toBe("a.b");
  });

  it("returns undefined when the value is absent", () => {
    expect(inferPath(manychatPayload, "value-not-present")).toBeUndefined();
  });

  it("returns undefined for null / empty targets", () => {
    expect(inferPath(manychatPayload, null)).toBeUndefined();
    expect(inferPath(manychatPayload, undefined)).toBeUndefined();
    expect(inferPath(manychatPayload, "")).toBeUndefined();
    expect(inferPath(manychatPayload, "   ")).toBeUndefined();
  });

  it("round-trips: getByPath(obj, inferPath(obj, v)) === v", () => {
    const target = "https://cdn.manychat.com/voice/abc123.ogg";
    const path = inferPath(manychatPayload, target);
    expect(path).toBeDefined();
    expect(getByPath(manychatPayload, path as string)).toBe(target);
  });

  it("handles bare-array roots", () => {
    const arr = [{ v: "x" }, { v: "y" }];
    expect(inferPath(arr, "y")).toBe("1.v");
  });
});

describe("detectKind", () => {
  it("classifies an audio attachment payload as audio", () => {
    expect(detectKind(manychatPayload)).toBe("audio");
  });

  it("detects audio from a URL extension", () => {
    expect(detectKind({ url: "https://x.com/a.mp3" })).toBe("audio");
    expect(detectKind({ url: "https://x.com/a.ogg" })).toBe("audio");
    expect(detectKind({ url: "https://x.com/a.m4a" })).toBe("audio");
    expect(detectKind({ url: "https://x.com/a.wav" })).toBe("audio");
  });

  it("detects image from a URL extension", () => {
    expect(detectKind({ url: "https://x.com/p.jpg" })).toBe("image");
    expect(detectKind({ url: "https://x.com/p.jpeg" })).toBe("image");
    expect(detectKind({ url: "https://x.com/p.png" })).toBe("image");
    expect(detectKind({ url: "https://x.com/p.webp" })).toBe("image");
  });

  it("ignores query strings / fragments when sniffing extensions", () => {
    expect(detectKind({ url: "https://x.com/a.mp3?token=abc" })).toBe("audio");
    expect(detectKind({ url: "https://x.com/p.png#frag" })).toBe("image");
  });

  it("detects from attachment `type` markers without an extension", () => {
    expect(detectKind({ attachments: [{ type: "image", payload: { url: "https://x/u" } }] })).toBe(
      "image",
    );
    expect(detectKind({ attachments: [{ type: "audio", payload: { url: "https://x/u" } }] })).toBe(
      "audio",
    );
  });

  it("prefers audio over image when both are present", () => {
    const mixed = {
      attachments: [
        { type: "image", payload: { url: "https://x/thumb.png" } },
        { type: "audio", payload: { url: "https://x/voice.ogg" } },
      ],
    };
    expect(detectKind(mixed)).toBe("audio");
  });

  it("falls back to text for plain messages", () => {
    expect(detectKind({ id: "u1", last_input_text: "hola" })).toBe("text");
    expect(detectKind({ url: "https://example.com/page" })).toBe("text");
  });

  it("handles null / undefined / empty / arrays without throwing", () => {
    expect(detectKind(null)).toBe("text");
    expect(detectKind(undefined)).toBe("text");
    expect(detectKind({})).toBe("text");
    expect(detectKind([])).toBe("text");
    expect(detectKind("just a string")).toBe("text");
    expect(detectKind([{ url: "https://x/a.mp3" }])).toBe("audio");
  });

  it("is case-insensitive for extensions and types", () => {
    expect(detectKind({ url: "https://x.com/A.MP3" })).toBe("audio");
    expect(detectKind({ url: "https://x.com/P.PNG" })).toBe("image");
    expect(detectKind({ attachments: [{ type: "AUDIO" }] })).toBe("audio");
  });
});
