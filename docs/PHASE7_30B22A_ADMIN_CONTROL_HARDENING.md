# Phase 7.30B2.2a Admin Identity and Rare-Control Hardening

Status: source implemented, default OFF, runtime evidence pending, Hosted/Human
activation HOLD.

## Outcome

Phase 7.30B2.2a hardens the dormant Google/TOTP Admin and personal AI PIN
foundation without adding a paid service, scheduler or hosted resource.
`PHASE730_ADMIN_IDENTITY_ENABLED`, `google_session_issue_enabled` and
`ai_unlock_enabled` remain independently default OFF. Existing `ADMIN_PIN` and
`BILLING_PIN` compatibility paths are not removed in this phase; their final
Production-preparation removal remains a later gated migration.

The application-session UX contract does not change:

- Supabase Authenticator App TOTP is the only v1 MFA path and is compatible
  with Google Authenticator;
- the Admin application session ends at the backing
  `auth.sessions.created_at + 8 hours` and has no idle expiry;
- normal lecture operation, normal AI PIN verification, remembered-browser
  proof and child AI calls never request periodic TOTP;
- five-minute fresh TOTP is used only for rare AI PIN enroll/rotate/revoke/reset
  and environment AI-policy mutations;
- a factor-history-free initial PIN enrollment can reuse the tracked fresh TOTP
  event that created the Admin session, so login does not prompt twice.

## Authoritative factor-set binding

Each newly issued Google/TOTP Admin session stores a SHA-256 digest over:

1. the fixed domain `compass:phase7.30:verified-totp-factor-set:v1`;
2. the exact Supabase Auth user UUID; and
3. all currently verified TOTP factor UUIDs in lexical UUID order.

The live evidence comes from `auth.mfa_factors`, not a JWT AAL claim, but live
state alone is not authorization: an old AAL2 bearer can add and verify another
factor upstream. `private.admin_principals` therefore stores the authoritative
approved digest, version and factor count plus bounded approval provenance. A
login/session insert requires the live set, principal approval and immutable
session binding to agree. A session touch, AI context decision or explicit
post-factor-change reconciliation applies the same comparison. A missing or
changed set revokes the session with `totp_factor_set_changed`; existing
session-revocation triggers then drain pending control proof and AI/session
authority.

An unverified challenged factor is accepted only for a `pending_mfa`
membership whose principal is unbound and whose current verified TOTP set is
empty. Other abandoned unverified factors do not block that exact initial
candidate. Fresh post-challenge JWT/AMR evidence then atomically approves the
exact singleton factor before issuing the first session. Once bound, login
requires the live set to equal the approved set and the challenged factor to be
a verified member. A newly added factor is rejected even if an old/stolen AAL2
bearer has already verified it upstream. Adding, removing or replacing a factor
requires B2.2b rare-control with fresh proof from the approved set and remains
HOLD.

An unbound principal that already has a verified factor set fails closed with
`factor_set_adoption_required`; the browser cannot adopt it. A separate
service-role/operator RPC can adopt one exact DB-recomputed set only while its
own gate is ON and normal Google session issuance is OFF. It is request/actor/
reason bound, append-only audited, idempotent for an exact retry even after the
gate returns OFF, cannot replace an existing approval and is intentionally not
an Edge action. Enabling and using this recovery path is a Hosted/Human HOLD.

Pre-B2.2a Google sessions are retained for FK/audit history but revoked with
`totp_factor_set_migration`. The migration never guesses or backfills either a
session digest or a principal approval. Existing verified sets require the
explicit operator-adoption HOLD before a fresh Google-to-TOTP login.

Enrolled remembered-browser credentials are intentionally not deleted merely
because an application session ends. Pending enrollment/assertion proof is
drained. Binding an existing credential to the new session factor-set contract
is a B2.2b concern and remains HOLD.

## Single-use rare-control authority

