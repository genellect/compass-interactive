# Phase 7.30C1 Google Admin lecture AI-master admission

Date: 2026-08-10; additive session admission updated 2026-08-20
Status: source implemented; exact-head database, Local Edge, Hosted and Human evidence required for activation
Activation: existing C1 gates; no provider or child-grant authority at master admission

## Scope

C1 is the narrow integration slice between the B2.2b personal AI-unlock proof
and lecture-scoped AI-master state. It adds:

- private, optional-row ownership evidence for lectures created through a verified
  Google/TOTP Admin context;
- atomic PIN-proof or remembered-browser-proof consumption and lecture-master
  creation/elevation in one database transaction;
- gate-independent exact replay, status, free captions downgrade and revoke;
- a dedicated default-OFF Edge/client transport which returns dormant master
  state and never calls a provider.

The additive migration
`20260820081453_google_aal2_session_ai_master.sql` adds the current lecture UI
path: a verified Google/TOTP AAL2 app session can admit its own lecture master
with one CTA and no AI PIN, remembered credential or new TOTP prompt. The
original PIN and remembered-browser functions remain deployed for rollback
compatibility but are no longer selected by the lecture workspace.

The `google_aal2_session` method is not an authentication shortcut. Database
admission still rechecks the live approved TOTP factor set, backing Supabase
Auth session and eight-hour cap, active AI-enabled membership, exact private
lecture ownership, open/hard-stop lifecycle and exact active policy/version.
Its receipt stores null factor/browser proof fields and binds
`unlock_verified_at` to the app session's recorded `step_up_verified_at`.
Six new/elevating admissions per app-session/lecture/minute are permitted;
exact replay and same-scope reuse do not consume that allowance. Accepted and
rate-limited decisions write content-free Admin audit evidence.

It deliberately performs no inferred backfill and does not infer an owner for
an existing lecture. The public
`lecture_sessions` shape exposes no principal or membership UUID. Existing
lectures and pre-C1 master rows are not adopted or converted.

## Database boundary

Migration `20260810160000_phase7_30c1_google_ai_master.sql` adds private,
RLS-enabled, browser-inaccessible ownership, admission-receipt, reuse-receipt
and control-receipt tables: `admin_lecture_ownerships`,
`admin_ai_master_admission_receipts`, `admin_ai_master_reuse_receipts` and
`admin_ai_master_control_receipts`. The admission receipt binds the request, Admin/Auth
session, lecture, scope, policy/version, unlock factor/version and exact PIN or
browser proof. Its canonical intent is recomputed in the database. PIN attempt
request ID equals the admission request ID; browser challenge IDs are evidence
without a cleanup-blocking foreign key.

The strong context path acquires principal then membership, re-reads the
environment `FOR SHARE` after principal/membership without an inverse owner-guard lock, then locks the Admin and Auth
sessions. It derives live verified-TOTP hash and count from one aggregate
snapshot. Approved/live/session mismatch revokes the stale app session and
drains its authority. The effective lifetime remains capped by both the Admin
session and `auth.sessions.created_at + 8 hours`; there is no lecture idle
timeout or periodic TOTP prompt.

Ownership creation is exact-request replayable before the C1 gate. A new
lecture is created only while the database gate is ON; the singleton gate row
is held `FOR SHARE` through the create transaction so a concurrent OFF update
linearizes before or after creation. The supplied raw
six-digit code is still checked by the established create RPC against the
canonical code hash. The raw code is not added to audit or ownership evidence.

## Atomic proof admission

For PIN admission, the private wrapper obtains proof metadata, consumes the
same request-bound PIN attempt, writes the full-provenance master and immutable
receipt in one transaction. For remembered-browser admission, the wrapper
validates the complete challenge binding before consumption, completes the
assertion and writes the master/receipt in that same transaction. A signature
denial may commit bounded abuse state; any binding or master failure after a
valid proof raises and rolls the challenge consumption back.

