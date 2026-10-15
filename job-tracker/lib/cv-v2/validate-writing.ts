import type { JdAnalysis } from './analyze';
import type { WritingResult } from './write-cv';
import type { CandidateVault, VaultEntry } from './vault';
import type { ProjectSelection } from './select-projects';
import bannedPhrases from '../../data/banned-phrases.json';
import { DEFAULT_LAYOUT } from './docx-builder';
import { loadCarlitoMetrics } from './fit-estimator';

export type WritingViolation = { path: string; message: string; hard: boolean };
export type WritingValidation = { violations: WritingViolation[]; warnings: WritingViolation[] };
export type WritingSanitization = { path: string; message: string };
export type WritingBudgets = { project: number; experience: number };

export function deriveWritingBudgets(input?: Partial<WritingBudgets>): WritingBudgets {
  const metrics = loadCarlitoMetrics();
  const usableWidth = DEFAULT_LAYOUT.pageWidthTwips - DEFAULT_LAYOUT.margins.left - DEFAULT_LAYOUT.margins.right - 720;
  const averageCharWidth = metrics.widthOfTextAtSize('abcdefghijklmnopqrstuvwxyz ', DEFAULT_LAYOUT.fontSize) / 27;
  const measuredTwoLineBudget = Math.floor((usableWidth * 2 * 0.82) / averageCharWidth);
  const budget = Math.max(40, measuredTwoLineBudget);
  return { project: Math.round(input?.project ?? budget), experience: Math.round(input?.experience ?? budget) };
}

export function writingBudgetReport(output: WritingResult, budgets: WritingBudgets) {
  const report = (items: WritingResult['projects'][number]['bullets']) => ({
    count: items.length,
    over: items.filter((item) => item.text.length > budgets.project).length,
    max: items.reduce((max, item) => Math.max(max, item.text.length), 0),
  });
  return {
    project: report(output.projects.flatMap((item) => item.bullets)),
    experience: {
      count: output.experience.flatMap((item) => item.bullets).length,
      over: output.experience.flatMap((item) => item.bullets).filter((item) => item.text.length > budgets.experience).length,
      max: output.experience.flatMap((item) => item.bullets).reduce((max, item) => Math.max(max, item.text.length), 0),
    },
  };
}

const NUMBER_PATTERN = /(?<!\w)(?:\d+(?:\.\d+)?(?:[kKmMbB])?%?|\.\d+(?:[kKmMbB])?%?)(?!\w)/g;
const BANNED = bannedPhrases;
const SOFT = new Set(['communication', 'teamwork', 'leadership', 'management', 'problem solving', 'collaboration', 'team player']);
const CAUSAL = /\b(?:reducing|reduced|cutting|cut|improving|improved|boosting|lowering|increasing|saving|enabling|resulting in|leading to|achieving|thereby|so that|to reduce|to improve|by\s+\w+ing)\b/i;
const QUALIFIERS = ['simulated', 'under', 'over', 'below', 'above', 'about', 'approximately', 'up to', 'at least', 'in a load test', 'during a field test', 'in testing'];
const SKILL_CATEGORIES = new Set(['Languages', 'Frameworks & Libraries', 'Databases', 'Tools & Platforms', 'Embedded & Hardware', 'Data & ML']);
const SKILL_STOPLIST = new Set(['apis', 'api', 'technical', 'software', 'coding']);
const VALID_CATEGORIES = ['Languages', 'Frameworks & Libraries', 'Databases', 'Tools & Platforms', 'Embedded & Hardware', 'Data & ML'];

function facts(entry: VaultEntry, ids: string[]): VaultEntry['facts'] {
  return ids.map((id) => entry.facts.find((fact) => fact.id === id)).filter((fact): fact is VaultEntry['facts'][number] => Boolean(fact));
}

function tools(entry: VaultEntry): Set<string> {
  return new Set(entry.tools.map((tool) => tool.toLocaleLowerCase()));
}

