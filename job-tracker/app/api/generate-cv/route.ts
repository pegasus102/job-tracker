import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { jsonrepair } from 'jsonrepair';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Highest-stakes call in the whole app. Free OpenRouter models rotate/degrade without notice
// and are less reliable at obeying the strict caps below (e.g. "at most 3 projects, at most 1
// addition") — that's exactly why every cap here is ALSO enforced in code below, not just in
// the prompt. If you see the 3-project or 1-addition rule get violated, it's the model ignoring
// instructions; the code will still clip it back down, so the output stays correct either way.
const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

function norm(s: string) {
  return (s || '').toLowerCase().trim();
}

export async function POST(request: Request) {
  let job_id: string | undefined;
  try {
    ({ job_id } = await request.json());
    if (!job_id) {
      return NextResponse.json({ success: false, error: 'job_id is required' }, { status: 400 });
    }

    await supabase.from('job_applications').update({ cv_status: 'Generating' }).eq('id', job_id);

    const [{ data: job, error: jobError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('job_applications').select('*').eq('id', job_id).single(),
      supabase.from('user_master_profile').select('*').limit(1).single(),
    ]);
    if (jobError || !job) throw jobError || new Error('Job not found');
    if (profileError || !profile) throw profileError || new Error('Master profile not set up yet');

    const vault = {
      skills: profile.master_skills || [],
      projects: profile.master_projects || [],
      experience: profile.master_experience || [],
      certifications: profile.master_certifications || [],
      extracurriculars: profile.master_extracurriculars || [],
    };

    if (vault.projects.length === 0 && vault.skills.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Master Profile is empty. Fill it in before generating a CV.' },
        { status: 400 }
      );
    }

    const systemPrompt = `
      You are an ATS resume tailoring assistant. You will be given a candidate's MASTER VAULT (their real,
      verified skills/projects/experience) and a target JOB DESCRIPTION, plus optional RESEARCH INSIGHTS
      from real online discussions about this role's hiring process. The candidate is a final-year Tier-3
      college engineering student applying off-campus. Their Certifications and Extracurriculars are handled
      separately outside this step (all of them are always included as-is) — do not worry about that section.

      Your job: select the most relevant subset of the vault and rephrase bullet points with strong action
      verbs and role-relevant keywords. You are rewriting PRESENTATION, not inventing FACTS — with one
      narrow, deliberate exception for projects, explained below.

      SECTION-BY-SECTION RULES:

      1. EXPERIENCE — selection only, NEVER invention.
         You may only choose from vault.experience using its exact "id" and reword its existing bullets.
         You may never create a new job, internship, or role that isn't in the vault.

      2. SKILLS — selection, plus limited, clearly-flagged additions.
         Select relevant items from vault.skills. You may ADD up to 3 new skills not in the vault ONLY if
         they are clearly essential for this specific role per the JD or research insights, and would
         meaningfully improve the candidate's shortlisting chances. Do not add skills just to look thorough
         — only add what's actually necessary. Every addition MUST appear in "ai_added_items" with a
         concrete justification.

      3. PROJECTS — the final Projects section must contain EXACTLY 3 projects (or fewer only if the vault
         genuinely has fewer than 3 projects total).
         Step 1: Rank vault.projects by genuine relevance to this specific role, using the JD and research
         insights (what recruiters/OA screens for this role tend to prioritize) as your judgment criteria.
         Select up to 3 of the most relevant, using exact "id"s, and reword their bullets.
         Step 2: Only if fewer than 3 vault projects are genuinely relevant to this role (e.g. the vault has
         3+ projects but only 1-2 actually fit, or the vault simply has fewer than 3 projects and a gap
         remains), you may add AT MOST ONE new project under "added_projects" to fill the gap.
         If 3 or more vault projects are already genuinely relevant, add ZERO new projects.

         If you do add one, calibrate the complexity carefully — this is the part that most often goes wrong:
         - NOT too advanced/showy: avoid anything that would make an interviewer suspicious a fresher
           actually built it alone (no distributed systems claims, no "built a production-grade X serving
           Y requests/sec", no invented infra scale).
         - NOT too basic/filler: avoid anything so simple it wouldn't help candidacy at all (no plain to-do
           apps, no copy-paste tutorial projects, no vague "learned X" bullets).
         - The right zone: a practical, specific, attention-grabbing project a motivated final-year student
           plausibly built independently or for a hackathon/course — concrete implementation detail, real
           technical decisions, but scoped appropriately for a fresher's experience level.
         - No fabricated outcome metrics. Do not invent percentages, latency numbers, user counts, or
           revenue impact. Describe what was built and how, not a fabricated business outcome.
         - MUST include a justification tied to the specific JD requirement or research insight it addresses,
           and MUST also be logged in "ai_added_items" with section "Projects".

      4. Never exaggerate scope, seniority, or impact beyond what an original bullet or added project
         actually supports.

      5. Output strict JSON ONLY. No markdown fences, no commentary.

      Required JSON shape:
      {
        "selected_skills": [{"category": "Languages", "items": "Python, JavaScript, C++"}],
        "selected_projects": [{"id": "must match a vault.projects id exactly", "tailored_bullets": ["First tailored bullet point goes here.", "Second tailored bullet point goes here."]}],
        "added_projects": [{"title": "Example Project Name", "tech_stack": "React, Node.js", "bullets": ["First project detail goes here.", "Second project detail goes here."], "justification": "Why this was added"}],
        "selected_experience": [{"id": "must match a vault.experience id exactly", "tailored_bullets": ["First experience bullet goes here.", "Second experience bullet goes here."]}],
        "ai_added_items": [{"section": "Skills" | "Projects", "item": "Docker", "justification": "Required by job description"}]
      }
    `;

    const userPayload = {
      job_description: (job.job_description_raw || '').slice(0, 6000),
      role_offered: job.role_offered,
      company_name: job.company_name,
      required_skills_extracted: job.required_skills,
      research_insights: job.research_insights || null,
      master_vault: vault,
    };

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 3000,
      temperature: 0.1,
      // 👇 forces the model to output only raw valid JSON
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt + ' You must output your final response as a valid JSON object.' },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });

    let raw = completion.choices[0].message.content || '{}';

    // Strip markdown fences
    raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

    // Discard any extra conversational text the model appends before/after the JSON
    const firstBracket = raw.indexOf('{');
    const lastBracket = raw.lastIndexOf('}');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      raw = raw.substring(firstBracket, lastBracket + 1);
    }

    const aiResult = safeParseAiJson(raw);

    // ---------- CODE-LEVEL GUARDRAILS (do not trust the model alone) ----------

    // 1. Vault-matched projects: only ids that actually exist in the vault are kept.
    //    Ids are normalized (trimmed/lowercased) before comparing.
    const projectMap = new Map(vault.projects.map((p: any) => [norm(p.id), p]));
    const experienceMap = new Map(vault.experience.map((e: any) => [norm(e.id), e]));

    const safeProjects = (aiResult.selected_projects || [])
      .filter((p: any) => projectMap.has(norm(p.id)))
      .map((p: any) => {
        const original: any = projectMap.get(norm(p.id));
        return {
          id: p.id,
          title: original.title,
          tech_stack: original.tech_stack,
          bullets: Array.isArray(p.tailored_bullets) && p.tailored_bullets.length > 0
            ? p.tailored_bullets
            : original.bullets,
          is_ai_added: false,
        };
      });

    // 2. Vault-matched experience: only ids that actually exist. No inventions possible here,
    //    by construction — there is no "added_experience" field in the schema at all.
    const safeExperience = (aiResult.selected_experience || [])
      .filter((e: any) => experienceMap.has(norm(e.id)))
      .map((e: any) => {
        const original: any = experienceMap.get(norm(e.id));
        return {
          id: e.id,
          role: original.role,
          company: original.company,
          duration: original.duration,
          bullets: Array.isArray(e.tailored_bullets) && e.tailored_bullets.length > 0
            ? e.tailored_bullets
            : original.bullets,
        };
      });

    // 3. Certifications & Extracurriculars: NEVER passed through the AI at all — every entry
    //    in your vault is included as-is, every time. Nothing to filter, nothing to lose.
    const finalCertifications = [
      ...vault.certifications.map((c: any) => (c.issuer ? `${c.name} — ${c.issuer}` : c.name)).filter(Boolean),
      ...vault.extracurriculars.map((ex: any) => (ex.detail ? `${ex.title} — ${ex.detail}` : ex.title)).filter(Boolean),
    ];

    // 4. Skills: model may add up to 3 items not in the vault; anything unmatched gets
    //    force-logged as an added item even if the model forgot to log it itself.
    const vaultSkillSet = new Set(
      vault.skills.flatMap((s: any) => (s.items || '').split(',').map((x: string) => norm(x)))
    );
    const declaredAdditions = new Map(
      (aiResult.ai_added_items || []).map((a: any) => [norm(a.item), a])
    );

    const finalAddedItems: any[] = [];
    const safeSkillCategories = (aiResult.selected_skills || []).map((cat: any) => {
      const items: string[] = (cat.items || '').split(',').map((x: string) => x.trim()).filter(Boolean);
      const kept: string[] = [];
      for (const item of items) {
        kept.push(item);
        if (!vaultSkillSet.has(norm(item))) {
          const declared = declaredAdditions.get(norm(item)) as { justification?: string } | undefined;
          finalAddedItems.push({
            section: 'Skills',
            item,
            justification: declared?.justification || 'Added by AI as role-critical; not in your original vault — verify before submitting.',
          });
        }
      }
      return { category: cat.category, items: kept.join(', ') };
    });

    // 5. New projects: allow AT MOST ONE, and require actual substance (proxy check — the
    //    prompt carries the real quality/complexity bar, this just blocks empty/lazy output).
    const addedProjectsRaw = Array.isArray(aiResult.added_projects) ? aiResult.added_projects.slice(0, 1) : [];
    const newProjects = addedProjectsRaw
      .filter((p: any) => p?.title && Array.isArray(p.bullets) && p.bullets.filter((b: string) => (b || '').length > 25).length >= 2)
      .map((p: any, i: number) => {
        finalAddedItems.push({
          section: 'Projects',
          item: p.title,
          justification: p.justification || 'Added by AI — not in your original vault. Only submit this if you can genuinely speak to it in an interview.',
        });
        return {
          id: `ai-project-${i}`,
          title: p.title,
          tech_stack: p.tech_stack || '',
          bullets: p.bullets,
          is_ai_added: true,
        };
      });

    // 6. Hard cap: final Projects section is exactly 3 max, with the added project (if any)
    //    always preserved rather than accidentally dropped by a naive slice.
    const maxSelectedSlots = Math.max(3 - newProjects.length, 0);
    const trimmedSelectedProjects = safeProjects.slice(0, maxSelectedSlots);
    const finalProjects = [...trimmedSelectedProjects, ...newProjects].slice(0, 3);

    const tailoredCv = {
      skills: safeSkillCategories,
      projects: finalProjects,
      experience: safeExperience,
      certifications: finalCertifications,
    };

    // Sanity check: if your vault actually has content but the tailored CV came back
    // completely empty on the AI-driven sections, something went wrong. Fail loudly instead
    // of silently saving an empty "Generated" CV that looks successful but downloads blank.
    const vaultHasContent = vault.skills.length > 0 || vault.projects.length > 0 || vault.experience.length > 0;
    const cvHasContent = tailoredCv.skills.length > 0 || tailoredCv.projects.length > 0 || tailoredCv.experience.length > 0;

    if (vaultHasContent && !cvHasContent) {
      await supabase.from('job_applications').update({ cv_status: 'Failed' }).eq('id', job_id);
      return NextResponse.json(
        {
          success: false,
          error: 'The AI returned no usable content even though your Master Profile has entries. ' +
                 'Double-check your Master Profile was saved (reopen it and confirm your data is still there), then hit Retry.',
        },
        { status: 500 }
      );
    }

    await supabase
      .from('job_applications')
      .update({
        tailored_cv_json: tailoredCv,
        ai_added_items: finalAddedItems,
        cv_status: 'Generated',
      })
      .eq('id', job_id);

    return NextResponse.json({ success: true, data: { tailored_cv: tailoredCv, ai_added_items: finalAddedItems } });
  } catch (error: any) {
    console.error('Generate CV error:', error.message);
    if (job_id) {
      await supabase.from('job_applications').update({ cv_status: 'Failed' }).eq('id', job_id).then(
        () => {},
        () => {} // best-effort only — don't let a status-reset failure mask the real error
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// The model sometimes returns near-valid JSON (an unescaped character inside a bullet,
// a stray trailing comma, etc.) despite response_format: json_object — that mode isn't
// strictly enforced by every provider on OpenRouter's free tier. Try a straight parse
// first, then fall back to jsonrepair before giving up with a clear, retry-able error.
function safeParseAiJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch (firstError) {
    try {
      return JSON.parse(jsonrepair(raw));
    } catch (secondError) {
      console.error('Raw AI output that failed to parse (even after repair):', raw.slice(0, 2000));
      throw new Error(
        'The AI returned malformed JSON (this happens occasionally with free models). Just hit Retry — it usually succeeds on the next attempt.'
      );
    }
  }
}