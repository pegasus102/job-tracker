import { scoreProjects } from '../../../../lib/cv-v2/score-projects';
import { route, boundedArray, PROJECT_MAX, REQUIREMENT_MAX, getCvClient, inputHash, cachedRun, saveRun } from '../_lib';
import type { VaultEntry } from '../../../../lib/cv-v2/vault';

export const maxDuration = 90;

export async function POST(request: Request) {
  return route(request, async (body) => {
    const projects = boundedArray<VaultEntry>(body.projects, 'projects', PROJECT_MAX);
    const requirements = boundedArray<{ id: string; text: string; weight: number }>(body.requirements, 'requirements', REQUIREMENT_MAX);
    const stage = 'project_matrix';
    const hash = inputHash(stage, body);
    const cached = await cachedRun(stage, hash);
    if (cached) return cached;
    const result = await scoreProjects({ projects, requirements, client: getCvClient(), runs: undefined });
    await saveRun(stage, hash, result, typeof body.jobId === 'string' ? body.jobId : undefined);
    return result;
  });
}
