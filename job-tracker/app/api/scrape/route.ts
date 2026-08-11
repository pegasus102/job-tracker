import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Initialize the Google GenAI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    // 1. Fetch webpage raw HTML
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = await response.text();
    
    // 2. Extract plain text with Cheerio
    const $ = cheerio.load(html);
    const pageText = $('body').text().replace(/\s+/g, ' ').substring(0, 15000);

    // 3. Prompt for structuring the data
    const prompt = `
      Analyze the following job description text and extract these fields into a strict JSON object. Do not include markdown formatting like \`\`\`json.
      {
        "company_name": "String",
        "role_offered": "String",
        "package": "String (use 'N.D.' if not disclosed)",
        "location": "String",
        "required_skills": "String (comma separated)",
        "deadline": "YYYY-MM-DD format (or null if not found)",
        "apply_link": "String (the actual application link if mentioned, otherwise return '${url}')"
      }
      
      Job Description Text:
      ${pageText}
    `;

    // 4. Generate content using the official active gemini-3.6-flash model
    const aiResult = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
    });

    let rawText = aiResult.text || '';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const jobData = JSON.parse(rawText);

    // 5. Insert into Supabase
    const { data, error } = await supabase
      .from('job_applications')
      .insert([jobData])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("Scraping Error:", error);
    
    const isRateLimit = error?.status === 429 || 
                        error?.message?.includes('429') || 
                        error?.message?.toLowerCase().includes('quota');

    if (isRateLimit) {
      return NextResponse.json({ 
        success: false, 
        error: 'RATE_LIMIT_EXCEEDED' 
      }, { status: 429 });
    }

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}