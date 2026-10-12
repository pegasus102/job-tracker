import type { Requirement } from './analyze';
import type { ProjectScoreRow } from './score-projects';
import type { VaultEntry } from './vault';

export type ProjectSelectionInput = {
  projects: VaultEntry[];
  requirements: Array<{ id: Requirement['id']; text: Requirement['text']; weight: number }>;
  matrix: ProjectScoreRow[];
  domain_relevance: Array<{ project_id: string; domain_relevance: number }>;
};

export type SelectedProject = {
  project: VaultEntry;
  why: string;
  depth: number;
};

export type ProjectSelection = {
  chosen: SelectedProject[];
  alternatives: SelectedProject[][];
  matrix: ProjectScoreRow[];
  uncovered_requirements: Array<{ id: string; text: string; weight: number }>;
  coverage: number;
  total: number;
};

function combinations<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  const visit = (start: number, current: T[]): void => {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  };
  visit(0, []);
  return output;
}

function weights(requirements: ProjectSelectionInput['requirements']): number {
  return requirements.reduce((sum, requirement) => sum + Math.max(0, requirement.weight), 0);
}

function score(matrix: ProjectScoreRow[], projectId: string, requirementId: string): number {
  return matrix.find((row) => row.project_id === projectId && row.requirement_id === requirementId)?.score ?? 0;
}

function domainRelevance(input: ProjectSelectionInput, projectId: string): number {
  return input.domain_relevance.find((item) => item.project_id === projectId)?.domain_relevance ?? 0;
}

function stackTokens(project: VaultEntry): Set<string> {
  return new Set(project.tools.flatMap((tool) => tool.split(/[,/\s]+/).map((token) => token.trim().toLocaleLowerCase()).filter(Boolean)));
}

export function projectStackSimilarity(left: VaultEntry, right: VaultEntry): number {
  const a = stackTokens(left);
  const b = stackTokens(right);
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : [...a].filter((token) => b.has(token)).length / union;
}

function depth(project: VaultEntry, input: ProjectSelectionInput, denominator: number): number {
  return input.requirements.reduce((sum, requirement) => (
    sum + requirement.weight * score(input.matrix, project.id, requirement.id) / 3
  ), 0) / denominator;
}

function why(project: VaultEntry, input: ProjectSelectionInput): string {
  const matched = input.requirements.flatMap((requirement) => {
    const row = input.matrix.find((item) => item.project_id === project.id && item.requirement_id === requirement.id);
    if (!row || row.score < 1) return [];
    const evidence = row.evidence_fact_ids.map((id) => project.facts.find((fact) => fact.id === id)?.text).filter(Boolean);
    return [`${row.reason || `Partial evidence: ${requirement.text}`}${evidence.length > 0 ? ` (${evidence.join('; ')})` : ''}`];
  });
  return matched.length > 0
    ? matched.join(' | ')
    : domainRelevance(input, project.id) > 0
      ? 'Closest domain match; no direct requirement evidence.'
      : 'No matching evidence for this role; included only to reach 3 projects.';
}

export function selectProjects(input: ProjectSelectionInput): ProjectSelection {
  if (input.projects.length < 3) throw new Error('At least 3 valid master projects are required; no filler project will be created');
  const denominator = Math.max(1, weights(input.requirements));
  const totalEvidence = new Map(input.projects.map((project) => [
    project.id,
    input.requirements.reduce((sum, requirement) => sum + score(input.matrix, project.id, requirement.id), 0),
  ]));
  const nonZero = input.projects.filter((project) => (totalEvidence.get(project.id) ?? 0) > 0);
  const zero = input.projects
    .filter((project) => !nonZero.includes(project))
    .sort((left, right) => domainRelevance(input, right.id) - domainRelevance(input, left.id));
  const eligible = nonZero.length >= 3 ? nonZero : [...nonZero, ...zero];
  const ranked = combinations(eligible, 3).map((triple, order) => {
    const coverage = input.requirements.reduce((sum, requirement) => (
      sum + requirement.weight * Math.max(...triple.map((project) => score(input.matrix, project.id, requirement.id))) / 3
    ), 0) / denominator;
    const depths = triple.map((project) => depth(project, input, denominator));
    const meanDepth = depths.reduce((sum, value) => sum + value, 0) / triple.length;
    const meanDomain = triple.reduce((sum, project) => sum + domainRelevance(input, project.id), 0) / triple.length;
    const similarities = combinations(triple, 2).map(([left, right]) => projectStackSimilarity(left, right));
    const meanStackSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
    return {
      triple,
      coverage,
      meanDepth,
      meanDomain,
      total: coverage + 0.25 * meanDepth + 0.05 * meanDomain / 3 - 0.15 * meanStackSimilarity,
      order,
    };
  }).sort((a, b) => b.total - a.total || b.coverage - a.coverage || b.meanDomain - a.meanDomain || b.meanDepth - a.meanDepth || a.order - b.order);
  const toSelected = (triple: VaultEntry[]): SelectedProject[] => triple.map((project) => ({
    project,
    depth: depth(project, input, denominator),
    why: why(project, input),
  }));
  const best = ranked[0];
  const uncovered_requirements = input.requirements
    .filter((requirement) => Math.max(...best.triple.map((project) => score(input.matrix, project.id, requirement.id))) < 2)
    .map(({ id, text, weight }) => ({ id, text, weight }));
  return {
    chosen: toSelected(best.triple),
    alternatives: ranked.slice(1, 3).map((item) => toSelected(item.triple)),
    matrix: input.matrix,
    uncovered_requirements,
    coverage: best.coverage,
    total: best.total,
  };
}
