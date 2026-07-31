# Phase 7.28 Local Gate - 2026-07-31

## Decision

**AUTOMATED LOCAL GATE: PASS**

**HUMAN UI GATE: HOLD**

**HOSTED SUPABASE/CLOUDFLARE GATE: HOLD**

**FORMAL PRODUCTION GATE: HOLD**

This record covers Phase 7.28A-C on the independent local candidate commit that
contains this file. It authorizes no hosted migration, secret or flag change,
paid OpenAI call, push, merge or deployment.

## Requirement disposition

| Area             | Implemented result                                                                                                                                                | Local evidence                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 7.28A            | One-off Journal Club rehearsal/production creation is hidden and rejected by default; history, Polls and archives remain compatible                               | Static/Edge tests plus flag-OFF 4/4 and recovery flag-ON 28/28 browser checks                        |
| 7.28B            | One Admin-issued, first-claimer-UID-bound private Display identity accelerates committed PDF pages and bounded captions; students remain on five-second snapshots | 64 pgTAP assertions, lock-order race, static security, local Edge/DB E2E in 3 browsers               |
| 7.28C            | One lecture/Admin-session/actor-bound master authorization exposes two exact scopes; each explicit paid start still consumes a fresh child grant                  | 56 pgTAP assertions, consume/revoke races, static and actual browser-to-Edge-to-DB E2E in 3 browsers |
| Summary recovery | Authorization and running state are separate; due server-time windows catch up on focus, visibility, online and pageshow with one in-flight scheduler             | Static/non-live tests and C E2E                                                                      |

## Security and failure behavior

- Raw Display tokens, API PINs and service-role credentials are not persisted
  or exposed to the public bundle.
- Display requires signed token claims, hashed JTI registration, first Display
  `auth.uid()`, exact lecture/topic, active issuing Admin session, open
  lifecycle and the DB runtime gate. Cross-user replay and claimed-token
  fallback fail closed.
- Private Broadcast carries no audio. Caption text is capped at 4,000
  characters and the request at 12 KiB; students have no new Realtime policy.
- Durable snapshot state remains authoritative. Relay failure does not roll
  back a page, stop transcription or create student requests.
- Registered Display bindings are checked even after an Edge flag rollback.
  DB-runtime shutdown permits snapshot/PDF downgrade only to the same claimed
  anonymous UID. A service-role-only RPC rechecks gate, binding/lecture lifetime
  and issuing Admin revoke/absolute/idle expiry on every request; replacement,
  Admin revocation and cross-UID replay fail closed on the live/rollback path.
  The established signed terminal-Review window remains a distinct
  time-bounded capability and does not authorize live Display access.
- A new Display registration permanently fences any runtime-downgraded
  predecessor; the old screen clears on its next bounded snapshot and cannot
  regain access if the replacement later stops.
- AI authorization stores no PIN and creates no billing grant, reservation,
  microphone request or provider call. Every explicit start rechecks scope,
  actor, lecture state, budget, concurrency and idempotency.
- Master revoke, Admin-session revoke, hard stop and lecture close revoke
  pending child grants and converge running work to a terminal state. Stop and
  revoke are free and idempotent.
- Critical findings: 0. High findings: 0.

Accepted Medium operational constraints are not hidden:

1. legacy unbound Display tokens remain a short-lived expand-first snapshot
   compatibility route; production claim-only cutover requires refreshed Admin
   clients and expiry of the maximum 95-minute token lifetime;
2. one-time claim is auth-UID-level, so tabs sharing that same browser profile
   can share the topic; it is not a strict tab lock;
3. while an AI master is active, old direct-PIN clients are rejected to prevent
   double admission; all Admin clients must refresh before activation;
4. AI event rows are content-free and field-size bounded, but row-count cleanup
   is deferred to a later retention contract.

## Final automated evidence

