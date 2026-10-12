import { describe, expect, it } from 'vitest';
import { estimate, loadCarlitoMetrics } from '../lib/cv-v2/fit-estimator';

describe('one-page acceptance fixtures', () => {
  it('accepts twenty varied one-page CVs with the safety margin', () => {
    const metrics = loadCarlitoMetrics();
    for (let index = 0; index < 20; index += 1) {
      const cv = {
        experience: [{ role: `Long title ${index}`, company: 'Example', bullets: Array.from({ length: 3 }, (_, item) => `Built service ${index}-${item} with measurable reliability improvements.`) }],
        projects: Array.from({ length: index % 4 + 1 }, (_, project) => ({ title: `Project ${index} ${project} with a long title`, bullets: Array.from({ length: 2 }, (_, item) => `Implemented feature ${project}-${item} using verified tools and test coverage.`) })),
        skills: [{ category: 'Tools & Platforms', items: 'TypeScript, PostgreSQL, Redis' }],
      };
      const result = estimate(cv, undefined, metrics);
      expect(result.estimatedPages).toBe(1);
      expect(result.overflow).toBe(false);
    }
  });
});
