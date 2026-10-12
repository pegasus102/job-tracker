import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType } from 'docx';

export type CvLayout = {
  font: string; pageWidthTwips: number; pageHeightTwips: number;
  margins: { top: number; bottom: number; left: number; right: number };
  fontSize: number; rightEdgeTwips: number; sectionBefore: number; sectionAfter: number; bulletAfter: number;
  headerAfter: number; contactAfter: number; titleAfter: number;
};

export const DEFAULT_LAYOUT: CvLayout = {
  font: 'Calibri', pageWidthTwips: 12240, pageHeightTwips: 15840,
  margins: { top: 500, bottom: 500, left: 620, right: 620 },
  fontSize: 10, rightEdgeTwips: 11000, sectionBefore: 200, sectionAfter: 80,
  bulletAfter: 40, headerAfter: 40, contactAfter: 120, titleAfter: 20,
};

const FONT = DEFAULT_LAYOUT.font;

// Page margins below are top/bottom 500, left/right 620 twips on a default
// Letter-size page (12240 twips wide) -> usable width = 12240 - 620*2 = 11000.
// This is the position dates right-align to, so every date lines up in a
// clean column regardless of how long the title text next to it is.
function sectionHeading(text: string, layout: CvLayout = DEFAULT_LAYOUT) {
  return new Paragraph({
    spacing: { before: layout.sectionBefore, after: layout.sectionAfter },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 21, font: FONT, color: '1a1a1a' })],
  });
}

function bullet(text: string, layout: CvLayout = DEFAULT_LAYOUT) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: layout.bulletAfter },
    children: [new TextRun({ text, size: layout.fontSize * 2, font: FONT })],
  });
}

// A title line with a date/duration that's right-aligned to the page edge via a
// real tab stop, instead of manually padding spaces (which never lines up once
// title lengths differ).
function titleWithRightDate(titleRuns: TextRun[], dateText: string, layout: CvLayout = DEFAULT_LAYOUT) {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: layout.rightEdgeTwips }],
    spacing: { after: 20 },
    children: [
      ...titleRuns,
      new TextRun({ text: `\t${dateText || ''}`, size: 19, font: FONT, color: '555555' }),
    ],
  });
}


export type CvProfile = Record<string, unknown>;
export type CvDocument = Record<string, unknown>;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

export async function buildCvDocx(profile: CvProfile, cv: CvDocument, layout: CvLayout = DEFAULT_LAYOUT): Promise<Buffer> {
  const fixed = record(profile.fixed_details);
  const children: Paragraph[] = [];
  // children are populated below: Paragraph[] = [];

  // --- Header: name (UPPERCASE) + contact line (FIXED, never touched by AI) ---
  children.push(
    new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: String(fixed.full_name || 'Your Name').toUpperCase(), bold: true, size: 32, font: FONT })],
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

  // --- Education (FIXED), dates right-aligned ---
  if (Array.isArray(fixed.education) && fixed.education.length > 0) {
    children.push(sectionHeading('Education'));
    for (const eduValue of fixed.education) { const edu = record(eduValue);
    children.push(
      titleWithRightDate(
      [new TextRun({ text: `${edu.degree}, ${edu.institution}`, bold: true, size: layout.fontSize * 2, font: FONT })],
      `${edu.start_date || ''} - ${edu.end_date || ''}`
      )
    );
    if (edu.cgpa) {
      const label = edu.score_type === 'Score' ? 'Score' : 'CGPA';
      const suffix = edu.score_type === 'Score' && !String(edu.cgpa).includes('%') ? '%' : '';
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${label}: ${edu.cgpa}${suffix}`, size: 19, font: FONT })] }));
    }
    }
  }

  // --- Experience (tailored bullets, real entries only), dates right-aligned ---
  if (Array.isArray(cv.experience) && cv.experience.length > 0) {
    children.push(sectionHeading('Experience'));
    for (const expValue of cv.experience) { const exp = record(expValue);
    children.push(
      titleWithRightDate(
      [new TextRun({ text: `${String(exp.role ?? '')} — ${String(exp.company ?? '')}`, bold: true, size: layout.fontSize * 2, font: FONT })],
      String(exp.duration || '')
      )
    );
    for (const b of (Array.isArray(exp.bullets) ? exp.bullets : [])) children.push(bullet(String(b)));
    }
  }

  // --- Projects (tailored bullets; target of 3: real vault matches, filled with the rest
  //   of your real vault projects if the AI skipped any, plus at most 1 AI-added filler
  //   only if your vault genuinely has fewer than 3 projects total) ---
  if (Array.isArray(cv.projects) && cv.projects.length > 0) {
    children.push(sectionHeading('Projects'));
    for (const projValue of cv.projects) { const proj = record(projValue);
    children.push(
      new Paragraph({
      spacing: { after: 20 },
      children: [
        new TextRun({ text: String(proj.title ?? ''), bold: true, size: layout.fontSize * 2, font: FONT }),
        proj.tech_stack ? new TextRun({ text: `  |  ${String(proj.tech_stack)}`, italics: true, size: 19, font: FONT, color: '555555' }) : new TextRun({ text: '' }),
      ],
      })
    );
    for (const b of (Array.isArray(proj.bullets) ? proj.bullets : [])) children.push(bullet(String(b)));
    }
  }

  // --- Skills (tailored) ---
  if (Array.isArray(cv.skills) && cv.skills.length > 0) {
    children.push(sectionHeading('Skills'));
    for (const catValue of cv.skills) { const cat = record(catValue);
    children.push(
      new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: `${String(cat.category ?? '')}: `, bold: true, size: layout.fontSize * 2, font: FONT }),
        new TextRun({ text: String(cat.items ?? ''), size: layout.fontSize * 2, font: FONT }),
      ],
      })
    );
    }
  }

  // --- Certifications: always the full vault list, its own section ---
  if (Array.isArray(cv.certifications) && cv.certifications.length > 0) {
    children.push(sectionHeading('Certifications'));
    for (const cert of cv.certifications) children.push(bullet(String(cert)));
  }

  // --- Extracurriculars: always the full vault list, its own section ---
  if (Array.isArray(cv.extracurriculars) && cv.extracurriculars.length > 0) {
    children.push(sectionHeading('Extracurriculars'));
    for (const ex of cv.extracurriculars) children.push(bullet(String(ex)));
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: layout.margins } }, children }] });
  return Packer.toBuffer(doc);
}
