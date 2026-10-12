import { describe, expect, it, vi } from 'vitest';
import { reviewAndRevise } from '../lib/cv-v2/critic';
import { scoreAtsProxy } from '../lib/cv-v2/ats-score';
import { buildCandidateVault } from '../lib/cv-v2/vault';
import type { WritingResult } from '../lib/cv-v2/write-cv';

const vault = buildCandidateVault({
  master_projects: [{ id: 'p1', title: 'API', tech_stack: 'TypeScript, PostgreSQL', bullets: ['Built a TypeScript API for 12 users'] }],
  master_experience: [],
  master_skills: [{ category: 'Languages', items: 'TypeScript' }],
});
const analysis = {
  role: 'Engineer',
  seniority: 'Junior',
  requirements: [
    { id: 'r1', text: 'TypeScript', type: 'must' as const, weight: 3 as const, technical: true },
    { id: 'r2', text: 'REST APIs', type: 'must' as const, weight: 3 as const, technical: true },
  ],
  keywords: ['TypeScript', 'REST APIs'],
};
const selection = { chosen: [{ project: vault.projects[0], why: '', depth: 1 }], alternatives: [], matrix: [], uncovered_requirements: [], coverage: 1, total: 1 };
const cv: WritingResult = {
  projects: [{ project_id: 'p1', stack_order: ['TypeScript', 'PostgreSQL'], bullets: [{ text: 'Built a TypeScript API for 12 users', source_fact_ids: [vault.projects[0].facts[0].id], priority: 1 }] }],
  experience: [],
  skills: [{ category: 'Languages', items: ['TypeScript'] }],
  added_skills: [],
};

describe('Phase 6 critic and ATS proxy', () => {
  it('rejects a revision that fails deterministic validation', async () => {
    const revision = { ...cv, projects: [{ ...cv.projects[0], stack_order: ['Rust'] }] };
    const client = { generateValidatedJson: vi.fn()
      .mockResolvedValueOnce({ value: { pass: false, issues: [{ path: 'projects.0.bullets.0.text', severity: 'high', type: 'lost_specificity', message: 'Too generic', suggested_fix: 'Restore nouns' }] } })
      .mockResolvedValueOnce({ value: revision }) };
    const result = await reviewAndRevise({ cv, analysis, selection, vault, client: client as never });
    expect(result.revisionKept).toBe(false);
    expect(result.cv).toBe(cv);
  });

  it('rejects a revision when deterministic high issues increase', async () => {
    const revision = { ...cv, projects: [{ ...cv.projects[0], stack_order: ['Rust'], bullets: [{ ...cv.projects[0].bullets[0], source_fact_ids: ['wrong'] }] }] };
    const client = { generateValidatedJson: vi.fn()
      .mockResolvedValueOnce({ value: { pass: false, issues: [{ path: 'projects.0.bullets.0.text', severity: 'high', type: 'causal_link', message: 'Causal', suggested_fix: 'Separate' }] } })
      .mockResolvedValueOnce({ value: revision }) };
    const result = await reviewAndRevise({ cv, analysis, selection, vault, client: client as never });
    expect(result.revisionKept).toBe(false);
  });

  it('returns missing keyword guidance without implication matching', () => {
    const result = scoreAtsProxy(cv, analysis);
    expect(result.matched).toContain('TypeScript');
    expect(result.missing[0]).toEqual({
      requirement: 'REST APIs',
      ask_user: 'Do you have real experience with REST APIs? If yes, add it to your Master Profile.',
    });
    expect(result.score).toBe(50);
  });
});
