# Lilly application automation — engineering specification

## Objective
Reduce human intervention to exceptions. Never report submission without an independently observed confirmation. Respect site access restrictions and never bypass CAPTCHA, MFA, rate limits, or anti-bot controls.

## Current baseline
- Railway persistent Chromium browser and supervised sign-in
- GitHub-backed candidate queue (11 unique jobs, with recorded submissions and closed listings)
- Read-only batch inspection, form field inspection, and salary calculation
- Manual Easy Apply completion; no automatic submission endpoint

## Required architecture
1. **Durable queue:** SQLite on Railway persistent volume, with migrations and unique LinkedIn job ID. Import the existing JSON queue. Store states: discovered, inspecting, eligible, filling, ready_for_review, needs_answers, submitted_verified, closed, failed_retryable, failed_terminal. Track timestamps, attempts, last error, and confirmation evidence reference.
2. **Single-worker orchestration:** one browser job at a time with lease, heartbeat, per-step timeout, retry/backoff, max-attempt limit, and safe restart. Never start a new job while an unfinished submission is uncertain.
3. **DOM-first application adapter:** locate accessible labels and input types; support text, select, radio, checkbox, resume chooser, modal scrolling, Next, Review. Inspect each page before action. Handle page changes without coordinate clicks where possible. Stop on unsupported widgets.
4. **Answer policy:** allowlist approved contact details, user-approved credentials in last-name field, current location, existing resume. Treat sponsorship/work authorization answers as user-confirmed and recheck if application wording differs. Do not infer degrees, clearances, years of experience, or other qualifications.
5. **Salary:** if valid advertised range, max(120000, min+0.75*(max-min)); else documented market estimate with 120000 floor; else 120000. Ignore implausible placeholder ranges. Record source and currency.
6. **Review and submission:** prepare a complete summary; submit only if all fields are verified and the user's standing authorization applies to that specific listing. For unknown answers, set needs_answers and continue to next job. After clicking submit, verify LinkedIn confirmation or Applied status; if uncertain, do not retry submission until status is checked.
7. **Security:** authenticated, CSRF-protected dashboard; no public unauthenticated job-control endpoints; secrets only in Railway variables; redact credentials, sensitive field values, and screenshots; least privilege.
8. **Dashboard:** queue counts, active job, resume, salary evidence, unanswered questions, review/submit action, verified confirmations, pause/resume, and downloadable CSV.
9. **Observability:** structured events per job and step, error codes, timing, and evidence. Never log passwords, session cookies, or access keys.
10. **Scheduling:** daily discovery and processing within platform terms and rate limits; no CAPTCHA solving or access-control evasion.

## Acceptance tests
- No duplicate submissions on retries/restarts.
- 10 known-form dry runs advance correctly without changing profile.
- Unknown question pauses only that job and continues others.
- Missing salary data never produces request below 120000.
- Submission only recorded after confirmation.
- Worker restarts preserve queue and question state.
- Clear operator controls for pause, review, and cancel.

## Implementation order
A. SQLite state machine and migration from JSON.
B. DOM field extraction with label/section associations and redacted logs.
C. Approved-answer resolver and dry-run form filler.
D. Exception queue and dashboard.
E. Verified submission adapter and controlled live pilot.
F. Scheduler and reporting.

## Deployment gates
Do not enable live batch submissions until dry-run tests and a supervised pilot pass. Maintain TEST_MODE=true until explicitly validated.
