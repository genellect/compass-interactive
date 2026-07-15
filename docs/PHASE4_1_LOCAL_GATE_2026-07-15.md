# Phase 4.1 local gate record

Date: 2026-07-15 (JST)

Decision: **PASS - local AI concurrency-lane implementation**

Production decision: **HOLD**. No production Supabase migration or setting,
Cloudflare resource, hosted secret, external service, public Web deployment,
feature flag or Git push was changed.

## Delivered

- One Realtime caption lane plus one bounded Batch lane per lecture.
- Global default ceiling two, with ceiling one retained as emergency
  serialization.
- Partial unique-index enforcement for both lanes.
- Ledger-authoritative counter reconciliation.
- Canonical lecture -> control -> usage lock order across close, start, finish,
  stop, reaper, heartbeat and publish.
- Grant -> lecture -> control -> usage order for paid start consumption.
- Atomic two-lane grant bundle and same-lane bundle rejection without grant
  consumption.
- Reproducible Phase 4 upgrade fixture/check and real multi-connection race
  harness.

Detailed behavior and rollback are in `PHASE4_1_AI_CONCURRENCY_LANES.md`.

## Database gates

| Gate                               | Result | Evidence                                                              |
| ---------------------------------- | ------ | --------------------------------------------------------------------- |
| Clean Phase 0 -> 4.1 reset         | PASS   | All ten migrations applied from an empty local PostgreSQL 17 database |
| Existing Phase 4 data upgrade      | PASS   | Running caption and issued grant preserved; ceiling backfilled to two |
| Upgraded caption plus new Batch    | PASS   | Batch admitted without stopping the pre-migration caption             |
| Full SQL regression                | PASS   | 11 pgTAP files, 444 assertions                                        |
| Phase 0 authentication regression  | PASS   | Original 27/27 Phase 0 assertions included                            |
| Phase 4.1 SQL suite                | PASS   | 45 assertions                                                         |
| Real multi-connection race         | PASS   | concurrent start/finish/stop/close; no deadlock or cache drift        |
| DB lint                            | PASS   | public/private PL/pgSQL: no warnings                                  |
| Local Security/Performance Advisor | PASS   | no warn-or-higher findings                                            |

The race harness verified that two simultaneous Batch starts admit exactly
one operation, a simultaneous caption and Batch start admit both, and
finish/stop/close contention converges without a timeout or stranded running
row.

## Load gate

| Scenario           | Added student calls | Added Realtime subscriptions | Maximum running ledger rows |
| ------------------ | ------------------: | ---------------------------: | --------------------------: |
| 20 students / 90m  |                   0 |                            0 |                           2 |
| 300 students / 90m |                   0 |                            0 |                           2 |

Phase 4.1 does not change the five-second snapshot protocol or caption publish
frequency. It adds an indexed count over at most two running rows during paid
operation transitions only.

## Application and repository gates

| Gate                                     | Result |
| ---------------------------------------- | ------ |
| TypeScript `--noEmit`                    | PASS   |
| Phase 3 publisher/Worker TypeScript      | PASS   |
| Oxlint                                   | PASS   |
| Existing frontend/Edge/static/load tests | PASS   |
| Phase 4.1 static and 20/300 load model   | PASS   |
| Production frontend build                | PASS   |
| Prettier check for changed JS/JSON/docs  | PASS   |
| `git diff --check`                       | PASS   |
| Changed-file credential/signature scan   | PASS   |

The real microphone/WebRTC test remains deferred by the developer and was not
repeated in Phase 4.1. This migration does not change the audio provider path.

## Deferred production work

1. Keep Phase 1-4 flags OFF until the combined Phase 6 rollout gate.
2. Run the already-deferred real microphone/WebRTC canary in the later phase.
3. Recheck current OpenAI models/prices and hosted limits before Phase 5/6
   activation.
4. Apply all pending migrations in order with a backup and duplicate-lane
   preflight; then run hosted Advisor and ownership separation tests.
5. Do not enable Phase 5 until the production canary confirms caption plus
   Batch coexistence and stop/close convergence.

## Workspace integrity

`PROJECT_GUIDE.md` remains a pre-existing unstaged user modification in the
primary checkout. Phase 4.1 does not edit, format, stage or commit it. Local
credentials and generated build/Supabase state remain ignored.