export function skillVocabulary(input: { vault: CandidateVault }): Set<string> {
  const values = [
    ...input.vault.skills.flatMap((group) => group.items.split(',').map((item) => item.trim())),
    ...input.vault.projects.flatMap((entry) => entry.tools),
    ...input.vault.experience.flatMap((entry) => [...entry.tools, ...entry.facts.flatMap((fact) => fact.tools)]),
  ];
  const vocabulary = new Set(values.map((item) => item.toLocaleLowerCase()).filter((item) => item && item !== 'apis'));
  if ([...vocabulary].some((item) => ['postgresql', 'mysql', 'sqlite'].includes(item))) vocabulary.add('sql');
  if ([...vocabulary].some((item) => ['express', 'node.js', 'rest'].includes(item))) vocabulary.add('rest apis');
  return vocabulary;
}

function sourceSentence(text: string, number: string): string {
  return text.split(/(?<=[.!?])\s+/).find((sentence) => sentence.includes(number)) ?? text;
}

function nearbyQualifiers(sentence: string, number: string): string[] {
  const words = sentence.toLocaleLowerCase().split(/\s+/);
  const index = words.findIndex((word) => word.replace(/[^\d.%]/g, '') === number.toLocaleLowerCase());
  if (index < 0) return [];
  return QUALIFIERS.filter((qualifier) => {
    return words.slice(Math.max(0, index - 6), index + 1).join(' ').includes(qualifier);
  });
}

function baselineFor(sentence: string, number: string): string | undefined {
  const match = sentence.match(/from\s+([0-9][\d.,]*%?)(?:\s+\w+){0,3}\s+to\s+([0-9][\d.,]*%?)/i);
  return match?.[2] === number ? match[1] : undefined;
}

function permutation(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index] || expected.includes(item)) && new Set(actual).size === new Set(expected).size && actual.every((item) => expected.includes(item));
}

export function validateCandidateBulletFix(
  bullet: WritingResult['projects'][number]['bullets'][number],
  entry: VaultEntry,
  analysis: JdAnalysis,
  vocabulary: Set<string>,
): boolean {
  const cited = facts(entry, bullet.source_fact_ids);
  if (cited.length !== bullet.source_fact_ids.length || cited.length === 0) return false;
  if (bullet.source_fact_ids.length > 2) return false;
  const citedText = cited.map((fact) => fact.text).join(' ').toLocaleLowerCase();
  const bulletNumbers = bullet.text.match(NUMBER_PATTERN) ?? [];
  for (const number of bulletNumbers) {
    if (!citedText.includes(number.toLocaleLowerCase())) return false;
    for (const fact of cited) {
      const sentence = sourceSentence(fact.text, number);
      for (const qualifier of nearbyQualifiers(sentence, number)) {
        if (!bullet.text.toLocaleLowerCase().includes(qualifier)) return false;
      }
      const baseline = baselineFor(sentence, number);
      if (baseline && !bullet.text.includes(baseline)) return false;
    }
  }
  if (cited.length > 1 && CAUSAL.test(bullet.text)) return false;
  const entryTools = tools(entry);
  for (const term of vocabulary) {
    if (bullet.text.toLocaleLowerCase().includes(term) && !citedText.includes(term) && !entryTools.has(term)) {
      return false;
    }
  }
  return true;
}

