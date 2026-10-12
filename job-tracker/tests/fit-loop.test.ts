import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT } from '../lib/cv-v2/docx-builder';
import { estimateFit } from '../lib/cv-v2/fit-estimator';
import { FIT_FAILED, fitCv } from '../lib/cv-v2/fit-loop';

const metrics = { widthOfTextAtSize: (text: string) => text.length * 100, lineHeightAtSize: () => 300 };
const profile = { fixed_details: { full_name: 'Test' } };
const cv = { projects: [] };

describe('fit loop', () => {
  it('estimates wrapped lines without fake font metrics', () => {
    const fit = estimateFit('one two three', metrics, DEFAULT_LAYOUT);
    expect(fit.lines).toBe(1);
    expect(fit.overflow).toBe(false);
  });
  it('uses ordered steps and terminates with FIT_FAILED', async () => {
    const seen: string[] = [];
    await expect(fitCv(profile, cv, { metrics, maxIterations: 12, render: async (_p, _c, layout) => { seen.push(String(layout.margins.top)); return Buffer.from('x'); } })).resolves.toMatchObject({ iterations: 1 });
    await expect(fitCv(profile, cv, { metrics: { widthOfTextAtSize: () => 100000, lineHeightAtSize: () => 100000 }, maxIterations: 12 })).rejects.toThrow(FIT_FAILED);
  });
});
