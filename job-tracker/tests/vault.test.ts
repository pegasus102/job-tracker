import { describe, expect, it } from 'vitest';
import { buildCandidateVault } from '../lib/cv-v2/vault';

describe('buildCandidateVault', () => {
  it('adapts the exact stored profile shape without exposing fixed sections', () => {
    const vault = buildCandidateVault({
      fixed_details: { full_name: 'Ada Example', education: [{ degree: 'B.Tech' }] },
      master_projects: [
        {
          id: 'p-1',
          title: 'Metrics API',
          tech_stack: 'TypeScript, PostgreSQL',
          bullets: ['Built an API processing 12k requests with TypeScript'],
        },
      ],
      master_experience: [
        {
          id: 'e-1',
          role: 'Engineer',
          company: 'Example Co',
          duration: '2024',
          bullets: ['Automated reports with Python and reduced time by 25%'],
        },
      ],
      master_skills: [{ category: 'Languages', items: 'TypeScript, Python' }],
      master_certifications: [{ name: 'Ignored' }],
      master_extracurriculars: [{ title: 'Ignored' }],
    });

    expect(vault.projects).toHaveLength(1);
    expect(vault.projects[0]).toMatchObject({
      id: 'p-1',
      title: 'Metrics API',
      tools: ['TypeScript', 'PostgreSQL'],
      facts: [
        {
          id: 'p-1.f5835a6c',
          text: 'Built an API processing 12k requests with TypeScript',
          tools: ['TypeScript'],
          numbers: ['12k'],
          warnings: [],
        },
      ],
    });

    expect(vault.experience).toHaveLength(1);
    expect(vault.experience[0]).toMatchObject({
      id: 'e-1',
      role: 'Engineer',
      company: 'Example Co',
      duration: '2024',
      tools: [],
      facts: [
        {
          id: 'e-1.f1f8af4f',
          text: 'Automated reports with Python and reduced time by 25%',
          tools: [],
          numbers: ['25%'],
          warnings: ['May contain more than one claim'],
        },
      ],
    });
    expect(vault.skills).toEqual([{ category: 'Languages', items: 'TypeScript, Python' }]);
  });

  it('creates stable IDs and warnings for unsupported or compound facts', () => {
    const input = {
      master_projects: [
        {
          id: 'p-2',
          title: 'Tooling',
          tech_stack: 'React',
          bullets: ['Improved quality and then shipped a dashboard'],
        },
      ],
    };
    const first = buildCandidateVault(input);
    const second = buildCandidateVault(input);
    expect(first.projects[0].facts[0].id).toBe(second.projects[0].facts[0].id);
    expect(first.projects[0].facts[0].warnings).toContain('May contain more than one claim');
  });
});
