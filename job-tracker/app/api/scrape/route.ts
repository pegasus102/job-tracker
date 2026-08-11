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
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await response.text();
    
    const $ = cheerio.load(html);
    
    // 1. SECRET WEAPON: Extract hidden JSON-LD (Google Jobs SEO data) before we clean the page
    let hiddenSeoData = '';
    $('script[type="application/ld+json"]').each((_, el) => {
      hiddenSeoData += $(el).html() + '\n';
    });
    
    // 2. Fixed Cleaning: Removed 'header' so we don't accidentally delete the location text!
    $('script:not([type="application/ld+json"]), style, noscript, nav, footer, iframe, svg, [role="navigation"], .cookie-banner').remove();
    
    let pageText = '';
    const targetContainers = $('main, article, [class*="job-description"], [id*="job-description"], [data-automation-id="job-posting-details"]');
    
    if (targetContainers.length > 0) {
      pageText = targetContainers.text();
    } else {
      pageText = $('body').text();
    }

    pageText = pageText.replace(/\s+/g, ' ').trim().substring(0, 12000);
    const pageTitle = $('title').text();

    // 3. Combine the visible text with the hidden SEO data for the AI
    const finalContentForAi = `
      Page Title: ${pageTitle}
      Hidden SEO Data: ${hiddenSeoData.substring(0, 3000)}
      Job Text: ${pageText}
    `;

    const prompt = `
      You are an expert Applicant Tracking System (ATS) data extractor.
      Analyze the provided job posting text and hidden SEO data, then extract the details into a strict JSON object. Do not use markdown blocks.
      
      Extraction Rules:
      - 'company_name': Find the hiring company.
      - 'role_offered': Find the job title.
      - 'package': Look for salary, LPA, CTC, or pay range. Use 'N.D.' if not disclosed.
      - 'location': Scour the text and SEO data for cities, states, countries, or terms like 'Remote', 'Hybrid', 'On-site'. It is often right next to the role title.
      - 'required_skills': Meticulously read sections titled "Qualifications", "Requirements", or "Experience". Extract specific technologies, tools, and hard skills as a comma-separated string (e.g., "Python, React, SQL"). Ignore soft skills.
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
    `;

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: finalContentForAi }
      ]
    });

    let aiResponse = completion.choices[0].message.content || '';
    aiResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jobData = JSON.parse(aiResponse);

    // Hardcode reliable fields
    jobData.apply_link = url;
    jobData.date_found = new Date().toISOString();

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
    console.error("Scraper Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}