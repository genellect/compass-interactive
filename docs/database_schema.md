# COMPASS Interactive Database Responsibility Map

Last reviewed: 2026-07-21
Authority: `supabase/migrations/` and a clean local database generated from all
migrations

This document is a responsibility map, not a hand-maintained substitute for the
schema. Column types, constraints, functions and grants must be checked against
the migrations or generated database types before implementation.

## 1. Core lecture and participation

| Table group                                 | Responsibility                                                        |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `lecture_sessions`                          | Lecture identity, state and canonical lifecycle timestamps            |
| `participants`                              | Anonymous participant row owned by `auth.uid()` within one lecture    |
| `comments` / `comment_likes`                | Bounded comments, optional per-comment nickname and unique likes      |
| `polls` / `poll_options` / `poll_responses` | Poll definition and one owned response per participant                |
| `lecture_admin_codes`                       | Server-controlled Admin-to-lecture relationship; not student-readable |

The public API never treats a participant UUID supplied by a browser as proof
of ownership. Participant joins and writes must bind to `(select auth.uid())`.

## 2. Synchronization and display

| Table group                                  | Responsibility                                          |
| -------------------------------------------- | ------------------------------------------------------- |
| `lecture_live_state`                         | Section versions and bounded shared live projection     |
| `comment_like_totals` / `poll_option_totals` | Cached aggregates without exposing raw ownership rows   |
| `lecture_display_state`                      | Compatibility state for synchronized classroom display  |
| `lecture_participant_presence`               | Throttled, server-timestamped heartbeat per participant |
| `lecture_presence_metrics`                   | Shared approximate participant/comment counts           |

Phase 1 snapshot RPCs separate shared state from participant-specific state.
History is cursor-paginated and is not part of the periodic snapshot.
Phase 7.1 adds a participant-scoped partial history index and v3 on-demand RPC;
`mine` ownership is resolved from `auth.uid()` and does not expose a participant
identifier in the response.

`poll_result_refresh_events` is a legacy compatibility artifact. New work must
not create a new student Realtime dependency around it.

## 3. Lifecycle, archive and audit

| Table group                    | Responsibility                               |
| ------------------------------ | -------------------------------------------- |
| `lecture_lifecycle_events`     | Append-only start/close/archive audit        |
| `lecture_archive_state`        | Canonical archive access and retention state |
| `lecture_archive_exports`      | Leased, idempotent sanitized export outbox   |
| `lecture_join_rate_limits`     | Server-side lecture-code attempt control     |
| `comment_moderation_events`    | Auditable hide/restore/pin actions           |
| `daily_operations_digest_jobs` | One idempotent digest job per date/recipient |

The database uses server time for expiry. Manual and automatic close converge
on the same close core. Read/write RPCs independently reject an expired lecture
even when scheduled maintenance has not run.

## 4. PDF metadata

`lecture_pdf_documents` stores document identity, publication state, bounded
metadata, retention state and R2/manifest references. It does not store PDF
bytes or the extracted body text.

`lecture_pdf_publications` is the browser-publication saga row. It stores the
lecture/document/Admin/idempotency binding, expected hash/size, nonce/JTI
digests, operation leases, Worker receipts, manifest/access versions, terminal
cleanup state and audit timestamps. RLS is enabled, browser roles receive no
table grant/policy, and service-role-only SECURITY INVOKER RPCs perform every
transition after Edge validates the tracked Admin session.

PDF page state is synchronized through the shared lecture state. Students
download byte ranges through the Cloudflare Worker, not through Supabase.

## 5. AI control and usage

| Table group                                    | Responsibility                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `lecture_ai_control`                           | Per-lecture enable/stop state, budgets and concurrency ceilings |
| `ai_usage_ledger`                              | Reserved/final usage and cost accounting                        |
| `ai_billing_rate_limits` / `ai_billing_grants` | API-use PIN attempt and one-time start authorization            |
| `ai_realtime_token_audit`                      | Realtime secret issuance audit                                  |
| `ai_realtime_provider_calls`                   | Provider-call identity, deadline and idempotent hangup state    |
| `lecture_public_captions`                      | Bounded completed caption windows for snapshot delivery         |
| `academic_answer_requests`                     | Idempotent evidence/admission/provider-dispatch state           |
| `lecture_academic_answers`                     | Immutable answer identity, model and prompt audit               |
| `academic_answer_sources`                      | Verified bounded citation metadata; no abstract/body text       |
| `academic_answer_revisions`                    | Immutable AI/teacher answer bodies                              |
| `academic_answer_publications`                 | Hidden/public teacher-reviewed projection                       |

`lecture_ai_control.summary_language` stores the future-window preference.
Each `lecture_summary_windows` row snapshots `requested_language` and later
records `resolved_language`, reason and timestamp exactly once. These fields
contain metadata only, never source text.

