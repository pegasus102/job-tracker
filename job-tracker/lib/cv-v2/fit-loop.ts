import { DEFAULT_LAYOUT, type CvDocument, type CvLayout, type CvProfile, buildCvDocx } from './docx-builder';
import { estimate, SAFETY_MARGIN_LINES, type FontMetrics } from './fit-estimator';

export const FIT_FAILED = 'FIT_FAILED';
export type FitStep = 'spacing' | 'font-size' | 'margins' | 'drop-bullet';
export type FitOptions = {
  metrics: FontMetrics;
  maxIterations?: number;
  persist?: (layout: CvLayout) => Promise<unknown>;
  render?: (profile: CvProfile, cv: CvDocument, layout: CvLayout) => Promise<Uint8Array | Buffer>;
};
export type FitResult = { buffer: Uint8Array | Buffer; cv: CvDocument; layout: CvLayout; iterations: number; steps: FitStep[]; estimate: ReturnType<typeof estimate> };

const MIN_FONT_SIZE = 10;
const MIN_MARGIN = 720;
const MIN_BULLET_AFTER = 0;
const MIN_SECTION_BEFORE = 0;
const MIN_SECTION_AFTER = 0;

function cloneCv(cv: CvDocument): CvDocument {
  return JSON.parse(JSON.stringify(cv)) as CvDocument;
}

function dropLowestPriorityBullet(cv: CvDocument): boolean {
  const entries = [...(Array.isArray(cv.projects) ? cv.projects : []), ...(Array.isArray(cv.experience) ? cv.experience : [])]
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && Array.isArray((entry as Record<string, unknown>).bullets));
  const eligible = entries.filter((entry) => (entry.bullets as unknown[]).length > 2);
  const target = eligible.sort((a, b) => (b.bullets as unknown[]).length - (a.bullets as unknown[]).length)[0];
  if (!target) return false;
  const bullets = target.bullets as Array<unknown>;
  let index = bullets.length - 1;
  let lowest = Number.POSITIVE_INFINITY;
  bullets.forEach((bullet, currentIndex) => {
    const priority = bullet && typeof bullet === 'object' && typeof (bullet as Record<string, unknown>).priority === 'number'
      ? (bullet as Record<string, unknown>).priority as number
      : Number.POSITIVE_INFINITY;
    if (priority < lowest) {
      lowest = priority;
      index = currentIndex;
    }
  });
  bullets.splice(index, 1);
  return true;
}

function applyStep(layout: CvLayout, step: FitStep): CvLayout {
  if (step === 'spacing') return {
    ...layout,
    sectionBefore: Math.max(MIN_SECTION_BEFORE, layout.sectionBefore - 40),
    sectionAfter: Math.max(MIN_SECTION_AFTER, layout.sectionAfter - 20),
    bulletAfter: Math.max(MIN_BULLET_AFTER, layout.bulletAfter - 10),
  };
  if (step === 'font-size') return { ...layout, fontSize: Math.max(MIN_FONT_SIZE, layout.fontSize - 0.5) };
  if (step === 'margins') return {
    ...layout,
    margins: {
      top: Math.max(MIN_MARGIN, layout.margins.top - 40),
      bottom: Math.max(MIN_MARGIN, layout.margins.bottom - 40),
      left: Math.max(MIN_MARGIN, layout.margins.left - 40),
      right: Math.max(MIN_MARGIN, layout.margins.right - 40),
    },
  };
  return layout;
}

export async function fitCv(profile: CvProfile, cv: CvDocument, options: FitOptions): Promise<FitResult> {
  const maxIterations = Math.min(12, options.maxIterations ?? 12);
  let layout = { ...DEFAULT_LAYOUT, margins: { ...DEFAULT_LAYOUT.margins } };
  const workingCv = cloneCv(cv);
  const steps: FitStep[] = [];
  let current = estimate(workingCv, layout, options.metrics);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (!current.overflow && current.slackLines >= SAFETY_MARGIN_LINES) {
      const render = options.render ?? ((p, c, l) => buildCvDocx(p, c, l));
      const buffer = await render(profile, workingCv, layout);
      try { await options.persist?.(layout); } catch { /* best effort persistence */ }
      return { buffer, cv: workingCv, layout, iterations: iteration, steps, estimate: current };
    }
    const step: FitStep = iteration <= 3 ? (['spacing', 'font-size', 'margins'] as FitStep[])[iteration - 1] : 'drop-bullet';
    steps.push(step);
    if (step === 'drop-bullet') {
      if (!dropLowestPriorityBullet(workingCv)) throw new Error(`${FIT_FAILED}: no removable bullet remains`);
    } else {
      layout = applyStep(layout, step);
    }
    current = estimate(workingCv, layout, options.metrics);
  }
  throw new Error(`${FIT_FAILED}: could not fit CV within ${maxIterations} iterations`);
}
