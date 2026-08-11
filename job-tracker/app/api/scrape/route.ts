import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
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

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = await response.text();
    
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    const pageText = $('body').text().replace(/\s+/g, ' ').substring(0, 15000);

    // AI PROMPT: We no longer ask the AI for the apply_link or date.
    const prompt = `
      Extract job details into a strict JSON object. Do not use markdown blocks.
      Meticulously read sections titled "Qualifications" or "Requirements" to find technical skills.
      
      Return these exact keys ONLY:
      {
        "company_name": "String",
        "role_offered": "String",
        "package": "String (use 'N.D.' if not disclosed)",
        "location": "String",
        "required_skills": "String (comma separated)",
        "deadline": "YYYY-MM-DD format (or null)"
      }
      
      Page Text:
      ${pageText}
    `;

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      max_tokens: 1500,
      messages: [{ role: 'system', content: prompt }]
    });

    let aiResponse = completion.choices[0].message.content || '';
    aiResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jobData = JSON.parse(aiResponse);

    // --- THE MAGIC FIX ---
    // We completely bypass the AI and hardcode the exact URL you submitted
    jobData.apply_link = url;
    jobData.date_found = new Date().toISOString();

    // Date safety check
    if (!jobData.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(jobData.deadline)) {
      jobData.deadline = null;
    }

    const { data, error } = await supabase
      .from('job_applications')
      .insert([jobData])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}