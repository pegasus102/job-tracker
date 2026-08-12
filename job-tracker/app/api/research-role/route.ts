import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TAVILY_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(query: string, maxResults = 4): Promise<TavilyResult[]> {
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'basic', // 'basic' = 1 credit/call, keeps us well inside the free 1000/mo tier
        max_results: maxResults,
        include_answer: false,
      }),
    });
    if (!res.ok) {
      console.error('Tavily error', await res.text());
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: (r.content || '').slice(0, 1200),
    }));
  } catch (err) {
    console.error('Tavily fetch failed', err);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { job_id } = await request.json();
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

    const company = job.company_name || '';
    const role = job.role_offered || '';

    // Three targeted queries covering the platforms the spec calls out.
    // Each is a 'basic' search = 1 Tavily credit. 3 queries per CV generation.
    const queries = [
      `${company} ${role} online assessment interview experience site:reddit.com`,
      `${company} ${role} interview questions shortlisting site:glassdoor.com`,
      `${company} ${role} online assessment topics site:leetcode.com OR site:geeksforgeeks.org`,
    ];

    const resultsPerQuery = await Promise.all(queries.map((q) => tavilySearch(q, 4)));
    const allResults = resultsPerQuery.flat();

    if (allResults.length === 0) {
      // No web signal found — still proceed, just note it. Don't fabricate insights.
      const fallback = {
        high_priority_skills: [],
        common_oa_topics: [],
        keyword_notes: 'No public discussion found for this specific role/company. Insights based on JD only.',
        sources: [],
      };
      await supabase
        .from('job_applications')
        .update({ research_insights: fallback, cv_status: 'Not Generated' })
        .eq('id', job_id);
      return NextResponse.json({ success: true, data: fallback });
    }

    const sourceBlock = allResults
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content}`)
      .join('\n\n');

    const systemPrompt = `
      You are analyzing real search-result excerpts (Reddit, Glassdoor, LeetCode/GeeksforGeeks) about a
      specific company and role's hiring process. Summarize ONLY what is actually supported by the excerpts
      below. Do not invent statistics or claims not present in the text. If the excerpts are thin or vague,
      say so plainly rather than filling gaps with generic assumptions.

      Return strict JSON only, no markdown fences, with these exact keys:
      {
        "high_priority_skills": ["skill1", "skill2", ...],   // tools/tech mentioned as important, max 8
        "common_oa_topics": ["topic1", "topic2", ...],       // recurring OA/interview topics, max 6
        "keyword_notes": "1-3 sentence summary of what ATS/recruiters seem to filter on for this role",
        "sources": [${allResults.map((_, i) => i + 1).join(', ')}]  // which numbered sources you actually used
      }
    `;

    const jdContext = `Job Title: ${role}\nCompany: ${company}\nJD excerpt: ${(job.job_description_raw || '').slice(0, 2000)}`;

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${jdContext}\n\n--- SEARCH EXCERPTS ---\n${sourceBlock}` },
      ],
    });

    let raw = completion.choices[0].message.content || '{}';
    raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const insights = JSON.parse(raw);

    // Attach real URLs so the audit UI can show genuine sources, not just AI claims
    insights.source_links = insights.sources
      ?.map((idx: number) => allResults[idx - 1])
      .filter(Boolean)
      .map((r: TavilyResult) => ({ title: r.title, url: r.url }));

    await supabase
      .from('job_applications')
      .update({ research_insights: insights, cv_status: 'Not Generated' })
      .eq('id', job_id);

    return NextResponse.json({ success: true, data: insights });
  } catch (error: any) {
    console.error('Research error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
