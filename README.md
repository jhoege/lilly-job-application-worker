# Lilly Job Application Worker

Private browser-automation worker for Lilly's job-search workflow.

## Current milestone

The initial service is intentionally limited to infrastructure validation:

- Node.js HTTP service
- Playwright 1.55 / Chromium
- persistent browser profile at `/data/browser-profile`
- `TEST_MODE=true` by default
- `GET /health` for Railway health checks
- `GET /ready` for Chromium readiness

No job applications are submitted by this initial version.

## Environment variables

- `TEST_MODE=true` — safe default; live submission logic must not run while true.
- `BROWSER_PROFILE_PATH=/data/browser-profile`
- `PORT` — supplied by Railway when applicable; defaults to 3000.

## Railway

Deploy using the included Dockerfile. Attach one persistent volume at `/data` so browser session state can survive service restarts and redeployments.