export function validateWriting(
  output: WritingResult,
  input: { analysis: JdAnalysis; selection: ProjectSelection; vault: CandidateVault; budgets?: { project: number; experience: number } },
): WritingValidation {
  const violations: WritingViolation[] = [];
  const warnings: WritingViolation[] = [];
  const projectMap = new Map(input.vault.projects.map((entry) => [entry.id, entry]));
  const experienceMap = new Map(input.vault.experience.map((entry) => [entry.id, entry]));
  const selectedIds = input.selection.chosen.map((item) => item.project.id);
  if (output.projects.length > 0 && output.projects.map((project) => project.project_id).sort().join() !== [...selectedIds].sort().join()) {
    violations.push({ path: 'projects', message: 'Project IDs do not match the selected three exactly', hard: true });
  }

  const vocabulary = new Set([
    ...skillVocabulary(input),
    ...input.analysis.requirements.flatMap((requirement) => [requirement.text]),
    ...input.analysis.keywords,
  ].map((term) => term.toLocaleLowerCase()));
  const validateBullets = (entry: VaultEntry | undefined, bullets: WritingResult['projects'][number]['bullets'], path: string, budget: number): void => {
    if (!entry) {
      violations.push({ path, message: 'Entry ID does not exist', hard: true });
      return;
    }
    const entryTools = tools(entry);
    bullets.forEach((bullet, index) => {
      const cited = facts(entry, bullet.source_fact_ids);
      if (bullet.source_fact_ids.length > 2) {
        violations.push({ path: `${path}.${index}.source_fact_ids`, message: 'At most 2 source facts may be cited per bullet', hard: true });
      }
      if (cited.length !== bullet.source_fact_ids.length || cited.length === 0) violations.push({ path: `${path}.${index}.source_fact_ids`, message: 'Fact ID is missing or belongs to another entry', hard: true });
      const citedText = cited.map((fact) => fact.text).join(' ').toLocaleLowerCase();
      const bulletNumbers = bullet.text.match(NUMBER_PATTERN) ?? [];
      for (const number of bulletNumbers) {
        if (!citedText.includes(number.toLocaleLowerCase())) violations.push({ path: `${path}.${index}.text`, message: `Invented number ${number}`, hard: true });
        for (const fact of cited) {
          const sentence = sourceSentence(fact.text, number);
          for (const qualifier of nearbyQualifiers(sentence, number)) {
            if (!bullet.text.toLocaleLowerCase().includes(qualifier)) {
              violations.push({ path: `${path}.${index}.text`, message: `Missing qualifier "${qualifier}" for ${number}`, hard: true });
            }
          }
          const baseline = baselineFor(sentence, number);
          if (baseline && !bullet.text.includes(baseline)) {
            violations.push({ path: `${path}.${index}.text`, message: `Missing baseline ${baseline} for ${number}`, hard: true });
          }
        }
      }
      if (cited.length > 1 && CAUSAL.test(bullet.text)) {
        violations.push({ path: `${path}.${index}.text`, message: 'Causal connective joins multiple cited facts without single-fact support', hard: true });
      }
      for (const term of vocabulary) {
        if (bullet.text.toLocaleLowerCase().includes(term) && !citedText.includes(term) && !entryTools.has(term)) {
          violations.push({ path: `${path}.${index}.text`, message: `Unsupported tool or JD term ${term}`, hard: true });
        }
      }
      // Deterministic specificity check: warn when concrete tokens from cited facts are dropped and are JD-relevant
      const jdTerms = input.analysis.requirements.map((r) => r.text.toLocaleLowerCase()).concat(input.analysis.keywords.map((k) => k.toLocaleLowerCase()));
      for (const fact of cited) {
        const factTokens = fact.text.match(/[a-zA-Z0-9_\-]+/g) ?? [];
        for (const token of factTokens) {
          const lowerToken = token.toLocaleLowerCase();
          if (lowerToken.length > 3 && jdTerms.some((t) => t.includes(lowerToken))) {
            if (!bullet.text.toLocaleLowerCase().includes(lowerToken)) {
              warnings.push({ path: `${path}.${index}.text`, message: `Lost concrete JD-relevant term: ${token}`, hard: false });
            }
          }
        }
      }
      for (const phrase of BANNED) if (bullet.text.toLocaleLowerCase().includes(phrase)) warnings.push({ path: `${path}.${index}.text`, message: `Banned phrase ${phrase}`, hard: false });
      if (bullet.text.length > budget) warnings.push({ path: `${path}.${index}.text`, message: `Over character budget ${budget}`, hard: false });
    });
  };
  output.projects.forEach((project, index) => {
    const entry = projectMap.get(project.project_id);
    if (entry && !permutation(project.stack_order, entry.tools)) violations.push({ path: `projects.${index}.stack_order`, message: 'Stack is not an exact permutation of the original', hard: true });
    validateBullets(entry, project.bullets, `projects.${index}.bullets`, input.budgets?.project ?? 110);
  });
  output.experience.forEach((entry, index) => validateBullets(experienceMap.get(entry.experience_id), entry.bullets, `experience.${index}.bullets`, input.budgets?.experience ?? 110));
  const masterItems = skillVocabulary(input);
  const allFactIds = new Set(input.vault.projects.concat(input.vault.experience).flatMap((entry) => entry.facts.map((fact) => fact.id)));
  output.skills.forEach((group, index) => group.items.forEach((item, itemIndex) => {
    if (SOFT.has(item.toLocaleLowerCase())) violations.push({ path: `skills.${index}.items.${itemIndex}`, message: 'Generic or soft skill', hard: true });
    if (SKILL_STOPLIST.has(item.toLocaleLowerCase()) || !masterItems.has(item.toLocaleLowerCase())) violations.push({ path: `skills.${index}.items.${itemIndex}`, message: 'Skill is not in verified vocabulary', hard: true });
  }));
  output.skills.forEach((group, index) => {
    if (!SKILL_CATEGORIES.has(group.category)) violations.push({ path: `skills.${index}.category`, message: 'Invalid skills category', hard: true });
  });
  if (output.added_skills.length > 3) violations.push({ path: 'added_skills', message: 'At most 3 added skills are allowed', hard: true });
  output.added_skills.forEach((skill, index) => {
    const name = skill.name.trim().toLocaleLowerCase();
    if (SKILL_STOPLIST.has(name) || masterItems.has(name)) violations.push({ path: `added_skills.${index}.name`, message: 'Added skill is already verified or forbidden', hard: true });
    const requiredByJd = input.analysis.requirements.some((requirement) => (
      requirement.technical && (requirement.text.toLocaleLowerCase().includes(name) || name.includes(requirement.text.toLocaleLowerCase()))
    )) || input.analysis.keywords.some((keyword) => keyword.toLocaleLowerCase() === name);
    if (!requiredByJd) violations.push({ path: `added_skills.${index}.name`, message: 'Added skill is not a technical JD requirement', hard: true });
    const valid = input.vault.projects.concat(input.vault.experience).flatMap((entry) => entry.facts.map((fact) => fact.id));
    if (skill.related_fact_ids.length === 0 || skill.related_fact_ids.some((id) => !valid.includes(id) || !allFactIds.has(id))) violations.push({ path: `added_skills.${index}.related_fact_ids`, message: 'Added skill must cite an adjacent valid fact', hard: true });
    const cited = input.vault.projects.concat(input.vault.experience).flatMap((entry) => entry.facts).filter((fact) => skill.related_fact_ids.includes(fact.id));
    if (cited.length > 0 && !cited.some((fact) => `${fact.text} ${fact.tools.join(' ')}`.toLocaleLowerCase().includes(name))) {
      warnings.push({ path: `added_skills.${index}`, message: 'Added skill is not supported by the cited fact text or tools', hard: false });
    }
    if (skill.reason.trim().length < 12) warnings.push({ path: `added_skills.${index}.reason`, message: 'Added skill reason is weak', hard: false });
  });
  return { violations, warnings };
}

