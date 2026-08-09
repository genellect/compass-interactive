# Phase 7.30A-B1 Google Admin Identity Local Implementation

Status: Implemented, verification pending
Gate state: Local Gate PASS; exact-head CI pending; Hosted/Human activation HOLD
Scope: source and local contracts for individual Google Admin identity and mandatory TOTP AAL2
Last verified: 2026-08-09

## Outcome

Phase 7.30A and the deliberately bounded B1 slice are implemented in source for
local validation. B1 establishes a separate Admin Auth client, trusted Google
identity binding, a mandatory TOTP AAL2 transition, and an individually
revocable application Admin session. It does **not** migrate lecture operations
to the new identity or implement the paid-AI unlock layer.

This record is not a Production Gate result. No real Google OAuth client,
Supabase Hosted provider, Hosted database, Hosted Edge Function, Hosted
callback allowlist, Hosted secret, real account, Hosted Auth user, or Hosted
runtime flag was created or changed. Local synthetic users and identities were
ephemeral and cleaned after verification. Real-account Google/TOTP, Hosted and
Human evidence is **not executed / HOLD**.

## Implemented B1 boundary

- A physically separate Supabase Admin client uses PKCE and the fixed
  `/admin/auth/callback` route. The existing anonymous Student client and
  session stay separate.
- The Admin Auth client strips Google `provider_token` and
  `provider_refresh_token` from Auth JSON before the Supabase SDK can persist
  or broadcast the session, and the storage adapter repeats that sanitization
  on writes and reads. The opaque application-session token is held in
  `sessionStorage`, not the Google provider token.
- The Edge admission path validates the bearer with Supabase Auth, then obtains
  the trusted server-side Auth user and linked Google identity. Request input,
  `user_metadata`, and later email comparison do not establish authority.
- Google issuer and subject are bound once. The Google `sub` is transformed
  with a domain-separated HMAC using the server-only
  `ADMIN_IDENTITY_PEPPER`; raw `sub` is not stored as the principal key.
- Environment, principal, owner/instructor membership, invitation/bootstrap,
  append-only audit, five-minute TOTP nonce, and tracked-session state are
  additive database structures. Private tables have RLS enabled and are not
  directly granted to browser roles.
- AAL1 admission returns only eligibility. It does not return role,
  `can_use_ai`, ledger, lecture, audit, or operational Admin data.
- Beginning step-up creates a nonce valid for at most five minutes. The first
  successful completion consumes it and creates exactly one session; an exact
  retry by the same caller, Auth session, JWT and nonce within that window
  returns the same session/token rather than issuing another. Only the nonce's
  SHA-256 digest is stored, bound to the exact environment, principal,
  membership, Supabase Auth `session_id`, pre-challenge JWT, intended action
  and reserved future application-session ID.
- Completion requires a verified TOTP factor, Supabase AAL2, a fresh JWT, and a
  fresh `totp` or `mfa/totp` AMR timestamp at the nonce issuance boundary. The
  database permits at most one second of JWT timestamp precision tolerance,
  consumes the nonce and records that server-validated AMR time atomically.
- Only after successful AAL2 completion is an opaque application Admin session
  created. The database stores its digest, not the bearer value. It has an
  eight-hour absolute lifetime and a sliding 30-minute inactivity limit and is
  bound to the Google principal, membership, environment, Supabase Auth
  session, and consumed step-up nonce.
- Status/touch rechecks the current Google/Supabase Auth session, membership,
  runtime gate, absolute expiry and inactivity expiry. Self-logout separately
  matches the token, Auth user and Auth session so it can revoke even an
  already-expired application session. B1 does not add owner-wide session
  management or operational RBAC.

## Dormant activation contract

Google Admin session issuance has two authoritative server gates and one
separate UI exposure flag:

| Layer    | Control                                                            | Committed default |
| -------- | ------------------------------------------------------------------ | ----------------- |
| Database | `private.admin_identity_runtime_gate.google_session_issue_enabled` | `false`           |
| Edge     | `PHASE730_ADMIN_IDENTITY_ENABLED`                                  | `false`           |
| Frontend | `VITE_PHASE7_30_ADMIN_IDENTITY`                                    | `false`           |

The database and Edge controls form the authorization AND gate. The frontend
flag only exposes the UI and is not an authorization boundary; a normal
activation nevertheless requires all three controls to be enabled together.
In addition, the environment ID, exact origin, issuer, audience, server-only
pepper and Admin session secret must be valid. Local Supabase TOTP enrollment
and verification support is enabled for testing, while the local Google
provider remains disabled until a developer supplies a separate Interactive
OAuth client outside Git.

Expand-first compatibility is equally explicit:

| Layer    | Control                                                        | Committed default |
| -------- | -------------------------------------------------------------- | ----------------- |
| Database | `private.admin_identity_runtime_gate.legacy_pin_login_enabled` | `true`            |
| Edge     | `PHASE730_LEGACY_ADMIN_PIN_ENABLED`                            | `true`            |
| Frontend | `VITE_PHASE7_30_LEGACY_ADMIN_PIN`                              | `true`            |

Legacy `ADMIN_PIN` sessions are explicitly tagged `legacy_pin`/AAL1. Google
sessions are explicitly tagged `google_totp`/AAL2, and database constraints
prevent the two credential modes from being interpreted interchangeably.

## Source verification boundary

The change supplies migration, pgTAP, Edge/helper, storage, type, build,
non-live, browser, and local integration coverage for the B1 contract. The
authoritative result is the exact-head CI and local command evidence attached
to the reviewed change; the presence of a test file is not itself a PASS.

The local negative matrix covers default-OFF behavior, legacy compatibility,
AAL1 and null-provenance denial, Google-subject disagreement, five-minute
nonce expiry, exact-retry idempotency, cross-principal/Auth-session/
prechallenge and expired-retry rejection, mode separation, revoke/rate
behavior, and provider-token sanitization. Student/demo/Display/PDF/AI/
Presenter-OFF regressions remain required because B1 must not widen those
surfaces. Non-null wrong-issuer, stale-AAL2-AMR and application-session
absolute/idle branches remain implementation contracts but are not claimed as
separate local negative test cases here.

## Local Gate evidence

The final local source snapshot passed the following checks on 2026-08-09:

- all 65 non-live test groups, strict TypeScript checks, production build,
  bundle budgets, documentation contracts and Cloud workspace readiness;
- secret scanning across 634 tracked and untracked files and `npm audit` with
  zero reported vulnerabilities;
- a clean latest-schema reset, 30 pgTAP files with 1,458 tests, generated-type
  drift verification and local database lint;
- the populated Phase 7.29C-to-7.30B1 upgrade probe with 15 of 15 assertions;
- Phase 7.30 Admin browser flows in Chromium and WebKit: 2 of 2 with the
  Google identity UI enabled and 2 of 2 with it disabled; and
- one real local GoTrue AAL1 session through TOTP enrollment,
  `challengeAndVerify`, AAL2/TOTP AMR issuance, Edge admission, tracked-session
  completion, exact retry, status and logout against the local database.

The local TOTP integration intentionally keeps the Google provider OFF. It
combines the real GoTrue-issued AAL2/TOTP AMR with a locally signed Google
identity fixture so that no Google Cloud OAuth client or Hosted state is
required. One real Google-plus-TOTP JWT, Hosted provider configuration and the
Hosted Supabase Security and Performance Advisor reports remain separate
Hosted/Human evidence and are not implied by this PASS.

## Explicit HOLD after B1

The following remain outside this implementation and are **HOLD**:

- **Phase 7.30B2:** personal four-digit AI PIN, remembered-browser credential,
  AI policy, master-authorization provenance expansion, and AI-unlock rate
  limits;
- **Phase 7.30C:** migration of every Admin Edge/RPC operation to Google RBAC,
  lecture ownership/capability enforcement, owner ledger, global revoke, and
  last-owner transaction coverage;
- **Phase 7.30D-E:** complete Admin/AI-unlock UX, accessibility matrix,
  compatibility canary, and fixed retirement of legacy shared PIN paths;
- **Phase 7.30F:** real Google accounts, Hosted OAuth/TOTP, recovery/revocation,
  two-owner/instructor canary, and Human evidence; and
- **Phase 7.33:** the integrated Production Gate.

B1 therefore confirms identity readiness only. It never converts the new
Google session into legacy global Admin authority, never enables AI, and never
claims Production readiness.

## Fixed-cost-zero development policy

This implementation adds no required paid service and no recurring fixed cost.
Development uses the checked-in local Supabase stack and source-level/mock
tests. A developer may later configure a separate Google OAuth client in an
existing Google Cloud project and Supabase environment, but credentials and
Hosted mutations remain manual, secret-controlled Gate work. Cloudflare custom
domains/Gateway, R2 update feeds, Authenticode signing, paid Hosted capacity,
and real AI provider calls are not prerequisites for this B1 local gate and
were not provisioned.

## Rollback

The committed state is already dormant. Leave the two Google server gates and
the Google UI flag OFF, and leave the three legacy-login compatibility controls
ON, to retain the pre-B1 Admin path. If a local canary is being exercised,
disable the database Google gate first, then Edge admission and the frontend
flag. Keep the additive identity/session/audit schema for evidence and do not
use destructive down migrations as an incident response.

The complete future contract remains in
[`PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`](PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md).
