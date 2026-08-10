const DEFAULT_MAX_CHUNKS = 3;

export function chunkReply(text: string, maxChunks: number = DEFAULT_MAX_CHUNKS): string[] {
  const cap = Math.max(1, Math.floor(maxChunks));
  const trimmed = text.trim();

  if (cap === 1) return [trimmed];

  // Try paragraph split first (explicit breaks win over length)
  const paras = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1 && paras.length <= cap) {
    return paras;
  }
  if (paras.length > cap) {
    // Keep the first cap-1 paragraphs, merge the tail into the last chunk
    const head = paras.slice(0, cap - 1);
    const tail = paras.slice(cap - 1).join(" ");
    return [...head, tail];
  }

  // Single paragraph — try sentence split
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [trimmed];

  // Distribute sentences into <= cap groups
  const chunks: string[] = [];
  const perChunk = Math.ceil(sentences.length / cap);
  for (let i = 0; i < sentences.length; i += perChunk) {
    chunks.push(sentences.slice(i, i + perChunk).join(" "));
  }
  return chunks.slice(0, cap);
}
