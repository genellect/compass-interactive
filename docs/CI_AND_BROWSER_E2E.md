# CI and browser E2E

Status: Operationally verified
Scope: GitHub Actions, browser E2E and non-live/hosted gate separation
Last verified: 2026-08-08

## Purpose and safety boundary

The CI gate validates COMPASS Interactive without changing or contacting any
hosted environment. It never deploys, links a Supabase project, pushes a
database, calls OpenAI, uploads a PDF, or accesses Cloudflare/R2. The only
backend used by browser integration tests is the disposable Supabase stack
created by Docker on the GitHub runner.

The application implementation is not switched into a test-only code path.
Playwright drives the same routes and repositories used by the browser. Test
configuration changes only build-time environment values and refuses a
non-local Supabase URL for the live E2E suite.

## GitHub Actions jobs

`.github/workflows/ci.yml` contains five mandatory gates plus conditional
Dependency Review and CodeQL jobs:

1. **Quality and non-live regression** runs TypeScript checks, oxlint, the
   explicit allowlist of existing non-live Phase 0-6.7 tests, documentation
   consistency, the production build and `git diff --check`.
2. **Demo browser E2E** runs desktop and 390 px mobile Chromium against the
   Supabase-independent `/demo` flow. It covers route entry, content order,
   comments, anonymous-by-default behavior, the 10-character nickname limit,
   polling, comment history and exit/re-entry behavior.
3. **Local Supabase, pgTAP and live browser E2E** applies every migration from
   zero, runs every pgTAP file plus the real-DB AI concurrency race test, runs
   DB lint, serves Edge Functions with synthetic secrets, checks
   Auth/CORS/paid-feature fail-closed behavior, then drives a teacher and a
    student through create, start, join, comment and close lifecycle operations.
4. **Presenter Bridge Windows x64 build and tests** restores and builds the .NET
   solution for x64, then runs the Core/loopback/security tests.
5. **Presenter Bridge Windows x86 build and tests** repeats the locked restore,
   build and deterministic test suite with the x86 runtime. Neither job uploads
   an unsigned executable. They do not claim real PowerPoint, installer,
   SmartScreen, browser PNA or venue acceptance.

Both browser suites block every non-local HTTP(S) request. Browser console
errors, uncaught page errors and horizontal overflow fail the suite. On
failure, traces, screenshots, videos, HTML reports and local Edge logs are
retained for seven days.

## Commands

Install the locked dependencies and the local Chromium binary:

```bash
npm ci
npx playwright install chromium
```

Run the no-cost demo E2E suite:

```bash
npm run test:e2e:demo
```

Run the quality gates used by CI:

```bash
npm run typecheck
npm run cloud:doctor
npm run typecheck:phase3
npm run typecheck:e2e
npm run lint
npm run test:phase6-7-docs
npm run test:ci:nonlive
npm run build
git diff --check
```

## Local Supabase E2E on Windows

Docker Desktop must be running. In terminal 1:

```bash
npx supabase start
npx supabase db reset --local --no-seed
npx supabase test db --local
npx supabase db lint --local --fail-on error
```

Create an ignored file named `.env.edge.e2e.local` containing only synthetic
local test values. These are examples, not production credentials:

```dotenv
ADMIN_PIN=246810
ADMIN_SESSION_SECRET=compass-local-only-admin-session-secret-at-least-32-bytes
BILLING_PIN=135790
COMPASS_EDGE_ALLOWED_ORIGINS=http://127.0.0.1:4173
PHASE4_REALTIME_CAPTIONS_ENABLED=false
PHASE5_MATERIAL_ANALYSIS_ENABLED=false
PHASE6_SUMMARIES_ENABLED=false
```

Then keep the local Functions server running in terminal 1:

```bash
npx supabase functions serve --env-file .env.edge.e2e.local
```

In terminal 2, use the same synthetic Admin PIN:

Git Bash:

```bash
export TEST_ADMIN_PIN=246810
npm run test:e2e:local
```

PowerShell:

```powershell
$env:TEST_ADMIN_PIN = '246810'
npm.cmd run test:e2e:local
```

The local runner obtains the API URL and publishable key from
`supabase status -o env`; it aborts if the URL is not `localhost` or
`127.0.0.1`.

## Tests intentionally excluded from CI

The following remain manual, explicitly paid or hosted checks:

- `test:phase5-openai-live`
- `test:phase6-openai-live`
- `scripts/test-pdf-sync-hosted.mjs`
- real microphone/Realtime transcription testing
- Cloudflare Publisher/R2 production uploads
- Hosted Supabase and public-web smoke testing
- signed Presenter installer, real Office/COM, 500 transitions and venue/PNA

They must not be added to the default workflow. The non-live suite also scans
the workflow for production migration, deployment and paid-live commands.

## Repository setup after push

No repository secret is required by this workflow. Main ruleset `20600565` is
active and requires the five job results above, a Pull Request and resolved
review conversations; force-push and branch deletion are blocked. Required
approvals remain zero for the solo owner, no administrator bypass is configured,
and `strict_required_status_checks_policy=false` avoids forcing every open PR to
update and repeat the full matrix after an unrelated `main` change. The five
checks still must pass for the candidate PR head. Keep workflow permissions
read-only and do not add production credentials to this workflow.
