export type SimilarityReport = {
  entryId: string;
  bulletText: string;
  similarity: number;
  nearVerbatim: boolean;
};

function tokens(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
}

export function bulletSimilarity(text: string, source: string): number {
  const output = tokens(text);
  const input = tokens(source);
  if (output.size === 0 || input.size === 0) return 0;
  let overlap = 0;
  for (const token of output) if (input.has(token)) overlap += 1;
  return overlap / Math.max(output.size, input.size);
}

export function reportBulletSimilarity(
  bullets: Array<{ entryId: string; text: string; sourceFactIds: string[] }>,
  facts: Map<string, string>,
): SimilarityReport[] {
  return bullets.map((bullet) => {
    const source = bullet.sourceFactIds.map((id) => facts.get(id) ?? '').join(' ');
    const similarity = bulletSimilarity(bullet.text, source);
    return { entryId: bullet.entryId, bulletText: bullet.text, similarity, nearVerbatim: similarity >= 0.9 };
  });
}
