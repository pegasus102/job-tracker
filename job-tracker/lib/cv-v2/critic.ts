import { z } from 'zod';
import { ThinkingLevel } from '@google/genai';
import { zodToVertexSchema } from './client';
import type { CvClient } from './types';
import type { JdAnalysis } from './analyze';
import type { CandidateVault } from './vault';
import { writingSchema, type WritingResult } from './write-cv';
import { validateWriting, validateCandidateBulletFix, skillVocabulary } from './validate-writing';
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

export type ReviewResult = { cv: WritingResult; critic: CriticResult; revisionKept: boolean; deterministicFixesApplied?: number };

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
  let result: WritingResult = JSON.parse(JSON.stringify(input.cv)) as WritingResult;
  let revisionKept = false;
  let deterministicFixesApplied = 0;
  const vocabulary = new Set([
    ...skillVocabulary(input),
    ...input.analysis.requirements.flatMap((requirement) => [requirement.text]),
    ...input.analysis.keywords,
  ].map((term) => term.toLocaleLowerCase()));

  // Deterministically apply critic fixes for lost_specificity of medium/low severity if suggested_fix passes bullet validation.
  // High-severity issues require full LLM revision (below).
  for (const issue of critic.issues) {
    if (issue.severity !== 'high' && issue.type === 'lost_specificity' && issue.suggested_fix && issue.suggested_fix.trim().length > 0) {
      const match = issue.path.match(/^(projects|experience)\.(\d+)\.bullets\.(\d+)/);
      if (match) {
        const section = match[1] as 'projects' | 'experience';
        const entryIdx = Number(match[2]);
        const bulletIdx = Number(match[3]);
        const originalBullet = result[section]?.[entryIdx]?.bullets?.[bulletIdx];
        if (originalBullet) {
          const entryId = section === 'projects'
            ? (result.projects[entryIdx] as WritingResult['projects'][number])?.project_id
            : (result.experience[entryIdx] as WritingResult['experience'][number])?.experience_id;
          const entry = section === 'projects'
            ? input.vault.projects.find((p) => p.id === entryId)
            : input.vault.experience.find((e) => e.id === entryId);

          if (entry) {
            const candidateBullet = { ...originalBullet, text: issue.suggested_fix };
            if (validateCandidateBulletFix(candidateBullet, entry, input.analysis, vocabulary)) {
              result[section][entryIdx].bullets[bulletIdx].text = issue.suggested_fix;
              revisionKept = true;
              deterministicFixesApplied += 1;
            }
          }
        }
      }
    }
  }

  const highCount = critic.issues.filter((issue) => issue.severity === 'high').length;
  if (highCount > 0) {
    revisionKept = false;
    const revision = (await input.client.generateValidatedJson({
      ...request,
      stage: 'critic_revision',
      contents: [
        'Revise only the affected bullets. Do not change unrelated CV content.',
        '<affected_cv>', affectedContent(result, critic.issues.filter((issue) => issue.severity === 'high')), '</affected_cv>',
        '<issues>', JSON.stringify(critic.issues.filter((issue) => issue.severity === 'high')), '</issues>',
        '<cited_facts>', citedFacts(result, input.vault), '</cited_facts>',
        '<technical_requirements>', JSON.stringify(input.analysis.requirements.filter((item) => item.technical)), '</technical_requirements>',
      ].join('\n'),
    }, writingSchema)).value;
    const validation = validateWriting(revision, { analysis: input.analysis, selection: input.selection, vault: input.vault });
    const revisionHighCount = validation.violations.filter((issue) => issue.hard).length;
    if (revisionHighCount === 0 && revisionHighCount <= highCount) {
      result = revision;
      revisionKept = true;
    } else {
      result = input.cv;
    }
  }
  if (!revisionKept) {
    result = input.cv;
  }
  if (input.runs) {
    try {
      await input.runs.from('cv_runs').insert({ job_id: input.jobId, stage: 'critic', output_json: critic });
    } catch (error) {
      console.warn('CV run metadata', { stage: 'critic', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cv: result, critic, revisionKept, deterministicFixesApplied };
}
