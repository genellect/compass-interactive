# Phase 6 five-minute summaries

Date: 2026-07-16 (JST)

Scope: local implementation only. Production Supabase, Hosted Auth/settings,
Cloudflare, public Web, hosted secrets and feature flags remain unchanged.

## Outcome and responsibility boundary

Phase 6 combines a lecture recap, neutral comment pulse and at most one
Admin-only academic-question candidate in one bounded `gpt-5.6-luna`
Responses request. Academic literature retrieval and reference answers are not
part of this phase and remain Phase 7 work.

The data boundary is deliberate:

- completed Realtime transcript segments remain in teacher-local IndexedDB;
- PDF text remains in the local Publisher;
- the Edge function receives only the selected five-minute transcript and at
  most the current PDF page plus adjacent pages;
- Supabase stores source hashes/counts, usage audit data, bounded structured AI
  output, immutable revisions and publication pointers;
- no audio, full transcript, PDF text, file bytes or OpenAI key enters a public
  browser or a Phase 6 table;
- students receive at most six compact published summaries in the existing
  five-second versioned snapshot. Phase 6 adds no student request, Realtime
  subscription or per-student AI call.

## Authoritative timing and state transitions

The browser proposes work from the latest snapshot `server_time` advanced with
`performance.now()`. It does not use the editable wall clock. The database is
still authoritative: every run/window RPC locks the lecture row, calls the
Phase 2 expiry guard and derives the exact boundary from `started_at`.

```text
summary run
  absent --Billing PIN grant--> running
  running --teacher stop------> stopped
  running --lecture close-----> closed

five-minute window
  absent --insufficient source--> skipped (no provider ledger row)
  absent/failed --admission-----> running (one Batch-lane operation)
  running --valid result--------> succeeded + immutable revision
  running --provider failure----> failed (at most one schema retry)
  running --stop/close----------> discarded

publication
  AI revision -> public or hidden by deterministic recommendation
  public <-> hidden
  public <-> pinned public
  AI revision --teacher edit--> appended Admin revision + public
```

Window uniqueness is `(lecture_session_id, window_index, prompt_version)`.
Provider attempts use deterministic operation keys and a maximum of two per
window. A successful completion replay returns the existing summary ID without
another ledger row, result or revision.

The lecture hard stop wins over a final call: normal five-minute summaries can
start at minutes 5 through 85, for at most 17 completed windows. A new call is
not started at minute 90 because the lecture is already expired. The existing
`summary_call_limit=18` is the ceiling for all provider attempts, including a
single structured-output retry; it is not a promise of 18 displayed cards.

## Admission, billing and cost control

Starting a summary run requires one explicit, actor/lecture/action-bound
Billing PIN grant. Stopping is always free and needs no PIN. The run does not
occupy an AI lane for 90 minutes. Each due provider request independently
passes the Phase 4.1 admission rules:

- lecture and run are open, unexpired and actor-bound;
- `summaries_enabled` is true;
- Batch lane has no running material/Poll/academic operation;
- global concurrency, budget, token and summary-call limits remain available;
- the deterministic five-minute window is due by server time;
- bounded transcript/PDF counts and live comment activity are rechecked at the
  paid-admission boundary, not trusted from the browser preflight;
- attempt count is below two and total summary provider attempts are below 18.

The production price snapshot is USD 1.00 per million input tokens and USD 6.00
per million output tokens for `gpt-5.6-luna`. Each reservation is capped at
40,000 input and 1,200 output tokens: USD 0.0472 worst case. Eighteen fully
reserved attempts therefore cap at USD 0.8496, below the existing USD 2.50
lecture budget example. Ordinary five-minute inputs are much smaller.

Cost-reduction behavior:

- fewer than 120 transcript and PDF characters records `skipped` without an
  OpenAI request when the same window also has fewer than three comments and
  no comment with at least three new likes; active comment-only windows proceed
  through the normal admission and cost limits;
- transcript input is capped at 8,000 characters and PDF context at 6,000;
- one request returns recap, comment pulse and academic candidate together;
- reasoning effort and verbosity are low; strict JSON, no tools, no files, no
  images, no background execution and `store:false` are used;
- only deterministic structured-output failure gets one retry;
- timeout, network ambiguity and HTTP failures are not automatically retried;
- reported provider usage replaces the reservation with actual usage;
- timeout/5xx/malformed response without usage conservatively retains the full
  reservation, while explicit 400/401/403/404/409/422/429 rejection records
  zero provider usage.

The one synthetic real-provider contract check consumed 559 input and 519
output tokens, calculated as USD 0.003673. Provider content and request ID were
not printed or stored.

## Input and quality gates

