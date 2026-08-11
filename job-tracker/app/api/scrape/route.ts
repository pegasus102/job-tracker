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

    // 1. Fetch with headers to prevent basic bot-blocking
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await response.text();
    
    // 2. Advanced Cheerio Parsing
    const $ = cheerio.load(html);
    
    // Strip out garbage elements that confuse the AI
    $('script, style, noscript, nav, footer, header, iframe, svg, [role="navigation"], .cookie-banner').remove();
    
    // Attempt to target the main job container first, fall back to body if not found
    let pageText = '';
    const targetContainers = $('main, article, [class*="job-description"], [id*="job-description"], [data-automation-id="job-posting-details"]');
    
    if (targetContainers.length > 0) {
      pageText = targetContainers.text();
    } else {
      pageText = $('body').text();
    }

    // Clean up whitespace and limit to 15,000 chars to save tokens
    pageText = pageText.replace(/\s+/g, ' ').trim().substring(0, 15000);
    const pageTitle = $('title').text();

    // 3. Optimized ATS AI Prompt
    const prompt = `
      You are an expert Applicant Tracking System (ATS) data extractor.
      Analyze the following job posting text and extract the details into a strict JSON object. Do not use markdown blocks or formatting.
      
      Extraction Rules:
      - 'company_name': Find the hiring company. If unclear, look at the page title.
      - 'role_offered': Find the job title. It is usually at the top or in the title.
      - 'package': Look for salary, LPA, CTC, or pay range. Use 'N.D.' if not disclosed.
      - 'location': Look for city, country, or keywords like 'Remote', 'Hybrid'.
      - 'required_skills': Meticulously read sections titled "Qualifications", "Requirements", "What we're looking for", or "Experience". Extract specific technologies, tools, and hard skills as a comma-separated string (e.g., "Python, React, SQL"). Do not include soft skills like "communication".
      - 'deadline': Look for "apply by", "closing date", or "deadline". Format as YYYY-MM-DD. If none exists, return null.

      Return these exact keys ONLY:
      {
        "company_name": "String",
        "role_offered": "String",
        "package": "String",
        "location": "String",
        "required_skills": "String",
        "deadline": "YYYY-MM-DD or null"
      }
      
      Page Title: ${pageTitle}
      Job Text:
      ${pageText}
    `;

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      max_tokens: 1500,
      temperature: 0.1, // Low temperature forces the AI to be highly factual, not creative
      messages: [{ role: 'system', content: prompt }]
    });

    let aiResponse = completion.choices[0].message.content || '';
    aiResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jobData = JSON.parse(aiResponse);

    // 4. Hardcoded fields (Zero AI hallucination)
    jobData.apply_link = url;
    jobData.date_found = new Date().toISOString();

    // Date safety check
    if (!jobData.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(jobData.deadline)) {
      jobData.deadline = null;
    }

    // 5. Save to Database
    const { data, error } = await supabase
      .from('job_applications')
      .insert([jobData])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("Scraper Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}