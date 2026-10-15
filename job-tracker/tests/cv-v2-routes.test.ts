import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/cv-v2/analyze', () => ({
  analyzeJobDescription: vi.fn(async ({ jobDescription }: { jobDescription: string }) => ({ role: jobDescription })),
}));
vi.mock('../lib/cv-v2/client', () => ({ createCvClient: vi.fn(() => ({ generate: vi.fn(), generateValidatedJson: vi.fn() })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('../lib/cv-v2/fit-loop', () => ({ fitCv: vi.fn(async () => ({ buffer: Buffer.from('mock-fitted-docx'), cv: {} })) }));
vi.mock('../lib/cv-v2/docx-builder', () => ({
  buildCvDocx: vi.fn(async () => Buffer.from('mock-legacy-docx')),
  DEFAULT_LAYOUT: {},
}));
vi.mock('../lib/cv-v2/fit-estimator', () => ({
  estimate: vi.fn(() => ({ overflow: true })),
  loadCarlitoMetrics: vi.fn(() => ({})),
}));

const analyze = await import('../app/api/cv-v2/analyze/route');
const exportDocx = await import('../app/api/export-docx/route');

function storage() {
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const gte = vi.fn(() => ({ count: 0, error: null }));
  const select = vi.fn((_columns?: string, options?: { count?: string }) =>
    options?.count ? { gte } : { eq },
  );
  const insert = vi.fn(async () => ({ error: null }));
  return { from: vi.fn(() => ({ select, insert })) };
}

describe('CV v2 routes', () => {
  beforeEach(() => {
    process.env.ENABLE_CV_V2 = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = 'test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('is gated when the feature flag is off', async () => {
    process.env.ENABLE_CV_V2 = 'false';
    const response = await analyze.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
  });

  it('prefers jdText and returns a typed validation error', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValue(storage() as never);
    const response = await analyze.POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ jdText: `Responsibilities\n${'pasted JD '.repeat(60)}`, jobDescription: 'scraped JD' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { role: expect.stringContaining('pasted JD') } });

    const invalid = await analyze.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('export-docx follows legacy buildCvDocx path when ENABLE_CV_V2 is off', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { buildCvDocx } = await import('../lib/cv-v2/docx-builder');
    const { fitCv } = await import('../lib/cv-v2/fit-loop');
    const mockStorage = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'job-1', company_name: 'Test Co', tailored_cv_json: { projects: [] } }, error: null })),
          })),
          limit: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'profile-1', fixed_details: { full_name: 'Test User' } }, error: null })),
          })),
        })),
      })),
    };
    vi.mocked(createClient).mockReturnValue(mockStorage as never);
    process.env.ENABLE_CV_V2 = 'false';

    const response = await exportDocx.POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ job_id: 'job-1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(buildCvDocx).toHaveBeenCalled();
    expect(fitCv).not.toHaveBeenCalled();
  });

  it('export-docx invokes fit loop when ENABLE_CV_V2 is true and overflow detected', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { fitCv } = await import('../lib/cv-v2/fit-loop');
    const mockStorage = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'job-1', company_name: 'Test Co', tailored_cv_json: { projects: [] } }, error: null })),
          })),
          limit: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'profile-1', fixed_details: { full_name: 'Test User' } }, error: null })),
          })),
        })),
      })),
    };
    vi.mocked(createClient).mockReturnValue(mockStorage as never);
    process.env.ENABLE_CV_V2 = 'true';

    const response = await exportDocx.POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ job_id: 'job-1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(fitCv).toHaveBeenCalled();
  });
});
