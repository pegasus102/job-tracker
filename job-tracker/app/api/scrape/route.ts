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
    const pageText = $('body').text().replace(/\s+/g, ' ').substring(0, 15000);

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash', // OpenRouter's stable Gemini routing string
      messages: [
        {
          role: 'system',
          content: 'Extract job details into a strict JSON object with keys: company_name, role_offered, package, location, required_skills, deadline, apply_link. Do not use markdown blocks.'
        },
        { role: 'user', content: pageText }
      ]
    });

    let aiResponse = completion.choices[0].message.content || '';
    aiResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jobData = JSON.parse(aiResponse);

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