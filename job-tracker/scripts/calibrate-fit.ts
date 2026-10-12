import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCvDocx } from '../lib/cv-v2/docx-builder';
import { estimate, loadCarlitoMetrics, SAFETY_MARGIN_LINES } from '../lib/cv-v2/fit-estimator';
import { fitCv } from '../lib/cv-v2/fit-loop';

const exec = promisify(execFile);

type Fixture = { name: string; cv: Record<string, unknown> };

function fixture(index: number, multiplier: number): Fixture {
  return {
    name: `boundary-${index.toString().padStart(2, '0')}`,
    cv: {
      experience: Array.from({ length: index % 3 + 1 }, (_, entry) => ({
        role: `Senior Engineer with a long bold title ${index}-${entry}`,
        company: 'Example Company',
        duration: '2020-2024',
        bullets: Array.from({ length: index % 3 + 2 }, (_, bullet) =>
          `Built feature ${index}-${entry}-${bullet} with TypeScript, PostgreSQL, Redis and measurable reliability improvements. `.repeat(multiplier),
        ),
      })),
      projects: Array.from({ length: index % 2 + 1 }, (_, project) => ({
        title: `Project ${index}-${project} with a deliberately long title for boundary calibration`,
        tech_stack: 'TypeScript, PostgreSQL, Redis, Docker',
        bullets: Array.from({ length: index % 3 + 2 }, (_, bullet) =>
          `Implemented project capability ${project}-${bullet} with verified tools and concrete operational outcomes. `.repeat(multiplier),
        ),
      })),
      skills: [{ category: 'Tools & Platforms', items: 'TypeScript, PostgreSQL, Redis, Docker, REST APIs, Kubernetes, Linux' }],
      certifications: ['Long education and certification detail '.repeat(Math.max(1, multiplier))],
    },
  };
}

const fixtures: Fixture[] = Array.from({ length: 30 }, (_, index) => fixture(index + 1, 1 + (index % 3)));

async function pdfStats(pdfPath: string): Promise<{ pages: number; lines: number; lastPageLines: number }> {
  const { stdout } = await exec('pdftotext', ['-bbox', pdfPath, '-']);
  const pages = [...stdout.matchAll(/<page\b/g)].length;
  const pageBlocks = [...stdout.matchAll(/<page\b[\s\S]*?<\/page>/g)].map((match) => match[0]);
  const pageLines = pageBlocks.map((block) => {
    const yPositions = [...block.matchAll(/<word\b[^>]*\byMin="([0-9.]+)"/g)]
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    const lines: number[] = [];
    for (const y of yPositions) {
      if (lines.length === 0 || Math.abs(y - lines.at(-1)!) > 1) lines.push(y);
    }
    return lines.length;
  });
  return { pages, lines: pageLines.reduce((sum, value) => sum + value, 0), lastPageLines: pageLines.at(-1) ?? 0 };
}

async function renderFixture(directory: string, name: string, cv: Record<string, unknown>): Promise<{ pages: number; lines: number; lastPageLines: number }> {
  const docxPath = join(directory, `${name}.docx`);
  const pdfPath = join(directory, `${name}.pdf`);
  await writeFile(docxPath, await buildCvDocx({ fixed_details: { full_name: 'Calibration User' } }, cv));
  await exec('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', directory, docxPath]);
  return pdfStats(pdfPath);
}

async function main(): Promise<void> {
  const metrics = loadCarlitoMetrics();
  const directory = await mkdtemp(join(tmpdir(), 'cv-calibration-'));
  const rows: Array<Record<string, string | number | boolean>> = [];
  for (const fixtureData of fixtures) {
    const before = estimate(fixtureData.cv, undefined, metrics);
    const fitted = await fitCv({ fixed_details: { full_name: 'Calibration User' } }, fixtureData.cv, { metrics });
    const real = await renderFixture(directory, fixtureData.name, fitted.cv);
    rows.push({
      fixture: fixtureData.name,
      unfittedEstimatedLines: before.lines,
      fittedEstimatedPages: fitted.estimate.estimatedPages,
      realPages: real.pages,
      realLines: real.lines,
      lastPageLines: real.lastPageLines,
      signedErrorLines: real.lines - fitted.estimate.lines,
      falseFit: real.pages > 1,
      safetyMarginLines: SAFETY_MARGIN_LINES,
    });
  }
  await mkdir('out', { recursive: true });
  await writeFile('out/fit-calibration.json', JSON.stringify(rows, null, 2));
  console.table(rows);
  const under = Math.max(...rows.map((row) => Number(row.signedErrorLines)));
  const over = Math.min(...rows.map((row) => Number(row.signedErrorLines)));
  console.log(`Max underestimation: ${under} lines`);
  console.log(`Max overestimation: ${Math.abs(over)} lines`);
  console.log(`Safety margin evidence target: ${Math.max(2, under + 1)} lines`);
  if (rows.some((row) => row.falseFit)) {
    console.error('FALSE FIT: at least one fitted CV rendered to more than one page.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
