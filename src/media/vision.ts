import type { ModelMessage } from "ai";

export function buildMultimodalUserMessage(
  text: string | undefined,
  imageUrl: string | undefined,
): ModelMessage {
  if (!imageUrl) {
    return { role: "user", content: text ?? "" };
  }
  return {
    role: "user",
    content: [
      { type: "image", image: new URL(imageUrl) },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}
