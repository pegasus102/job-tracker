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

// Highest-stakes call in the whole app -> use the stronger model.
// Swap to 'google/gemini-2.5-flash' (or a free OpenRouter model) if you want
// to spend closer to ₹0/month; Pro is noticeably more literal/obedient to
// strict JSON + rules, which matters most for this specific call.
const MODEL = 'google/gemini-2.5-pro-exp-03-25:free';

function norm(s: string) {
  return (s || '').toLowerCase().trim();
}

export async function POST(request: Request) {
  try {
    const { job_id } = await request.json();
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
      verified skills/projects/experience/certifications/extracurriculars) and a target JOB DESCRIPTION, plus
      optional RESEARCH INSIGHTS from real online discussions about this role's hiring process. The candidate
      is a final-year Tier-3 college engineering student applying off-campus.

      Your job: select the most relevant subset of the vault and rephrase bullet points with strong action
      verbs and role-relevant keywords. You are rewriting PRESENTATION, not inventing FACTS — with one
      narrow, deliberate exception for projects, explained below.

      SECTION-BY-SECTION RULES:

      1. EXPERIENCE — selection only, NEVER invention.
         You may only choose from vault.experience using its exact "id" and reword its existing bullets.
         You may never create a new job, internship, or role that isn't in the vault.

      2. CERTIFICATIONS — selection only, NEVER invention.
         You may only choose exact strings already present in vault.certifications or vault.extracurriculars.
         Do not propose certifications the candidate should "get" — that would look fabricated and is
         easy for an interviewer to catch out. Leave this section as-is if nothing in the vault fits.

      3. SKILLS — selection, plus limited, clearly-flagged additions.
         Select relevant items from vault.skills. You may ADD up to 3 new skills not in the vault ONLY if
         they are clearly essential for this specific role per the JD or research insights. Every addition
         MUST appear in "ai_added_items" with a concrete justification.

      4. PROJECTS — selection first; ONE new project only as a last resort.
         First, select from vault.projects using exact "id"s and reword their existing bullets.
         Only if NO project in the vault reasonably demonstrates a skill/technology that is clearly essential
         for this role, you may propose AT MOST ONE new project under "added_projects". This is a narrow
         exception, not a default — most tailoring runs should add zero projects.

         If you do add one, it must pass ALL of these bars:
         - Genuinely technically substantive and specific: a real, describable implementation approach
           (e.g. "implemented a token-bucket rate limiter backed by Redis", "built a mini SQL query planner
           supporting joins and basic cost-based optimization", "wrote a toy TCP-based chat server handling
           concurrent connections with epoll"). Never generic or shallow (no to-do apps, no vague "worked
           with X" bullets, no buzzword soup with no implementation detail).
         - Plausible as something a motivated final-year STUDENT built independently or for a course/hackathon
           — not something that implies years of professional experience, a team, or production/enterprise
           deployment. It should make the candidate look capable and driven, never like a fresher falsely
           claiming senior-level experience — that reads as suspicious to an interviewer, not impressive.
         - No fabricated outcome metrics. Do not invent percentages, latency numbers, user counts, or revenue
           impact. Describe what was built and how it works, not a fabricated business outcome.
         - Must include a clear justification tied to the specific JD requirement or research insight it
           addresses, and MUST also be logged in "ai_added_items" with section "Projects".

      5. Never exaggerate scope, seniority, or impact beyond what an original bullet or added project
         actually supports.

      6. Output strict JSON ONLY. No markdown fences, no commentary.

      Required JSON shape:
      {
        "summary": "1-2 sentence professional summary grounded only in vault facts, or null",
        "selected_skills": [{"category": "string", "items": "comma, separated, list"}],
        "selected_projects": [{"id": "must match a vault.projects id exactly", "tailored_bullets": ["...", "..."]}],
        "added_projects": [{"title": "string", "tech_stack": "string", "bullets": ["...", "..."], "justification": "string"}],
        "selected_experience": [{"id": "must match a vault.experience id exactly", "tailored_bullets": ["...", "..."]}],
        "selected_certifications": ["exact strings from vault.certifications or vault.extracurriculars only"],
        "ai_added_items": [{"section": "Skills" | "Projects", "item": "string", "justification": "string"}]
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
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });

    let raw = completion.choices[0].message.content || '{}';

// Extract strictly what is between the first '{' and the last '}'
    const firstBracket = raw.indexOf('{');
    const lastBracket = raw.lastIndexOf('}');

    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      raw = raw.substring(firstBracket, lastBracket + 1);
    } else {
      raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    const aiResult = JSON.parse(raw);
    

    // ---------- CODE-LEVEL GUARDRAILS (do not trust the model alone) ----------

    // 1. Vault-matched projects: only ids that actually exist in the vault are kept.
    //    Ids are normalized (trimmed/lowercased) before comparing — LLMs occasionally echo
    //    an id back with stray whitespace or case changes, and we don't want that to silently
    //    drop a genuinely valid selection.
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

    // 3. Certifications: STRICT selection only. Anything not verbatim in the vault is dropped
    //    silently (never shown, never flagged as "added" — certifications are never invented).
    const vaultCertSet = new Set([
      ...vault.certifications.map((c: any) => norm(c.name)),
      ...vault.extracurriculars.map((c: any) => norm(c.title)),
    ]);
    const safeCertifications = (aiResult.selected_certifications || []).filter((cert: string) =>
      vaultCertSet.has(norm(cert))
    );

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
          const declared = declaredAdditions.get(norm(item));
          finalAddedItems.push({
            section: 'Skills',
            item,
            justification: (declared as any)?.justification || 'Added by AI as role-critical; not in your original vault — verify before submitting.',
          });
        }
      }
      return { category: cat.category, items: kept.join(', ') };
    });

    // 5. New projects: allow AT MOST ONE, and require actual substance (proxy check —
    //    the prompt carries the real quality bar, this just blocks empty/lazy output).
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

    const tailoredCv = {
      summary: aiResult.summary || null,
      skills: safeSkillCategories,
      projects: [...safeProjects, ...newProjects],
      experience: safeExperience,
      certifications: safeCertifications,
    };

    // Sanity check: if your vault actually has content but the tailored CV came back
    // completely empty, something went wrong (empty vault at generation time, id
    // mismatch, or malformed model output). Fail loudly instead of silently saving
    // an empty "Generated" CV that looks successful in the UI but downloads blank.
    const vaultHasContent =
      vault.skills.length > 0 || vault.projects.length > 0 ||
      vault.experience.length > 0 || vault.certifications.length > 0 ||
      vault.extracurriculars.length > 0;
    const cvHasContent =
      tailoredCv.skills.length > 0 || tailoredCv.projects.length > 0 ||
      tailoredCv.experience.length > 0 || tailoredCv.certifications.length > 0;

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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}