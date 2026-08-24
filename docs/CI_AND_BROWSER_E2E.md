# CI and browser E2E

Status: Operationally verified
Scope: GitHub Actions, browser E2E and non-live/hosted gate separation
Last verified: 2026-08-12

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

## Actions capacity conservation

GitHub Actions capacity is a bounded release resource. Every task must run
focused/local/static checks before push, combine related corrections, and
freeze one exact head before requesting the full required workflow. Do not use
push-per-fix iteration or blind same-head reruns. Fetch a failing job log once,
classify source versus runner/infrastructure, and use at most one targeted
job-only rerun when the evidence proves a transient. A source failure receives
a new locally validated head. The approved repository Actions ceiling is $15
and the account Actions ceiling is $35; the lower remaining headroom is the
operative limit, and exceeding either ceiling requires a new explicit approval.

For a Pull Request whose complete diff stays within the approved documentation
surfaces (the known root documents, `docs/**/*.md`, `.github/**/*.md`,
`.claude/**/*.md`, the Presenter and Supabase manual READMEs, `LICENSE` and
`NOTICE`), CI runs only `security:secrets`, `test:phase6-7-docs` and the
committed-diff whitespace check. The remaining required contexts are reported
without starting browser, database, native build, Dependency Review or CodeQL
work. The Dev Container is also skipped unless one of its narrower contract
paths changed. Push and manual-dispatch runs remain full, and any source,
workflow, configuration, lockfile, asset or unknown Markdown path fails closed
to the full matrix.

## GitHub Actions jobs

`.github/workflows/ci.yml` contains five mandatory gates plus conditional
Dependency Review and CodeQL jobs:

1. **Quality and non-live regression** runs TypeScript checks, oxlint, the
   explicit allowlist of 75 non-live Phase 0-7.30 test groups, documentation
   consistency, the production build and `git diff --check`.
2. **Demo browser E2E** runs desktop and 390 px mobile Chromium against the
   Supabase-independent `/demo` flow, plus the Phase 7.30 Admin identity gate
   in desktop Chromium and WebKit with the Google path both OFF and ON. The
   Admin identity run verifies PKCE callback isolation, production UI TOTP
   enrollment/challenge handling against deterministic mocked Auth responses,
   provider-token non-persistence, separate
   student anonymous state, tracked-session completion and logout behavior.
   It also runs the B2.2b Chromium/WebKit IndexedDB contract for non-extractable
   P-256 keys, identity/Auth-session scope, expiry, reload and cross-tab
   convergence without contacting Supabase or any hosted service.
3. **Local Supabase, pgTAP and live browser E2E** applies every migration from
   zero, verifies generated types, runs every pgTAP file plus the real-DB
   concurrency suites, proves populated Phase 7.29, B1, B2, C1 and C2 states
   upgrade through the current schema, and additionally proves populated C2
   Display provenance and D ownership/ledger state survive E without inferred
   approvals, claims or cutover receipts, then runs DB lint. The
   B2/B2.2a/B2.2b database step includes the
   from-zero migration/pgTAP, a real two-transaction replay/lock-order/
   cleanup and principal-transition concurrency runner plus populated
   Phase 7.29/B1/B2-head/B2.2a-head-to-B2.2b upgrades. It
   E step adds a real two-connection approval/claim/session/cutover NOWAIT and
   exact-replay runner, then fully resets the local database. It then serves Edge Functions with
   synthetic secrets, checks Auth/CORS/paid-feature fail-closed behavior, and
   drives the browser integrations with Google app-session fixtures rather
   than a shared Admin PIN. Its Phase 7.30 step enables only the local identity
   gates, performs real local GoTrue TOTP enrollment and
   `challengeAndVerify`, binds the resulting AAL2/TOTP AMR into the signed
   local Google-identity fixture, exercises Edge plus database tracked-session
   admission/status/logout, and restores the identity gates to OFF before the
   existing teacher/student lifecycle run.

