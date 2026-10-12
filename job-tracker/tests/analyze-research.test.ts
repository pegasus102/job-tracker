import { describe, expect, it, vi } from 'vitest';
import { analyzeJobDescription } from '../lib/cv-v2/analyze';
import { researchJob } from '../lib/cv-v2/research';

function mockClient(responses: Array<{ text: string; groundingMetadata?: { sourceUrls: string[]; metadata?: unknown } }>) {
  let index = 0;
  return {
    generate: vi.fn(async () => responses[index++]),
    generateValidatedJson: vi.fn(async (request: { thinkingConfig?: unknown }) => {
      void request;
      return {
        value: JSON.parse(responses[index++].text),
        response: responses[index - 1],
      };
    }),
  };
}

const analysis = {
  role: 'Software Engineer',
  seniority: 'Mid-level',
  requirements: [
    { id: 'r1', text: 'TypeScript', type: 'must' as const, weight: 3 as const, technical: true },
    { id: 'r2', text: 'Teamwork', type: 'nice' as const, weight: 1 as const, technical: false },
  ],
  keywords: ['TypeScript', 'API'],
};

describe('Phase 3 analysis and research', () => {
  it('uses Flash low thinking configuration for JD analysis', async () => {
    const client = {
      generateValidatedJson: vi.fn(async (request: { thinkingConfig?: unknown }) => {
        expect(request.thinkingConfig).toMatchObject({ thinkingLevel: expect.any(String) });
        return { value: analysis, response: { text: JSON.stringify(analysis) } };
      }),
    };
    await expect(analyzeJobDescription({ jobDescription: 'TypeScript engineer', client: client as never })).resolves.toEqual(analysis);
  });

  it('performs grounded then structured research and preserves grounding URLs', async () => {
    const structured = {
      sources: [{ title: 'Roles', domain: 'company.example', url: 'https://company.example/roles' }],
      stack_signals: ['TypeScript'],
      emphasis: ['API design'],
      company_evidence_found: true,
      confidence: 'high' as const,
      weight_adjustments: [{ requirement_id: 'r1', adjustment: 1 as const }],
    };
    const client = mockClient([
      {
        text: 'Public research notes',
        groundingMetadata: {
          sourceUrls: ['https://search.example/result'],
          metadata: { groundingChunks: [{ web: { title: 'Search result', uri: 'https://search.example/result' } }] },
        },
      },
      { text: JSON.stringify(structured) },
    ]);
    const result = await researchJob({
      company: 'Example Co',
      role: 'Software Engineer',
      jobDescription: 'TypeScript engineer',
      analysis,
      client: client as never,
    });

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(client.generateValidatedJson).toHaveBeenCalledTimes(1);
    expect(result.sourceUrls).toEqual(['https://search.example/result', 'https://company.example/roles']);
    expect(result.structured.sources).toEqual([
      { title: 'Search result', domain: 'search.example', url: 'https://search.example/result' },
      { title: 'Roles', domain: 'company.example', url: 'https://company.example/roles' },
    ]);
    expect(result.structured.weight_adjustments).toEqual([{ requirement_id: 'r1', adjustment: 1 }]);
  });

  it('drops adjustments for requirements that analysis did not produce', async () => {
    const client = mockClient([
      { text: 'notes' },
      {
        text: JSON.stringify({
          sources: [],
          stack_signals: [],
          emphasis: [],
          company_evidence_found: true,
          confidence: 'high',
          weight_adjustments: [{ requirement_id: 'not-real', adjustment: 1 }],
        }),
      },
    ]);
    const result = await researchJob({
      company: 'Example Co',
      role: 'Software Engineer',
      jobDescription: 'TypeScript engineer',
      analysis,
      client: client as never,
    });
    expect(result.structured.weight_adjustments).toEqual([]);
  });

  it('continues when the research cache is unavailable', async () => {
    const client = mockClient([
      { text: 'notes' },
      { text: JSON.stringify({ sources: [], stack_signals: [], emphasis: [], company_evidence_found: false, confidence: 'low', weight_adjustments: [] }) },
    ]);
    const cache = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              gt: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'unreachable' } })),
              })),
            })),
          })),
        })),
      })),
    };
    await expect(researchJob({
      company: 'Example Co',
      role: 'Software Engineer',
      jobDescription: 'TypeScript engineer',
      analysis,
      client: client as never,
      cache: cache as never,
    })).resolves.toMatchObject({ fromCache: false });
  });

  it('discards all adjustments without company evidence or with low confidence', async () => {
    for (const evidence of [
      { company_evidence_found: false, confidence: 'high' as const },
      { company_evidence_found: true, confidence: 'low' as const },
    ]) {
      const client = mockClient([
        { text: 'generic notes' },
        {
          text: JSON.stringify({
            sources: [{ title: 'Search', domain: 'example.com', url: 'https://example.com' }],
            stack_signals: [],
            emphasis: [],
            ...evidence,
            weight_adjustments: [{ requirement_id: 'r1', adjustment: 1 }],
          }),
        },
      ]);
      const result = await researchJob({
        company: 'Example Co',
        role: 'Software Engineer',
        jobDescription: 'TypeScript engineer',
        analysis,
        client: client as never,
      });
      expect(result.structured.weight_adjustments).toEqual([]);
    }
  });

  it('sets low thinking for structured research', async () => {
    const client = mockClient([
      { text: 'notes' },
      { text: JSON.stringify({ sources: [], stack_signals: [], emphasis: [], company_evidence_found: false, confidence: 'low', weight_adjustments: [] }) },
    ]);
    await researchJob({
      company: 'Example Co',
      role: 'Software Engineer',
      jobDescription: 'TypeScript engineer',
      analysis,
      client: client as never,
    });
    expect(client.generateValidatedJson.mock.calls[0][0].thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });
});
