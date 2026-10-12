# CV v2 preview manual test

The real deployment target is Word with Calibri. Carlito is used for
server-side metric estimation because it is metric-compatible, but it is not
identical to Calibri. Always open the downloaded DOCX in Word and verify
exactly one page. Set both `ENABLE_CV_V2` and `NEXT_PUBLIC_ENABLE_CV_V2` in the
Vercel Preview environment, and confirm Fluid Compute is enabled before relying
on the 300-second Hobby limit.

1. Set `ENABLE_CV_V2=true` and `CV_V2_MAX_RUNS_PER_DAY` in the Vercel preview environment.
2. Keep `ENABLE_VAULT_REVIEW` unset and verify `/vault-review` is unavailable.
3. Open a normal scraped job and click **Generate CV (v2)**.
4. Confirm the stage stepper advances through analysis, selection, writing, review, and export.
5. Confirm a successful run shows selected projects, warnings, sanitizations, critic issues, and the ATS proxy.
6. Use the project swap control and confirm only writing is rerun.
7. Confirm added skills begin as unchecked and can be approved or rejected locally.
8. Download the DOCX and verify it is exactly one page in Word.
9. Retry a deliberately failed stage and confirm the UI distinguishes ERROR from EMPTY.
10. Use a thin JD and confirm the warning is shown while processing may continue.
11. Use a JD with no named tools and confirm low-signal messaging and domain output.
12. Use a poor scrape or login-wall JD and confirm the paste-JD box appears.
13. Paste a valid JD and confirm analysis resumes without changing scraper data.
14. Repeat runs until the daily cap is reached and confirm `RUN_CAP_REACHED`.
15. With `ENABLE_CV_V2` unset, confirm the v2 button and routes are unavailable.