Exact admission replay is checked before runtime/source gates and proof expiry.
It converges to the current master state without consuming proof again. A
same-session, same-policy, same-scope active C1 master is also a proof-free
reuse. It writes an immutable request observation, so a lost-response retry
after revoke/expiry returns the recorded master row's terminal state and never
reactivates authority. Elevation or policy change requires a new proof. Downgrade and revoke use
immutable action/actor/session/lecture receipts. Their exact retries return the
current state of the recorded master row, not a historical version. A caller
refreshes lecture status after a later admission creates a different row; an
old control retry never mutates that newer row.

## Default-OFF and C2 HOLD

New/elevating admission requires all of:

- `PHASE730_C1_GOOGLE_AI_MASTER_ENABLED=true` at the Edge source boundary;
- the existing B2.2b AI-unlock source gate;
- `ai_unlock_enabled=true` and
  `google_ai_master_admission_enabled=true` in the private runtime row;
- `remembered_browser_enabled=true` for browser proof.

New/elevating admission holds that same singleton runtime-gate row `FOR SHARE`
and rechecks the AI, C1 and remembered-browser flags together at final apply.
If a flag is turned OFF first, the proof and master transaction rolls back; if
admission linearizes first, the OFF update proceeds only after it commits.

Status, exact replay, free downgrade and revoke remain available when the C1
admission gate is OFF. All public facades are fixed-search-path SECURITY
DEFINER functions executable only by `service_role`; private helpers and tables
are not executable/readable by browser or service roles directly.

C1 fences the legacy master and child-grant paths from any C1/full-provenance
master. No child grant, provider call, paid execution, legacy Admin workspace
bridge or operational Admin endpoint migration is introduced. The 20
operational Admin Edge/RPC migrations, `ADMIN_PIN`/`BILLING_PIN` removal,
provider/child-grant verifier and ledger UX remain **C2 HOLD**.

## Evidence and activation

Source evidence includes the static contract, pgTAP schema/ACL/atomic-order
catalog checks, a populated B2.2b-head no-backfill upgrade probe, generated
types, documentation routing and the ordinary non-live quality suite. Docker
from-zero/upgrade/pgTAP/concurrency, Local Edge, exact-head CI, Hosted Google
OAuth/TOTP and Human teacher evidence remain HOLD. Source presence is not an
activation decision and creates no hosted fixed cost.

## Additive rollout checklist for `google_aal2_session`

The order is strict and repair-forward. No new secret is required.

1. Apply the additive database migration. Verify the new public facade is
   `service_role`-only, the private rate table has RLS and no runtime-role
   grants, and old PIN/browser facades still exist.
2. Deploy `admin-ai-unlock` while keeping frontend exposure unchanged. The
   existing `PHASE730_ADMIN_AI_UNLOCK_ENABLED` and
   `PHASE730_C1_GOOGLE_AI_MASTER_ENABLED` source gates must both be `true` for
   new admission. Status, exact replay, downgrade and revoke remain callable
   while admission is disabled.
3. Keep database `ai_unlock_enabled=true` and
   `google_ai_master_admission_enabled=true`. `remembered_browser_enabled` may
   remain `false`; this path does not depend on it. Identity session issuance,
   Google operations and the existing child/provider gates remain independent
   server-side decisions.
4. Deploy the frontend with `VITE_PHASE7_30_ADMIN_IDENTITY`,
   `VITE_PHASE7_30_ADMIN_AI_UNLOCK` and
   `VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS` enabled. A failed or 503 status
   request must leave the CTA disabled and the parent availability badge out
   of its ready state; the browser never infers admission from its local
   lecture state or frontend flags.
5. In the bounded Production canary, confirm one enabled CTA sends exactly one
   `authorizeMasterWithAal2Session` request with no PIN/credential field. The
   resulting master and immutable receipt must use `google_aal2_session` with
   null factor/browser columns. Immediately after master admission there must
   be no new child grant, billing grant, usage row or provider request.
6. Separately invoke each approved AI feature. Each real provider start must
   create and consume exactly one bounded child and reach an observed terminal
   provider result; master admission itself never satisfies this evidence.
   Then stop all AI, close the lecture and verify pending descendants drain.
7. Rollback first disables either C1 source admission or the database admission
   gate, then restores the previous frontend/Edge revision if needed. Do not
   drop the schema. Existing exact replay, status, free stop/revoke/downgrade,
   session/membership/policy/lecture drains and the retained PIN/browser
   transports provide repair-forward compatibility.
