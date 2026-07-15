# Phase 5 material analysis and AI Poll proposals

Date: 2026-07-16
Status: locally implemented; production rollout deferred until Phase 6.

## 1. Responsibility boundary

Phase 5 adds only teacher-initiated PDF material analysis and Admin-only Poll
proposal drafts. Five-minute lecture/comment summaries and academic comment
answers remain Phase 6 work.

- Private R2 continues to hold PDF bytes.
- The local Publisher continues to hold extracted text and its 30-day/retention
  lifecycle.
- Supabase holds immutable PDF metadata, billing/usage audit rows and bounded
  structured AI output only.
- OpenAI receives selected text only after an explicit teacher action and
  Billing PIN check.
- Students receive no Phase 5 read, poll, Realtime or snapshot traffic.

## 2. End-to-end flow

1. Teacher publishes a text-layer PDF through the Phase 3 Publisher. This does
   not call OpenAI.
2. With Phase 5 enabled, teacher chooses the registered document and presses
   `資料を分析する`.
3. The browser requests a short PDF access token, then obtains the exact local
   extraction from the paired Publisher. The extraction is kept only in the
   current function call.
4. `authorize-ai-start` validates the server-side Billing PIN and issues a
   two-minute one-use grant for `material_analysis`.
5. `analyze-lecture-material` verifies Admin actor, feature flag, PDF metadata,
   per-page excerpt hashes and aggregate hash.
6. `admin_start_material_ai_operation` consumes the grant, reserves budget and
   Batch capacity, and inserts a content-free operation context in one database
   transaction.
7. Edge calls the OpenAI Responses API outside every database transaction.
8. Strict schema parsing and deterministic educational gates run before any
   result is accepted.
9. `admin_complete_material_ai_operation` applies the Phase 4.1 lecture-end
   guard and atomically marks usage complete, stores the analysis/proposals and
   releases the Batch lane.
10. Teacher may edit a proposal and copy it into the ordinary Poll list. The
    new Poll is always `draft`; starting it remains an existing explicit action.

Additional proposals repeat steps 3-9 with `poll_suggestions`, a new Billing
PIN grant, an active analysis ID and an explicit page range.

## 3. State transitions and failure behavior

| State                  | Trigger                                                      | Result                                                                                                     |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| disabled               | Either frontend or Edge flag is false                        | UI/action unavailable; Edge returns 503 before paid work.                                                  |
| awaiting authorization | Teacher presses an action                                    | Billing PIN is held only in component memory.                                                              |
| authorized             | PIN succeeds                                                 | One-use actor/action/lecture-scoped grant expires within two minutes.                                      |
| running                | Dedicated start RPC commits                                  | Usage reservation and content-free PDF context exist; one Batch slot is held.                              |
| succeeded              | Provider output passes all gates while lecture is open       | Usage and structured result commit atomically; slot is released.                                           |
| failed                 | Provider HTTP/refusal/incomplete/invalid output/quality gate | Usage is terminal `failed`; no result row; fresh PIN is required for retry.                                |
| cancelled              | Admin stop or lecture close wins first                       | Existing Phase 4.1 transition stops the operation.                                                         |
| discarded              | Provider reports success after lecture becomes unavailable   | Actual usage remains audited; output is not stored.                                                        |
| replay                 | Same idempotency key is observed                             | Completed result is returned; running work returns conflict; provider is never called twice automatically. |

There is intentionally no automatic provider retry. That choice prevents a
network ambiguity from silently creating a second paid request.

## 4. Database design

### `material_ai_operation_contexts`

One row per Phase 5 usage operation. It binds feature, lecture, immutable PDF
ID/version/hash, optional active analysis and optional page range. It stores no
PDF text.

### `lecture_material_analyses`

Admin-only accepted outline, short summary, terms, important pages and section
boundaries. Only one active analysis exists per document version; a future
re-analysis can supersede, not overwrite, an earlier row.

### `ai_poll_proposals`

Admin-only structured proposal, evidence references, educational metadata,
quality score and review lifecycle:

`draft -> adopted | rejected | expired | superseded`

Lecture close changes remaining `draft` proposals to `expired` without deleting
review history. Adoption references the ordinary draft Poll it created.

