import { describe, expect, it, vi } from 'vitest';
import { buildCandidateVault } from '../lib/cv-v2/vault';
import { validateWriting } from '../lib/cv-v2/validate-writing';
import { resolveWritingMode, writingPrompt, writingResponseSchema, writeCv, writeCvDetailed } from '../lib/cv-v2/write-cv';
import type { WritingResult } from '../lib/cv-v2/write-cv';

const vault = buildCandidateVault({
  master_projects: [{
    id: 'p1',
    title: 'API',
    tech_stack: 'TypeScript, PostgreSQL',
    bullets: ['Built a TypeScript API for 12 users'],
  }],
  master_experience: [{
    id: 'e1',
    role: 'Developer',
    company: 'Lab',
    duration: '2024',
    bullets: ['Automated reports with Python'],
  }],
  master_skills: [{ category: 'Languages', items: 'TypeScript, Python' }],
});
const analysis = {
  role: 'Engineer',
  seniority: 'Junior',
  requirements: [{ id: 'r1', text: 'TypeScript', type: 'must' as const, weight: 3 as const, technical: true }],
  keywords: ['TypeScript'],
};
const selection = {
  chosen: [{ project: vault.projects[0], why: '', depth: 1 }],
  alternatives: [],
  matrix: [],
  uncovered_requirements: [],
  coverage: 1,
  total: 1,
};
const base = (): WritingResult => ({
  projects: [{ project_id: 'p1', stack_order: ['TypeScript', 'PostgreSQL'], bullets: [{ text: 'Built a TypeScript API for 12 users', source_fact_ids: [vault.projects[0].facts[0].id], priority: 1 }] }],
  experience: [{ experience_id: 'e1', bullets: [{ text: 'Automated reports with Python', source_fact_ids: [vault.experience[0].facts[0].id], priority: 1 }] }],
  skills: [{ category: 'Languages', items: ['TypeScript'] }],
  added_skills: [],
});

function check(output: ReturnType<typeof base>) {
  return validateWriting(output, { analysis, selection, vault });
}

