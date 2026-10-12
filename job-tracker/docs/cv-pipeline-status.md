# CV pipeline status

## Stage 1 — JD input robustness

Done. Scraped `job_description_raw` is cleaned deterministically, capped at 12,000
characters, classified as `ok`, `thin`, or `poor`, and protected from prompt-injection
lines. `required_skills` is not used as the requirements source. `--job-json` and
fixture coverage are present.

## Stage 2 — safety and post-processing

Done. Skills are restricted to the six approved categories and verified vocabulary;
selected-project tools are included when JD-relevant. Added skills and spelling-only
ATS variants are validated. Profile shape unwrapping, budget reporting, and ignore
rules are present.

## Stage 3 — low technical signal

Done. Requirements have tool/domain/soft kinds, role families, low-signal defaults,
and default requirements are excluded from ATS and added skills. Runner output reports
role family, signal status, kinds, and defaults.

## Stage 4 — quality instrumentation

Done. Bullet-to-fact token-overlap reports identify near-verbatim bullets, rough profile
input is supported, and runner timing totals are printed.

## Stage 5 — safety items

Done. Vault review calls `notFound()` before reading data unless
`ENABLE_VAULT_REVIEW=true`. Dependency and OpenAI usage inspection was completed
without reinstalling packages.

## Stage 6 — one-page fit

Done. DOCX generation is extracted to `lib/cv-v2/docx-builder.ts`; default layout
values preserve the legacy builder. Carlito/fontkit estimation, bounded ordered fit
steps, calibration tooling, and `--fit` output are present. LibreOffice was not
available in this environment; calibration reports the installation command.

## Stage 7 — gate

Complete. Validation and the calibration report are complete now that LibreOffice is
installed. Stages 8–11 are not started.

## Phase 2 status

Part 0 evidence:

1. `grep -rnE "cv-v2|vault-review" app components lib --include='*.ts' --include='*.tsx' --exclude-dir='lib/cv-v2'` reports only the permitted `app/vault-review` imports and the permitted export route import; no unrelated page/component imports the pipeline.
2. `tests/docx-builder.test.ts` compares `word/document.xml` from the legacy fixture builder and `buildCvDocx`; it passes.
3. Carlito Regular, Bold, Italic, and BoldItalic TTFs plus the OFL licence are bundled. The font test confirms bold text measures wider than regular text.
4. `next.config.ts` uses `outputFileTracingIncludes` for `/api/export-docx`; the built `.nft.json` lists all four Carlito TTFs.
5. LibreOffice 24.2.7.2 calibration ran on six fixtures. Estimated/real pages were 1/1, 1/1, 1/1, 7/7, 10/9, and 11/11; maximum error was 8 lines, so the safety margin is 8 lines.
6. Writing budgets use Carlito metrics, 10pt font, 10,180 twips usable bullet width, measured average character width, two measured lines, and an 0.82 safety factor. The resulting budget is computed rather than fixed at 90.
7. The repository root is `/workspaces/job-tracker`; `node_modules` is untracked and ignored by `/workspaces/job-tracker/.gitignore`. No node_modules files should be added or removed.
8. Runtime packages are dependencies; Vitest, tsx, ESLint, and TypeScript are devDependencies.
9. No OpenAI application usage was found; only the dependency inspection script mentions OpenAI.

Stage 1 scraper audit summary: a submitted URL is fetched with plain `fetch` and a browser User-Agent. Cheerio removes selected structural elements and extracts visible job text. Hidden JSON-LD is sent to the legacy extractor but is not stored in the raw JD field. `job_description_raw` stores cleaned visible text, capped at 12,000 characters in the scraper. The legacy research route truncates it to 8,000 characters. The legacy CV route truncates it to 6,000 characters. `required_skills` is an LLM extraction and is not authoritative for v2 requirements. Plain fetch cannot execute JavaScript-rendered job pages. Login walls and blocked pages can create tiny or unusable rows. There is no existing manual paste path. The v2 cleaner strips residual tags/entities, boilerplate, duplicate blocks, and prompt-injection lines. Poor input returns `JD_NEEDS_REVIEW`; thin input continues with a warning.

Stage 4 rough-fixture result: the deterministic quality evaluator is available through
`npm run eval:quality`; no production `dev-data` run was executed in this environment
because it would require model credentials. The rough fixture demonstrates the intended
before/after pattern: “Did many things for a team and made the tool better.” becomes a
specific fact-grounded rewrite only when evidence supports it; “Worked on various
improvements and helped users.” is warned for banned/passive wording; and a concrete
tool/metric bullet remains unchanged when it is already specific. Near-verbatim ratio is
reported by `scripts/dev-run.ts` and `scripts/eval-quality.ts`, not used as a gate.

## Phase 2 parts

Part A: done — flag-gated resumable v2 routes, service-role storage, run cap, typed
errors, optional research, and route tests.