function categoryFor(item: string): string {
  const value = item.toLocaleLowerCase();
  if (/typescript|javascript|python|java|^c$|^go$|rust/.test(value)) return 'Languages';
  if (/react|next|express|pandas|scikit|pytorch|opencv/.test(value)) return /pandas|scikit|pytorch|opencv/.test(value) ? 'Data & ML' : 'Frameworks & Libraries';
  if (/postgres|mysql|sqlite|redis|sql/.test(value)) return 'Databases';
  if (/mqtt|freertos|stm32|arduino|sensor/.test(value)) return 'Embedded & Hardware';
  return 'Tools & Platforms';
}

export function sanitizeWriting(
  output: WritingResult,
  input: { analysis: JdAnalysis; selection: ProjectSelection; vault: CandidateVault },
): { result: WritingResult; sanitizations: WritingSanitization[] } {
  const sanitizations: WritingSanitization[] = [];
  const result: WritingResult = JSON.parse(JSON.stringify(output)) as WritingResult;
  const vocabulary = skillVocabulary(input);
  const technical = input.analysis.requirements.filter((item) => item.technical);
  const relevant = (name: string) => technical.some((item) => item.text.toLocaleLowerCase().includes(name) || name.includes(item.text.toLocaleLowerCase()))
    || input.analysis.keywords.some((item) => item.toLocaleLowerCase() === name);
  const entryMap = new Map(input.vault.projects.concat(input.vault.experience).map((entry) => [entry.id, entry]));
  result.projects.forEach((project, projectIndex) => {
    const entry = entryMap.get(project.project_id);
    if (!entry) return;
    const rebuilt: typeof project.bullets = [];
    project.bullets.forEach((bullet, bulletIndex) => {
      const cited = bullet.source_fact_ids.map((id) => entry.facts.find((fact) => fact.id === id)).filter((fact): fact is VaultEntry['facts'][number] => Boolean(fact));
      if (cited.length > 1 && CAUSAL.test(bullet.text)) {
        rebuilt.push({ ...bullet, text: cited[0].text });
        sanitizations.push({ path: `projects.${projectIndex}.bullets.${bulletIndex}.text`, message: 'fallback: used source fact' });
        cited.slice(1).forEach((fact) => {
          rebuilt.push({ text: fact.text, source_fact_ids: [fact.id], priority: bullet.priority });
          sanitizations.push({ path: `projects.${projectIndex}.bullets`, message: `fallback: emitted source fact ${fact.id} separately` });
        });
      } else rebuilt.push(bullet);
    });
    project.bullets = rebuilt;
  });
  result.experience.forEach((entryOutput, entryIndex) => {
    const entry = entryMap.get(entryOutput.experience_id);
    if (!entry) return;
    entryOutput.bullets = entryOutput.bullets.flatMap((bullet, bulletIndex) => {
      const cited = bullet.source_fact_ids.map((id) => entry.facts.find((fact) => fact.id === id)).filter((fact): fact is VaultEntry['facts'][number] => Boolean(fact));
      if (cited.length > 1 && CAUSAL.test(bullet.text)) {
        sanitizations.push({ path: `experience.${entryIndex}.bullets.${bulletIndex}.text`, message: 'fallback: used source fact' });
        return [{ ...bullet, text: cited[0].text }, ...cited.slice(1).map((fact) => ({ text: fact.text, source_fact_ids: [fact.id], priority: bullet.priority }))];
      }
      return [bullet];
    });
  });
  result.added_skills = result.added_skills.filter((skill, index) => {
    const name = skill.name.toLocaleLowerCase();
    if (SKILL_STOPLIST.has(name) || vocabulary.has(name) || !relevant(name)) {
      sanitizations.push({ path: `added_skills.${index}`, message: `dropped invalid added skill "${skill.name}"` });
      return false;
    }
    return true;
  });
  result.skills = result.skills.flatMap((group, index) => {
    const category = VALID_CATEGORIES.includes(group.category) ? group.category : undefined;
    const items = group.items.filter((item) => vocabulary.has(item.toLocaleLowerCase()) && !SKILL_STOPLIST.has(item.toLocaleLowerCase()));
    if (!category && items.length === 0) {
      sanitizations.push({ path: `skills.${index}`, message: 'dropped invalid skill group' });
      return [];
    }
    const normalizedCategory = category ?? categoryFor(items[0]);
    if (!category) sanitizations.push({ path: `skills.${index}.category`, message: `moved skills to ${normalizedCategory}` });
    return [{ category: normalizedCategory, items }];
  });
  return { result, sanitizations };
}
