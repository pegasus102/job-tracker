import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Single-user tool: there is always exactly one row in user_master_profile.
// GET returns it (creating an empty one if somehow missing).
// POST upserts it wholesale.

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('user_master_profile')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const { data: created, error: insertError } = await supabase
        .from('user_master_profile')
        .insert([{ fixed_details: {} }])
        .select()
        .single();
      if (insertError) throw insertError;
      return NextResponse.json({ success: true, data: created });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Master profile GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      fixed_details,
      master_skills,
      master_projects,
      master_experience,
      master_certifications,
      master_extracurriculars,
    } = body;

    // Get the existing single row's id (or create one if missing)
    const { data: existing, error: fetchError } = await supabase
      .from('user_master_profile')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (fetchError) throw fetchError;

    const payload = {
      fixed_details: fixed_details ?? {},
      master_skills: master_skills ?? [],
      master_projects: master_projects ?? [],
      master_experience: master_experience ?? [],
      master_certifications: master_certifications ?? [],
      master_extracurriculars: master_extracurriculars ?? [],
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existing?.id) {
      const { data, error } = await supabase
        .from('user_master_profile')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('user_master_profile')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Master profile POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
