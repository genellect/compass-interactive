# Phase 7.30B2.2b Admin AI Unlock Edge and Browser Readiness

Date: 2026-08-10
Status: Implemented in source, non-Docker verification pending
Activation: default OFF; Local Supabase, Local Edge, Hosted and Human evidence HOLD

## 1. Scope

Phase 7.30B2.2b connects the B2 database foundation and the B2.2a approved-TOTP
trust anchor to a dedicated Admin-only transport and browser UI. It implements:

- personal four-digit AI PIN profile, initial enrollment, rotation, revoke,
  reset and ordinary verification;
- opt-in remembered-browser enrollment with a non-extractable WebCrypto P-256
  private key stored only in IndexedDB;
- dormant ES256 remembered-browser assertion verification which never creates a
  lecture master or paid-provider authority;
- rare-control add/remove transitions for an approved Supabase TOTP factor set;
- bounded response-loss recovery for an already-authorized factor transition;
- separate identity-factor and AI-unlock UI gates.

It does not migrate the operational Admin Edge inventory, add lecture ownership,
or atomically exchange a PIN/browser proof for `lecture_ai_master_authorizations`.
Those authority boundaries remain Phase 7.30C/E work.

## 2. Default-OFF topology

Activation requires matching source, Edge and database gates. The source defaults
remain:

- `VITE_PHASE7_30_ADMIN_AI_UNLOCK=false`;
- `VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION=false`;
- `PHASE730_ADMIN_AI_UNLOCK_ENABLED=false`;
- `PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED=false`;
- `private.admin_ai_unlock_runtime_gate.ai_unlock_enabled=false`;
- `private.admin_ai_unlock_runtime_gate.remembered_browser_enabled=false`;
- `private.admin_identity_runtime_gate.totp_factor_mutation_enabled=false`.

TOTP factor management is an identity control. It is not conditional on
`can_use_ai`, the AI-unlock Edge secret set, or the AI-unlock runtime gate.
AI PIN and remembered-browser controls are hidden when `can_use_ai=false`.

## 3. Dedicated Edge boundary

`admin-ai-unlock` accepts only a bounded JSON action allowlist and requires a
Google OAuth bearer, AAL2, a live `auth.sessions` row, an active B2.2a `g1` Admin
app session, active environment membership and the approved/live TOTP factor-set
match on every request. It applies strict Origin/CORS checks, `Cache-Control:
no-store`, bounded errors and service-role RPC facades. Browser roles receive no
direct grant on private tables or helpers.

The raw four-digit PIN exists only in a bounded TLS request body. The Edge derives
a domain-separated peppered HMAC and a trusted coarse-network HMAC before calling
the database bcrypt/rate/receipt path. Raw PINs, pepper values, recovery tokens,
TOTP codes, TOTP secrets and QR material are excluded from browser persistence,
database audit, logs and errors. Invalid PIN shape is a request error; missing or
invalid server pepper configuration is a fail-closed service-unavailable error.

Ordinary PIN verification does not require a fresh TOTP event. PIN enrollment,
rotation, revoke and reset use the B2.2a five-minute, action/request/session/
factor-set/JWT/AMR/canonical-intent-bound single-use grant. A factor-history-free
initial enrollment first reuses the still-valid login grant, then asks for one
fresh TOTP only when that grant is no longer usable.

## 4. Remembered-browser contract

The browser creates a P-256 key with `extractable=false`. Only the public JWK,
RFC 7638 fingerprint and bounded provenance are sent to the server. The private
`CryptoKey` remains in IndexedDB and the four-digit PIN is never stored.

Enrollment persists a client-generated opaque nonce and stable request IDs before
the Edge call. A five-minute enrollment window is distinct from the credential's
absolute lifetime. Ambiguous begin/complete responses retain the pending key and
nonce for exact retry; successful completion converges pending state to active
state idempotently across tabs. Pending claims are atomic per environment,
principal and membership. Active records are shown only for the current identity
scope; other teachers' records on a shared origin remain hidden and intact.

