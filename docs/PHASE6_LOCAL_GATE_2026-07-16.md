# Phase 6 local gate record

Date: 2026-07-16 (JST)

Decision: **PASS - local five-minute summaries, comment pulse and Admin review**

Production decision: **HOLD**. No production Supabase migration/setting/secret,
Cloudflare resource, public Web deployment, feature flag, Hosted configuration,
external service or Git remote was changed. All Phase 1-6 feature flags remain
OFF by default.

## Delivered

- Server-time deterministic five-minute windows and actor-bound summary runs.
- One Billing PIN start, free stop, Batch-lane admission and maximum 18 provider
  attempts per lecture including schema retries.
- One low-cost Luna request for recap, comment pulse and Admin-only academic
  candidate, with strict schema and deterministic quality/evidence gates.
- No raw transcript/PDF/audio in Supabase and no secret in browser code.
- Immutable AI/Admin revision history with publish/hide/pin/unpin/correct flow.
- Compact v4 snapshot and v3 archive delivery through existing polling.
- Default-OFF teacher/student UI with server-clock scheduling and local hide.

Detailed architecture, state/failure behavior, cost control, migration and
rollback are in `PHASE6_FIVE_MINUTE_SUMMARIES.md`. The inspected baseline and
threat controls are in `PHASE6_REQUIREMENTS_AND_THREAT_MODEL.md`. Human-only
work is isolated in `PHASE6_HUMAN_TEST_CHECKLIST.md`.

## Database gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Clean Phase 0 -> 6 reset | PASS | All 12 migrations applied from an empty local PostgreSQL 17 database |
| Existing Phase 5 data upgrade | PASS | Phase 5 fixture preserved; Phase 6 migration applied independently |
| Upgrade assertions | PASS | 15/15 pgTAP assertions |
| Full SQL regression | PASS | 13 pgTAP files, 557 assertions |
| Phase 6 SQL suite | PASS | 59 assertions |
| Phase 4.1 real concurrency | PASS | Parallel start/finish/stop/close completed without deadlock |
| DB lint | PASS | public/private warning threshold, no findings |
| Local Advisor equivalent | PASS | security Advisor suite, RLS/grants and DB lint passed |
| Realtime boundary | PASS | no Phase 6 table in the Realtime publication |

The gate caught and fixed an actual completion-replay defect: a lost successful
HTTP response followed by client replay initially raised `summary window not
found`. The final RPC returns the existing summary ID without duplicating a
ledger row, result or revision. It also caught and fixed conservative accounting
for timeout/5xx failures with unknown provider usage.

## Application, Edge and E2E gates

| Gate | Result |
| --- | --- |
| TypeScript `--noEmit` | PASS |
| Phase 3 Publisher/Worker TypeScript | PASS |
| Oxlint | PASS, zero warnings |
| Phase 6 helper/quality/cost suite | PASS, 6/6 |
| Phase 6 static/default-OFF suite | PASS |
| Phase 6 20/300 load model | PASS |
| Existing Phase 0-5 frontend/Edge/static/load suites | PASS |
| Production frontend build | PASS |
| Desktop student/Admin browser shells | PASS; no console warning/error or horizontal overflow |
| Mobile student/Admin browser shells | PASS; no console warning/error or horizontal overflow |
| Default-OFF browser behavior | PASS; Phase 6 Admin panel absent, existing demo recap intact |
| Real OpenAI Phase 6 contract | PASS once; synthetic non-personal data only |

The real contract used `gpt-5.6-luna`, strict structured output, 559 input and
519 output tokens and calculated USD 0.003673. Provider content, request ID and
key were not printed or stored. It will not be repeated during ordinary
regression.

## Load and cost gate

| Scenario | Existing student snapshots | Phase 6 added student calls | Added Realtime subscriptions | Batch concurrency |
| --- | ---: | ---: | ---: | ---: |
| 20 students / 90m | 21,600 | 0 | 0 | 1 |
| 300 students / 90m | 324,000 | 0 | 0 | 1 |

Worst-case reservation is USD 0.0472 per provider attempt. The hard maximum of
18 attempts, including structured-output retries, is USD 0.8496. Windows with
both insufficient lecture source and quiet discussion make no provider call;
active comment-only windows still use the same capped admission path.
Timeout/5xx with unknown usage retains the reservation, preventing a failure
loop from understating the lecture budget.

The paid-admission RPC independently rechecks the bounded source counts and
current comment activity immediately before reservation. A state change after
the no-cost preflight therefore cannot create an empty paid operation.

## Human test and production hold

Real microphone/audio, a full 90-minute lecture, multi-device Admin token
separation, teacher educational-value judgment, accessibility sign-off, a real
Publisher PDF, Hosted Advisors/limits and 20/300-person canaries remain human
work. See `PHASE6_HUMAN_TEST_CHECKLIST.md`.

## Repository and rollout integrity

`PROJECT_GUIDE.md` was not edited, formatted, staged or committed. Ignored
`.env.local`, secrets, provider response content, generated build output and
local Supabase state are excluded. The Phase 6 independent commit hash is
reported in the handoff because a commit cannot contain its own final hash.

Production application remains a later explicit task: backup, migration,
Advisors, Edge functions OFF, frontend OFF, two-user separation, 20-person
canary, measured monitoring and only then staged expansion. No push is included
in this local gate.
