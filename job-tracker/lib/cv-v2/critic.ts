import { z } from 'zod';
import { ThinkingLevel } from '@google/genai';
import { zodToVertexSchema } from './client';
import type { CvClient } from './types';
import type { JdAnalysis } from './analyze';
import type { CandidateVault } from './vault';
import { writingSchema, type WritingResult } from './write-cv';
import { validateWriting } from './validate-writing';
import type { ProjectSelection } from './select-projects';
import type { SupabaseClient } from '@supabase/supabase-js';

const issueSchema = z.object({
  path: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  type: z.enum(['unsupported_claim', 'causal_link', 'dropped_qualifier', 'lost_specificity', 'generic_phrase', 'redundant', 'uncovered_must_have', 'better_project_available', 'weak_added_skill']),
  message: z.string(),
  suggested_fix: z.string(),
});
export const criticSchema = z.object({ issues: z.array(issueSchema), pass: z.boolean() });
export const criticResponseSchema = zodToVertexSchema(criticSchema);
export type CriticResult = z.infer<typeof criticSchema>;

function citedFacts(cv: WritingResult, vault: CandidateVault): string {
  const ids = new Set(cv.projects.flatMap((project) => project.bullets.flatMap((bullet) => bullet.source_fact_ids))
    .concat(cv.experience.flatMap((entry) => entry.bullets.flatMap((bullet) => bullet.source_fact_ids))));
  return JSON.stringify(vault.projects.concat(vault.experience).flatMap((entry) => entry.facts.filter((fact) => ids.has(fact.id))));
}

function criticPrompt(cv: WritingResult, analysis: JdAnalysis, vault: CandidateVault): string {
  return [
    'Review this CV only against the supplied cited facts and technical requirements. Do not invent problems.',
    '<cv_json>', JSON.stringify(cv), '</cv_json>',
    '<cited_facts>', citedFacts(cv, vault), '</cited_facts>',
    '<technical_requirements>', JSON.stringify(analysis.requirements.filter((item) => item.technical)), '</technical_requirements>',
    'Check explicitly for unsupported_claim, causal_link, dropped_qualifier, lost_specificity, generic_phrase, redundant, uncovered_must_have, better_project_available, and weak_added_skill. A weak_added_skill is an added skill that is not a specific technical JD requirement, lacks an adjacent supporting fact, or merely renames a verified skill.',
    'Return only real issues supported by the supplied data. Set pass false only when an issue exists.',
  ].join('\n');
}

function affectedContent(cv: WritingResult, issues: CriticResult['issues']): string {
  const paths = issues.map((issue) => issue.path);
  return JSON.stringify({
    paths,
    projects: cv.projects.filter((_, index) => paths.some((path) => path.startsWith(`projects.${index}`))),
    experience: cv.experience.filter((_, index) => paths.some((path) => path.startsWith(`experience.${index}`))),
  });
}

export type ReviewResult = { cv: WritingResult; critic: CriticResult; revisionKept: boolean };

export async function reviewAndRevise(input: {
  cv: WritingResult;
  analysis: JdAnalysis;
  selection: ProjectSelection;
  vault: CandidateVault;
  client: CvClient;
  runs?: SupabaseClient;
  jobId?: string;
}): Promise<ReviewResult> {
  const request = {
    model: 'gemini-3.1-pro-preview',
    contents: criticPrompt(input.cv, input.analysis, input.vault),
    systemInstruction: 'You are a precise CV critic. Do not invent problems.',
    responseJsonSchema: criticResponseSchema,
    thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    timeoutMs: 150_000,
    stage: 'critic',
  };
  const critic = (await input.client.generateValidatedJson(request, criticSchema)).value;
  let result = input.cv;
  let revisionKept = false;
  const highCount = critic.issues.filter((issue) => issue.severity === 'high').length;
  if (highCount > 0) {
    const revision = (await input.client.generateValidatedJson({
      ...request,
      stage: 'critic_revision',
      contents: [
        'Revise only the affected bullets. Do not change unrelated CV content.',
        '<affected_cv>', affectedContent(input.cv, critic.issues.filter((issue) => issue.severity === 'high')), '</affected_cv>',
        '<issues>', JSON.stringify(critic.issues.filter((issue) => issue.severity === 'high')), '</issues>',
        '<cited_facts>', citedFacts(input.cv, input.vault), '</cited_facts>',
        '<technical_requirements>', JSON.stringify(input.analysis.requirements.filter((item) => item.technical)), '</technical_requirements>',
      ].join('\n'),
    }, writingSchema)).value;
    const validation = validateWriting(revision, { analysis: input.analysis, selection: input.selection, vault: input.vault });
    const revisionHighCount = validation.violations.filter((issue) => issue.hard).length;
    if (revisionHighCount === 0 && revisionHighCount <= highCount) {
      result = revision;
      revisionKept = true;
    }
  }
  if (input.runs) {
    try {
      await input.runs.from('cv_runs').insert({ job_id: input.jobId, stage: 'critic', output_json: critic });
    } catch (error) {
      console.warn('CV run metadata', { stage: 'critic', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cv: result, critic, revisionKept };
}