Realtime and Batch use separate concurrency lanes. A failed or closed operation
must release its lane and finalize/discard through the existing idempotent
ledger path.

## 6. Material analysis, Poll proposals and summaries

| Table group                                        | Responsibility                                          |
| -------------------------------------------------- | ------------------------------------------------------- |
| `material_ai_operation_contexts`                   | Bounded operation input/evidence context                |
| `lecture_material_analyses`                        | Immutable analysis result and quality state             |
| `ai_poll_proposals`                                | Teacher-only Poll drafts; never automatic student Polls |
| `lecture_summary_runs` / `lecture_summary_windows` | Five-minute scheduling and idempotency                  |
| `lecture_ai_summaries`                             | Logical summary output                                  |
| `lecture_ai_summary_revisions`                     | Immutable AI/teacher revisions                          |
| `summary_publications`                             | Published/hidden/pinned student projection              |
| `lecture_material_summary_publications`            | Published material-summary projection                   |

Raw PDF text, raw transcript and audio do not belong in these tables.
Retrieved literature abstracts and article bodies also do not belong in these
tables. Phase 7.2 v6/v2/v4/v3 snapshot/archive functions project at most three
published answers and preserve older RPC versions for expand-first rollout.

## 7. RLS and grants

- Every application table in an exposed schema has RLS enabled.
- Data API access requires both an explicit grant and a matching row policy.
- `TO authenticated` is not authorization by itself.
- UPDATE policies require both `USING` and `WITH CHECK` plus any required SELECT
  policy.
- Public RPCs should remain `SECURITY INVOKER` unless privileged access is
  unavoidable.
- Privileged helpers belong in a non-exposed schema, use a fixed `search_path`,
  verify `auth.uid()` or trusted machine authentication and receive the minimum
  EXECUTE grant.
- Application functions must not retain an implicit `PUBLIC` EXECUTE grant.
- No public application table should be in the Supabase Realtime publication.
- The service role must never reach the browser.

## 8. Index and query rules

Indexes are selected for lecture-scoped and deadline-scoped access. New schema
work must review:

- lecture plus created-at cursor scans;
- lecture plus state/deadline maintenance scans;
- participant ownership and unique response/like constraints;
- presence expiry and shared count-cache refresh;
- AI operation state, lane and deadline cleanup;
- archive-export leases and retry availability.

Every new or changed periodic query requires `EXPLAIN` review and a 20/300-user
load comparison. Avoid an index added only to silence a lint rule without a
documented query.

## 9. Migration and generated types

Current migrations are ordered from the remote baseline through Phase 7.26.
The accepted workflow is:

1. create an additive migration with the pinned Supabase CLI;
2. apply all migrations from an empty local database;
3. apply the migration to the previous-Phase fixture;
4. run all pgTAP tests and DB lint;
5. regenerate TypeScript database types;
6. compare generated output in CI;
7. deploy capability with flags OFF;
8. defer destructive contract cleanup until old clients are retired.

Phase 6.9 will make generated database types a checked-in, deterministic CI
contract. Until then, `src/types/database.ts` must be reviewed against the local
schema during any DB phase.

## 10. Verification entrypoints

```bash
npx supabase db reset --local --no-seed
npx supabase test db --local
npx supabase db lint --local --fail-on error
npm run test:supabase:static
npm run typecheck
```

See `docs/supabase_setup.md`, `docs/SECURITY.md` and the applicable Phase gate
report before changing schema, grants, RLS, Cron or Edge configuration.

## 11. Phase 7.28 additive objects

`display_realtime_sessions` stores only server-side Display binding metadata:
lecture, issuing Admin session/user, first claimed Display auth UID, SHA-256 JTI
hash, random private topic, expiry/revocation and lifecycle timestamps. A
partial unique index permits at most one active binding per lecture. RLS is ON;
`anon` and `authenticated` have no table grant. Private service-role helpers
issue, claim, authorize a topic, terminalize and clean at most 500 old terminal
rows per hourly run. The service-role-only snapshot-fallback verifier joins the
runtime gate, binding, lecture and issuing `admin_sessions` row so Edge never
authorizes a rollback from `revoke_reason` or client state alone.

`ai_master_authorizations` stores one active lecture authorization bound to a
tracked Admin session, actor, exact action array and hard stop.
`ai_master_authorization_events` stores content-free bounded audit metadata.
Child paid starts continue to use `ai_billing_grants` and the existing usage,
operation and concurrency tables. RLS is ON and only explicit service-role
paths can access these new tables/functions.

The two Phase 7.28 migrations are expand-only. A future physical-cleanup
contract must delete dependent audit events, grants and master rows in FK-safe
order; Phase 7.28 performs no destructive schema rollback.
