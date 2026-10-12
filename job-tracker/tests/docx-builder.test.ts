import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType } from 'docx';
import { buildCvDocx, DEFAULT_LAYOUT } from '../lib/cv-v2/docx-builder';
import { loadCarlitoMetrics } from '../lib/cv-v2/fit-estimator';

const profile = { fixed_details: { full_name: 'Test User', email: 'test@example.com' } };
const cv = {
  experience: [{ role: 'Engineer', company: 'Example', duration: '2020-2022', bullets: ['Built a service'] }],
  projects: [{ title: 'Order API', tech_stack: 'TypeScript, PostgreSQL', bullets: ['Added indexed queries'] }],
  skills: [{ category: 'Languages', items: 'TypeScript' }],
};

async function legacyFixture(): Promise<Buffer> {
  const fixed = profile.fixed_details;
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: fixed.full_name.toUpperCase(), bold: true, size: 32, font: 'Calibri' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: fixed.email, size: 18, font: 'Calibri', color: '444444' })] }),
    new Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } }, children: [new TextRun({ text: 'EXPERIENCE', bold: true, size: 21, font: 'Calibri', color: '1a1a1a' })] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 11000 }], spacing: { after: 20 }, children: [new TextRun({ text: 'Engineer — Example', bold: true, size: 20, font: 'Calibri' }), new TextRun({ text: '\t2020-2022', size: 19, font: 'Calibri', color: '555555' })] }),
    new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: 'Built a service', size: 20, font: 'Calibri' })] }),
    new Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } }, children: [new TextRun({ text: 'PROJECTS', bold: true, size: 21, font: 'Calibri', color: '1a1a1a' })] }),
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: 'Order API', bold: true, size: 20, font: 'Calibri' }), new TextRun({ text: '  |  TypeScript, PostgreSQL', italics: true, size: 19, font: 'Calibri', color: '555555' })] }),
    new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: 'Added indexed queries', size: 20, font: 'Calibri' })] }),
    new Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } }, children: [new TextRun({ text: 'SKILLS', bold: true, size: 21, font: 'Calibri', color: '1a1a1a' })] }),
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Languages: ', bold: true, size: 20, font: 'Calibri' }), new TextRun({ text: 'TypeScript', size: 20, font: 'Calibri' })] }),
  ];
  return Packer.toBuffer(new Document({ sections: [{ properties: { page: { margin: DEFAULT_LAYOUT.margins } }, children }] }));
}

function documentXml(buffer: Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), 'cv-docx-'));
  const file = join(directory, 'doc.docx');
  writeFileSync(file, buffer);
  const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' });
  rmSync(directory, { recursive: true, force: true });
  return xml;
}

describe('DOCX builder', () => {
  it('preserves the legacy default word/document.xml', async () => {
    expect(documentXml(await buildCvDocx(profile, cv))).toBe(documentXml(await legacyFixture()));
  });

  it('measures bold Carlito wider than regular text', () => {
    const metrics = loadCarlitoMetrics();
    expect(metrics.widthOfStyledTextAtSize?.('Project title', 10, 'bold')).toBeGreaterThan(
      metrics.widthOfStyledTextAtSize?.('Project title', 10, 'regular') ?? 0,
    );
  });
});
