# FINISH-CHECKLIST

## State Reconstruction (Step 0)
- **Branch**: `feature/cv-pipeline-v2`
- **Existing artifacts confirmed**:
  - v2 routes: `app/api/cv-v2/analyze`, `research`, `score`, `write`, `export`, plus `_lib.ts`
  - `CvV2Panel`: `components/CvV2Panel.tsx`
  - fit estimator & fit loop: `lib/cv-v2/fit-estimator.ts`, `lib/cv-v2/fit-loop.ts`, `tests/fit-loop.test.ts`
  - calibrate script: `scripts/calibrate-fit.ts`
  - jd-input: `lib/cv-v2/jd-input.ts`, `tests/jd-input.test.ts`
  - role-family defaults: in `lib/cv-v2/analyze.ts`

---

## Round Status

### Round A: T2, T3, T1, T4 (Guards, Data Hygiene, Instrumentation, Writing Quality)
- **Status**: Implemented, pending user terminal verification
- **Files Modified / Created**:
  - `scripts/dev-run.ts` (T2 guards, --write-fit, --force-jd, T1 instrumentation)
  - `lib/cv-v2/vault.ts` (T3 empty bullet filtering)
  - `lib/cv-v2/docx-builder.ts` (T3 empty bullet filtering in docx builder)
  - `app/vault-review/page.tsx` (T3 empty bullet count and listing)
  - `lib/cv-v2/write-cv.ts` (T4 rewriting prompt, 2-fact citation, near-verbatim revision gate)
  - `lib/cv-v2/validate-writing.ts` (T4 2-fact citations, concrete noun specificity check)
  - `lib/cv-v2/critic.ts` (T4 deterministic critic lost_specificity fixes)
  - `tests/vault.test.ts` (T3 tests for empty bullet filtering)
  - `tests/write-cv.test.ts` (T4 tests for max 2 facts, cross-entry citation rejection, uncited numbers, specificity check, critic auto-fix)
  - `tests/docx-builder.test.ts` (T3 tests for docx empty bullet filtering)
- **Commit**: Pending verification
- **Evidence**: Pending command execution
- **UNVERIFIED**: Pending user terminal execution of `verify` and `dev-run`.

---

## T4 Before / After Comparison Table
| Bullet # | Before Text (from real run) | After Text | Similarity Before | Similarity After |
|---|---|---|---|---|
| (To be populated after user pastes dev-run output) | | | | |

---

## Calibration Table (T8)
*(To be completed in Round C)*

---

## Supabase Call Audit Table (T11)
*(To be completed in Round B)*

---

## Route x Scenario Matrix (T12)
*(Deferred)*
