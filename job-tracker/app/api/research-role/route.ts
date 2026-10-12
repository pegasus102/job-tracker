/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { geminiFlash } from '@/lib/vertex';
import { ThinkingLevel, type Tool } from '@google/genai';

type ResearchInsights = {
  confirmed_requirements: string[];
  recurring_skills: string[];
  stack_signals: string[];
  interview_signals: string[];
  emphasis: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  let job_id: string | undefined;
  try {
    ({ job_id } = await request.json());
    if (!job_id) {
      return NextResponse.json({ success: false, error: 'job_id is required' }, { status: 400 });
    }

    const { data: job, error: jobError } = await supabase
      .from('job_applications')
      .select('*')
      .eq('id', job_id)
      .single();
    if (jobError || !job) throw jobError || new Error('Job not found');

    await supabase.from('job_applications').update({ cv_status: 'Researching' }).eq('id', job_id);

    const researchPrompt = `
      Use Google Search grounding to gather evidence about this company and role. Use only evidence you
      can support, distinguish facts from recurring signals, and do not invent company-specific claims.
      Return concise plain-text research notes under these headings:
      What the role asks for
      Skills that recur
      Stack signals
      Assessment or interview signals
      Emphasis
      Keep each section concise and explicitly say when reliable evidence is unavailable.
      Company: ${job.company_name || ''}
      Role: ${job.role_offered || ''}
      Job description:
      ${(job.job_description_raw || '').slice(0, 8000)}
    `;

    const researchResponse = await generateGroundedResearch(researchPrompt);

    const raw = researchResponse.text?.trim();
    if (!raw) {
      const blockReason = researchResponse.promptFeedback?.blockReason;
      const finishReason = researchResponse.candidates?.[0]?.finishReason;
      const detail = blockReason
        ? `prompt blocked (${blockReason})`
        : finishReason
          ? `generation finished without text (${finishReason})`
          : 'the model returned no candidates or text';
      console.error('Vertex research returned no text', {
        responseId: researchResponse.responseId,
        candidateCount: researchResponse.candidates?.length ?? 0,
        finishReason,
        finishMessage: researchResponse.candidates?.[0]?.finishMessage,
        blockReason,
        blockReasonMessage: researchResponse.promptFeedback?.blockReasonMessage,
        usageMetadata: researchResponse.usageMetadata
          ? {
              promptTokenCount: researchResponse.usageMetadata.promptTokenCount,
              candidatesTokenCount: researchResponse.usageMetadata.candidatesTokenCount,
              totalTokenCount: researchResponse.usageMetadata.totalTokenCount,
            }
          : undefined,
      });
      throw new Error(`Vertex AI returned no research text: ${detail}. Retry the research step.`);
    }

    const formatResponse = await geminiFlash.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `
            Convert the evidence-backed research notes below into strict JSON only. Do not add facts
            that are not present in the notes. Use exactly this shape:
            {
              "confirmed_requirements": ["specific requirements"],
              "recurring_skills": ["recurring skills"],
              "stack_signals": ["technology stack signals"],
              "interview_signals": ["supported interview signals"],
              "emphasis": "a concise summary"
            }
            Use [] when a list has no supported evidence.

            Research notes:
            ${raw}
          `,
        }],
      }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });

    const formattedRaw = formatResponse.text?.trim();
    if (!formattedRaw) {
      throw new Error('Vertex AI returned research notes but could not format them as JSON. Retry the research step.');
    }

    const insights = parseResearchInsights(formattedRaw);

    await supabase
      .from('job_applications')
      .update({ research_insights: insights, cv_status: 'Not Generated' })
      .eq('id', job_id);

    return NextResponse.json({ success: true, data: insights });
  } catch (error: any) {
    if (job_id) {
      await supabase.from('job_applications').update({ cv_status: 'Failed' }).eq('id', job_id);
    }

    console.error('Research error:', {
      message: error?.message || String(error),
      status: error?.status ?? error?.code,
      details: Array.isArray(error?.details)
        ? error.details.map((detail: any) => ({
            type: detail?.type,
            reason: detail?.reason,
            domain: detail?.domain,
            metadataKeys: detail?.metadata ? Object.keys(detail.metadata) : undefined,
          }))
        : undefined,
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function generateGroundedResearch(prompt: string) {
  let response: Awaited<ReturnType<typeof geminiFlash.generateContent>> | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await geminiFlash.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
      tools: [{ googleSearch: {} } satisfies Tool],
    });

    if (response.text?.trim()) return response;

    const finishReason = response.candidates?.[0]?.finishReason;
    if (attempt < 2 && finishReason === 'MALFORMED_FUNCTION_CALL') {
      console.warn('Retrying grounded research after a malformed model tool call');
      continue;
    }
  }

  if (!response) {
    throw new Error('Vertex AI did not return a grounded research response.');
  }

  return response;
}

function parseResearchInsights(raw: string): ResearchInsights {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Vertex AI returned research that was not valid JSON. Retry the research step.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Vertex AI returned an invalid research object. Retry the research step.');
  }

  const value = parsed as Record<string, unknown>;
  const stringArray = (field: keyof ResearchInsights): string[] => {
    const candidate = value[field];
    if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === 'string')) {
      throw new Error(`Vertex AI returned an invalid research field: ${field}. Retry the research step.`);
    }
    return candidate;
  };

  return {
    confirmed_requirements: stringArray('confirmed_requirements'),
    recurring_skills: stringArray('recurring_skills'),
    stack_signals: stringArray('stack_signals'),
    interview_signals: stringArray('interview_signals'),
    emphasis: typeof value.emphasis === 'string'
      ? value.emphasis
      : (() => {
          throw new Error('Vertex AI returned an invalid research emphasis. Retry the research step.');
        })(),
  };
}
