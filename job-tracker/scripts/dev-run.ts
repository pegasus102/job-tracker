import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeJobDescription, applyLowTechnicalSignal } from '../lib/cv-v2/analyze';
import { createCvClient } from '../lib/cv-v2/client';
import { researchJob } from '../lib/cv-v2/research';
import { scoreProjects } from '../lib/cv-v2/score-projects';
import { selectProjects } from '../lib/cv-v2/select-projects';
import { buildCandidateVault } from '../lib/cv-v2/vault';
import { writeCvDetailed } from '../lib/cv-v2/write-cv';
import { deriveWritingBudgets, validateWriting, writingBudgetReport } from '../lib/cv-v2/validate-writing';
import { reviewAndRevise } from '../lib/cv-v2/critic';
import { scoreAtsProxy } from '../lib/cv-v2/ats-score';
import { prepareJobInput, requireUsableJobInput } from '../lib/cv-v2/jd-input';
import { fitCv } from '../lib/cv-v2/fit-loop';
import { loadCarlitoMetrics } from '../lib/cv-v2/fit-estimator';
import { reportBulletSimilarity } from '../lib/cv-v2/instrumentation';
import { lintBullets } from '../lib/cv-v2/bullet-quality';
import { mkdir, writeFile } from 'node:fs/promises';

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Optional for fixture-only validation; the client reports missing credentials if called.
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function unwrapProfile(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.master_profile ?? value.profile ?? value.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : value;
}

