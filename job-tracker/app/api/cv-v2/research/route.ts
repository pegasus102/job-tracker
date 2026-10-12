import { researchJob } from '../../../../lib/cv-v2/research';
import { route, requiredText, optionalText, JD_MAX, getCvClient, getCvSupabase, inputHash, cachedRun, saveRun, CvRouteError } from '../_lib';

export const maxDuration = 240;

export async function POST(request: Request) {
  return route(request, async (body) => {
    if (body.skip === true || body.enabled === false) return { skipped: true };
    const analysis = body.analysis;
    if (!analysis || typeof analysis !== 'object') throw new CvRouteError('INVALID_INPUT', 'analysis is required');
    const jdText = optionalText(body, 'jdText', JD_MAX) ?? requiredText(body, 'jobDescription', JD_MAX);
    const company = requiredText(body, 'company', 200);
    const role = requiredText(body, 'role', 200);
    const stage = 'research';
    const hash = inputHash(stage, { ...body, jdText });
    const cached = await cachedRun(stage, hash);
    if (cached) return cached;
    const timeoutMs = Math.min(
      Math.max(1_000, Number.parseInt(process.env.CV_V2_RESEARCH_TIMEOUT_MS ?? '180000', 10)),
      maxDuration * 1000 - 30_000,
    );
    const result = await researchJob({ company, role, jobDescription: jdText, analysis: analysis as never, client: getCvClient(), cache: getCvSupabase(), timeoutMs });
    await saveRun(stage, hash, result, typeof body.jobId === 'string' ? body.jobId : undefined);
    return result;
  });
}