describe('Phase 5 writing validation', () => {
  it('includes supplied style examples in the delimited prompt', () => {
    expect(writingPrompt({
      analysis,
      selection,
      vault,
      client: {} as never,
      styleExamples: [{ text: 'Built a concise API.' }],
    }))
      .toContain('<style_examples>[{"text":"Built a concise API."}]</style_examples>');
  });

  it('defaults to single writing mode and accepts per-entry mode', () => {
    expect(resolveWritingMode(undefined)).toBe('single');
    expect(resolveWritingMode('per_entry')).toBe('per_entry');
  });
  it('keeps the writing schema flat and array-safe', () => {
    expect(writingResponseSchema.type).toBe('object');
    expect(writingResponseSchema.properties?.projects).toMatchObject({ type: 'array' });
  });

  it('catches invented numbers, unsupported tools, wrong facts, and stack changes', () => {
    const output = base();
    output.projects[0].bullets[0].text = 'Built a Rust API for 99 users';
    output.projects[0].bullets[0].source_fact_ids = [vault.experience[0].facts[0].id];
    output.projects[0].stack_order = ['Rust'];
    const result = check(output);
    expect(result.violations.map((item) => item.message).join('|')).toMatch(/Invented number|Unsupported tool|Fact ID|Stack/);
  });

  it('reports banned phrases as cosmetic warnings and rejects generic skills', () => {
    const output = base();
    output.experience[0].bullets[0].text = 'Leveraged communication to automate reports';
    output.skills[0].items.push('teamwork');
    const result = check(output);
    expect(result.warnings.some((item) => item.message.includes('Banned phrase'))).toBe(true);
    expect(result.violations.some((item) => item.message.includes('Generic'))).toBe(true);
  });

  it('rejects four added skills', () => {
    const output = base();
    output.added_skills = ['A', 'B', 'C', 'D'].map((name) => ({ name, related_fact_ids: [vault.experience[0].facts[0].id], reason: 'Adjacent fact' }));
    expect(check(output).violations.some((item) => item.path === 'added_skills')).toBe(true);
  });

  it('rejects causal merging across facts', () => {
    const sourceVault = buildCandidateVault({
      master_projects: [{
        id: 'p1',
        title: 'Operations Dashboard',
        tech_stack: 'React, TypeScript, REST',
        bullets: ['Added filter state, accessible tables, and drill-down views for 14 alert categories', 'Reduced weekly spreadsheet review time from 6 hours to 90 minutes'],
      }],
    });
    const sourceSelection = { ...selection, chosen: [{ project: sourceVault.projects[0], why: '', depth: 1 }] };
    const output = base();
    output.projects = [{
      project_id: 'p1',
      stack_order: ['React', 'TypeScript', 'REST'],
      bullets: [{
        text: 'Added accessible tables for 14 alert categories, reducing review from 6 hours to 90 minutes.',
        source_fact_ids: sourceVault.projects[0].facts.map((fact) => fact.id),
        priority: 1,
      }],
    }];
    const result = validateWriting(output, { analysis, selection: sourceSelection, vault: sourceVault });
    expect(result.violations.some((item) => item.message.includes('Causal connective'))).toBe(true);
  });

  it('requires qualifiers and baselines from the cited facts', () => {
    const sourceVault = buildCandidateVault({
      master_projects: [{
        id: 'p1',
        title: 'Edge',
        tech_stack: 'Go',
        bullets: ['Recovered configuration after simulated network outages in under 20 seconds', 'Reduced review time from 6 hours to 90 minutes'],
      }],
    });
    const sourceSelection = { ...selection, chosen: [{ project: sourceVault.projects[0], why: '', depth: 1 }] };
    const output = base();
    output.projects = [{
      project_id: 'p1',
      stack_order: ['Go'],
      bullets: [
        { text: 'Recovered configuration after network outages in 20 seconds', source_fact_ids: [sourceVault.projects[0].facts[0].id], priority: 1 },
        { text: 'Reduced review time to 90 minutes', source_fact_ids: [sourceVault.projects[0].facts[1].id], priority: 1 },
      ],
    }];
    const result = validateWriting(output, { analysis, selection: sourceSelection, vault: sourceVault });
    expect(result.violations.some((item) => item.message.includes('simulated'))).toBe(true);
    expect(result.violations.some((item) => item.message.includes('Missing baseline 6'))).toBe(true);
  });

  it('moves vocabulary items out of added skills', async () => {
    const output = base();
    output.added_skills = [{ name: 'PostgreSQL', related_fact_ids: [vault.projects[0].facts[0].id], reason: 'Adjacent database work' }];
    const client = { generateValidatedJson: vi.fn().mockResolvedValue({ value: output }) };
    const result = await writeCv({ analysis, selection, vault, client: client as never });
    expect(result.added_skills).toEqual([]);
    expect(result.skills.flatMap((group) => group.items)).toContain('PostgreSQL');
  });

  it('sanitizes a causal bullet after repair without failing', async () => {
    const output = base();
    output.projects[0].bullets[0] = {
      text: 'Built a TypeScript API, reducing latency',
      source_fact_ids: [vault.projects[0].facts[0].id, vault.projects[0].facts[0].id],
      priority: 1,
    };
    const client = { generateValidatedJson: vi.fn().mockResolvedValue({ value: output }) };
    const result = await writeCvDetailed({ analysis, selection, vault, client: client as never });
    expect(result.result.projects[0].bullets[0].text).toBe(vault.projects[0].facts[0].text);
    expect(result.sanitizations.some((item) => item.message.includes('fallback: used source fact'))).toBe(true);
  });

  it('drops invalid added skills without failing', async () => {
    const output = base();
    output.added_skills = [{ name: 'API', related_fact_ids: [], reason: 'Generic' }];
    const client = { generateValidatedJson: vi.fn().mockResolvedValue({ value: output }) };
    const result = await writeCvDetailed({ analysis, selection, vault, client: client as never });
    expect(result.result.added_skills).toEqual([]);
    expect(result.sanitizations.some((item) => item.message.includes('dropped invalid added skill'))).toBe(true);
  });

  it('still fails on an invented number', async () => {
    const output = base();
    output.projects[0].bullets[0].text = 'Built a TypeScript API for 99 users';
    const client = { generateValidatedJson: vi.fn().mockResolvedValue({ value: output }) };
    await expect(writeCv({ analysis, selection, vault, client: client as never })).rejects.toThrow(/Invented number/);
  });

  it('sends only violating paths and cited facts during repair', async () => {
    const invalid = base();
    invalid.projects[0].bullets[0].source_fact_ids = ['wrong'];
    const valid = base();
    const client = { generateValidatedJson: vi.fn()
      .mockResolvedValueOnce({ value: invalid })
      .mockResolvedValueOnce({ value: valid }) };
    await writeCv({ analysis, selection, vault, client: client as never });
    const repairRequest = client.generateValidatedJson.mock.calls[1][0] as { contents: string };
    expect(repairRequest.contents).toContain('projects.0.bullets.0.source_fact_ids');
    expect(repairRequest.contents).toContain(vault.projects[0].facts[0].id);
    expect(repairRequest.contents).not.toContain('"experience"');
  });

  it('repairs hard validation failures once', async () => {
    const invalid = base();
    invalid.projects[0].stack_order = ['Rust'];
    const valid = base();
    const client = { generateValidatedJson: vi.fn().mockResolvedValueOnce({ value: invalid }).mockResolvedValueOnce({ value: valid }) };
    await expect(writeCv({ analysis, selection, vault, client: client as never })).resolves.toEqual(valid);
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(2);
  });
});