Part B: done — additive gated panel with stepper, retry/error/empty states, project
swap, skill approval checkboxes, ATS and fit details, and poor-JD paste fallback.

Part C: complete for the implemented scope — old and v2 exports use the estimator
and fit loop, safety margin is enforced, legacy lint is clean, `npm run verify`
exists and passes, and v2 route storage is service-role-only. Existing-route
smoke coverage is represented by the route-level validation tests; live external
provider behavior still requires preview testing.

Part D: done — style examples are prompt-only style guidance, banned-phrase lint,
evaluation script, per-entry opt-in mode, and model/latency reporting.

Part E: complete for repository-level verification; preview/manual Vercel testing
remains required.

Preview environment variables: set `ENABLE_CV_V2=true`,
`CV_V2_MAX_RUNS_PER_DAY=30`, `SUPABASE_SERVICE_ROLE_KEY`, and the server-side
Vertex credential names (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLIENT_EMAIL`,
`GOOGLE_PRIVATE_KEY`). `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` remain public client configuration. Keep
`ENABLE_VAULT_REVIEW` unset. Known limits are the Hobby plan duration, the
research latency, the daily run cap, and the need for LibreOffice calibration
outside Vercel. Remaining work is production preview validation and user approval
of per-entry writing mode.

The repository has no `maxDuration` configuration. The selected Vercel Hobby plan
supports a 300-second maximum function duration with Fluid compute; research uses
a 180-second timeout, while analysis/scoring/writing/critic use their existing
shorter client defaults or 150-second caps. Measured prior grounded-research
latency was approximately 18–102 seconds. Current model configuration is Flash
with LOW thinking for analysis/research, and Pro with MEDIUM thinking for scoring,
writing, and critic review.

## Part D — writing quality evaluation and call instrumentation

Done. Writing prompts receive `styleExamples` through the `<style_examples>` delimiter;
the development runner currently loads the checked-in
`tests/fixtures/style-examples.json`. The proposed `cv_style_examples` table is
documented storage for future persisted examples, but is not read by routes or by
the no-model evaluation script.

`data/banned-phrases.json` is the editable source for deterministic quality warnings.
`npm run eval:quality` evaluates all bullets in `dev-data/profile.json` without model
calls and prints warning counts and paths. `CV_WRITE_MODE=per_entry` runs one isolated
writing call per selected project and experience entry; the default is `single`.
Development model metadata includes model, thinking configuration, and latency in
the existing client run logs. No routes, UI, SQL, or real model-call tests were
changed.

## Part A — CV v2 API routes

Implemented behind `ENABLE_CV_V2=true`:

- `POST /api/cv-v2/analyze`
- `POST /api/cv-v2/research` (can be skipped)
- `POST /api/cv-v2/score`
- `POST /api/cv-v2/write`
- `POST /api/cv-v2/export`

These routes use the existing CV v2 services, enforce bounded inputs and typed
errors, and persist only `cv_*` run/cache data through the service-role client.
Stage input hashes make retries idempotent and allow completed stages to be
resumed. `jdText` takes precedence over scraped job text. No existing route was
changed.

## Part B — CV v2 UI

Implemented behind `NEXT_PUBLIC_ENABLE_CV_V2=true` (the browser-safe projection of
`ENABLE_CV_V2`). The additive `components/CvV2Panel.tsx` provides the Generate CV v2
button, stage stepper, empty/error/retry states, project swaps, unchecked added-skill
approvals, warnings/sanitizations, critic and ATS prompts, fit display, DOCX download,
and a poor-JD paste box. It is a UI-only preview and makes no model calls.

Exact existing-UI diff: `app/page.tsx` has one import for `CvV2Panel` and one render
after the jobs table. No routes, SQL, or existing CV actions were changed.

## Phase 3 calibration and deployment notes

The boundary calibration renders 30 fixtures through LibreOffice and extracts
real text baselines from PDF bounding boxes. The current run measured signed
errors from -4 to +1 lines (real lines minus estimated lines), with no false
one-page fits; the evidence-based minimum margin is therefore 2 lines. This is
Carlito measurement evidence, not a substitute for the required Word check:
production Word uses Calibri, and Carlito is metric-compatible but not
identical. The manual Word check remains mandatory.

The server flag is `ENABLE_CV_V2`; the client display flag is
`NEXT_PUBLIC_ENABLE_CV_V2`. If the client flag is enabled while the server flag
is disabled, the panel reports “CV v2 is not enabled on the server”. Research
uses `CV_V2_RESEARCH_TIMEOUT_MS`, defaulting to 180 seconds and capped below
the 240-second Hobby/Fluid Compute route duration. Confirm Fluid Compute is
enabled in Vercel; without it, the available duration is lower.

The parent `/workspaces/job-tracker/package-lock.json` is tracked but contains
only a small standalone `openai` dependency tree and no Next app dependencies.
The application lockfile is `job-tracker/package-lock.json`; Vercel Root
Directory should be `job-tracker`. The parent lockfile was not modified or
untracked.
