import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEFAULT_LAYOUT, type CvDocument, type CvLayout } from './docx-builder';

export type FontMetrics = {
  widthOfTextAtSize(text: string, size: number): number;
  lineHeightAtSize(size: number): number;
  widthOfStyledTextAtSize?: (text: string, size: number, style: 'regular' | 'bold' | 'italic' | 'boldItalic') => number;
};

export type FitEstimate = {
  estimatedPages: number;
  usedHeightRatio: number;
  linesOver: number;
  slackLines: number;
  lines: number;
  heightTwips: number;
  overflow: boolean;
};
export const SAFETY_MARGIN_LINES = 8;

function stringsFrom(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return ['text', 'title', 'role', 'company', 'duration', 'tech_stack', 'items', 'category', 'bullets']
      .flatMap((key) => typeof record[key] === 'string'
        ? [record[key] as string]
        : key === 'bullets' ? stringsFrom(record[key]) : []);
  });
}

function cvText(cv: CvDocument): string[] {
  const values = ['experience', 'projects', 'skills', 'certifications', 'extracurriculars']
    .flatMap((key) => stringsFrom(cv[key]));
  return values.length > 0 ? values : [JSON.stringify(cv)];
}

function wrappedLines(text: string, metrics: FontMetrics, size: number, width: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = metrics.widthOfTextAtSize(`${lineWidth ? ' ' : ''}${word}`, size);
    if (lineWidth === 0 && wordWidth > width) {
      const extraLines = Math.ceil(wordWidth / width);
      lines += extraLines - 1;
      lineWidth = wordWidth % width;
      continue;
    }
    if (lineWidth > 0 && lineWidth + wordWidth > width) {
      lines += 1;
      lineWidth = metrics.widthOfTextAtSize(word, size);
    } else {
      lineWidth += wordWidth;
    }
  }
  return lines;
}

export function estimate(
  cv: CvDocument,
  layout: CvLayout = DEFAULT_LAYOUT,
  metrics: FontMetrics = fallbackMetrics,
): FitEstimate {
  const usableWidth = layout.pageWidthTwips - layout.margins.left - layout.margins.right - 720;
  const usableHeight = layout.pageHeightTwips - layout.margins.top - layout.margins.bottom;
  const lineHeight = metrics.lineHeightAtSize(layout.fontSize);
  const capacity = Math.max(1, Math.floor(usableHeight / lineHeight));
  const lines = Math.max(1, cvText(cv).reduce((total, text) => total + wrappedLines(text, metrics, layout.fontSize, usableWidth), 0));
  const heightTwips = lines * lineHeight;
  const estimatedPages = Math.max(1, Math.ceil(lines / capacity));
  return {
    estimatedPages,
    usedHeightRatio: heightTwips / usableHeight,
    linesOver: Math.max(0, lines - capacity),
    slackLines: Math.max(0, capacity - lines),
    lines,
    heightTwips,
    overflow: lines > capacity || capacity - lines < SAFETY_MARGIN_LINES,
  };
}

export function estimateFit(text: string, metrics: FontMetrics, layout: CvLayout = DEFAULT_LAYOUT, fontSize = layout.fontSize): FitEstimate {
  return estimate({ projects: [{ bullets: [text] }] }, { ...layout, fontSize }, metrics);
}

const fallbackMetrics: FontMetrics = {
  widthOfTextAtSize: (text, size) => text.length * size * 10,
  lineHeightAtSize: (size) => size * 24,
};

export function loadCarlitoMetrics(fontPath = process.env.CARLITO_FONT_PATH ?? resolve(process.cwd(), 'assets/fonts/Carlito-Regular.ttf')): FontMetrics {
  if (!fontPath) throw new Error('Carlito metrics unavailable: set CARLITO_FONT_PATH to a licensed Carlito .ttf file');
  try {
    const require = createRequire(import.meta.url);
    const fontkit = require('fontkit') as {
      openSync(path: string): {
        layout(text: string, size: number): { glyphs: Array<{ advanceWidth: number }> };
        unitsPerEm: number;
        ascent: number;
        descent: number;
      };
    };
    const base = resolve(fontPath);
    const fontFor = (style: 'regular' | 'bold' | 'italic' | 'boldItalic') => {
      if (process.env.CARLITO_FONT_PATH) return fontkit.openSync(base);
      const filename = {
        regular: 'Carlito-Regular.ttf',
        bold: 'Carlito-Bold.ttf',
        italic: 'Carlito-Italic.ttf',
        boldItalic: 'Carlito-BoldItalic.ttf',
      }[style];
      return fontkit.openSync(resolve(process.cwd(), 'assets/fonts', filename));
    };
    const font = fontFor('regular');
    const scale = (size: number) => size * 20 / font.unitsPerEm;
    return {
      widthOfTextAtSize: (text, size) => font.layout(text, size).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * scale(size),
      widthOfStyledTextAtSize: (text, size, style) => {
        const styled = fontFor(style);
        const styledScale = (size: number) => size * 20 / styled.unitsPerEm;
        return styled.layout(text, size).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * styledScale(size);
      },
      lineHeightAtSize: (size) => (font.ascent - font.descent) * scale(size),
    };
  } catch (error) {
    throw new Error(`Carlito metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