`private.admin_control_step_up_nonces` and
`private.admin_control_step_up_grants` are RLS-enabled, directly inaccessible
to browser roles and service role, and contain digests/identifiers only. Every
five-minute grant binds all of the following:

- exact action, mutation request UUID and canonical mutation-intent digest;
- environment, principal, membership and opaque Admin app session;
- backing Supabase Auth session;
- immutable verified TOTP factor-set digest;
- pre-challenge and completion JWT digests;
- minimum and verified TOTP AMR timestamps.

The canonical intent digest uses the fixed domain
`compass:phase7.30:admin-control-intent:v1`. PIN enrollment/rotation binds the
action, pepper version and Edge-peppered HMAC. Policy change binds the target
membership, normalized/sorted actions and models, every quota/limit and exact
validity timestamps. PIN revoke/reset binds the current membership and active
factor id/version; its digest is generated from database state at begin, so the
browser does not need the factor id. The mutation facade recomputes the digest
from its authoritative inputs before consuming the grant. A caller therefore
cannot finish TOTP and then substitute a different PIN or policy payload under
the same request UUID.

The grant is consumed in the same transaction as the PIN/policy mutation. A
committed exact-request and exact-intent retry returns the prior result, while
cross-action, cross-intent, cross-request, cross-session, changed-factor-set,
same-JWT, stale-AMR and double-consumption attempts fail closed. The pre-B2.2a
private PIN and policy implementations have no executable privilege;
same-signature facades prevent old RPC or overload bypass.

Explicit service-role-only RPCs now cover:

- begin/complete rare-control TOTP;
- post-enroll/unenroll factor-set reconciliation;
- default-OFF operator adoption for an existing verified set (Edge-unwired);
- AI PIN revoke and reset;
- safe AI-unlock profile metadata;
- bounded `SKIP LOCKED` control-state cleanup.

`admin-identity-session` exposes only the identity/control begin, complete and
reconcile actions needed for this boundary. It keeps the existing default-OFF
Edge flag. Identity/context HMACs continue to use their server-only secrets;
factor-set, JWT, nonce and canonical-intent digests use domain-separated
SHA-256. No TOTP code, TOTP seed, QR payload, raw control nonce or app-session
token is stored in PostgreSQL.

The Google-session INSERT trigger independently requires the issuance gate,
principal-approved/live/session hash and count, a matching pending login nonce,
and non-null post-challenge JWT/AMR evidence written by the completion RPC. A
service-role table INSERT therefore cannot skip TOTP completion.

The login completion lock chain is principal, membership, environment and then
the re-read nonce; its first nonce lookup is nonlocking discovery only. Session
revocation drains assertion challenges before enrollment nonces, matching the
existing factor-authority drain. Static and real two-transaction tests keep
these cross-function lock orders from drifting.

## Verification contract

Source verification includes:

- static checks for gates, ACL/RLS, fixed `search_path`, domain separation,
  legacy-function privilege removal, Edge body allowlists and generated types;
- pgTAP for factor ordering, initial atomic approval, explicit adoption,
  stolen-old-AAL2 factor rejection, completed-evidence session binding,
  8h/no-idle, single-use control, PIN rotation and factor-change drain;
- populated upgrade evidence that old Google sessions are retained but
  reason-revoked without session-digest or principal-approval backfill;
- concurrency coverage for begin/complete and identity-mutation lock order,
  session-revoke versus factor drain, exact retry versus grant consumption and
  factor-set reconciliation versus session touch;
- the existing clean reset, all-pgTAP, generated types and DB lint CI gates.

The current task does not run Docker, Local Supabase, Local Edge or Hosted
mutations. Before activation, exact-head CI must pass and the Local Edge gate
must prove that Supabase `challengeAndVerify` on an already-AAL2 session returns
a new access token containing a new TOTP AMR timestamp. Real Google accounts,
factor enrollment/unenrollment recovery, browser-device proof and Hosted/Human
evidence remain explicit HOLD items.
