import { analyzeJobDescription } from '../../../../lib/cv-v2/analyze';
import { prepareJobInput, requireUsableJobInput } from '../../../../lib/cv-v2/jd-input';
import { route, requiredText, optionalText, JD_MAX, getCvClient, inputHash, cachedRun, saveRun } from '../_lib';

export const maxDuration = 90;

export async function POST(request: Request) {
  return route(request, async (body) => {
    const rawJd = optionalText(body, 'jdText', JD_MAX) ?? requiredText(body, 'jobDescription', JD_MAX);
    const prepared = requireUsableJobInput(prepareJobInput({
      company_name: typeof body.company === 'string' ? body.company : '',
      role_offered: typeof body.role === 'string' ? body.role : '',
      job_description_raw: rawJd,
    }));
    const jdText = prepared.jdText;
    const stage = 'jd_analysis';
    const hash = inputHash(stage, { ...body, jdText });
    const cached = await cachedRun(stage, hash);
    if (cached) return cached;
    const result = await analyzeJobDescription({ jobDescription: jdText, client: getCvClient() });
    await saveRun(stage, hash, result, typeof body.jobId === 'string' ? body.jobId : undefined);
    return result;
  });
}
