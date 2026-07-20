# Phase 7.2 Local Gate - 2026-07-20

Base commit: `bad4097`
Implementation checkpoint: `2539ec2`
Decision: **PASS - Phase 7.2 automated Local Gate is complete**
Release decision: **HOLD - teacher literature review, Phase 7.1 real-phone QR,
hosted verification and production authorization remain outstanding**

## 1. Scope and protected work

The local scope covers verified-primary-literature retrieval, one bounded Luna
draft, exact usage settlement, teacher publication control, student/archive
projection and Phase 6.8-7.2 integrated regression. No live OpenAI call,
production service, flag, secret, push or deployment is part of this gate.

The following pre-existing user edits are protected and must remain unedited,
unstaged and uncommitted:

- `docs/PHASE6_6_INTEGRATED_UX_AND_OPERATIONS.md`
- `docs/PHASE6_6_LOCAL_GATE_2026-07-16.md`
- `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`

## 2. Automated evidence

| Gate | Result |
| --- | --- |
| Clean migration through Phase 7.2 | PASS |
| Phase 7.1 fixture upgrade migration | PASS - 12/12 assertions |
| Full Phase 0-7.2 pgTAP | PASS - 20 files / 963 assertions |
| App-schema DB lint | PASS - zero public/private errors; two pre-existing v5/v1 compatibility warnings remain non-blocking at warning level |
| Generated public DB types | PASS - regenerated; deterministic zero drift |
| Literature/Edge helper tests | PASS - 9/9 |
| Static security/integration | PASS |
| Identifier and claim quality fixture | PASS - 100% identifiers, 20/20 claims supported |
| 20/300-person load model | PASS - zero new periodic requests/subscriptions; maximum three calls/USD 0.0936 |
| Full non-live Phase 0-7.2 regression | PASS - 45/45 groups after the final UI fixes |
| TypeScript/lint/production build/bundle | PASS - all three typechecks, oxlint, production build and bundle ceilings |
| Demo Chromium/WebKit Desktop/Mobile, three repetitions | PASS - 60/60 after contrast/details fixes |
| Local Edge Auth/CORS/default-OFF smoke | PASS with synthetic local-only values |
| Local Supabase Chromium/WebKit/Mobile, three repetitions | PASS - 9/9 full lecture lifecycles |
| Secrets/dependency audit | PASS - 400-file secret scan; npm audit reported zero vulnerabilities |
| Final diff/independent Phase 7.2 completion commit | PASS - completion evidence is committed locally on the Phase 7.2 checkpoint branch |

The first local browser repetition correctly exposed a test-configuration
mismatch: the frontend Phase 7.2 flag was enabled while the synthetic Edge flag
remained disabled, so two expected fail-closed status requests returned 503.
The default-OFF smoke evidence was preserved, the synthetic Edge configuration
was then enabled to match the E2E frontend, and the unchanged product code
passed all nine repeated local lecture lifecycles. No provider credential or
OpenAI request was present in either configuration. The Edge process was
stopped and the ignored synthetic environment file was removed after testing.

## 3. Security and lifecycle findings resolved locally

1. Direct authenticated compatibility reads of comments/display state now
   require participant membership for the target lecture.
2. Academic operations cannot be finalized through the generic Batch endpoint;
   the dedicated exact-settlement path is mandatory.
3. Provider dispatch is recorded before network traffic. Free cancellation is
   possible only before dispatch; ambiguous dispatched work settles the bounded
   reservation and is never replayed automatically.
4. A two-minute stale lease plus five-minute cron/status reaper makes recovery
   idempotent when the browser or Edge request disappears.
5. Historical Phase 7.1 ledger cost/token/provider data survives migration and
   is marked settled without cost rewriting.
6. The admitted prompt version is stored with the immutable answer audit row.
7. Unapproved, failed, cancelled and late results do not enter student or
   archive projections.

## 4. Global gate classification

| Gate | Local result | Remaining evidence |
| --- | --- | --- |
| G0 traceability | PASS | base, checkpoint and completion evidence are branch-local and reviewable |
| G1 DB/authorization | PASS locally | hosted Advisor and two-user canary |
| G2 code/artifacts | PASS locally | committed-SHA hosted CI remains a Hosted Gate item |
| G3 UX/accessibility | AUTOMATED PASS | human teacher/student review |
| G4 browser/visual | AUTOMATED PASS | Phase 7.1 real-phone QR and human visual review |
| G5 load/cost | PASS modeled | observed canary usage and current hosted price check |
| G6 compatibility/recovery | PASS locally | production backup/rollback rehearsal |
| G7 evidence/release control | LOCAL PASS | committed-SHA hosted CI, human and hosted sign-off |

## 5. Human and hosted HOLD

Before Phase 7 production enablement, a human must:

1. review representative Japanese/English academic drafts against the linked
   papers and exercise approve, hide and reject;
2. confirm low-value/unsupported/conflicting questions produce no misleading
   student answer;
3. review Admin/student/archive focus, labels, source links, limitations and
   mobile/desktop visual hierarchy;
4. complete the Phase 7.1 real-phone QR scan;
5. run the committed SHA in hosted CI and preserve browser/security artifacts;
6. apply the OFF-first production runbook, run Advisor and two-user separation,
   then explicitly decide canary flag activation.

Until those records exist, Human Gate and Hosted Gate remain **HOLD** and no
production enablement is authorized.