Comment context is computed in SQL for the exact window. It includes current
and prior counts, unique participant count, growth ratio and per-comment like
deltas, with at most 20 visible/pinned/recent comments and no participant ID.

The model output must pass both strict Responses schema validation and local
deterministic validation:

- one to five recap lines, zero to three comment-pulse lines and bounded memo;
- every transcript/page evidence ID must match supplied source;
- fewer than three comments suppresses the comment pulse unless a comment gains
  at least three likes in the window;
- an academic candidate requires a supplied comment, score at least 0.75 and a
  substantive question, and remains Admin-only;
- output substantially duplicating the previous recap is hidden;
- missing evidence, individualized diagnosis/prescription language or a model
  recommendation to hide prevents automatic publication.

Low-value, failed or discarded output never replaces the last useful published
summary. Students can hide live AI recap support locally without changing
Supabase or other students' view.

## Storage, RLS and API surface

New tables:

- `lecture_summary_runs`: actor-bound authorization lifetime; token hash only;
- `lecture_summary_windows`: server-derived window, attempt and failure audit;
- `lecture_ai_summaries`: accepted bounded structured output;
- `lecture_ai_summary_revisions`: immutable AI/Admin revision history;
- `summary_publications`: active revision, visibility, review and pin state.

All tables have RLS enabled. `anon` and `authenticated` receive no direct table
privileges. `service_role` receives only required select/insert/update grants;
revision history has no update/delete grant. No Phase 6 table is added to the
Realtime publication.

Public RPC wrappers are `SECURITY INVOKER`. Private definer primitives use an
empty fixed `search_path`, explicit actor/run/lecture validation and minimum
execute grants. Authenticated students can call only the compact v4 snapshot
and v3 archive wrappers, which preserve Phase 0 participant ownership checks.
Existing v1-v3 snapshot and v1-v2 archive RPCs remain unchanged.

## Student and teacher UX

Teacher controls provide:

- Billing-PIN start, free stop and actor-bound resume-token rotation;
- server-time waiting state and automatic catch-up of locally available
  transcript windows after browser sleep;
- explicit information-poor skip and PDF-unavailable messages;
- usage/call-limit display;
- Admin-only academic candidate;
- publish, hide, pin, unpin and append-only correction controls.

Student UI reuses the existing recap component. It shows a maximum of six
current/pinned cards, teacher review state and only non-empty comment pulse or
question sections. It does not auto-scroll or show an empty/low-value card.
Archive preview can return at most 12 public summaries for the 30-day lecture
preview lifecycle.

## Failure behavior

| Failure | Server/accounting result | User-visible result |
| --- | --- | --- |
| Server clock sample absent | No RPC/provider call | Wait for next five-second snapshot |
| Source and discussion below threshold | Idempotent `skipped`, no ledger row | Explicit no-cost skip message |
| Window early/client clock altered | DB rejects `window_not_due` | No provider call |
| Batch lane occupied | No reservation; retryable admission response | Existing summary remains |
| Structured JSON invalid | Attempt finalized with reported usage; one retry if limits allow | No invalid card |
| Timeout/network/5xx without usage | Attempt failed; full reservation retained; no auto retry | Existing summary remains |
| Teacher stops during provider call | Ledger cancelled, window discarded, run token revoked | Scheduler and controls stop |
| Lecture closes during provider call | Phase 2/6 close guards cancel/discard; result cannot be saved | Clients converge to closed lecture |
| Completion response lost | Idempotent replay returns existing summary ID | No duplicate cost/card/revision |
| Publisher unavailable | PDF omitted; transcript may proceed | Teacher sees degraded-context note |

## Migration and rollback

The migration is expand-first: it creates new tables, indexes, functions,
grants, trigger and v4/v3 read contracts without dropping or changing old RPC
signatures. Clean Phase 0-to-6 application and a Phase 5 fixture upgrade are
both tested.

Production application order after approval:

1. confirm backup/rollback criteria and current hosted model price/quota;
2. keep frontend and Edge Phase 6 flags OFF;
3. apply the Phase 6 migration;
4. run hosted DB lint/Advisors and old-client compatibility checks;
5. deploy both Phase 6 Edge functions with existing secrets but flags OFF;
6. deploy the frontend with `VITE_PHASE6_SUMMARIES=false`;
7. run two-Admin/two-student ownership and idempotency checks;
8. enable Edge then frontend only for a bounded 20-person canary;
9. monitor call count, Batch conflicts, failure codes, snapshot size/latency and
   actual OpenAI spend before any wider rollout.

Rollback is contract-first: turn both flags OFF and stop active runs. Keep the
additive objects and audit/revision history in place so old clients continue to
work. Repair forward rather than dropping tables or deleting accounting rows.
A destructive down migration is intentionally not supplied.
