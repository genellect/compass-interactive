# Phase 6.6 Local Gate

Date: 2026-07-16 JST

Decision: **PASS for local code, database and build gates.**

Production deployment, Git push, Hosted Supabase changes, Cloudflare changes,
external scheduler creation and feature-flag activation were not performed.
The independent commit hash is reported in the final handoff.

## Scope accepted

- Teacher lecture history, safe lecture duplication/restart and six-digit new
  codes.
- One primary PDF-publication flow with the one-time local Publisher pairing
  retained as a security boundary.
- Admin PDF preview/page control, bounded Poll history and API PIN wording.
- Mobile-first student order: PDF, fresh captions, five recent comments,
  composer, active Poll, useful recaps, reviewed material summary and exit.
- Separate non-polling comment history.
- Nullable per-comment nickname, maximum ten characters and anonymous default.
- Read-only Cloudflare archive for closed lecture codes.
- Approximate active participant count folded into the existing five-second
  snapshot, with 45-second writes, 90-second expiry and 15-second shared cache.
- Admin-only comment moderation and scoped Admin/classroom snapshot access.
- Explicit Realtime-only start, duration reservation, trusted SDP exchange and
  retryable server-side provider hangup.
- Daily 20:00 JST activity/cost digest queue.
- Private R2 archive export, Turnstile, two rate limits and a failed-code
  Durable Object guard.

## Database gates

### Clean migration

- Docker Desktop 4.82.0 / Engine 29.6.1: PASS.
- All migrations from the immutable baseline through
  `20260717090500_phase6_6_realtime_provider_control.sql`: PASS from a recreated
  database.
- Final local database was reset again and left in a clean fully migrated
  state.

### Upgrade migration

The database was reset to `20260716073719_production_gate_hardening.sql`. A
representative open lecture with a legacy code, participant, nickname-bearing
comment and current PDF page was inserted. Both Phase 6.6 migrations were then
applied with `migration up`.

Verified after upgrade:

- lecture status and legacy code preserved;
- current PDF page preserved;
- participant and comment preserved;
- participant and visible-comment metric backfills equal one;
- active-presence backfill equal one;
- new Realtime provider table present;
- legacy v4 snapshot RPC still present.

Result: PASS.

### pgTAP and concurrency

- 17 SQL files.
- 837 assertions.
- Clean database: PASS.
- Existing-data upgrade database: PASS.
- Final clean database: PASS.
- Phase 4.1 real concurrent start/finish/stop/close test: PASS without deadlock.

### DB lint / Advisor-equivalent

- Errors: 0.
- Warnings: 4, documented and accepted.

The warnings are compatibility parameters intentionally retained by the v5 and
operator snapshot signatures. Metrics are returned every five seconds because
active attendance can change by time expiry without a row mutation. The
15-second lecture-scoped indexed cache bounds the count query, and the modeled
load remains within target.

## Frontend, Edge, Publisher and Worker gates

- TypeScript application typecheck: PASS.
- Publisher/Worker TypeScript typecheck: PASS.
- oxlint: PASS.
- Production Vite build and route-entry generation: PASS.
- `git diff --check`: PASS.
- Phase 0-6.6 mock/static/security/load regressions: PASS.
- Publisher validation, pairing, retention and loopback-origin tests: 10/10
  PASS.
- Worker PDF, archive, Turnstile, rate-limit, Durable Object and retention
  tests: 11/11 PASS.
- Phase 6.6 archive Edge tests: 7/7 PASS.
- Phase 6.6 daily digest tests: 7/7 PASS.
- Phase 6.6 archive session-storage tests: 3/3 PASS.
- Realtime trusted SDP/hangup helper tests: PASS.
- Cloudflare production Worker dry-run: PASS.

The dry-run bundle contains:

- private `PDF_BUCKET`;
- `ARCHIVE_FAILURE_GUARD` Durable Object;
- 600/min IP rate limiter;
- 12/min archive resolver limiter;
- exact production Origin and Turnstile hostname settings.

## HTTP and UX gates

Production build HTTP smoke returned status 200 and the React root for:

- `/join`
- `/lecture`
- `/lecture/comments`
- `/lecture/archive`
- `/admin`
- `/display`
- `/demo`

Exact Edge DevTools mobile emulation at 390 x 844 confirmed:

- `innerWidth = clientWidth = scrollWidth = 390`;
- Join card bounds `left=16`, `right=374`;
- full COMPASS brand and Demo navigation fit in the header;
- Demo route converges to `/lecture`;
- semantic mobile order is PDF, caption, comments, composer, Poll, recap,
  material summary, exit;
- Demo participant label is `221人参加`;
- no document-level horizontal overflow.

Desktop Demo and Admin login captures showed no material layout break. Student
desktop retains the established PDF/Poll split while the DOM remains
mobile-first.

## Load model

For a 90-minute lecture:

| Scenario | Snapshot calls | Presence writes max | Shared count refreshes |
| --- | ---: | ---: | ---: |
| 20 students | 21,600 | 2,400 | 360 |
| 300 students | 324,000 | 36,000 | 360 |

The v5 initial comment cap is five. Comment history is requested only by an
explicit page visit. There are no new student Realtime subscriptions and PDF
bytes remain outside Supabase.

## Accepted local limitations

- Repository-wide Prettier is not a usable gate because the existing baseline
  contains 216 unrelated nonconforming files, including the user-managed
  `PROJECT_GUIDE.md`. No bulk formatting was performed.
- Four DB lint compatibility warnings remain as documented above.

## Human / hosted hold

The items in `PHASE6_6_HUMAN_TEST_CHECKLIST.md` require real credentials,
devices, external providers or a scheduled time. They do not block the local
gate, but they block final production activation.
