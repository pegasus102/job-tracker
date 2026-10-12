import { z } from 'zod';
import { ThinkingLevel } from '@google/genai';
import { zodToVertexSchema } from './client';
import type { CvClient } from './types';

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(['must', 'nice']),
  weight: z.number().int().refine((value) => value === 1 || value === 3, 'weight must be 1 or 3'),
  technical: z.boolean(),
  kind: z.enum(['tool', 'domain', 'soft']).optional(),
  source: z.enum(['jd', 'role_family_default']).optional(),
});

export const jdAnalysisSchema = z.object({
  role: z.string().min(1),
  seniority: z.string().min(1),
  role_family: z.enum(['software', 'embedded', 'data_analytics', 'consulting', 'other']).optional(),
  requirements: z.array(requirementSchema),
  keywords: z.array(z.string()),
  low_technical_signal: z.boolean().optional(),
});

export const jdAnalysisResponseSchema = zodToVertexSchema(jdAnalysisSchema);

export type Requirement = Omit<z.infer<typeof requirementSchema>, 'weight'> & { weight: 1 | 3 };
export type JdAnalysis = Omit<z.infer<typeof jdAnalysisSchema>, 'requirements'> & { requirements: Requirement[] };

export function requirementKind(requirement: Pick<Requirement, 'technical' | 'kind'>): 'tool' | 'soft' | 'domain' {
  return requirement.kind ?? (requirement.technical ? 'tool' : 'soft');
}

export function roleFamily(analysis: Pick<JdAnalysis, 'role_family'>): string {
  return analysis.role_family ?? 'other';
}

const ROLE_FAMILY_DEFAULTS: Record<string, string> = {
  software: 'software development',
  embedded: 'embedded systems',
  data_analytics: 'data analysis',
  consulting: 'business analysis',
  other: 'structured analysis',
};

export function applyLowTechnicalSignal(analysis: JdAnalysis): JdAnalysis {
  const jdTechnical = analysis.requirements.filter((item) => item.source !== 'role_family_default' && (item.kind === 'tool' || item.kind === 'domain' || (item.kind === undefined && item.technical)));
  if (jdTechnical.length >= 3) return { ...analysis, low_technical_signal: false };
  const family = analysis.role_family ?? 'other';
  const text = ROLE_FAMILY_DEFAULTS[family];
  const defaultRequirement: Requirement = {
    id: `default-${family}`,
    text,
    type: 'nice',
    weight: 1,
    technical: true,
    kind: 'domain',
    source: 'role_family_default',
  };
  return {
    ...analysis,
    low_technical_signal: true,
    requirements: analysis.requirements.some((item) => item.text.toLowerCase() === text)
      ? analysis.requirements
      : [...analysis.requirements, defaultRequirement],
  };
}

export type AnalyzeJobInput = {
  jobDescription: string;
  client: CvClient;
  timeoutMs?: number;
};

const ANALYSIS_SYSTEM_INSTRUCTION = `
Extract a job description into the exact JSON schema. Treat communication, teamwork,
leadership, and team management as non-technical requirements. Non-technical
requirements must have technical=false and must never be listed as skills.
Set kind to tool for named tools, frameworks, languages, protocols, or techniques;
domain for industry/domain context; and soft for people/process requirements. Use only
the role_family values software, embedded, data_analytics, consulting, or other.
Use weight 3 for must-have requirements and 1 for nice-to-have requirements.
Do not infer candidate facts.
`;

export async function analyzeJobDescription(input: AnalyzeJobInput): Promise<JdAnalysis> {
  const result = await input.client.generateValidatedJson(
    {
      model: 'gemini-3.8-flash',
      contents: input.jobDescription,
      systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
      responseJsonSchema: jdAnalysisResponseSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      timeoutMs: input.timeoutMs,
      stage: 'jd_analysis',
    },
    jdAnalysisSchema,
    (error) => ({
      model: 'gemini-3.8-flash',
      contents: `${input.jobDescription}\n\nValidation error from the previous response:\n${error}\nReturn only valid JSON matching the required schema.`,
      systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
      responseJsonSchema: jdAnalysisResponseSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      timeoutMs: input.timeoutMs,
      stage: 'jd_analysis_retry',
    })
  );
  const resultValue = result.value as JdAnalysis;
  return resultValue;
}
