import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildCvDocx } from '../../../lib/cv-v2/docx-builder';
import { estimate, loadCarlitoMetrics } from '../../../lib/cv-v2/fit-estimator';
import { fitCv } from '../../../lib/cv-v2/fit-loop';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabase();
    const { job_id } = await request.json();
    if (!job_id) return NextResponse.json({ success: false, error: 'job_id is required' }, { status: 400 });
    const [{ data: job, error: jobError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('job_applications').select('*').eq('id', job_id).single(),
      supabase.from('user_master_profile').select('*').limit(1).single(),
    ]);
    if (jobError || !job) throw jobError || new Error('Job not found');
    if (profileError || !profile) throw profileError || new Error('Master profile not found');
    if (!job.tailored_cv_json) return NextResponse.json({ success: false, error: 'Generate the CV before exporting.' }, { status: 400 });
    let buffer: Buffer | Uint8Array;
    const cv = job.tailored_cv_json;
    if (process.env.ENABLE_CV_V2 === 'true') {
      const metrics = loadCarlitoMetrics();
      const estimateResult = estimate(cv, undefined, metrics);
      if (estimateResult.overflow) {
        const fitted = await fitCv(profile, cv, { metrics });
        buffer = fitted.buffer;
      } else {
        buffer = await buildCvDocx(profile, cv);
      }
    } else {
      buffer = await buildCvDocx(profile, cv);
    }
    const fixed = profile.fixed_details || {};
    const filename = `${(job.company_name || 'CV').replace(/[^a-z0-9]/gi, '_')}_${(fixed.full_name || 'Resume').replace(/[^a-z0-9]/gi, '_')}.docx`;
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }});
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Export failed';
    console.error('Export docx error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
