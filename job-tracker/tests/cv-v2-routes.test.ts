import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/cv-v2/analyze', () => ({
  analyzeJobDescription: vi.fn(async ({ jobDescription }: { jobDescription: string }) => ({ role: jobDescription })),
}));
vi.mock('../lib/cv-v2/client', () => ({ createCvClient: vi.fn(() => ({ generate: vi.fn(), generateValidatedJson: vi.fn() })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const analyze = await import('../app/api/cv-v2/analyze/route');

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
});