| Gate                             | Result                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean migration                  | PASS; 30 migrations applied from the remote baseline through both Phase 7.28 migrations                                                                                                                                                                          |
| Full pgTAP                       | PASS; 27 files, 1,303 assertions                                                                                                                                                                                                                                 |
| Phase 7.28 B/C pgTAP             | PASS; B 64 / C 56, included above                                                                                                                                                                                                                                |
| Populated Phase 7.27 upgrade     | PASS; both additive migrations applied and 20/20 preservation assertions                                                                                                                                                                                         |
| Concurrency/lock order           | PASS; Phase 4.1, 7.26, 7.27, 7.28B issue/revoke and 7.28C consume/revoke races; no deadlock or residual work                                                                                                                                                     |
| DB lint/Advisor equivalent       | PASS; error 0; four pre-existing extra unused-parameter warnings only                                                                                                                                                                                            |
| Generated DB types               | PASS; deterministic and current                                                                                                                                                                                                                                  |
| Non-live regression              | PASS; 58 groups                                                                                                                                                                                                                                                  |
| Type/lint                        | PASS; app, Phase 3 and E2E typechecks; lint error 0 with two pre-existing exhaustive-deps warnings                                                                                                                                                               |
| Production build/bundle          | PASS; Admin JS 92,109/92,109 bytes, CSS 87,734/88,449, index/PDF within budget                                                                                                                                                                                   |
| Secrets/dependencies/diff        | PASS; 485-file secret scan, 0 audit vulnerabilities, only `react-router@8.3.0`, `git diff --check` clean                                                                                                                                                         |
| 7.28A browser modes              | PASS; OFF 4/4 (28 intentional skips), recovery ON 28/28 (4 intentional skips) across Desktop/Mobile Chromium/WebKit                                                                                                                                              |
| 7.28B browser integration        | PASS; Desktop Chromium, Desktop WebKit and 390px Mobile Chromium, including private claim/replay, runtime-gate same-UID snapshot/PDF fallback, cross-UID rejection, issuing-Admin revoke fence, permanent replacement fence, terminal behavior, keyboard and axe |
| 7.28C browser integration        | PASS; Desktop Chromium, Desktop WebKit and 390px Mobile Chromium, including master authorize/child start/atomic stop and zero summary RPC during the post-stop 5.5-second scheduler interval, keyboard and axe                                                   |
| Existing local lecture lifecycle | PASS; 3/3 across Desktop Chromium, Desktop WebKit and Mobile Chromium                                                                                                                                                                                            |
| Demo stability                   | PASS; 108 tests, 168 intentional feature-mode skips, three repetitions across Desktop/Mobile Chromium/WebKit; accessibility, keyboard and visual contracts included                                                                                              |
| In-app browser review            | PASS; A hidden, B/C controls present, 390px horizontal overflow 0, console warning/error 0                                                                                                                                                                       |
| Load/cost boundary               | PASS; 20 students 21,600 snapshots; 300 students 324,000; 90-minute Display max 11,881 relays; modeled monthly incremental Edge 49,788; student-added Realtime/requests 0                                                                                        |

Known benign browser warnings from PDF.js test fixtures (`TT: undefined
function` and missing local Helvetica-Bold) did not appear in the final in-app
Admin review and are not application console errors or data-integrity failures.

## Rollback contract

### 7.28A

Leave both creation flags OFF. Enable them only for an explicitly reviewed
recovery exercise. No data/schema rollback is required.

### 7.28B

1. Disable the DB runtime gate first. This blocks new issue/claim/relay work and
   terminalizes active bindings atomically.
2. Verify active bindings are zero, the same claimed Display has converged to
   the five-second snapshot/PDF path, and a different UID is still rejected.
3. Disable Edge and frontend flags.

Additive tables/functions remain. Do not drop them during incident response.

### 7.28C

1. Disable server start/child issuance while retaining status, free revoke and
   service-role drain.
2. Drain active masters to zero and stop already-admitted work through existing
   stop paths.
3. Hide the frontend master UI. Direct-PIN compatibility resumes only after
   masters are terminal.

## Production prerequisites

1. Archive the currently deployed frontend/Edge/migration state and record
   owner, change window, stop thresholds and rollback window.
2. Apply additive migrations with every Phase 7.28 flag OFF; run hosted Advisor,
   DB lint and two-user/two-lecture ownership tests.
3. Keep 7.28A recovery flags OFF. For B, enable DB runtime, then Edge, then
   frontend. For C, enable server admission before frontend.
4. Refresh all Admin clients and wait out the legacy Display-token TTL before
   treating claim-only behavior as enforced.
5. Verify private Broadcast policy, message/connection telemetry, terminal
   revocation and student Realtime count zero in a hosted canary.
6. Verify AI master authorization first with no-provider operations, then a
   separately approved bounded paid canary and free-stop drill.
7. Exercise the documented B and C rollback sequences, hourly cleanup ownership
   and failure monitoring.
8. Complete teacher Display/Admin UX, real microphone, real phone,
   accessibility and human review. Record a separate Production Gate decision
   before normal activation.
