# Phase 6 requirements and threat model

Date: 2026-07-16
Scope: local implementation and verification only. Production Supabase,
Cloudflare, Hosted settings, public Web, feature flags and Git remotes remain
unchanged.

## Inspected baseline and delivered requirements matrix

This matrix was written after inspecting the migrations, RPCs, RLS, Edge
Functions, local caption store, Publisher integration, live snapshot client and
existing tests. `PROJECT_GUIDE.md` is a design input, not the sole source.

| Requirement | Pre-Phase 6 state | Delivered Phase 6 state |
| --- | --- | --- |
| Deterministic five-minute windows from server lecture time | **Partial.** Phase 2 provides server-owned `started_at` and `hard_stop_at`; no summary window state exists. | **Implemented.** Unique windows derive from locked DB timestamps; the client scheduler uses sampled `server_time`, and DB rejects early/closed claims. |
| At most 18 paid summary calls in 90 minutes | **Partial.** `summary_call_limit=18` and usage accounting exist. | **Implemented.** Every provider attempt enters the ledger first; attempts and schema retries count toward the same hard limit. |
| One explicit Billing PIN start, free stop | **Partial.** One-use grants and free AI stop exist, but the grant API starts a billable operation immediately. | **Implemented.** One grant starts an actor-bound run; window calls occupy the Batch lane only during a provider attempt, and stop is PIN-free. |
| Combined lecture recap, comment pulse and academic-candidate call | **Not implemented.** | **Implemented.** One strict low-cost Responses call emits all three; literature search/answer remains explicitly Phase 7. |
| Raw transcript and PDF source do not enter Supabase | **Implemented foundation.** Captions are stored in local IndexedDB; PDF text remains in the local Publisher. | **Maintained.** Edge receives bounded text and stores only hashes/counts and structured output; `store:false` and no tools/files/images are used. |
| Current PDF context and Phase 5 outline | **Partial.** Publisher extraction and Admin-only material analysis exist. | **Implemented.** Current page ±1 is hash-verified; active Phase 5 outline is server-selected; missing Publisher context degrades explicitly. |
| Comment trend and like surge are server-derived | **Partial.** Comments, immutable like rows and aggregate totals exist. | **Implemented.** Exact-window SQL metrics and at most 20 bounded comments are sent without participant identity. |
| Low-value, unsupported or duplicate output is not shown | **Not implemented.** | **Implemented.** Input threshold, strict schema, evidence, sample-size, duplicate and safety gates preserve the last useful publication. |
| Immutable AI original and teacher revision history | **Not implemented.** | **Implemented.** AI/Admin revisions are append-only and publication points to one active revision. |
| Publish, hide, pin, unpin and correct | **Mock UI only.** | **Implemented.** Admin actions use protected RPCs and bump only the summary section version. |
| Five-second student delivery without added fan-out | **Partial.** Phase 1 already reserves a `summaries` version/payload slot but returns an empty array. | **Implemented.** Default-OFF v4 fills the existing changed section with at most six publications; no new request/subscription. |
| Student can hide AI support and is not auto-scrolled | **Mock/partial.** Recap UI exists; no live summary data. | **Implemented.** Live publications map to the recap; hide/show is local and no forced scroll is introduced. |
| Lecture close stops new/in-flight summary acceptance | **Implemented foundation.** Phase 2/4.1 closes AI and discards late generic results. | **Implemented.** Close/stop invalidates runs, cancels ledgers, discards windows and prevents result storage. |
| Sleep/offline recovery without duplicate billing | **Partial.** Caption segments survive in IndexedDB; no summary scheduler exists. | **Implemented contract.** Server-clock catch-up, unique windows and idempotent completion prevent duplicates; real device sleep remains a human test. |
| 30-day archive includes public summaries | **Partial.** Archive payload already contains an empty `summaries` array. | **Implemented.** v3 archive returns at most 12 public revisions and excludes private candidates/audit data. |
| Phase 0/1 ownership and old RPC compatibility | **Implemented and must not regress.** | **Maintained.** 557 SQL assertions pass; old RPCs remain, new tables use explicit RLS/grants, and Phase 6 remains OFF. |

## Security and cost decisions

- The browser never receives the OpenAI API key or Supabase service role.
- A summary run is bound to one lecture, one Admin actor and the authoritative
  hard stop. Its opaque nonce is stored only in component memory and can be
  rotated after an authenticated Admin reload.
- Billing PIN input is used only by `authorize-ai-start`, cleared after the
  attempt and never written to browser storage, logs or tables.
- A Batch operation exists only around one provider request. Realtime captions
  can continue in the independent Realtime lane.
- Provider requests are bounded, use the low-cost Luna model, low reasoning and
  low verbosity, strict structured output, no tools/files/images/background
  mode and `store:false`.
- Provider retries are limited to one deterministic structured-output retry.
  Timeouts and ambiguous network failures are not retried automatically.
- A low-information window is recorded as skipped without creating usage or
  calling OpenAI.

## Threat model

| Threat | Primary control | Failure behavior |
| --- | --- | --- |
| Client clock is moved to force an early window | Window bounds and due checks use locked DB timestamps. | Claim is rejected before usage is reserved. |
| Same window is submitted by retries/tabs | Unique lecture/window/prompt row plus deterministic attempt idempotency keys. | Existing result/status is returned; no second provider request for the same attempt. |
| A stolen run token is used by another Admin session | Run nonce hash is actor- and lecture-bound; Admin token actor is revalidated. | 401/409, no usage row. |
| Browser tampers with comment metrics | SQL builds metrics and bounded comment input from authoritative tables. | Client-supplied comment data is ignored. |
| PDF/transcript contains prompt injection | Text is an untrusted user-data object; no tools are available; evidence IDs and deterministic gates are mandatory. | Invalid/unsupported output is not published. |
| Admin stops while OpenAI is running | Stop and completion use the same lecture/control/usage/run lock order; run state must still be active at completion. | Late output is discarded; previous publication remains. |
| Lecture reaches the 90-minute boundary | Every start and completion rechecks the server lecture row and hard stop. | No post-close OpenAI start; late output is discarded. |
| Summary payload inflates five-second traffic | Snapshot contains at most six compact public summaries and changes only on publication mutations. | Poll size remains participant-independent; older history is archive/Admin-only. |
| Low-value AI output harms UX | Pre-call minimum content and post-call evidence/novelty/safety gates. | No empty card is added; last useful summary stays visible. |

## Human-only verification deferred

The local gate can verify contracts, SQL behavior, mocked Edge behavior, build
and route shells. Real microphone capture, a real 90-minute lecture, teacher
judgment of educational value, signed-in multi-device visual behavior and
Hosted/Cloudflare production behavior require later human execution and are
listed in the Phase 6 gate record.
