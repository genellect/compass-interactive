# Phase 7.30B2 Admin AI Unlock Database Foundation

Status: Implemented, verification pending
Scope: default-OFF PostgreSQL source foundation for personal AI PIN, policy, remembered-browser state, session continuity and authority drains
Last verified: 2026-08-10

## Evidence boundary

The B2 database/source checkpoint is commit `9f1e0ec` (`feat: add dormant admin
AI unlock foundation`). It was reconciled with the latest `main` before this
documentation update. The non-Docker static contract
`npm run test:phase7-30b2-static`, Node syntax checks and `git diff --check`
passed for the reviewed source.

This is not runtime database acceptance. Exact-head CI still has to prove the
from-zero migration, every pgTAP file, the real two-transaction concurrency
runner, the populated Phase 7.29/B1-to-B2 upgrade, generated database types and
database lint. Hosted Supabase, real Google OAuth, Human MFA/browser evidence,
feature activation and Production remain **HOLD**.

No Hosted resource, OAuth client, secret, account or recurring fixed-cost
service is required or created by this source foundation.

## Implemented database boundary

The B2 migration adds nine RLS-enabled private tables:

1. `private.admin_ai_unlock_runtime_gate`: singleton default-OFF AI-unlock and
   remembered-browser gates;
2. `private.admin_ai_policies`: versioned, environment/membership-scoped AI
   action, model, usage, cost, concurrency and validity policy;
3. `private.admin_ai_unlock_factors`: versioned personal AI PIN verifier and
   lifecycle metadata, never the raw four digits;
4. `private.admin_ai_unlock_rate_limits`: atomic membership, pepper-hashed
   coarse-network and environment buckets;
5. `private.admin_ai_unlock_attempt_receipts`: immutable, input-bound
   verification results and denial replay;
6. `private.admin_ai_pin_discovery_receipts`: short-lived, version-bound
   pepper-discovery receipts;
7. `private.admin_ai_browser_enrollment_nonces`: short-lived, single-use
   enrollment intent and completion state;
8. `private.admin_ai_browser_credentials`: revocable Origin/profile public
   credential state; and
9. `private.admin_ai_browser_assertion_challenges`: digest-only, one-time,
   lecture/scope/session/policy-bound assertion state.

`public.lecture_ai_master_authorizations` gains nullable principal,
membership, issuing Admin session, unlock method, factor/browser/policy and
request provenance. Existing rows remain readable during the expand-first
migration. B2 does not yet issue a new lecture master from an AI proof.

All nine private tables revoke direct access from `PUBLIC`, `anon`,
`authenticated` and `service_role`; RLS remains enabled as defense in depth.
The public RPC wrappers are `SECURITY INVOKER` and executable only by
`service_role`. The minimum privileged implementation stays in the private
schema, uses `SECURITY DEFINER` only where required, fixes `search_path` to an
empty value and revalidates principal, membership, Admin session and backing
`auth.sessions` state inside the database.

## Session continuity

B2 replaces the transitional B1 Google-session idle branch with the approved
teacher-session contract:

- the application absolute cap is derived from
  `auth.sessions.created_at + 8 hours`;
- `idle_expires_at` is normalized to the same absolute expiry, so opening a new
  tab or touching a session cannot extend it;
- the backing `auth.sessions` row must still exist for sensitive database
  operations;
- no 30-minute idle expiry or periodic TOTP prompt occurs during a lecture;
- role changes are evaluated from current membership state; and
- AI factor rotation drains derived AI authority but preserves the Admin
  application session.

Phase 7.30C still has to apply one unified verifier to every operational Admin
Edge Function and RPC. The B2 database helper is not evidence that legacy
lecture, PDF, Display, Presenter or AI endpoints already use Google authority.

## Personal AI PIN contract

The database never accepts or stores a raw four-digit PIN. Its B2 input is a
64-hex, versioned HMAC produced by the later trusted Edge boundary. PostgreSQL
stores only a bcrypt cost-12 verifier of that peppered HMAC and the non-secret
pepper version/factor provenance.