The three tables use RLS, explicit browser revokes, service-role-only minimal
grants, restrictive FKs and indexed lecture/review lookups. They are not added
to the Supabase Realtime publication.

## 5. Model, request and cost controls

The 2026-07-16 snapshot uses `gpt-5.6-luna` because it supports Responses and
Structured Outputs while its text price ($1.00/M input, $6.00/M output) is
appropriate for a bounded, teacher-initiated analysis. The request fixes:

- `reasoning.effort='low'`;
- `text.verbosity='low'`;
- strict JSON Schema;
- `store=false`;
- no tools, files, images or background mode;
- stable privacy-preserving `safety_identifier`;
- 4,000 maximum output tokens for initial analysis and 2,500 for additional
  proposals.

The initial worst-case reservation is 65,000 input + 4,000 output tokens =
89,000 micro-USD (`$0.089`). Additional calls use their selected text size and
a 2,500-output cap; the displayed conservative ceiling is `$0.08`. Exact input
and output price snapshots are stored with the operation context and accepted
analysis. The existing lecture limits remain authoritative:

- input: 200,000 tokens;
- output: 30,000 tokens;
- budget: 2,500,000 micro-USD;
- initial material analysis: one by default;
- additional Poll calls: five by default;
- Batch concurrency: one.

The live provider contract test used 861 input and 1,518 output tokens, produced
three accepted proposals and calculated 9,969 micro-USD (`$0.009969`). This is
a development test result, not a production cost guarantee.

## 6. UX behavior

- The feature sits in the existing educator learning-support panel; no preview
  route or student UI is added.
- Copy states clearly that PDF publication alone is not billed.
- Billing PIN is cleared after every success or failure and is never put in
  local/session storage.
- Results are marked `AI生成・未検証` and show page evidence, objective,
  explanation and educational value.
- The teacher must open an edit form before adoption. Discussion prompts must
  be converted into an ordinary choice Poll before adoption because the current
  delivery protocol supports only single/multiple choice.
- Rejected proposals remain auditable but visually de-emphasized.
- Low-quality output is not partially forced onto the teacher; the call fails
  when it cannot provide the minimum useful set.

## 7. Lifecycle and retention

- Raw extracted text remains governed by the Phase 3 local Publisher retention
  feed and is never copied to Supabase.
- Structured analysis/proposals remain linked to the lecture through the Phase
  2 30-day archive lifecycle. They are Admin-only and are not included in the
  student archive payload.
- Unreviewed proposals expire immediately when the lecture closes.
- Physical deletion remains a later contract migration after archive operations
  have real usage evidence; Phase 5 introduces no cascading delete.

## 8. Migration and rollback

The migration is expand-first: new tables, indexes, functions and a close
trigger only. It does not replace an existing RPC signature or alter a student
policy/snapshot. Both clean reset and a Phase 4.1-data upgrade path are tested.

Safe rollback before production enablement:

1. keep `VITE_PHASE5_MATERIAL_ANALYSIS=false`;
2. keep `PHASE5_MATERIAL_ANALYSIS_ENABLED=false`;
3. do not deploy/call the two new Edge routes;
4. preserve additive tables and usage audit rows;
5. repair forward with a new migration rather than dropping result/audit data.

Dropping the additive schema is not the normal rollback because it would erase
audit and teacher review history.

## 9. Deferred production sequence

After Phase 6 and a fresh backup/price review:

1. apply Phase 0-6 expand migrations with all flags OFF;
2. run Hosted Advisor/lint and compatibility checks;
3. deploy Publisher extraction route and validate origin/session/token binding;
4. deploy both Phase 5 Edge functions with the standard API key and server flag
   OFF;
5. deploy frontend with Vite flag OFF and confirm no Phase 5 network traffic;
6. run production two-Admin actor separation and lecture-close/late-result tests
   using non-sensitive fixture material;
7. enable for one limited lecture, observe provider usage, DB failures and
   teacher workflow;
8. expand only after recording the Phase 6 combined production gate.

Unresolved before production: current model price/access re-confirmation,
Hosted Edge timeout behavior, strengthened named teacher identity beyond the
current Admin-session actor, archive purge contract, and real-teacher UX review.
