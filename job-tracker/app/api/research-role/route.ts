import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { geminiFlash } from '@/lib/vertex';
import type { Tool } from '@google/genai';

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

    const prompt = `
      Research the company and role using Google Search grounding. Use only evidence you can support,
      distinguish confirmed facts from recurring signals, and do not invent company-specific claims.
      Return strict JSON only with exactly these keys:
      {
        "confirmed_requirements": ["specific requirements confirmed by the job description or sources"],
        "recurring_skills": ["skills repeatedly associated with this company and role"],
        "stack_signals": ["technology stack signals from the job or reliable sources"],
        "interview_signals": ["assessment or interview patterns supported by sources"],
        "emphasis": "a concise summary of what the candidate should emphasize"
      }
      Use arrays for all list fields. Keep each list concise and use [] when evidence is unavailable.

      Company: ${job.company_name || ''}
      Role: ${job.role_offered || ''}
      Job description:
      ${(job.job_description_raw || '').slice(0, 8000)}
    `;

    const response = await geminiFlash.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1600,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
      tools: [{ googleSearch: {} } satisfies Tool],
    });

    const raw = response.text?.trim();
    if (!raw) {
      const blockReason = response.promptFeedback?.blockReason;
      const finishReason = response.candidates?.[0]?.finishReason;
      const detail = blockReason
        ? `prompt blocked (${blockReason})`
        : finishReason
          ? `generation finished without text (${finishReason})`
          : 'the model returned no candidates or text';
      throw new Error(`Vertex AI returned no research text: ${detail}. Retry the research step.`);
    }

    const insights = parseResearchInsights(raw);

    await supabase
      .from('job_applications')
      .update({ research_insights: insights, cv_status: 'Not Generated' })
      .eq('id', job_id);

    return NextResponse.json({ success: true, data: insights });
  } catch (error: any) {
    if (job_id) {
      await supabase.from('job_applications').update({ cv_status: 'Failed' }).eq('id', job_id);
    }

    console.error('Research error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
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
