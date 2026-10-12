export type JobInputRow = {
  company_name?: unknown;
  role_offered?: unknown;
  job_description_raw?: unknown;
  required_skills?: unknown;
};

export type JobInputQuality = {
  chars: number;
  sectionsFound: string[];
  boilerplateRemovedChars: number;
  truncated: boolean;
  status: 'ok' | 'thin' | 'poor';
  promptInjectionLinesRemoved: number;
  warning?: string;
};

export type PreparedJobInput = {
  company: string;
  role: string;
  jdText: string;
  quality: JobInputQuality;
};

export class JdNeedsReviewError extends Error {
  readonly code = 'JD_NEEDS_REVIEW' as const;

  constructor(message = 'The scraped job description looks incomplete. Paste the job description manually.') {
    super(message);
    this.name = 'JdNeedsReviewError';
  }
}

const MAX_CHARS = 12_000;
const SECTION_PATTERN = /^(?:about the role|role overview|responsibilities|what you(?:'|’)ll do|requirements|qualifications|skills|must[- ]haves?|preferred|nice to have|what we offer|eligibility)\s*:?\s*$/i;
const ROLE_PATTERN = /\b(responsibilit(?:y|ies)|qualifications?|requirements?|skills?|experience|what you(?:'|’)ll do|must[- ]haves?|preferred|software engineer|developer|analyst|designer|intern)\b/i;
const BOILERPLATE_PATTERN = /^(?:accept cookies?|cookie (?:notice|policy|settings)|we use cookies|share (?:this )?job|apply now|sign in|log in|menu|home|search jobs?|privacy policy|terms (?:of use|and conditions)|equal employment opportunity|equal opportunity employer|eeo|all rights reserved|subscribe|follow us|back to jobs?)\b/i;
const INJECTION_PATTERN = /\b(?:ignore previous instructions|system prompt|you are an ai)\b/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function cleanLine(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function sectionName(line: string): string | undefined {
  const match = line.match(SECTION_PATTERN);
  return match?.[0].replace(/:$/, '').toLowerCase();
}

function priority(line: string): boolean {
  return Boolean(sectionName(line)?.match(/responsibil|what you|requirement|qualification|skill|must|preferred/i));
}

export function prepareJobInput(jobRow: JobInputRow): PreparedJobInput {
  const rawLines = text(jobRow.job_description_raw).split(/\r?\n|(?<=[.!?])\s{2,}/).map(cleanLine).filter(Boolean);
  const seen = new Set<string>();
  const sectionsFound: string[] = [];
  let boilerplateRemovedChars = 0;
  let promptInjectionLinesRemoved = 0;
  const retained: string[] = [];

  for (const line of rawLines) {
    const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (INJECTION_PATTERN.test(line)) {
      promptInjectionLinesRemoved += line.length;
      continue;
    }
    const section = sectionName(line);
    if (section && !sectionsFound.includes(section)) sectionsFound.push(section);
    if (BOILERPLATE_PATTERN.test(line)) {
      boilerplateRemovedChars += line.length;
      continue;
    }
    if (seen.has(normalized) || normalized.length < 2) {
      boilerplateRemovedChars += line.length;
      continue;
    }
    seen.add(normalized);
    retained.push(line);
  }

  const blocks: string[][] = [];
  for (const line of retained) {
    if (sectionName(line)) blocks.push([line]);
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line);
    else blocks.push([line]);
  }
  const ordered = blocks.length > 0
    ? blocks.sort((left, right) => Number(priority(right[0])) - Number(priority(left[0]))).flat()
    : retained;
  let jdText = '';
  let truncated = false;
  for (const line of ordered) {
    const candidate = jdText ? `${jdText}\n${line}` : line;
    if (candidate.length > MAX_CHARS) {
      truncated = true;
      break;
    }
    jdText = candidate;
  }
  if (ordered.join('\n').length > jdText.length) truncated = true;

  const chars = jdText.length;
  const hasRoleLikeContent = ROLE_PATTERN.test(jdText) && !/^(?:log in|sign in|access denied|enable javascript|cookies required)/i.test(jdText);
  const status: JobInputQuality['status'] = chars < 400 || !hasRoleLikeContent
    ? 'poor'
    : chars <= 1_200 || !sectionsFound.some((section) => /responsibil|requirement|qualification|skill|what you|must|preferred/i.test(section))
      ? 'thin'
      : 'ok';
  return {
    company: text(jobRow.company_name).trim(),
    role: text(jobRow.role_offered).trim(),
    jdText,
    quality: {
      chars,
      sectionsFound,
      boilerplateRemovedChars,
      truncated,
      status,
      promptInjectionLinesRemoved,
      ...(status === 'thin' ? { warning: 'The job description is thin; technical signal may be incomplete.' } : {}),
    },
  };
}

export function requireUsableJobInput(input: PreparedJobInput): PreparedJobInput {
  if (input.quality.status === 'poor') throw new JdNeedsReviewError();
  return input;
}
