import { describe, expect, it } from 'vitest';
import { vaultReviewEnabled } from '../lib/cv-v2/vault-review';

describe('vault review gate', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(vaultReviewEnabled(undefined)).toBe(false);
    expect(vaultReviewEnabled('false')).toBe(false);
    expect(vaultReviewEnabled('true')).toBe(true);
    expect(vaultReviewEnabled('1')).toBe(true);
  });
});
