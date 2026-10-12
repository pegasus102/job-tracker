import { describe, expect, it } from 'vitest';
import { jdAnalysisResponseSchema } from '../lib/cv-v2/analyze';
import { researchStructuredResponseSchema } from '../lib/cv-v2/research';
import { projectScoringResponseSchema } from '../lib/cv-v2/score-projects';
import { writingResponseSchema } from '../lib/cv-v2/write-cv';
import { criticResponseSchema } from '../lib/cv-v2/critic';

function assertVertexSchema(value: unknown, path = 'root'): void {
  expect(value).toBeTypeOf('object');
  expect(value).not.toHaveProperty('$ref');
  expect(value).not.toHaveProperty('$defs');
  expect(value).not.toHaveProperty('definitions');
  const schema = value as { type?: string; items?: unknown; properties?: Record<string, unknown> };
  if (path === 'root') expect(schema.type).toBe('object');
  if (schema.type === 'array') {
    expect(schema.items, `${path} must define items`).toBeDefined();
    assertVertexSchema(schema.items, `${path}.items`);
  }
  Object.entries(schema.properties ?? {}).forEach(([key, child]) => assertVertexSchema(child, `${path}.${key}`));
}

describe('Vertex response schemas', () => {
  it('generates fully inlined analysis and research schemas', () => {
    assertVertexSchema(jdAnalysisResponseSchema);
    assertVertexSchema(researchStructuredResponseSchema);
    assertVertexSchema(projectScoringResponseSchema);
    assertVertexSchema(writingResponseSchema);
    assertVertexSchema(criticResponseSchema);
  });
});
