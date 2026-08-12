import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FONT = 'Calibri';

function sectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: 21, font: FONT, color: '1a1a1a' }),
    ],
  });
}

function bullet(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: [new TextRun({ text, size: 20, font: FONT })],
  });
}

export async function POST(request: Request) {
  try {
    const { job_id } = await request.json();
    if (!job_id) {
      return NextResponse.json({ success: false, error: 'job_id is required' }, { status: 400 });
    }

    const [{ data: job, error: jobError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('job_applications').select('*').eq('id', job_id).single(),
      supabase.from('user_master_profile').select('*').limit(1).single(),
    ]);
    if (jobError || !job) throw jobError || new Error('Job not found');
    if (profileError || !profile) throw profileError || new Error('Master profile not found');
    if (!job.tailored_cv_json) {
      return NextResponse.json({ success: false, error: 'Generate the CV before exporting.' }, { status: 400 });
    }

    const fixed = profile.fixed_details || {};
    const cv = job.tailored_cv_json;

    const children: Paragraph[] = [];

    // --- Header: name + contact line (FIXED, never touched by AI) ---
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: fixed.full_name || 'Your Name', bold: true, size: 32, font: FONT })],
      })
    );
    const contactParts = [fixed.phone, fixed.email, fixed.linkedin, fixed.github, fixed.portfolio].filter(Boolean);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: contactParts.join('  |  '), size: 18, font: FONT, color: '444444' })],
      })
    );

    // --- Summary (AI-generated, grounded) ---
    if (cv.summary) {
      children.push(sectionHeading('Summary'));
      children.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: cv.summary, size: 20, font: FONT })] }));
    }

    // --- Education (FIXED) ---
    if (Array.isArray(fixed.education) && fixed.education.length > 0) {
      children.push(sectionHeading('Education'));
      for (const edu of fixed.education) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: `${edu.degree}, ${edu.institution}`, bold: true, size: 20, font: FONT }),
              new TextRun({ text: `   ${edu.start_date || ''} - ${edu.end_date || ''}`, size: 19, font: FONT, color: '555555' }),
            ],
          })
        );
        if (edu.cgpa) {
          children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `CGPA: ${edu.cgpa}`, size: 19, font: FONT })] }));
        }
      }
    }

    // --- Skills (tailored) ---
    if (Array.isArray(cv.skills) && cv.skills.length > 0) {
      children.push(sectionHeading('Skills'));
      for (const cat of cv.skills) {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `${cat.category}: `, bold: true, size: 20, font: FONT }),
              new TextRun({ text: cat.items, size: 20, font: FONT }),
            ],
          })
        );
      }
    }

    // --- Projects (tailored bullets, real projects only) ---
    if (Array.isArray(cv.projects) && cv.projects.length > 0) {
      children.push(sectionHeading('Projects'));
      for (const proj of cv.projects) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: proj.title, bold: true, size: 20, font: FONT }),
              proj.tech_stack ? new TextRun({ text: `  |  ${proj.tech_stack}`, italics: true, size: 19, font: FONT, color: '555555' }) : new TextRun({ text: '' }),
            ],
          })
        );
        for (const b of proj.bullets || []) children.push(bullet(b));
      }
    }

    // --- Experience (tailored bullets, real entries only) ---
    if (Array.isArray(cv.experience) && cv.experience.length > 0) {
      children.push(sectionHeading('Experience'));
      for (const exp of cv.experience) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: `${exp.role} — ${exp.company}`, bold: true, size: 20, font: FONT }),
              new TextRun({ text: `   ${exp.duration || ''}`, size: 19, font: FONT, color: '555555' }),
            ],
          })
        );
        for (const b of exp.bullets || []) children.push(bullet(b));
      }
    }

    // --- Certifications / Extracurriculars ---
    if (Array.isArray(cv.certifications) && cv.certifications.length > 0) {
      children.push(sectionHeading('Certifications & Extracurriculars'));
      for (const cert of cv.certifications) children.push(bullet(cert));
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: { margin: { top: 500, bottom: 500, left: 620, right: 620 } },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${(job.company_name || 'CV').replace(/[^a-z0-9]/gi, '_')}_${(fixed.full_name || 'Resume').replace(/[^a-z0-9]/gi, '_')}.docx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Export docx error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
