# Phase 4.1 AI concurrency lanes

Date: 2026-07-15 (JST)

Status: local implementation complete; production rollout remains deferred to
the combined Phase 6 gate. Phase 4 flags remain OFF by default.

## Outcome

Phase 4.1 removes the single-slot conflict between a 90-minute Realtime caption
session and bounded Phase 5/6 text work. It does not add a public preview route,
frontend feature, OpenAI model call or hosted configuration.

Each lecture has two fixed execution lanes:

| Lane     | Features                                                                 | Running limit |
| -------- | ------------------------------------------------------------------------ | ------------: |
| Realtime | `captions`                                                               |             1 |
| Batch    | `summaries`, `material_analysis`, `poll_suggestions`, `academic_answers` |             1 |
| Global   | Realtime plus Batch                                                      |             2 |

`max_concurrent_operations=2` is the normal default. Setting it to 1 remains
an emergency serialization/cost-control option. Values above 2 do not bypass
the lane invariants.

Phase 5's initial material analysis and Poll proposals remain one
`material_analysis` operation. A later, explicit extra Poll request uses
`poll_suggestions`, after the previous Batch operation finishes.

## Authoritative state and invariants

`ai_usage_ledger` running rows are authoritative. The existing
`lecture_ai_control.active_operation_count` is retained for compatibility and
observability, but is recomputed from the ledger after every operation
transition.

Two partial unique indexes enforce the final database boundary:

- `ai_usage_ledger_running_realtime_uidx`: one running caption per lecture;
- `ai_usage_ledger_running_batch_uidx`: one running bounded text operation per
  lecture.

The admission RPC also checks the lanes before insert. Existing clients still
receive `reason=concurrency_limit`; new callers may inspect
`concurrency_lane=realtime|batch|global` and `retryable=true`. A unique-index
race is translated to the same response rather than leaking a raw SQL error.

Idempotency is checked before lane admission. A retry with the same lecture,
feature and key returns the existing operation without consuming a second slot
or reservation.

## Lock order and short transactions

All lecture-scoped AI transitions use this order:

1. `lecture_sessions`;
2. `lecture_ai_control`;
3. `ai_usage_ledger`, ordered by operation ID;
4. the bounded public caption row when publication or deletion requires it.

Billing consumption owns its one-use `ai_billing_grants` row first, then enters
the same lecture -> control -> usage order. No function that already owns a
control or usage row subsequently locks a billing grant.

Grant issuance no longer invokes the caption reaper. It locks only the lecture
and PIN rate-limit row. Grant consumption reconciles stale captions after
locking the grant. The standalone reaper follows lecture -> control -> usage
and retains `SKIP LOCKED` for service-worker retries.

The following Phase 2/4 functions are replaced without changing their public
signatures:

- unified lecture close;
- AI start, generic finish and control stop;
- billing grant issue and consume;
- Realtime caption finish, reaper and heartbeat;
- completed caption publication.

OpenAI/WebRTC calls remain outside database transactions. Phase 4.1 adds no
network call and does not expose the service role, billing PIN or OpenAI key.

## State and failure behavior

| Event                            | Result                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Caption starts, no Batch         | count 1, status `running`                                               |
| Batch starts while caption runs  | count 2, status `running`                                               |
| One lane finishes                | count 1, other lane remains `running`                                   |
| Caption stops while Batch runs   | captions disabled; Batch and whole control remain `running`             |
| Both lanes finish                | count 0; `ready` if any feature is enabled, otherwise `disabled`        |
| Whole-control manual stop        | every running ledger row becomes `cancelled`; count 0, status `stopped` |
| Lecture close/hard stop          | both lanes cancelled through the unified terminal transition            |
| Late provider result after close | not accepted; no result publication                                     |
| Stale caption heartbeat          | only Realtime is reaped; an active Batch operation is preserved         |
| Counter drift                    | private repair recomputes the cache from running ledger rows            |

The private repair function preserves explicit `stopping`, `stopped` and
`failed` states by default. It has a fixed empty search path and no execution
grant to `service_role`, `authenticated` or `anon`; only database-owner
maintenance and internal Definer functions may use it.

## Billing-grant bundles

One grant consumption may atomically start:

- one Realtime operation;
- one Batch operation; or
- one operation from either lane.

Two requested operations in the same lane return
`reason=grant_lane_conflict`, and the grant remains `issued`. If a later
operation fails normal admission, the existing exception boundary rolls back
all earlier starts and leaves the one-use grant unconsumed.

## Migration and rollback

Migration `20260715145555_phase4_1_ai_concurrency_lanes.sql` is expand-first.
It performs these steps:

1. fail loudly if existing data already has more than one running row in a
   lane;
2. change the new-row default from one to two and backfill existing value 1;
3. add the two partial unique indexes;
4. reconcile cached counts from the ledger;
5. replace private primitives while preserving every public RPC signature and
   grant.

It never auto-cancels an ambiguous duplicate, deletes accounting data, drops a
column or changes an exposed RLS policy. No Phase 4.1 table is added to
`supabase_realtime`.

Before Phase 5 use, rollback may restore the previous functions, remove the two
indexes and return the default/backfilled ceiling to one. After Phase 5 begins,
rollback must occur only after stopping all operations; returning to one slot
while captions run would intentionally block Batch work. Usage, grant and audit
rows must always be preserved, with repair-forward preferred over destructive
down migration.

## Load boundary

Phase 4.1 adds no student request, snapshot field, Postgres Changes
subscription, caption write or stored content. Admission counts at most two
indexed running rows per lecture. Therefore both target scenarios retain their
existing student snapshot counts:

| Scenario            | Existing 5-second snapshots | Added student calls | Max running ledger rows |
| ------------------- | --------------------------: | ------------------: | ----------------------: |
| Free MVP / 20 / 90m |                      21,600 |                   0 |                       2 |
| Pro / 300 / 90m     |                     324,000 |                   0 |                       2 |

The additional work is limited to teacher/service-side operation transitions
and two tiny partial indexes. Phase 5 model price and call frequency remain a
separate gate.

## Production sequence after Phase 6

1. Keep all Phase 1-5 flags OFF and confirm no running AI operation.
2. Back up production and query for duplicate running rows per lane.
3. Apply migrations in order; do not apply Phase 4.1 alone ahead of Phase 1-4.
4. Verify index existence, function grants, RLS and cached-count equality.
5. Run hosted Advisor and two-user ownership regression.
6. Deploy Edge/frontend with flags OFF.
7. In the controlled canary, verify one caption plus one Batch operation,
   duplicate-lane rejection and stop/close convergence before enabling Phase 5.
