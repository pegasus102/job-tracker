import { buildCvDocx } from '../../../../lib/cv-v2/docx-builder';
import { estimate, loadCarlitoMetrics } from '../../../../lib/cv-v2/fit-estimator';
import { fitCv } from '../../../../lib/cv-v2/fit-loop';
import { ensureEnabled, responseError, jsonBody, CvRouteError } from '../_lib';

export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    ensureEnabled();
    const body = await jsonBody(request);
    if (!body.profile || !body.cv) throw new CvRouteError('INVALID_INPUT', 'profile and cv are required');
    const profile = body.profile as Record<string, unknown>;
    const cv = body.cv as Record<string, unknown>;
    const metrics = loadCarlitoMetrics();
    const initial = estimate(cv, undefined, metrics);
    const buffer = initial.overflow
      ? (await fitCv(profile, cv, { metrics })).buffer
      : await buildCvDocx(profile, cv);
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="cv.docx"' },
    });
  } catch (error) {
    return responseError(error);
  }
}
