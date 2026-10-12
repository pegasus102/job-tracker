import bannedPhrases from '../../data/banned-phrases.json';

export type BulletQualityWarning = {
  code: 'banned_phrase' | 'over_budget' | 'weak_opening' | 'missing_period';
  message: string;
};

const weakOpenings = /^(?:worked on|helped with|responsible for|participated in|assisted with)\b/i;

export function lintBulletQuality(text: string, budget = 90): BulletQualityWarning[] {
  const warnings: BulletQualityWarning[] = [];
  const lower = text.toLocaleLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase.toLocaleLowerCase())) {
      warnings.push({ code: 'banned_phrase', message: `Banned phrase "${phrase}"` });
    }
  }
  if (text.length > budget) warnings.push({ code: 'over_budget', message: `Over character budget (${text.length}/${budget})` });
  if (weakOpenings.test(text.trim())) warnings.push({ code: 'weak_opening', message: 'Weak or passive opening' });
  if (text.trim() && !/[.!?]$/.test(text.trim())) warnings.push({ code: 'missing_period', message: 'Bullet does not end with punctuation' });
  return warnings;
}

export function lintBullets(
  bullets: Array<{ path: string; text: string }>,
  budgets: { project: number; experience: number } = { project: 90, experience: 90 },
): { warnings: Array<BulletQualityWarning & { path: string }>; counts: Record<string, number> } {
  const warnings = bullets.flatMap(({ path, text }) =>
    lintBulletQuality(text, path.startsWith('experience') ? budgets.experience : budgets.project)
      .map((warning) => ({ path, ...warning }))
  );
  const counts = warnings.reduce<Record<string, number>>((result, warning) => {
    result[warning.code] = (result[warning.code] ?? 0) + 1;
    return result;
  }, {});
  return { warnings, counts };
}
