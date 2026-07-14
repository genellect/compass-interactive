# Phase 2 requirements and implementation audit

Date: 2026-07-14 (JST)

Scope: local implementation and local validation only
Production state: not applied; Phase 1 and Phase 2 feature flags remain OFF

## Audit method

This matrix is based on the repository implementation, not only on
`PROJECT_GUIDE.md`. The audit covered:

- migrations from the remote baseline through Phase 1;
- public/private RPC definitions, function privileges, RLS policies and indexes;
- the `manage-lectures`, `manage-polls`, and `update-display-state` Edge Functions;
- student comment, like, poll-response, snapshot, and participant-state paths;
- `CompassStateContext`, adaptive polling, local session persistence, and optimistic writes;
- pgTAP, frontend, static-schema, and load-test coverage.

Status meanings:

- **Implemented**: the current code already meets the Phase 2 requirement.
- **Partial**: a useful component exists, but the requirement is not safe end to end.
- **Missing**: no current implementation provides the required guarantee.

## Requirement-to-implementation matrix

| ID | Requirement | Current status | Evidence in current implementation | Phase 2 local change |
| --- | --- | --- | --- | --- |
| P2-01 | Server-time 90-minute hard stop | **Missing** | `admin_set_lecture_status` accepts an Edge-generated `transition_at`; `lecture_sessions` has only nullable `starts_at`/`ends_at`. | Add canonical `started_at`, `hard_stop_at`, `closed_at`; start uses DB `statement_timestamp()` and fixes hard stop at start + 90 minutes. Caller time becomes compatibility-only and is ignored. |
| P2-02 | Manual and automatic close use one idempotent transition | **Partial** | Manual close updates `lecture_sessions` and polls atomically, but a retry returns `false`; no automatic worker exists. | Route manual close, deadline reconciliation, and batch maintenance through one row-locking close primitive. A repeated close returns the persisted terminal result without duplicate side effects. |
| P2-03 | Auditable close reason, time, and actor | **Missing** | Only `status` and `ends_at` are retained. | Add close metadata and an append-only lifecycle event table with one terminal-close event per lecture. |
| P2-04 | Expiry works with every browser closed | **Missing** | No database scheduler/worker entry point. | Add a bounded, retry-safe database maintenance function. Production Cron installation is a Phase 6 runbook step; local tests invoke the same worker directly. |
| P2-05 | Writes fail after deadline even if Cron is down | **Partial** | Phase 0 RLS calls `private.is_lecture_open`, but it uses legacy `ends_at`; admin PDF and poll functions check stored status only. | Make `private.is_lecture_open` hard-stop aware and update every student/admin mutation guard to use effective-open semantics. Read RPCs lazily reconcile expired lectures. |
| P2-06 | Closed lectures reject comments, likes, poll responses, snapshot/display writes and AI starts | **Partial** | Student RLS rejects writes after stored close; PDF display and admin poll operations can accept an expired-but-still-`open` row; no AI path exists. | Preserve ownership checks, strengthen effective-open guards, and add tested AI operation admission control. |
| P2-07 | Clients converge to a terminal state and stop polling/subscriptions/AI/pending sends | **Partial** | `CompassStateContext` stops Phase 1 polling after receiving `status='closed'`; it does not purge optimistic pending comments or provide a closed-session one-shot archive read. | Normalize expired snapshots to closed, cancel/ignore pending UI completions, stop adaptive sync, and perform at most one archive read when the Phase 2 flag is enabled. |
| P2-08 | Phase 0 authentication, ownership and RLS are not weakened | **Implemented** | Participant ownership is bound to `auth.uid()`; comment/like/response policies use private ownership helpers; browser table grants are minimal. | Keep all policies and ownership predicates; add only stricter deadline predicates and deny-by-default RLS for new control/audit tables. |
| P2-09 | Phase 1 split snapshot protocol and old client compatibility survive | **Partial** | The v1 and v2 RPCs coexist and Phase 1 defaults OFF, but v2 may return persisted `status='open'` to a member after legacy expiry. | Replace function bodies without changing public signatures; keep both contracts; add terminal fields only inside JSON payloads; retain default-OFF flags. |
| P2-10 | AI enable/stop/usage/concurrency control foundation | **Missing** | Phase 1 has reserved caption/summary versions only. No control row, operation ledger, limit, reservation, heartbeat, or stop state exists. | Add one control row per lecture and a content-free operation/usage ledger. Admission locks the control row and checks lecture state, explicit feature enablement, hard limits, idempotency key, and concurrency. |
| P2-11 | AI operation ending after lecture close is stopped or discarded | **Missing** | No AI operation lifecycle. | Unified close marks control stopped and running operations cancelled; operation completion after close is recorded as discarded and cannot publish a result. |
| P2-12 | No OpenAI key or service role in public client | **Implemented** | Service-role use is limited to Edge Functions; no OpenAI integration/key is present in `src`. | Preserve this boundary. Phase 2 performs no OpenAI request and stores no provider credential. |
| P2-13 | 30-day retention origin and scope | **Missing** | No `archive_expires_at` or archive state exists. | Set `archive_expires_at = closed_at + interval '30 days'` once, from canonical close time. Retain public comments, summary placeholder data and PDF metadata; exclude participant-private poll/like state from archive payloads. |
| P2-14 | Recoverable, idempotent, retryable archive | **Missing** | No archive worker/state. | Use logical archive state first; do not physically delete in Phase 2. Batch claiming uses row locks and `SKIP LOCKED`; retries do not duplicate the archive event or break FKs. |
| P2-15 | Only lecture members can access the post-lecture preview | **Partial** | Closed members can read some live RPC data because membership is checked, but there is no expiry-bounded archive RPC. | Add an authenticated, one-shot archive RPC derived from `auth.uid()` membership and reject at the 30-day boundary. |
| P2-16 | Unrelated lectures cannot be ended or archived | **Partial** | Browser roles cannot call admin lifecycle functions, but service-role actions have no lecture-admin identity model beyond the existing Admin token. | Keep service-role-only mutation RPCs and validate target row/action atomically. Phase 2 records the existing Admin-session actor; per-teacher accounts remain out of scope and are documented as a Phase 6 gate item. |
| P2-17 | Deadline and archive indexes do not harm sync load | **Missing** | Existing `(status, starts_at, ends_at)` index does not cover the new hard stop/archive eligibility. | Add partial deadline and archive eligibility indexes; workers use bounded batches; no per-student maintenance calls or Realtime publication are introduced. |
| P2-18 | Full boundary, race, security, regression and load tests | **Missing** | Phase 0 has 27 pgTAP assertions and Phase 1 has 46; no Phase 2 tests or lifecycle-load scenario exists. | Add Phase 2 pgTAP coverage, adapt the old lifecycle regression to server time, run every SQL suite from clean and upgrade databases, and add 20/300-client analytical load tests. |

