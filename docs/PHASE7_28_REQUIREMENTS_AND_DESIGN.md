# Phase 7.28 Requirements, Threat Model and Design

Date: 2026-07-31

Scope: local implementation only. Hosted Supabase, Cloudflare, OpenAI, public
Pages, production flags, push and deployment are explicitly excluded.

## 1. Objective

Phase 7.28 closes three gaps observed after the first Journal Club operation
without replacing the Phase 0-7.27 contracts.

- **7.28A - retire one-off preset creation:** hide the rehearsal/production
  Journal Club creation path from normal Admin operation while preserving all
  existing lectures, Polls, archives and compatibility code.
- **7.28B - authorized cross-browser Display acceleration:** give only the
  Admin-issued Display identity low-latency committed PDF-page and caption
  updates. Students remain on the existing bounded five-second snapshot.
- **7.28C - lecture-wide AI authorization:** accept the API PIN once for one of
  two exact scopes, while retaining a fresh single-use child grant and every
  budget, concurrency, lifecycle and idempotency check for each explicit paid
  start. Make five-minute-summary activation and recovery unambiguous.

All new capabilities are additive, backward compatible and default OFF. Server
time, the durable snapshot and the shared lecture lifecycle remain
authoritative. PDF/audio bytes and raw transcripts do not enter Supabase.

## 2. Requirement disposition before implementation

| Requirement                                 | Previous state                                                    | Disposition                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Hide completed Journal Club preset creation | Dedicated Admin card remained visible                             | Missing; add separate creation-only UI and Edge flags             |
| Preserve the historical Journal Club run    | Phase 7.27 rows/archive policy existed                            | Preserve without data mutation                                    |
| Same-browser Display acceleration           | Local `BroadcastChannel` existed                                  | Compatibility only when no private claim is used                  |
| Independent-browser Display acceleration    | Five-second snapshot only                                         | Add private, claimed Realtime Broadcast                           |
| Student load boundary                       | Snapshot polling; no Realtime channel                             | Preserve exactly                                                  |
| API PIN once per lecture                    | Per-feature PIN authorization                                     | Add actor/session/lecture/scope-bound master authorization        |
| Paid-start safety                           | Single-use grant, budget, lane, lifecycle and idempotency existed | Reuse unchanged after child-grant issuance                        |
| Summary recovery                            | Server-time windows, ordinary interval                            | Add explicit status and focus/visibility/online/pageshow catch-up |

Production evidence contained no summary-control, run, window or publication
row. The primary failure was non-activation, not a rejected OpenAI response or
a PDF-quality decision. Phase 7.28C improves activation and recovery; it does
not weaken educational-value or publication gates.

## 3. Cross-phase invariants

1. The database server clock and the common close transition determine whether
   a lecture is live.
2. Closed, expired and archived lectures reject writes and AI starts.
3. `auth.uid()` and tracked Admin-session ownership are verified; an
   `authenticated` role alone is never sufficient.
4. Exposed RPCs remain `SECURITY INVOKER`. Privileged helpers are private
   `SECURITY DEFINER` routines with an empty fixed `search_path`, explicit
   authorization inputs, revoked `PUBLIC` execute and minimum grants.
5. New server-only tables use RLS and grant no table access to `anon` or
   `authenticated`; trusted Edge paths use explicit `service_role` grants.
6. API keys, service-role keys, PINs and raw Display tokens never enter source,
   database rows, logs or durable browser storage.
7. Students receive no new periodic request and no Realtime subscription.
8. Demo remains browser-local and does not contact Supabase or providers.
9. Old clients keep their existing behavior while all Phase 7.28 flags are OFF.

## 4. Phase 7.28A - preset retirement

Creation is controlled independently by:

- frontend: `VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION`;
- Edge: `PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED`.

Both default OFF. The Admin card requires the Phase 7.27 compatibility flag and
the new frontend flag. The Edge creation action requires both server flags and
returns `410` before auth lookup or creation work when retired. Listing,
six-Poll order, permanent production archive metadata, completed runs and
ordinary lecture controls remain compatible.

The flag is recovery-only. A normal Phase 7.28 rollout must never enable it.
There is no schema or data rollback for A.

## 5. Phase 7.28B - Display Realtime

### 5.1 Authorization and identity boundary

1. A tracked Admin asks `issue-display-session` for a Display link.
2. Edge verifies the signed Admin token, bearer `auth.uid()`, tracked session,
   lecture state and server hard stop.
3. Only when the requesting new client opts in and the Edge flag
   `PHASE728_DISPLAY_REALTIME_ENABLED` is ON, Edge stores a SHA-256 hash of the
   Display-token JTI, a random private topic, issuer bindings and bounded
   expiry. Raw tokens are not stored.
