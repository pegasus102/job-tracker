import { z } from 'zod';
import { ThinkingLevel } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zodToVertexSchema } from './client';
import type { Requirement } from './analyze';
import type { CvClient } from './types';
import type { VaultEntry } from './vault';

const MAX_JOB_REQUIREMENT_TEXT = 500;

export const projectScoreRowSchema = z.object({
  project_id: z.string().min(1),
  requirement_id: z.string().min(1),
  score: z.number().int().min(0).max(3),
  evidence_fact_ids: z.array(z.string()),
  reason: z.string().optional(),
});

export const projectDomainRelevanceSchema = z.object({
  project_id: z.string().min(1),
  domain_relevance: z.number().int().min(0).max(3),
});

export const projectScoringSchema = z.object({
  matrix: z.array(projectScoreRowSchema),
  domain_relevance: z.array(projectDomainRelevanceSchema),
});

export const projectScoringResponseSchema = zodToVertexSchema(projectScoringSchema);

export type ProjectScoreRow = z.infer<typeof projectScoreRowSchema>;
export type ProjectDomainRelevance = z.infer<typeof projectDomainRelevanceSchema>;
export type ProjectScoringResult = {
  matrix: ProjectScoreRow[];
  domain_relevance: ProjectDomainRelevance[];
};

export type ScoringRequirement = {
  id: Requirement['id'];
  text: Requirement['text'];
  weight: number;
};

export type ScoreProjectsInput = {
  projects: VaultEntry[];
  requirements: ScoringRequirement[];
  client: CvClient;
  runs?: SupabaseClient;
  jobId?: string;
  timeoutMs?: number;
};

function projectData(projects: VaultEntry[]): string {
  return JSON.stringify(projects.map((project) => ({
    id: project.id,
    title: project.title,
    tech_stack: project.tools,
    facts: project.facts.map((fact) => ({ id: fact.id, text: fact.text })),
  })));
}

function requirementData(requirements: ScoringRequirement[]): string {
  return JSON.stringify(requirements.map((requirement) => ({
    id: requirement.id,
    text: requirement.text.slice(0, MAX_JOB_REQUIREMENT_TEXT),
    weight: requirement.weight,
  })));
}

function pairKey(row: ProjectScoreRow): string {
  return `${row.project_id}\u0000${row.requirement_id}`;
}

function validateMatrix(
  result: ProjectScoringResult,
  projects: VaultEntry[],
  requirements: ScoringRequirement[],
): void {
  const projectIds = new Set(projects.map((project) => project.id));
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const factIdsByProject = new Map(projects.map((project) => [
    project.id,
    new Set(project.facts.map((fact) => fact.id)),
  ]));
  const expected = projects.length * requirements.length;
  if (result.matrix.length !== expected) {
    throw new Error(`Project scoring must contain exactly ${expected} project-requirement pairs`);
  }
  const seen = new Set<string>();
  for (const row of result.matrix) {
    if (!projectIds.has(row.project_id)) throw new Error(`Unknown project ID: ${row.project_id}`);
    if (!requirementIds.has(row.requirement_id)) throw new Error(`Unknown requirement ID: ${row.requirement_id}`);
    const key = pairKey(row);
    if (seen.has(key)) throw new Error(`Duplicate project-requirement pair: ${row.project_id}/${row.requirement_id}`);
    seen.add(key);
    const factIds = factIdsByProject.get(row.project_id);
    if (!factIds || row.evidence_fact_ids.some((factId) => !factIds.has(factId))) {
      throw new Error(`Evidence fact ID does not belong to project ${row.project_id}`);
    }
    if (row.score >= 2 && row.evidence_fact_ids.length === 0) {
      throw new Error(`Score ${row.score} requires evidence for ${row.project_id}/${row.requirement_id}`);
    }
  }

  if (seen.size !== expected) throw new Error('Project scoring omitted a project-requirement pair');
  const domainIds = new Set<string>();
  for (const item of result.domain_relevance) {
    if (!projectIds.has(item.project_id)) throw new Error(`Unknown domain relevance project ID: ${item.project_id}`);
    if (domainIds.has(item.project_id)) throw new Error(`Duplicate domain relevance project: ${item.project_id}`);
    domainIds.add(item.project_id);
  }
  if (domainIds.size !== projects.length) throw new Error('Project scoring must include domain relevance for every project');
}

function normalizeReason(reason: string | undefined): string {
  const words = (reason ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return words.length > 15 ? `${words.slice(0, 15).join(' ')}...` : words.join(' ');
}

function normalizeResult(result: ProjectScoringResult): ProjectScoringResult {
  return {
    ...result,
    matrix: result.matrix.map((row) => ({ ...row, reason: normalizeReason(row.reason) })),
  };
}

function request(input: ScoreProjectsInput, contents: string, stage: string) {
  return {
    model: 'gemini-3.1-pro-preview' as const,
    contents,
    systemInstruction: 'Judge projects only from the supplied project facts and verified tech_stack. Do not invent evidence and do not use research notes.',
    responseJsonSchema: projectScoringResponseSchema,
    thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    timeoutMs: input.timeoutMs,
    stage,
  };
}

async function persistMatrix(input: ScoreProjectsInput, matrix: ProjectScoreRow[]): Promise<void> {
  if (!input.runs) return;
  try {
    const { error } = await input.runs.from('cv_runs').insert({
      job_id: input.jobId,
      stage: 'project_matrix',
      output_json: { matrix },
    });
    if (error) console.warn('CV run metadata', { stage: 'project_matrix', error: error.message });
  } catch (error) {
    console.warn('CV run metadata', {
      stage: 'project_matrix',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function scoreProjects(input: ScoreProjectsInput): Promise<ProjectScoringResult> {
  const contents = [
    'Return one matrix row for every project and technical requirement pair.',
    'Use this strict rubric: 0 = no evidence. 1 = the tool/topic appears only in tech_stack, is tangential, or is adjacent evidence. 2 = a fact explicitly states the specific tool/technique was used, but gives no specifics. 3 = a fact directly demonstrates THE SPECIFIC requirement with what was built, how, and ideally a result; adjacent activity never scores 3. A brief tool mention never scores 3.',
    'Examples: 0 = a project lists PostgreSQL but has no database fact. 1 = a UI consumes a REST API when the requirement is building APIs. 2 = a fact says "built a REST API" without details. 3 = a fact says "built a REST API with pagination and p95 latency of 180 ms". A load test alone is 1 for automated testing.',
    'For every score 1-3, provide a reason of at most 15 words. Use an empty reason only for score 0. Also provide domain_relevance 0-3 for every project.',
    'Only cite fact IDs belonging to the project in that row. A score of 2 or 3 must cite at least one fact ID.',
    `<projects>${projectData(input.projects)}</projects>`,
    `<technical_requirements>${requirementData(input.requirements)}</technical_requirements>`,
  ].join('\n');
  const first = await input.client.generateValidatedJson(
    request(input, contents, 'project_scoring'),
    projectScoringSchema,
  );
  let result = normalizeResult(first.value);
  try {
    validateMatrix(result, input.projects, input.requirements);
  } catch (error) {
    const validationError = error instanceof Error ? error.message : String(error);
    const retry = await input.client.generateValidatedJson(
      request(input, `${contents}\nValidation error from the previous response: ${validationError}\nReturn a complete corrected matrix only.`, 'project_scoring_retry'),
      projectScoringSchema,
    );
    result = normalizeResult(retry.value);
    validateMatrix(result, input.projects, input.requirements);
  }
  await persistMatrix(input, result.matrix);
  return result;
}

export { validateMatrix };