## Current write-path audit

| Write path | Current authorization | Deadline weakness before Phase 2 |
| --- | --- | --- |
| Comment insert | `authenticated`, Phase 0 RLS, owned participant, open helper | Helper is based on nullable legacy `ends_at`, not an immutable 90-minute deadline. |
| Comment like insert | `authenticated`, Phase 0 RLS, owned participant, visible comment | Same helper weakness. |
| Poll response insert | `authenticated`, Phase 0 RLS, owned participant, open poll/lecture helper | Poll helper repeats legacy time logic. |
| PDF/display update | service-role RPC through Admin Edge Function | Checks `status <> 'closed'`; an overdue stored-open lecture can still change. |
| Poll create/open | service-role RPC through Admin Edge Function | Checks stored status only. |
| Lecture start/close | service-role RPC through Admin Edge Function | Uses caller-provided time; close retry is treated as conflict; no common automatic transition. |
| AI start/finish | none | Missing. |
| Archive | none | Missing. |

## Security and compatibility constraints for implementation

- New public tables use RLS with no browser policies and explicit table grants.
- Public browser RPCs remain `SECURITY INVOKER` and derive ownership only from
  `auth.uid()` inside narrowly granted private helpers.
- Internal `SECURITY DEFINER` primitives live in `private`, use
  `search_path = ''`, schema-qualify every object, and have no browser execute
  grant.
- Service-role admin RPCs remain `SECURITY INVOKER` where possible and receive
  explicit execute grants only for `service_role`.
- Existing v1/v2 RPC names and argument signatures remain available.
- The Phase 1 flag stays OFF. Any Phase 2 client behavior is behind
  `VITE_PHASE2_LECTURE_LIFECYCLE=false` by default.
- Phase 2 contains no physical deletion, billing action, external deployment,
  Hosted configuration change, OpenAI call, Cloudflare call, or production
  migration.

## Low-risk assumptions

1. The canonical 90 minutes starts when the draft-to-open transition commits,
   not from an optional planned start time supplied when the lecture was created.
2. `ends_at` remains a compatibility projection of the hard stop/close time;
   new code uses `hard_stop_at` and `closed_at` as the canonical fields.
3. Phase 2 archive means reversible logical archival. Physical Supabase deletion
   and Cloudflare object deletion require a later, separately approved retention
   workflow.
4. The archive preview contains public comments and PDF metadata available in
   the current schema. AI summary rows do not exist yet, so the response exposes
   an empty summary collection until their later expand migration.
5. The existing Admin token is the actor boundary for Phase 2 lifecycle actions.
   Billing PIN and individual teacher identity are Phase 4 concerns and will not
   be invented in this phase.