4. The Display browser uses anonymous Supabase Auth and exchanges its signed
   token once through `claim-display-realtime-session`.
5. The claim atomically binds the first Display `auth.uid()` after rechecking
   signature, lecture, JTI hash, expiry, lifecycle and issuing Admin session.
   The same UID is idempotent; a different UID is rejected.
6. A private `realtime.messages` policy permits only the claimed UID and exact
   topic. Students have no binding and cannot subscribe.

The binding is one active Display identity per lecture, not per Admin session.
The claim is identity-level, not a cryptographic single-tab lock: tabs sharing
the same anonymous-auth UID can join the same topic. This is acceptable for one
teacher Display browser profile and must be monitored, not described as strict
single-tab exclusivity.

### 5.2 Delivery and data boundary

- PDF page updates commit to durable live state first. A database trigger then
  emits the committed page/version through private Broadcast. Broadcast failure
  cannot roll back the snapshot.
- Once a private claim is active, private Realtime replaces local
  `BroadcastChannel` delivery. The old local channel remains only as the
  flag-OFF or claim-less compatibility route.
- Caption deltas are latest-value coalesced to at most one relay every 500 ms;
  completed/stopped events flush immediately. The authenticated Edge relay
  rechecks Admin UID/session, lecture, topic, runtime gate and hard stop for
  every request.
- A relay request is capped at 12 KiB and caption text at 4,000 characters. It
  carries no audio. Supabase-managed private Broadcast temporarily retains the
  bounded text event under the provider's managed retention; application tables
  do not store the delta and students do not subscribe.
- Relay failure never stops transcription. The completed-caption snapshot and
  five-second polling remain the fallback.

### 5.3 Revocation, compatibility and failure behavior

Realtime policy can be cached for an existing socket, so database state alone
is not treated as instantaneous socket revocation.

- close, hard stop, Admin-session revoke, runtime-gate disable and Display-link
  replacement emit a terminal event and revoke the binding;
- Display removes its channel on terminal state and at its server-derived hard
  stop, and never redraws late events after termination;
- snapshot and PDF requests revalidate registered bindings regardless of the
  Edge flag. Security/lifecycle revocations fail closed; only a DB-runtime-gate
  rollback may downgrade the same already-claimed UID to the signed five-second
  snapshot/PDF path. That downgrade is decided by a service-role-only DB RPC on
  every request; it rechecks the disabled gate, exact UID/JTI/lecture, binding
  expiry and hard stop, open lecture state, and the issuing Admin session's
  revoke, absolute-expiry and idle-expiry state against server time;
- a later Admin-session revoke or lecture terminal transition permanently
  overwrites a `feature_disabled` binding with its security/lifecycle reason,
  so re-enabling a flag or restoring a client cannot resurrect the fallback;
- a later Display registration permanently reclassifies every runtime-downgraded
  predecessor as `session_replaced`; the old UI converges to its quiet terminal
  screen within the next bounded snapshot interval and cannot reactivate. A
  recognized same-UID expiry returns a data-free control response, while
  cross-UID/unclaimed/invalid credentials remain HTTP 401 on the live/rollback
  path;
- terminal Review continues to use the signed terminal window and canonical
  lecture state, independent of a deleted live binding. That existing
  time-bounded signed-link capability is deliberately separate from live
  Display binding authorization;
- the caption relay revalidates every batch, preventing continued publication
  through cached client state;
- hourly cleanup at minute 17 deletes at most 500 terminal rows older than one
  day and is idempotent.

Expand-first compatibility is deliberate: an old/unbound short-lived Display
token may keep the legacy snapshot path when the issuer did not opt in. A
registered, replayed or claimed token never falls back on 401/409. New clients
fall back only when the claim endpoint is absent (`404`) or server-disabled
(`503`). Production cutover must refresh Admin clients, allow the maximum
95-minute legacy token lifetime to elapse, verify no unbound link remains and
record a later sunset decision if strict claim-only operation is required.

### 5.4 Runtime kill switch and rollback

The database runtime gate is the authoritative no-admission switch. Correct
rollback order is:

1. disable the DB runtime gate first; this atomically blocks new issue/claim/
   relay admission and terminalizes active bindings;
2. verify the active-binding count is zero, the same claimed Display has
   converged to the five-second snapshot/PDF path, and a different UID remains
   rejected;
3. disable Edge and frontend flags.

Do not hide the frontend first while leaving cached channels and server
admission active.

### 5.5 Load envelope

