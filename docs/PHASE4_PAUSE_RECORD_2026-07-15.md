# Phase 4 safe pause record

Date: 2026-07-15 (JST)

Status: **RESUMED — superseded by the Phase 4 PASS record**

Resumption decision: the developer explicitly deferred the real
microphone/WebRTC canary to a later phase. The provider client-secret boundary,
mocked WebRTC event flow and isolated browser/DB flow are the Phase 4 local
gate; live audio quality and latency are Phase 6 canary measurements.

Production status: **UNCHANGED / HOLD**. No production Supabase migration,
Hosted setting, Hosted secret, Cloudflare resource, public Web deployment,
feature-flag activation, external service configuration change or Git push was
performed. The committed Phase 1-4 feature flags remain OFF.

## Work completed in this continuation

- Confirmed `OPENAI_API_KEY` and `BILLING_PIN` are each present exactly once in
  ignored `.env.local`. Their values were never displayed, copied into source,
  logged or committed.
- Fixed the Admin Realtime-caption start guard to use the Admin-owned lecture
  list state. The previous participant-owned context snapshot is legitimately
  unavailable to an Admin who is not a participant, and incorrectly kept the
  start button disabled for an open lecture.
- Added a Phase 4 static regression assertion for that Admin-owned status
  selection.
- Kept `PROJECT_GUIDE.md` untouched, unstaged and outside every Phase 4 change.

## Browser verification

An isolated local Supabase/Vite environment and non-production PIN fixtures
were used. No real key was placed in the browser.

- Admin login, lecture creation and lecture start succeeded.
- The Realtime-caption start button was disabled without a billing PIN and
  enabled only after a billing PIN was entered for an open Admin-owned lecture.
- With the server feature flag OFF, start failed closed with HTTP 503, cleared
  the PIN, disabled automatic reconnect and required a new PIN for restart.
- Stop remained available without a PIN and returned the control to `stopped`.
- A completed caption fixture appeared in the student caption panel after the
  five-second snapshot interval; no delta or Realtime subscription was used.
- Manual lecture close converged the student client to the lecture-ended state
  after the next snapshot, disabled posting controls and cleared the public
  caption.
- Caption, five-minute recap and comments remained separate UI regions.

## Database and migration verification

Validation stack: isolated local Supabase/PostgreSQL 17 on the Phase 4
validation ports.

- Clean reset applied all nine Phase 0-4 migrations from an empty database.
- Upgrade reconstruction reset to Phase 3, inserted one open lecture, one
  participant and one comment, then applied Phase 4. All three rows remained,
  the old v2 snapshot RPC remained available and the new Phase 4 objects were
  present.
- The database was subsequently clean-reset through all nine migrations again.
- Full pgTAP regression passed twice: 399/399 assertions across 10 files.
  - Phase 0 auth hardening: 27/27
  - Phase 1 sync protocol: 46/46
  - Phase 2 lifecycle: 96/96
  - Phase 2 security/Advisor equivalent: 14/14
  - Phase 3 private PDF delivery: 51/51
  - Phase 4 billing/Realtime captions: 59/59
  - Existing baseline/Admin/live-state/PDF suites: 105/105
- `supabase db lint` passed for `public` and `private` with no warnings.
- Local Supabase security and performance Advisors reported no issues.
- Zero Phase 4 tables were found in the `supabase_realtime` publication.

## Frontend, Edge and load verification

The following all passed locally:

- Phase 0-4 frontend/static/unit regressions
- Phase 4 caption ordering/window/parser/export tests
- Phase 4 Edge billing/token/OpenAI helper tests with mock fetch
- 20-person Free and 300-person Pro, 90-minute load models for Phases 1-4
- Phase 3 Worker tests and Publisher tests (7/7)
- TypeScript no-emit checks for the app and Phase 3 publisher/worker scope
- Oxlint with zero warnings
- Production frontend build

## Real OpenAI provider-boundary verification

A single local, no-audio boundary test loaded the ignored real key and billing
PIN through a random OS-temporary env file. The file was zeroed and deleted in
`finally`; no secret or client token was printed.

- OpenAI issued a short-lived client secret for `gpt-realtime-whisper`.
- No WebRTC connection was created, no microphone permission was requested and
  no audio was sent.
- The operation was stopped immediately and finished `cancelled`; active
  operation count returned to zero and the token audit recorded one successful
  issuance.
- The conservative COMPASS ledger measured two seconds from secret issuance to
  stop and recorded 567 microUSD in the isolated budget ledger. This is not
  evidence of OpenAI audio billing because no audio session was created, but
  the permanent design record should explicitly document that local budget
  metering begins at secret issuance.

## Resumption outcome

- The developer resolved the microphone gate by deferring real microphone and
  WebRTC audio testing to a later-phase canary.
- Permanent Phase 4 design, threat-model and Local Gate records now include the
  isolated browser/DB flow, real no-audio provider boundary and conservative
  internal-metering evidence.
- The complete SQL, frontend, Edge, Publisher, Worker, load, type, lint and
  production-build regressions passed after the Admin status-guard fix.
- Final secret, bundle and diff checks are the last commit-time gate; their
  result and the independent commit hash belong in the final task report.
- Production Supabase, Hosted settings/secrets, Cloudflare, public Web,
  feature flags and Git remotes remain unchanged until the combined Phase 6
  rollout gate.
