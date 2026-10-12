import type { SupabaseClient } from '@supabase/supabase-js';
import { ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { zodToVertexSchema } from './client';
import type { JdAnalysis } from './analyze';
import type { CvClient } from './types';

export const researchStructuredSchema = z.object({
  sources: z.array(z.object({
    title: z.string(),
    domain: z.string(),
    url: z.string().url(),
  })),
  stack_signals: z.array(z.string()),
  emphasis: z.array(z.string()),
  company_evidence_found: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  weight_adjustments: z.array(z.object({
    requirement_id: z.string().min(1),
    adjustment: z.literal(1),
  })),
});

export const researchStructuredResponseSchema = zodToVertexSchema(researchStructuredSchema);

export type ResearchStructured = z.infer<typeof researchStructuredSchema>;

export type ResearchResult = {
  notes: string;
  structured: ResearchStructured;
  sourceUrls: string[];
  fromCache: boolean;
};

export type ResearchInput = {
  company: string;
  role: string;
  jobDescription: string;
  analysis: JdAnalysis;
  client: CvClient;
  cache?: SupabaseClient;
  timeoutMs?: number;
};

const CACHE_DAYS = 30;

function roleFamily(role: string): string {
  return role.toLocaleLowerCase().replace(/\b(junior|senior|lead|staff|intern|engineer|developer)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cacheKey(input: ResearchInput): { companyName: string; roleFamily: string } {
  return { companyName: input.company.trim().toLocaleLowerCase(), roleFamily: roleFamily(input.role) };
}

async function readCache(input: ResearchInput): Promise<ResearchResult | undefined> {
  if (!input.cache) return undefined;
  try {
    const key = cacheKey(input);
    const { data, error } = await input.cache
      .from('cv_research_cache')
      .select('research_json, expires_at')
      .eq('company_name', key.companyName)
      .eq('role_family', key.roleFamily)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return undefined;
    const cached = researchStructuredSchema.safeParse(data.research_json);
    if (!cached.success) return undefined;
    return {
      notes: '',
      structured: cached.data,
      sourceUrls: cached.data.sources.map((source) => source.url),
      fromCache: true,
    };
  } catch {
    return undefined;
  }
}

async function writeCache(input: ResearchInput, structured: ResearchStructured): Promise<void> {
  if (!input.cache) return;
  const key = cacheKey(input);
  const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await input.cache.from('cv_research_cache').upsert({
    company_name: key.companyName,
    role_family: key.roleFamily,
    research_json: structured,
    expires_at: expiresAt,
  }, { onConflict: 'company_name,role_family' });
}

function filterAdjustments(structured: ResearchStructured, analysis: JdAnalysis): ResearchStructured {
  const validIds = new Set(analysis.requirements.map((requirement) => requirement.id));
  return {
    ...structured,
    weight_adjustments: structured.company_evidence_found && structured.confidence !== 'low'
      ? structured.weight_adjustments.filter((item) => validIds.has(item.requirement_id))
      : [],
  };
}

function groundedSources(metadata: unknown): ResearchStructured['sources'] {
  if (!metadata || typeof metadata !== 'object') return [];
  const groundingChunks = (metadata as { groundingChunks?: unknown }).groundingChunks;
  if (!Array.isArray(groundingChunks)) return [];
  return groundingChunks.flatMap((chunk) => {
    if (!chunk || typeof chunk !== 'object') return [];
    const web = (chunk as { web?: unknown }).web;
    if (!web || typeof web !== 'object') return [];
    const value = web as { title?: unknown; uri?: unknown };
    if (typeof value.uri !== 'string' || !/^https?:\/\//.test(value.uri)) return [];
    try {
      return [{
        title: typeof value.title === 'string' ? value.title : '',
        domain: new URL(value.uri).hostname,
        url: value.uri,
      }];
    } catch {
      return [];
    }
  });
}

export async function researchJob(input: ResearchInput): Promise<ResearchResult> {
  const cached = await readCache(input);
  if (cached) return cached;

  const grounded = await input.client.generate({
    model: 'gemini-3.8-flash',
    contents: `Research this company and role using reliable public sources. Do not discuss or infer anything about the candidate.\nCompany: ${input.company}\nRole: ${input.role}\nJob description:\n${input.jobDescription}`,
    tools: [{ googleSearch: {} }],
    timeoutMs: input.timeoutMs,
    stage: 'grounded_research',
  });

  const structuredResult = await input.client.generateValidatedJson(
    {
      model: 'gemini-3.8-flash',
      contents: `Convert these research notes into the required JSON. Only include role/company signals, never candidate facts or candidate skills. Only suggest weight adjustments backed by company- or role-specific evidence in the research notes, never from generic knowledge about the job title. ${input.analysis.low_technical_signal ? 'Because this is a low-signal JD, identify typical tools and deliverables for this role at this company; they remain research context and must not become candidate skills without vault evidence.' : ''}\n\nResearch notes:\n${grounded.text}\n\nRequirements:\n${JSON.stringify(input.analysis.requirements)}`,
      responseJsonSchema: researchStructuredResponseSchema,
      timeoutMs: input.timeoutMs,
      stage: 'structured_research',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
    researchStructuredSchema,
    (error) => ({
      model: 'gemini-3.8-flash',
      contents: `Return only valid JSON for the research schema. Validation error: ${error}\nOnly suggest weight adjustments backed by company- or role-specific evidence in the research notes, never from generic knowledge about the job title.\nResearch notes:\n${grounded.text}`,
      responseJsonSchema: researchStructuredResponseSchema,
      timeoutMs: input.timeoutMs,
      stage: 'structured_research_retry',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    })
  );

  const structured = filterAdjustments({
    ...structuredResult.value,
    sources: [...groundedSources(grounded.groundingMetadata?.metadata ?? grounded.groundingMetadata), ...structuredResult.value.sources],
  }, input.analysis);
  await writeCache(input, structured).catch(() => undefined);
  return {
    notes: grounded.text,
    structured,
    sourceUrls: [...new Set([
      ...(grounded.groundingMetadata?.sourceUrls ?? []),
      ...structured.sources.map((source) => source.url),
    ])],
    fromCache: false,
  };
}
