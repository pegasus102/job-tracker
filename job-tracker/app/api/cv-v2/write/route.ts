import { writeCvDetailed } from '../../../../lib/cv-v2/write-cv';
import { route, boundedArray, getCvClient, inputHash, cachedRun, saveRun, CvRouteError } from '../_lib';

export const maxDuration = 240;

export async function POST(request: Request) {
  return route(request, async (body) => {
    if (!body.analysis || !body.selection || !body.vault) throw new CvRouteError('INVALID_INPUT', 'analysis, selection, and vault are required');
    const styleExamples = boundedArray<{ text: string }>(body.styleExamples ?? [], 'styleExamples', 20);
    const stage = 'cv_writing';
    const hash = inputHash(stage, body);
    const cached = await cachedRun(stage, hash);
    if (cached) return cached;
    const result = await writeCvDetailed({
      analysis: body.analysis as never,
      research: typeof body.research === 'string' ? body.research.slice(0, 20_000) : undefined,
      selection: body.selection as never,
      vault: body.vault as never,
      styleExamples,
      client: getCvClient(),
    });
    await saveRun(stage, hash, result, typeof body.jobId === 'string' ? body.jobId : undefined);
    return result;
  });
}
