import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CV v2 storage client policy', () => {
  it('uses the server service-role client for every cv_* table access', () => {
    const source = readFileSync(new URL('../app/api/cv-v2/_lib.ts', import.meta.url), 'utf8');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(source).not.toMatch(/createBrowserClient|createClientComponentClient/);
  });
});
