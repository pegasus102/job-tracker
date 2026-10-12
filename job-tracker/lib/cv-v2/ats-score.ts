import synonyms from '../../data/synonyms.json';
import type { JdAnalysis } from './analyze';
import type { WritingResult } from './write-cv';

export type AtsProxyResult = {
  score: number;
  matched: string[];
  missing: Array<{ requirement: string; ask_user: string }>;
};

function cvText(cv: WritingResult): string {
  return [
    ...cv.projects.flatMap((project) => [project.project_id, ...project.stack_order, ...project.bullets.map((bullet) => bullet.text)]),
    ...cv.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.text)),
    ...cv.skills.flatMap((group) => [group.category, ...group.items]),
  ].join(' ');
}

function literalMatch(text: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function spellingVariants(term: string): string[] {
  const variants = new Set([term]);
  if (term.includes('-')) variants.add(term.replaceAll('-', ' '));
  if (term.includes(' ')) variants.add(term.replaceAll(' ', '-'));
  if (/programming$/i.test(term)) variants.add(term.replace(/programming$/i, 'programing'));
  if (/programing$/i.test(term)) variants.add(term.replace(/programing$/i, 'programming'));
  return [...variants];
}

export function scoreAtsProxy(cv: WritingResult, analysis: JdAnalysis): AtsProxyResult {
  const text = cvText(cv);
  const matched: string[] = [];
  const missing: AtsProxyResult['missing'] = [];
  let total = 0;
  let covered = 0;
  for (const requirement of analysis.requirements.filter((item) => item.technical && item.source !== 'role_family_default')) {
    total += requirement.weight;
    const variants = [
      ...((synonyms as Record<string, string[]>)[requirement.text] ?? []),
      ...spellingVariants(requirement.text),
    ];
    if (variants.some((variant) => literalMatch(text, variant))) {
      matched.push(requirement.text);
      covered += requirement.weight;
    } else {
      missing.push({ requirement: requirement.text, ask_user: `Do you have real experience with ${requirement.text}? If yes, add it to your Master Profile.` });
    }
  }
  return { score: total === 0 ? 0 : 100 * covered / total, matched, missing };
}
