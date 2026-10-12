import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectScoringResponseSchema, scoreProjects } from '../lib/cv-v2/score-projects';
import { selectProjects } from '../lib/cv-v2/select-projects';
import type { VaultEntry } from '../lib/cv-v2/vault';

const projects: VaultEntry[] = ['a', 'b', 'c', 'zero'].map((id) => ({
  id,
  title: `Project ${id}`,
  tools: id === 'c' ? ['Go', 'PostgreSQL'] : ['React', 'TypeScript'],
  facts: [{ id: `${id}.fact`, text: `${id} evidence`, tools: [], numbers: [], warnings: [] }],
}));
const requirements = [
  { id: 'r1', text: 'Embedded systems', weight: 3 as const },
  { id: 'r2', text: 'Web development', weight: 3 as const },
  { id: 'r3', text: 'Data science', weight: 1 as const },
];

function matrix(rows: Array<[string, string, number, string[]]>) {
  return rows.map(([project_id, requirement_id, score, evidence_fact_ids]) => ({
    project_id, requirement_id, score, evidence_fact_ids, reason: score > 0 ? 'Relevant evidence' : '',
  }));
}

const domains = projects.map((project, index) => ({ project_id: project.id, domain_relevance: index === 3 ? 1 : 3 }));

describe('Phase 4 project scoring and selection', () => {
  it('includes eight invented large-profile projects with specific facts', () => {
    const profile = JSON.parse(readFileSync(new URL('./fixtures/profile-large.json', import.meta.url), 'utf8')) as {
      master_projects: Array<{ bullets: string[] }>;
    };
    expect(profile.master_projects).toHaveLength(8);
    expect(profile.master_projects.every((project) => project.bullets.length >= 3 && project.bullets.length <= 4)).toBe(true);
  });

  it('uses a flat Vertex-safe scoring schema', () => {
    expect(projectScoringResponseSchema.type).toBe('object');
    const rows = projectScoringResponseSchema.properties?.matrix as { type: string; items?: unknown };
    expect(rows.type).toBe('array');
    expect(rows.items).toBeDefined();
  });

  it('retries an invalid fact citation and rejects it if still invalid', async () => {
    const client = {
      generateValidatedJson: vi.fn()
        .mockResolvedValueOnce({ value: { matrix: matrix([['a', 'r1', 2, ['b.fact']]]), domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] } })
        .mockResolvedValueOnce({ value: { matrix: matrix([['a', 'r1', 2, ['a.fact']]]), domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] } }),
    };
    await expect(scoreProjects({ projects: projects.slice(0, 1), requirements: requirements.slice(0, 1), client: client as never }))
      .resolves.toEqual({ matrix: matrix([['a', 'r1', 2, ['a.fact']]]), domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] });
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(2);
  });

  it('accepts long cosmetic reasons and normalizes them to 15 words', async () => {
    const longReason = Array.from({ length: 40 }, (_, index) => `word${index + 1}`).join(' ');
    const client = {
      generateValidatedJson: vi.fn().mockResolvedValue({
        value: {
          matrix: [{ project_id: 'a', requirement_id: 'r1', score: 1, evidence_fact_ids: [], reason: longReason }],
          domain_relevance: [{ project_id: 'a', domain_relevance: 2 }],
        },
      }),
    };
    const result = await scoreProjects({
      projects: projects.slice(0, 1),
      requirements: requirements.slice(0, 1),
      client: client as never,
    });
    expect(result.matrix[0].reason).toBe(`${Array.from({ length: 15 }, (_, index) => `word${index + 1}`).join(' ')}...`);
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(1);
  });

  it('accepts a missing cosmetic reason without retrying', async () => {
    const client = {
      generateValidatedJson: vi.fn().mockResolvedValue({
        value: {
          matrix: [{ project_id: 'a', requirement_id: 'r1', score: 1, evidence_fact_ids: [] }],
          domain_relevance: [{ project_id: 'a', domain_relevance: 2 }],
        },
      }),
    };
    const result = await scoreProjects({
      projects: projects.slice(0, 1),
      requirements: requirements.slice(0, 1),
      client: client as never,
    });
    expect(result.matrix[0].reason).toBe('');
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(1);
  });

  it('sends medium thinking through the SDK thinkingLevel field', async () => {
    const client = {
      generateValidatedJson: vi.fn(async (request: { thinkingConfig?: unknown }) => {
        expect(request.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
        return { value: { matrix: matrix([['a', 'r1', 1, []]]), domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] } };
      }),
    };
    await scoreProjects({ projects: projects.slice(0, 1), requirements: requirements.slice(0, 1), client: client as never });
  });

  it('rejects omitted and duplicate pairs', async () => {
    const invalid = matrix([['a', 'r1', 1, []]]);
    const client = { generateValidatedJson: vi.fn().mockResolvedValue({ value: { matrix: invalid, domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] } }) };
    await expect(scoreProjects({ projects: projects.slice(0, 1), requirements: requirements.slice(0, 2), client: client as never })).rejects.toThrow(/exactly 2/);
    const duplicate = matrix([['a', 'r1', 1, []], ['a', 'r1', 1, []]]);
    client.generateValidatedJson.mockReset().mockResolvedValue({ value: { matrix: duplicate, domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] } });
    await expect(scoreProjects({ projects: projects.slice(0, 1), requirements: requirements.slice(0, 2), client: client as never })).rejects.toThrow(/Duplicate/);
  });

  it('chooses complementary coverage over similar high scorers', () => {
    const selected = selectProjects({
      projects: projects.slice(0, 3),
      requirements,
      matrix: matrix([
        ['a', 'r1', 3, ['a.fact']], ['a', 'r2', 0, []], ['a', 'r3', 0, []],
        ['b', 'r1', 0, []], ['b', 'r2', 3, ['b.fact']], ['b', 'r3', 0, []],
        ['c', 'r1', 2, ['c.fact']], ['c', 'r2', 2, ['c.fact']], ['c', 'r3', 1, ['c.fact']],
      ]),
      domain_relevance: domains,
    });
    expect(selected.chosen.map((item) => item.project.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks equal totals by mean depth, then profile order', () => {
    const selected = selectProjects({
      projects: projects.slice(0, 4),
      requirements: [{ id: 'r1', text: 'Skill', weight: 1 }],
      matrix: matrix([
        ['a', 'r1', 3, ['a.fact']], ['b', 'r1', 2, ['b.fact']],
        ['c', 'r1', 1, ['c.fact']], ['zero', 'r1', 0, []],
      ]),
      domain_relevance: domains,
    });
    expect(selected.chosen.map((item) => item.project.id)).toEqual(['a', 'b', 'c']);
  });

  it('requires three projects and excludes zero-evidence projects when possible', () => {
    expect(() => selectProjects({ projects: projects.slice(0, 2), requirements, matrix: [], domain_relevance: domains })).toThrow(/At least 3/);
    const selected = selectProjects({
      projects,
      requirements: [{ id: 'r1', text: 'Skill', weight: 5 }],
      matrix: matrix([
        ['a', 'r1', 1, ['a.fact']], ['b', 'r1', 1, ['b.fact']], ['c', 'r1', 1, ['c.fact']], ['zero', 'r1', 0, []],
      ]),
      domain_relevance: domains,
    });
    expect(selected.chosen.every((item) => item.project.id !== 'zero')).toBe(true);
  });

  it('treats weights above three as ordinary numbers', () => {
    const selected = selectProjects({
      projects: projects.slice(0, 3),
      requirements: [{ id: 'r1', text: 'Skill', weight: 9 }],
      matrix: matrix([['a', 'r1', 3, ['a.fact']], ['b', 'r1', 0, []], ['c', 'r1', 0, []]]),
      domain_relevance: domains,
    });
    expect(selected.coverage).toBe(1);
  });

  it('reports uncovered requirements and gives an honest zero-evidence explanation', () => {
    const selected = selectProjects({
      projects,
      requirements: [
        { id: 'r1', text: 'Known skill', weight: 1 },
        { id: 'r4', text: 'Missing skill', weight: 4 },
      ],
      matrix: matrix([
        ['a', 'r1', 2, ['a.fact']], ['a', 'r4', 0, []],
        ['b', 'r1', 1, []], ['b', 'r4', 0, []],
        ['c', 'r1', 0, []], ['c', 'r4', 0, []],
        ['zero', 'r1', 0, []], ['zero', 'r4', 0, []],
      ]),
      domain_relevance: domains,
    });
    expect(selected.uncovered_requirements).toEqual([{ id: 'r4', text: 'Missing skill', weight: 4 }]);
    expect(selected.chosen.find((item) => item.project.id === 'c')?.why)
      .toBe('Closest domain match; no direct requirement evidence.');
  });

  it('prefers complementary projects over redundant dashboards and domain-ranked fillers', () => {
    const order = { id: 'order', title: 'Order API', tools: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'], facts: [{ id: 'order.fact', text: 'order', tools: [], numbers: [], warnings: [] }] };
    const ops = { id: 'ops', title: 'Ops Dashboard', tools: ['React', 'TypeScript', 'REST'], facts: [{ id: 'ops.fact', text: 'ops', tools: [], numbers: [], warnings: [] }] };
    const support = { id: 'support', title: 'Support Dashboard', tools: ['React', 'TypeScript', 'REST'], facts: [{ id: 'support.fact', text: 'support', tools: [], numbers: [], warnings: [] }] };
    const edge = { id: 'edge', title: 'Edge Service', tools: ['Go', 'Docker', 'gRPC', 'SQLite'], facts: [{ id: 'edge.fact', text: 'edge', tools: [], numbers: [], warnings: [] }] };
    const row = (project_id: string, requirement_id: string, score: number, fact: string) => ({ project_id, requirement_id, score, evidence_fact_ids: [fact], reason: 'Direct evidence' });
    const selected = selectProjects({
      projects: [order, ops, support, edge],
      requirements: [
        { id: 'ts', text: 'TypeScript', weight: 3 },
        { id: 'react', text: 'React', weight: 3 },
        { id: 'apis', text: 'APIs', weight: 3 },
        { id: 'sql', text: 'SQL', weight: 3 },
        { id: 'testing', text: 'Testing', weight: 3 },
      ],
      matrix: [
        ...['ts', 'react', 'apis', 'sql', 'testing'].map((id, index) => row('order', id, [3, 0, 3, 3, 1][index], 'order.fact')),
        ...['ts', 'react', 'apis', 'sql', 'testing'].map((id, index) => row('ops', id, [3, 3, 1, 0, 0][index], 'ops.fact')),
        ...['ts', 'react', 'apis', 'sql', 'testing'].map((id, index) => row('support', id, [3, 3, 1, 0, 0][index], 'support.fact')),
        ...['ts', 'react', 'apis', 'sql', 'testing'].map((id, index) => row('edge', id, [0, 0, 3, 3, 1][index], 'edge.fact')),
      ],
      domain_relevance: ['order', 'ops', 'support', 'edge'].map((project_id) => ({ project_id, domain_relevance: 3 })),
    });
    const ids = selected.chosen.map((item) => item.project.id);
    expect(ids).toContain('order');
    expect(ids).not.toEqual(expect.arrayContaining(['ops', 'support']));
  });

  it('accepts a scored row without a cosmetic reason', async () => {
    const invalid = matrix([['a', 'r1', 1, ['a.fact']]]).map((row) => ({ ...row, reason: '' }));
    const client = {
      generateValidatedJson: vi.fn().mockResolvedValue({
        value: { matrix: invalid, domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] },
      }),
    };
    await expect(scoreProjects({ projects: projects.slice(0, 1), requirements: requirements.slice(0, 1), client: client as never }))
      .resolves.toEqual({ matrix: invalid, domain_relevance: [{ project_id: 'a', domain_relevance: 3 }] });
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(1);
  });
});
