import { describe, expect, it } from 'vitest';
import { lintBulletQuality, lintBullets } from '../lib/cv-v2/bullet-quality';

describe('bullet quality lint', () => {
  it('reports deterministic banned phrase and budget warnings', () => {
    const warnings = lintBulletQuality('Leveraged a very long implementation that worked on many things', 20);
    expect(warnings.map((warning) => warning.code)).toEqual(['banned_phrase', 'banned_phrase', 'over_budget', 'missing_period']);
  });

  it('returns stable warning counts', () => {
    const report = lintBullets([
      { path: 'projects.p.0', text: 'Built an API.' },
      { path: 'experience.e.0', text: 'Helped with testing' },
    ]);
    expect(report.counts).toEqual({ banned_phrase: 1, weak_opening: 1, missing_period: 1 });
  });
});