async function runSelection(
  profile: Record<string, unknown>,
  jobDescription: string,
  role: string,
  company: string,
  client: ReturnType<typeof createCvClient>,
  cache: SupabaseClient | undefined,
  verbose: boolean,
  write: boolean,
): Promise<void> {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const callsAtStart = client.getCallCount();
  const prepared = requireUsableJobInput(prepareJobInput({ company_name: company, role_offered: role, job_description_raw: jobDescription }));
  if (prepared.quality.status === 'thin') console.warn(`JD warning: ${prepared.quality.warning}`);
  let mark = Date.now();
  const analysis = applyLowTechnicalSignal(await analyzeJobDescription({ jobDescription: prepared.jdText, client }));
  console.log(`Role family: ${analysis.role_family ?? 'other'}; low_technical_signal: ${analysis.low_technical_signal ? 'true' : 'false'}`);
  console.log('Requirements:', analysis.requirements.map((item) => `${item.id} [${item.kind ?? (item.technical ? 'tool' : 'soft')}${item.source === 'role_family_default' ? ', default' : ''}] ${item.text}`).join(' | '));
  timings.analysis = Date.now() - mark;
  mark = Date.now();
  const research = await researchJob({ company: prepared.company, role: prepared.role, jobDescription: prepared.jdText, analysis, client, cache });
  timings.research = Date.now() - mark;
  const vault = buildCandidateVault(profile);
  const validRequirementIds = new Set(analysis.requirements.map((requirement) => requirement.id));
  const adjustments = new Map(
    research.structured.weight_adjustments
      .filter((item) => validRequirementIds.has(item.requirement_id))
      .map((item) => [item.requirement_id, item.adjustment])
  );
  const requirements = analysis.requirements
    .filter((requirement) => requirement.technical)
    .map((requirement) => ({ ...requirement, weight: requirement.weight + (adjustments.get(requirement.id) ?? 0) }));
  mark = Date.now();
  const scoring = await scoreProjects({ projects: vault.projects, requirements, client, runs: cache });
  timings.scoring = Date.now() - mark;
  const selection = selectProjects({ projects: vault.projects, requirements, matrix: scoring.matrix, domain_relevance: scoring.domain_relevance });
  if (write) {
    const styleExamples = JSON.parse(await readFile(resolve(process.cwd(), 'tests/fixtures/style-examples.json'), 'utf8')) as Array<{ text: string }>;
    const budgets = deriveWritingBudgets();
    const writing = await writeCvDetailed({
      analysis,
      research: research.notes,
      selection,
      vault,
      styleExamples,
      client,
      runs: cache,
      budgets,
    });
    const output = writing.result;
    const validation = validateWriting(output, { analysis, selection, vault, budgets });
    console.log('Budget report:', writingBudgetReport(output, budgets));
    console.log(`\n${role} — CV writing`);
    console.log(`Repair attempts used: ${writing.repairAttempts}`);
    console.log(`Uncovered requirements: ${selection.uncovered_requirements.map((requirement) => `${requirement.id} (${requirement.weight}): ${requirement.text}`).join(' | ') || 'None'}`);
    output.projects.forEach((project) => {
      console.log(`Project ${project.project_id}: ${project.stack_order.join(', ')}`);
      project.bullets.forEach((bullet) => console.log(`- ${bullet.text} (${bullet.text.length}/90 chars) [${bullet.source_fact_ids.join(', ')}]`));
    });
    output.experience.forEach((entry) => {
      console.log(`Experience ${entry.experience_id}`);
      entry.bullets.forEach((bullet) => console.log(`- ${bullet.text} (${bullet.text.length}/90 chars) [${bullet.source_fact_ids.join(', ')}]`));
    });
    const factTexts = new Map(vault.projects.concat(vault.experience).flatMap((entry) => entry.facts.map((fact) => [fact.id, fact.text] as const)));
    const similarity = reportBulletSimilarity([
      ...output.projects.flatMap((entry) => entry.bullets.map((bullet) => ({ entryId: entry.project_id, text: bullet.text, sourceFactIds: bullet.source_fact_ids }))),
      ...output.experience.flatMap((entry) => entry.bullets.map((bullet) => ({ entryId: entry.experience_id, text: bullet.text, sourceFactIds: bullet.source_fact_ids }))),
    ], factTexts);
    console.log('Bullet similarity:', similarity.map((item) => `${item.entryId}: ${item.similarity.toFixed(2)}${item.nearVerbatim ? ' near-verbatim' : ' rewritten'}`).join(' | '));
    console.log(`Similarity totals: bullets ${similarity.length}, near-verbatim ${similarity.filter((item) => item.nearVerbatim).length}, rewritten ${similarity.filter((item) => !item.nearVerbatim).length}`);
    const quality = lintBullets([
      ...output.projects.flatMap((entry, entryIndex) => entry.bullets.map((bullet, index) => ({ path: `projects.${entryIndex}.bullets.${index}`, text: bullet.text }))),
      ...output.experience.flatMap((entry, entryIndex) => entry.bullets.map((bullet, index) => ({ path: `experience.${entryIndex}.bullets.${index}`, text: bullet.text }))),
    ]);
    console.log(`Bullet quality warnings: ${quality.warnings.length}; counts: ${JSON.stringify(quality.counts)}`);
    output.skills.forEach((group) => console.log(`Skills ${group.category}: ${group.items.join(', ')}`));
    output.added_skills.forEach((skill) => console.log(`Added skill ${skill.name}: ${skill.reason} [${skill.related_fact_ids.join(', ')}]`));
    if (validation.violations.length === 0 && validation.warnings.length === 0) console.log('Validation: PASSED');
    else [...validation.violations, ...validation.warnings].forEach((item, index) => console.log(`${index + 1}. ${item.path}: ${item.message}`));
    console.log('Sanitizations:');
    writing.sanitizations.forEach((item) => console.log(`- ${item.path}: ${item.message}`));
    console.log('Warnings:');
    validation.warnings.forEach((item) => console.log(`- ${item.path}: ${item.message}`));
    if (process.argv.includes('--review')) {
      const review = await reviewAndRevise({ cv: output, analysis, selection, vault, client, runs: cache });
      console.log('Critic issues:', review.critic.issues.reduce((groups, issue) => {
        (groups[issue.severity] ??= []).push(`${issue.path}: ${issue.message}`);
        return groups;
      }, {} as Record<string, string[]>));
      console.log(`Revision kept: ${review.revisionKept}`);
      const ats = scoreAtsProxy(review.cv, analysis);
      console.log(`ATS keyword coverage proxy: ${ats.score.toFixed(1)}; matched: ${ats.matched.join(', ') || 'None'}; missing: ${ats.missing.map((item) => item.requirement).join(', ') || 'None'}`);
    }
  }
  console.log(`\n${role} (${company}) — calls: ${client.getCallCount() - callsAtStart}, elapsed: ${Date.now() - startedAt}ms`, { timings });
  console.log('Chosen:', selection.chosen.map(({ project, why }) => `${project.title}: ${why}`).join(' | '));
  console.log('Alternatives:', selection.alternatives.map((alternative) => alternative.map(({ project }) => project.title).join(', ')).join(' | '));
  console.log('Uncovered:', selection.uncovered_requirements.map((requirement) => `${requirement.id} (${requirement.weight}): ${requirement.text}`).join(' | ') || 'None');
  if (verbose) {
    console.log('Projects:', vault.projects.map((project) => ({ id: project.id, title: project.title })));
    console.table(scoring.matrix.map((row) => ({
      project_id: row.project_id,
      requirement_id: row.requirement_id,
      score: row.score,
      reason: row.reason,
      domain_relevance: scoring.domain_relevance.find((item) => item.project_id === row.project_id)?.domain_relevance ?? 0,
      evidence_fact_ids: row.evidence_fact_ids.join(', '),
    })));
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const company = argument('--company') ?? 'Fixture Company';
  const profileArgument = argument('--profile');
  const profileShape = profileArgument === 'raw' || profileArgument === 'nested' ? profileArgument : undefined;
  const profilePath = resolve(process.cwd(), process.argv.includes('--profile-large')
    ? 'tests/fixtures/profile-large.json'
    : process.argv.includes('--profile-rough')
    ? 'tests/fixtures/profile-rough.json'
    : profileShape ? 'tests/fixtures/profile.json' : profileArgument ?? 'tests/fixtures/profile.json');
  const profileInput = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown>;
  const requestedShape = argument('--profile-shape') ?? profileShape;
  const profile = requestedShape === 'raw' ? profileInput : unwrapProfile(profileInput);
  const cache = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : undefined;
  if (process.argv.includes('--fit')) {
    const cv = {
      experience: ((profile.master_experience as Record<string, unknown>[]) ?? []).map((entry) => ({ role: entry.role, company: entry.company, duration: entry.duration, bullets: entry.bullets ?? [] })),
      projects: ((profile.master_projects as Record<string, unknown>[]) ?? []).map((entry) => ({ title: entry.title, tech_stack: entry.tech_stack, bullets: entry.bullets ?? [] })),
      skills: profile.master_skills ?? [], certifications: profile.master_certifications ?? [], extracurriculars: profile.master_extracurriculars ?? [],
    };
    const result = await fitCv(profile, cv, { metrics: loadCarlitoMetrics() });
    await mkdir(resolve(process.cwd(), 'out'), { recursive: true });
    await writeFile(resolve(process.cwd(), 'out/cv.private.docx'), result.buffer);
    console.log(`Fit complete in ${result.iterations} iterations: out/cv.private.docx`);
    return;
  }
  if (process.argv.includes('--all-jobs')) {
    const jobs = [
      ['Embedded Engineer', 'tests/fixtures/job-embedded.txt'],
      ['Software Engineer', 'tests/fixtures/job-software.txt'],
      ['Data Scientist', 'tests/fixtures/job-data.txt'],
    ] as const;
    for (const [role, relativePath] of jobs) {
      const client = createCvClient();
      try {
        await runSelection(profile, await readFile(resolve(process.cwd(), relativePath), 'utf8'), role, company, client, cache, process.argv.includes('--verbose'), process.argv.includes('--write'));
      } catch (error) {
        console.error(`JOB FAILED: ${role}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return;
  }
  const jobPath = resolve(process.cwd(), argument('--job') ?? 'tests/fixtures/job-software.txt');
  let jobRow: Record<string, unknown> | undefined;
  let jobDescription: string;
  const jobJsonPath = argument('--job-json');
  if (jobJsonPath) {
    jobRow = JSON.parse(await readFile(resolve(process.cwd(), jobJsonPath), 'utf8')) as Record<string, unknown>;
    const prepared = requireUsableJobInput(prepareJobInput(jobRow));
    console.log('JD quality:', JSON.stringify(prepared.quality, null, 2));
    console.log(`Cleaned length: ${prepared.jdText.length}`);
    console.log(`First 600 characters:\n${prepared.jdText.slice(0, 600)}`);
    console.log(`Last 300 characters:\n${prepared.jdText.slice(-300)}`);
    console.log(`Removed boilerplate characters: ${prepared.quality.boilerplateRemovedChars}`);
    if (prepared.quality.status === 'thin') console.warn(`JD warning: ${prepared.quality.warning}`);
    jobDescription = prepared.jdText;
  } else {
    jobDescription = await readFile(jobPath, 'utf8');
  }
  const role = argument('--role') ?? 'Software Engineer';
  const client = createCvClient();
  const startedAt = Date.now();
  const callsAtStart = client.getCallCount();
  const prepared = requireUsableJobInput(prepareJobInput({
    company_name: jobRow?.company_name ?? company,
    role_offered: jobRow?.role_offered ?? role,
    job_description_raw: jobDescription,
  }));
  const effectiveCompany = prepared.company || company;
  const effectiveRole = prepared.role || role;
  const analysis = applyLowTechnicalSignal(await analyzeJobDescription({ jobDescription: prepared.jdText, client }));
  const research = await researchJob({ company: effectiveCompany, role: effectiveRole, jobDescription: prepared.jdText, analysis, client, cache });
  if (process.argv.includes('--select')) {
    const vault = buildCandidateVault(profile);
    const adjustments = new Map(research.structured.weight_adjustments.map((item) => [item.requirement_id, item.adjustment]));
    const requirements = analysis.requirements
      .filter((requirement) => requirement.technical)
      .map((requirement) => ({ ...requirement, weight: requirement.weight + (adjustments.get(requirement.id) ?? 0) }));
    const scoring = await scoreProjects({ projects: vault.projects, requirements, client, runs: cache });
    const selection = selectProjects({
      projects: vault.projects,
      requirements,
      matrix: scoring.matrix,
      domain_relevance: scoring.domain_relevance,
    });
    console.log('Requirements:', requirements.map((requirement) => `${requirement.id} (${requirement.weight}): ${requirement.text}`).join(' | '));
    console.table(scoring.matrix.map((row) => ({
      project_id: row.project_id,
      requirement_id: row.requirement_id,
      score: row.score,
      reason: row.reason,
      domain_relevance: scoring.domain_relevance.find((item) => item.project_id === row.project_id)?.domain_relevance ?? 0,
      evidence_fact_ids: row.evidence_fact_ids.join(', '),
    })));
    console.log('Chosen projects:', selection.chosen.map(({ project, why }) => ({ id: project.id, title: project.title, why })));
    console.log('Alternatives:', selection.alternatives.map((alternative) => alternative.map(({ project, why }) => ({
      id: project.id,
      title: project.title,
      why,
    }))));
    return;
  }
  if (process.argv.includes('--write')) {
    const vault = buildCandidateVault(profile);
    const requirements = analysis.requirements.filter((requirement) => requirement.technical);
    const scoring = await scoreProjects({ projects: vault.projects, requirements, client, runs: cache });
    const selection = selectProjects({ projects: vault.projects, requirements, matrix: scoring.matrix, domain_relevance: scoring.domain_relevance });
    const styleExamples = JSON.parse(await readFile(resolve(process.cwd(), 'tests/fixtures/style-examples.json'), 'utf8')) as Array<{ text: string }>;
    const writingCallsAtStart = client.getCallCount();
    const budgets = deriveWritingBudgets();
    const writing = await writeCvDetailed({ analysis, research: research.notes, selection, vault, styleExamples, client, runs: cache, budgets });
    const output = writing.result;
    const validation = validateWriting(output, { analysis, selection, vault, budgets });
    console.log('Budget report:', writingBudgetReport(output, budgets));
    console.log(`Requirements: ${requirements.map((requirement) => `${requirement.id} (${requirement.weight}): ${requirement.text}`).join(' | ')}`);
    console.log(`Repair attempts used: ${Math.max(0, client.getCallCount() - writingCallsAtStart - 1)}`);
    console.log(`Uncovered requirements: ${selection.uncovered_requirements.map((requirement) => `${requirement.id} (${requirement.weight}): ${requirement.text}`).join(' | ') || 'None'}`);
    console.log(JSON.stringify(output, null, 2));
    output.projects.forEach((project) => project.bullets.forEach((bullet) => console.log(`Bullet ${project.project_id}: ${bullet.text.length}/90 chars`)));
    output.experience.forEach((entry) => entry.bullets.forEach((bullet) => console.log(`Bullet ${entry.experience_id}: ${bullet.text.length}/90 chars`)));
    if (validation.violations.length === 0 && validation.warnings.length === 0) console.log('Validation: PASSED');
    else [...validation.violations, ...validation.warnings].forEach((item, index) => console.log(`${index + 1}. ${item.path}: ${item.message}`));
    console.log('Sanitizations:');
    writing.sanitizations.forEach((item) => console.log(`- ${item.path}: ${item.message}`));
    console.log('Warnings:');
    validation.warnings.forEach((item) => console.log(`- ${item.path}: ${item.message}`));
    if (process.argv.includes('--review')) {
      const review = await reviewAndRevise({ cv: output, analysis, selection, vault, client, runs: cache });
      console.log('Critic issues:', review.critic.issues);
      console.log(`Revision kept: ${review.revisionKept}`);
      const ats = scoreAtsProxy(review.cv, analysis);
      console.log(`ATS keyword coverage proxy: ${ats.score.toFixed(1)}`);
      console.log('Matched:', ats.matched.join(', ') || 'None');
      console.log('Missing:', ats.missing.map((item) => `${item.requirement} — ${item.ask_user}`).join(' | ') || 'None');
    }
    console.log(`Total calls: ${client.getCallCount() - callsAtStart}; elapsed: ${Date.now() - startedAt}ms`);
    return;
  }
  const displayResearch = {
    ...research,
    structured: {
      ...research.structured,
      sources: research.structured.sources.map(({ title, domain }) => ({ title, domain })),
    },
    sourceUrls: undefined,
  };
  console.log(JSON.stringify({ profileKeys: Object.keys(profile), analysis, research: displayResearch }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