Students add zero Realtime connections, messages and requests. One lecture adds
one Display connection. The strict 500 ms limit yields at most 7,200 continuous
caption relays in 60 minutes; measured 90-minute worst-case modeling is 11,881
relays including bounded lifecycle/page events. There is one in-flight caption
relay per lecture.

## 6. Phase 7.28C - AI master authorization

### 6.1 Scope and stored state

The Admin UI exposes exactly two scopes:

1. all eligible AI except captions: summaries, material analysis, Poll
   suggestions and academic answers;
2. all eligible AI including captions.

The active authorization is bound to lecture UUID,
`admin-session:<session-id>`, exact actor UID, exact action set and lecture hard
stop. No PIN, PIN hash, provider output, prompt, budget reservation or API
secret is stored. The audit table is content-free and field-size bounded, but
its row count has no physical-deletion contract in this phase.

Concurrent authorization leaves at most one active row per lecture. Another
Admin session cannot use or revoke it. Revoke is free and idempotent. Lecture
close, hard stop and tracked-session revoke terminate the master, pending child
grants and running operations through the shared lifecycle.

### 6.2 Paid operation flow

1. Master authorization verifies the API PIN once and performs no paid work.
2. Each explicit feature CTA requests a fresh two-minute child grant.
3. Edge rechecks master/session/actor/action/lifecycle before creating a
   nonce-bound `ai_billing_grants` row.
4. The existing actual-start RPC consumes the child once and rechecks budget,
   call limit, concurrency lane, idempotency key and lecture state before any
   provider request.
5. Captions retain their own start CTA, duration/language choice and browser
   microphone permission even under the inclusive scope.

While no master is active, the old direct-PIN flow remains compatible even when
the new server flag is ON. While a master is active, old direct-PIN clients are
rejected to prevent a double-charge bypass; Admin clients must therefore be
refreshed before production activation. Revocation and child consumption share
deterministic lock order so they converge without deadlock or orphaned work.

### 6.3 Summary activation and recovery

“AI use authorized” and “five-minute summary running” are visibly separate.
Authorization never implies that a summary, caption or provider has started.
The summary CTA remains explicit and uses a child grant without re-requesting
the PIN.

Due windows continue to derive from server time and persisted processed-window
state. The scheduler runs immediately, every bounded interval and on focus,
visibility, online and pageshow. Only one scheduler request is in flight.
Missing context follows the existing no-call/low-value policy, while the prior
published result remains available after failure.

Polling the authorization status every 10 seconds produces 540 free status
checks in 90 minutes. With 24 bounded feature starts, the modeled incremental
load is 566 Edge invocations per lecture and 49,788 per month under the agreed
weekly usage envelope. Student-side load remains zero.

### 6.4 Rollback

1. disable server start/child issuance while retaining status, free revoke and
   service-role drain;
2. drain active masters idempotently until zero;
3. stop any admitted work through existing free stop paths;
4. hide the frontend master UI.

Direct-PIN compatibility resumes only after the master is terminal. Additive
tables/functions remain. Future physical cleanup must delete event references,
then grants, then master rows, then parent lecture/session records under a
separately approved contract migration.

## 7. Migration strategy

- `20260731110507_phase7_28b_authorized_display_realtime.sql` and
  `20260731110753_phase7_28_ai_master_authorization.sql` are additive.
- No old column, RPC, table or policy is removed.
- Both a clean database and a populated Phase 7.27 fixture must pass.
- The upgrade probe preserves lecture, participant, comment, Poll, PDF,
  publication, AI usage, summary and archive identifiers/counts.
- Generated TypeScript DB types, pgTAP, two-connection concurrency, lock order,
  DB lint and Advisor-equivalent checks are mandatory.

## 8. Local Gate acceptance

Automated Local PASS requires one final diff to satisfy ROADMAP G0-G7:

- A/B/C traceability, threat model, failure behavior and rollback recorded;
- clean and populated upgrades; all pgTAP and SQL regression;
- ownership isolation, replay/cross-topic rejection, lifecycle convergence,
  scope/actor/expiry/revoke, child single-use and billing races;
- deterministic DB types, DB lint, static security and secret checks;
- typecheck, lint, non-live regression, production build, bundle budgets,
  dependency audit and `git diff --check`;
- Chromium, WebKit and 390px Chromium Admin/Display E2E, keyboard focus,
  serious/critical axe checks, Demo and lifecycle regression;
- repeatable 20/300 load model with no student-load increase;
- zero unresolved Critical/High security or data-integrity defect.

Local PASS does not authorize hosted migration, secret/flag changes, paid
OpenAI calls, push or deployment. Human, Hosted and formal Production evidence
remain HOLD until a separate approved gate.
