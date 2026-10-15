import { createHash } from 'node:crypto';

export type MasterProfileRow = {
  fixed_details?: unknown;
  master_projects?: unknown;
  master_experience?: unknown;
  master_skills?: unknown;
  master_certifications?: unknown;
  master_extracurriculars?: unknown;
};

export type VaultFact = {
  id: string;
  text: string;
  tools: string[];
  numbers: string[];
  warnings: string[];
};

export type VaultEntry = {
  id: string;
  title: string;
  tools: string[];
  facts: VaultFact[];
};

export type VaultExperienceEntry = VaultEntry & {
  role: string;
  company: string;
  duration: string;
};

export type VaultSkillGroup = {
  category: string;
  items: string;
};

export type CandidateVault = {
  projects: VaultEntry[];
  experience: VaultExperienceEntry[];
  skills: VaultSkillGroup[];
  droppedEmptyBulletsCount?: number;
  droppedEmptyBullets?: Array<{ entryId: string; entryTitle: string; rawText: string }>;
};

type StoredProject = {
  id?: unknown;
  title?: unknown;
  tech_stack?: unknown;
  bullets?: unknown;
};

type StoredExperience = {
  id?: unknown;
  role?: unknown;
  company?: unknown;
  duration?: unknown;
  bullets?: unknown;
};

type StoredSkillGroup = {
  category?: unknown;
  items?: unknown;
};

const NUMBER_PATTERN = /(?<!\w)(?:\d+(?:\.\d+)?(?:[kKmMbB])?%?|\.\d+(?:[kKmMbB])?%?)(?!\w)/g;
const CLAIM_SPLIT_PATTERN = /[.!?;]\s+|\s+\b(?:and|while|then|also)\b\s+/i;
const HAS_LETTER_OR_DIGIT = /[a-zA-Z0-9]/;

export function isMeaningfulBullet(text: string): boolean {
  return HAS_LETTER_OR_DIGIT.test(text);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function entryTools(value: unknown): string[] {
  return asString(value)
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function factWarnings(text: string, tools: string[], numbers: string[]): string[] {
  const warnings: string[] = [];
  if (CLAIM_SPLIT_PATTERN.test(text)) warnings.push('May contain more than one claim');
  if (tools.length === 0 && numbers.length === 0) warnings.push('No concrete tool or number detected');
  return warnings;
}

function createFacts(entryId: string, bullets: unknown, tools: string[]): VaultFact[] {
  return asStringArray(bullets)
    .filter(isMeaningfulBullet)
    .map((text) => {
      const digest = createHash('sha1').update(text).digest('hex').slice(0, 8);
      const numbers = [...new Set(text.match(NUMBER_PATTERN) ?? [])];
      const factTools = tools.filter((tool) => text.toLocaleLowerCase().includes(tool.toLocaleLowerCase()));
      return {
        id: `${entryId}.${digest}`,
        text,
        tools: factTools,
        numbers,
        warnings: factWarnings(text, factTools, numbers),
      };
    });
}

function projectEntry(value: StoredProject, index: number): VaultEntry {
  const id = asString(value.id) || `project-${index + 1}`;
  const tools = entryTools(value.tech_stack);
  return {
    id,
    title: asString(value.title),
    tools,
    facts: createFacts(id, value.bullets, tools),
  };
}

function experienceEntry(value: StoredExperience, index: number): VaultExperienceEntry {
  const id = asString(value.id) || `experience-${index + 1}`;
  return {
    id,
    title: asString(value.role) || asString(value.company) || id,
    role: asString(value.role),
    company: asString(value.company),
    duration: asString(value.duration),
    tools: [],
    facts: createFacts(id, value.bullets, []),
  };
}

export function buildCandidateVault(profile: MasterProfileRow): CandidateVault {
  const droppedEmptyBullets: Array<{ entryId: string; entryTitle: string; rawText: string }> = [];

  const inspectBullets = (entryId: string, entryTitle: string, bullets: unknown) => {
    if (Array.isArray(bullets)) {
      for (const b of bullets) {
        if (typeof b === 'string' && !isMeaningfulBullet(b)) {
          droppedEmptyBullets.push({ entryId, entryTitle, rawText: b });
        }
      }
    }
  };

  const projects = Array.isArray(profile.master_projects)
    ? profile.master_projects.map((value, index) => {
        const p = (value ?? {}) as StoredProject;
        const id = asString(p.id) || `project-${index + 1}`;
        const title = asString(p.title);
        inspectBullets(id, title, p.bullets);
        return projectEntry(p, index);
      })
    : [];
  const experience = Array.isArray(profile.master_experience)
    ? profile.master_experience.map((value, index) => {
        const e = (value ?? {}) as StoredExperience;
        const id = asString(e.id) || `experience-${index + 1}`;
        const title = asString(e.role) || asString(e.company) || id;
        inspectBullets(id, title, e.bullets);
        return experienceEntry(e, index);
      })
    : [];
  const skills = Array.isArray(profile.master_skills)
    ? profile.master_skills.map((value) => {
        const group = (value ?? {}) as StoredSkillGroup;
        return { category: asString(group.category), items: asString(group.items) };
      })
    : [];

  return {
    projects,
    experience,
    skills,
    droppedEmptyBulletsCount: droppedEmptyBullets.length,
    droppedEmptyBullets,
  };
}

export async function readCandidateVault(
  readProfile: () => Promise<MasterProfileRow>
): Promise<CandidateVault> {
  return buildCandidateVault(await readProfile());
}