The B2/B2.2a/B2.2b source/static contract is implemented, but this branch still
needs an exact-head CI run before those real database steps are evidence for the
B2.2b candidate. Their workflow presence is not a PASS result. Every new gate
remains default OFF and this job does not contact Hosted Supabase.

The Phase 7.30F non-live group validates only the source/local readiness
contract: strict schema/example, default `HOLD`, redaction and rejection cases,
production-environment metadata validation, read-only SQL shape and approval
separation. It does not execute the SQL, contact a Hosted environment, inspect
an OAuth client, enroll a Human account, invoke the E cutover, delete a secret,
retire billing authority or enable a canary. Its highest possible readiness
word is `READY_FOR_SEPARATE_HOSTED_EXECUTION`; CI cannot produce
`Production PASS`. A source-only CI/example input remains `HOLD`. The maximum
word applies only when the offline validator receives a complete dossier of
separately approved staging observations; it checks consistency but neither
collects nor independently proves them.

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
npm run test:phase7-30b2-static
npm run test:phase7-30b22a-static
npm run test:phase7-30b22b-static
npm run test:phase7-30c1-static
npm run test:phase7-30c2-static
npm run test:phase7-30d-static
npm run test:phase7-30e-static
npm run test:phase7-30f-static
npm run test:ci:nonlive
npm run build
npm run test:e2e:phase7-30
npm run test:e2e:phase7-30:flag-off
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
ADMIN_SESSION_SECRET=compass-local-only-admin-session-secret-at-least-32-bytes
ADMIN_IDENTITY_PEPPER=compass-local-only-admin-identity-pepper-at-least-32-bytes
ADMIN_IDENTITY_PEPPER_VERSION=1
ADMIN_AI_PIN_PEPPER=compass-local-only-admin-ai-pin-pepper-at-least-32-bytes
ADMIN_AI_PIN_PEPPER_VERSION=1
ADMIN_AI_NETWORK_PEPPER=compass-local-only-admin-ai-network-pepper-at-least-32-bytes
ADMIN_AI_BROWSER_CHALLENGE_SECRET=compass-local-only-browser-challenge-secret-at-least-32-bytes
COMPASS_EDGE_ALLOWED_ORIGINS=http://127.0.0.1:4173
PHASE730_ADMIN_IDENTITY_ENABLED=true
PHASE730_ADMIN_AI_UNLOCK_ENABLED=true
PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED=false
PHASE730_C1_GOOGLE_AI_MASTER_ENABLED=true
PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED=true
PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED=false
PHASE730_ADMIN_ENVIRONMENT_ID=00000000-0000-4000-8000-000000000730
```

Then keep the local Functions server running in terminal 1:

```bash
npx supabase functions serve --env-file .env.edge.e2e.local
```

In terminal 2, start the local browser suite. The runner creates short-lived,
per-project Google AAL2/Auth fixtures and cleans them up; no shared Admin PIN is
accepted or configured:

Git Bash:

```bash
npm run test:e2e:local
```

PowerShell:

```powershell
npm.cmd run test:e2e:local
```

The local runner obtains the API URL and publishable key from
`supabase status -o env`; it aborts if the URL is not `localhost` or
`127.0.0.1`.

## Tests intentionally excluded from CI

The following remain manual, explicitly paid or hosted checks:

- `test:phase5-openai-live`
- `test:phase6-openai-live`
- real microphone/Realtime transcription testing
- Cloudflare Publisher/R2 production uploads
- Hosted Supabase and public-web smoke testing
- execution of `scripts/phase7-30f-hosted-readonly-preflight.sql` or collection
  of a real Phase 7.30F evidence manifest
- signed Presenter installer, real Office/COM, 500 transitions and venue/PNA
- real-account Admin AI PIN, browser CryptoKey persistence/signature,
  Google/TOTP factor-set invalidation and remembered-browser Human testing

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