Assertion challenges bind the exact Origin, current Admin app/Auth session,
environment, principal, membership, AI factor/policy, lecture and scope. A
credential may survive logout and be reused only after a new valid AAL2 Admin
session. Factor change, credential revoke, stale session or binding mismatch
fails closed. B2.2b returns a dormant proof marker only; it issues no master and
does not call a paid provider.

## 5. Approved TOTP factor transitions

Adding or removing an approved TOTP factor is rare identity control:

1. prepare requires live verified factors to exactly equal the principal's
   approved pre-set and computes one canonical transition intent from one
   aggregate `auth.mfa_factors` snapshot;
2. the existing approved set completes a fresh B2.2a control grant;
3. authorize consumes that grant into one durable, payload-bound transition;
4. Supabase Auth verifies the exact unverified add candidate, or unenrolls the
   selected approved remove target;
5. finalize requires the live set to equal the bound expected post-set, advances
   the principal anchor atomically and drains old Admin-session/AI authority.

Removal may not produce zero verified factors. Replacement is add, re-login, then
remove. Supabase JWT AMR does not identify the factor UUID, so B2.2b does not claim
that a particular authenticator performed the approval. Its security statement is
the exact approved live set plus a fresh TOTP AMR before authorization.

The transition recovery window is at most 30 minutes and is capped by both the
Admin app-session expiry and `auth.sessions.created_at + 8 hours`. A transition is
refused before prompting when five minutes of safe recovery time do not remain.
The browser stores a random recovery token in IndexedDB; the database stores only
its hash. Finalize can recover after the factor mismatch drains the old app token,
but still requires the same Auth user/session and exact transition tuple. Other
teachers and other Auth sessions cannot see or use the local recovery. Logout is
blocked while that current-scope transition is recoverable. There is no unsafe
cancel operation across the non-transactional Supabase Auth mutation boundary.
The local claim is intentionally written before authorization to survive an
ambiguous response, but is never itself treated as authority. Recovery first
attempts exact finalization and, while the pre-change app session is still
available, must then recover the exact DB `authorized` transition before calling
Supabase Auth. A transport failure before DB commit therefore cannot trigger
factor verification or unenrollment. At the five-minute boundary, the DB alone
marks an unused recovery token safe for token-private local deletion.

## 6. Migration and evidence

Migration `20260810113000_phase7_30b22b_ai_unlock_edge_browser.sql` is additive.
It does not infer an approved factor set or browser trust binding. Pre-B2.2b
pending browser ephemera is superseded; pre-B2.2b active credentials are revoked
with bounded provenance because their new bindings cannot be guessed. PIN/policy
state and the B2.2a principal anchor are preserved.

Source evidence includes:

- B2.2b, B2.2a, B2 and Supabase static contracts;
- Chromium and WebKit IndexedDB/CryptoKey scope, expiry, reload and cross-tab
  convergence tests;
- a true populated B2.2a-head-to-B2.2b upgrade fixture;
- pgTAP schema/ACL/terminal-state contracts;
- deterministic principal-transition admission and authorize/finalize expiry
  lock ordering in the B2 concurrency runner;
- bounded transition-before-grant-before-nonce retention through the existing
  control-ephemera cleanup facade;
- generated types, documentation routing, secret scan, lint, typecheck and build
  in the non-live CI topology.

Docker-backed migration/pgTAP/concurrency, real GoTrue AAL2-to-AAL2 freshness,
Local Edge, exact-head CI, Hosted Google OAuth/TOTP, full browser-profile/XSS and
Human teacher recovery evidence remain HOLD until those gates actually run.

## 7. Production boundary

B2.2b adds no fixed-cost hosted service and performs no deployment. It does not
remove `ADMIN_PIN` or `BILLING_PIN`; those are removed only after the Phase 7.30C
operational authorization migration and personal-AI-PIN E2E respectively, before
Production. It does not authorize Presenter hosting, signing distribution, R2,
lecture ownership, master activation or paid AI execution.