A new factor enrollment or rotation request requires a server-recorded TOTP
step-up within five minutes. Initial enrollment immediately after the
Google-to-TOTP login uses the already-fresh login event and therefore adds no
second prompt. Once an actor/principal/membership/environment/Admin-session-
bound request ID commits, any retry with that same binding returns the stored
factor result and ignores supplied PIN/HMAC/pepper material. It never compares
that material or runs bcrypt again, so the idempotency path cannot become a PIN
oracle. A changed actor, session or scope returns no result. Future AI PIN reset
must use the same rare five-minute control-plane boundary.

Ordinary AI PIN verification, remembered-browser proof, lecture operation,
emergency stop, lecture-master activation or scope/cost escalation and child AI
calls require a valid AAL2 Admin session but no fresh TOTP prompt. The personal
PIN is verified once per new lecture master or explicit scope/cost escalation,
not once per provider call.

Before bcrypt, B2 uses nonblocking transaction advisory semaphores capped at
four concurrent attempts per environment and two per coarse-network bucket.
After verification, canonical row locking atomically rechecks the membership,
coarse-network and environment rate tiers. Immutable receipts bind the request
input, actor, session and factor provenance so exact positive or negative
replay cannot increment counters or change its result. Rotation does not clear
membership-wide abuse state.

## Remembered-browser database state

B2 constrains public credentials to ES256/P-256 public JWKs, rejects private
`d` material and JSON-null substitutions, and binds the stored fingerprint to
the RFC 7638 canonical thumbprint. Enrollment nonce, credential and assertion
challenge rows carry exact environment, principal, membership, Admin session,
factor version, Origin, expiry and request provenance. Assertion challenges are
single-use and additionally bind lecture, requested scope and policy version.

This is database state only. Actual browser non-extractable `CryptoKey`
creation/storage, WebCrypto signing, Edge ES256 verification, CSP/profile-copy
evidence and Chrome/Edge/WebKit Human testing are not implemented by B2. No
hardware or physical-device binding is claimed.

## Policy, drains and cleanup

Policy creation/supersession and new PIN factor enrollment/rotation cross the
five-minute rare-mutation boundary. Policy, factor-rotation and browser
transitions use membership-scoped serialization and idempotent drains. Factor
rotation supersedes the old factor's pending browser state and drains derived
AI master authority while leaving the Admin session intact. Individual browser
revoke drains only that credential's authority. Policy supersession drains
masters carrying the superseded policy version. An explicit factor revoke/reset
transition API remains B2.2/C.

Cleanup is bounded to 500 rows per class, uses nonblocking membership
serialization plus `SKIP LOCKED`, records a content-free request audit and
returns `has_more` so repeated runs converge. Concurrent cleanup, factor
rotation, browser revoke and a second cleaner may choose `expired` or
`superseded` for a pending child, but converge to one safe terminal credential
outcome without revoking the teacher's Admin session.

## Explicitly not implemented in B2

The following remain B2.2/Phase 7.30C or later and **HOLD**:

- the Edge endpoint that validates exactly four decimal digits, applies the
  server-only pepper HMAC and clears raw input after the bounded TLS request;
- actual remembered-browser WebCrypto key creation and ES256 signature
  verification;
- authoritative verified-TOTP factor-set fingerprinting and invalidation;
- explicit AI PIN factor revoke/reset transition APIs;
- the unified verifier across every Admin Edge/RPC path;
- lecture ownership and owner/instructor operational RBAC;
- one-transaction AI proof-to-lecture-master admission and every paid child
  start integration;
- Google/MFA/AI-unlock UI, accessibility and real browser E2E;
- a dedicated AI Passkey/WebAuthn implementation;
- real Google OAuth, Hosted Supabase provider/database/Edge configuration,
  two-owner recovery, Human evidence and activation; and
- `ADMIN_PIN` and `BILLING_PIN` removal.

`ADMIN_PIN` is removed after the Phase 7.30C authorization migration and before
Production. `BILLING_PIN` and its compatibility RPC are removed after personal
AI PIN end-to-end completion and before Production. Rollback uses a reviewed
Google-only immutable revision and operator owner recovery, never either shared
PIN.

## Next gate

The B2 source PR may proceed only after exact-head CI runs the real database
steps named above. Passing them confirms this default-OFF foundation; it does
not authorize Hosted mutation or activation. Phase 7.30C remains the next
authorization implementation boundary, and Phase 7.33 remains the next formal
integrated Production Gate.
