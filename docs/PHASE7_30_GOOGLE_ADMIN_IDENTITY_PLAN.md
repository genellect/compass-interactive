# Phase 7.30 Google Admin Identity, AAL2 and RBAC Plan

Status: Phase 7.30A-D verified default-OFF; Phase 7.30E and 7.30F source/local candidates
Gate state: A-D exact-head database, Edge and browser evidence passes. E removes the shared Admin transport from the current application and leaves the operator cutover dormant; E exact-head runtime evidence was pending when F branched. F adds a default-HOLD source/local readiness contract, but all Hosted/Human execution and activation remain HOLD
Implementation scope: A-D complete; E Google-only source, explicit ownership evidence and dormant identity-cutover authority implemented; F redacted evidence/schema/validator/read-only-preflight source candidate; E runtime freeze, billing compatibility retirement and every external F action pending
Approval: requirements approved; Hosted/Human activation not authorized
Scope: Google sign-in, mandatory step-up authentication, multi-Admin authorization and audit
Last verified: 2026-08-12

Implementation records:
[`PHASE7_30A_B1_IMPLEMENTATION.md`](PHASE7_30A_B1_IMPLEMENTATION.md) and
[`PHASE7_30B2_AI_UNLOCK_FOUNDATION.md`](PHASE7_30B2_AI_UNLOCK_FOUNDATION.md) and
[`PHASE7_30B22A_ADMIN_CONTROL_HARDENING.md`](PHASE7_30B22A_ADMIN_CONTROL_HARDENING.md) and
[`PHASE7_30B22B_AI_UNLOCK_EDGE_BROWSER.md`](PHASE7_30B22B_AI_UNLOCK_EDGE_BROWSER.md) and
[`PHASE7_30D_ADMIN_LEDGER.md`](PHASE7_30D_ADMIN_LEDGER.md) and
[`PHASE7_30E_GOOGLE_ONLY_CUTOVER.md`](PHASE7_30E_GOOGLE_ONLY_CUTOVER.md) and
[`PHASE7_30F_HOSTED_HUMAN_READINESS.md`](PHASE7_30F_HOSTED_HUMAN_READINESS.md).
The narrow C1 ownership and atomic dormant-master integration record is
[`PHASE7_30C1_GOOGLE_AI_MASTER_ADMISSION.md`](PHASE7_30C1_GOOGLE_AI_MASTER_ADMISSION.md).

## Implementation checkpoint

Phase 7.30A, the bounded B1 identity foundation and the B2 default-OFF Admin AI
unlock database foundation now exist in source. Google issuance is protected by two independent,
default-OFF server controls: the database runtime gate and
`PHASE730_ADMIN_IDENTITY_ENABLED` at Edge. The separate
`VITE_PHASE7_30_ADMIN_IDENTITY` flag exposes the frontend UI but is not an
authorization boundary; normal activation requires all three to be enabled
together. B1 originally retained shared Admin PIN compatibility; Phase 7.30E
removes that issuer, UI, client storage, flags and wire transport from the
current application while leaving the database cutover dormant.

B1 binds the trusted Google issuer/subject with a server-only HMAC, uses a
five-minute digest-only nonce, verifies a fresh TOTP AMR timestamp, and creates
an opaque application Admin session only after AAL2. That session has an
eight-hour absolute lifetime and a sliding 30-minute inactivity limit. It does
not grant the existing operational Admin workspace authority; that migration
belongs to Phase 7.30C.

The preceding lifetime remains the exact historical B1 source state, not the
current B2 session behavior. Phase 7.30B2 now implements the default-OFF
continuous-session lifetime and invalidation database migration; Phase 7.30C
completed its unified verifier across every operational Admin Edge/RPC path.
B2 removes the 30-minute idle limit and anchors the application session's absolute cap to the backing
`auth.sessions.created_at + 8 hours`. There is no periodic TOTP prompt during a
lecture. The B2 database path rejects explicit logout, disappearance of the
backing `auth.sessions` row, principal/environment/membership invalidation or
the eight-hour cap. Role changes are enforced live without dropping the Admin
session; `can_use_ai=false` drains AI authority while preserving it. B2.2a now
stores an approved factor-set hash/version/count on the principal and issues a
Google Admin session only when that trust anchor, the live verified set, the
session binding and completed post-challenge JWT/AMR nonce evidence agree.
Changed sets are reason-revoked and drain pending AI authority. The only
automatic approval is an unbound `pending_mfa` principal's exact first 0-to-1
factor during fresh completion. Existing verified but unbound sets require an
Edge-unwired, default-OFF operator adoption while issuance is OFF; migration
never infers approval. B2.2b now implements default-OFF add/remove rare-control:
one aggregate live snapshot, a fresh existing-set control grant and an exact
expected post-set advance the principal anchor while draining old authority.
Its maximum 30-minute hash-only recovery is capped by the same Auth session.
C2 adds the shared Google Edge verifier, a closed 75-action policy
matrix and same-transaction database facades for lecture lifecycle, comments,
polls, Admin self-session controls, PDF documents and Admin access claims,
Admin operator snapshots, Display state, Presenter and PDF publication,
material-analysis, Summary, Academic and Realtime provider continuations. All
20 C2 operational Admin Edge functions initially had a default-OFF dual
transport. E deletes the redundant `authorize-ai-start` entry and makes the 19
remaining operational adapters Google-app-session only. The Admin workspace
uses its distinct AAL2 Supabase client and has no raw-string legacy transport.
Status, hide, stop and revoke remain available when admission flags are OFF;
provider starts retain request-bound IDs across ambiguous responses.

The B2 source additionally implements nine private AI-unlock tables, service-
role-only public wrappers, fixed-search-path private helpers, bcrypt cost-12 of
a versioned Edge-peppered HMAC, atomic rate/receipt state, ES256/RFC 7638 public
credential constraints, browser nonce/credential/challenge state, policy,
factor-rotation and browser drains, bounded cleanup and nullable lecture-master
provenance.
The runtime gates remain default OFF. A-D clean migration, populated upgrade,
pgTAP, database concurrency, generated types, DB lint, Local Edge and browser
evidence pass exact-head CI. E static, type, non-live and mocked browser
evidence passes locally; E database runtime and exact-head evidence is pending.

No Google Cloud OAuth client, Supabase Hosted provider/database/Edge setting,
callback allowlist, secret, or real account was created or changed. Real Google
OAuth, Hosted and Human evidence is not executed and remains HOLD. B2.2b adds
the default-OFF Edge raw-PIN/HMAC path, real non-extractable browser
CryptoKey/signature flow, PIN/factor UI and approved factor transitions. C1 then
adds private optional-row lecture ownership and atomic PIN/browser-proof to
dormant-master admission without inferred backfill or child/provider authority.
It does not by itself implement the all-Admin verifier, complete operational
Edge/RPC migration or AI Passkey. C2 implements the all-Admin verifier and
closed policy/facade matrix. D adds the owner-only invitation, membership,
session and bounded-audit ledger with immutable request/step-up evidence and
safe flag-OFF controls. E removes the application shared-Admin transport, adds
explicit operator-reviewed ownership evidence, Display terminal provenance and
a dormant SERIALIZABLE/NOWAIT cutover authority. The irreversible cutover,
billing compatibility retirement, AI Passkey and every Hosted activation
remain HOLD. F now supplies the source/local evidence format, strict
secret-rejecting validator, read-only preflight, approval separation and
Google-only rollback checklist. It never performs an external action, and its
highest local decision is `READY_FOR_SEPARATE_HOSTED_EXECUTION`: a complete,
separately collected staging dossier may request the next separately approved
step, but the validator does not query or independently prove Hosted state and
this is not a Production result. The source implementation adds no recurring
fixed-cost dependency.

## Outcome

Phase 7.30 replaces the shared Admin **login** PIN with individual Google
identities without weakening any student, lecture, PDF, Display, AI or
Presenter contract. Authentication, authorization, step-up authentication and
AI-use intent remain separate server-side decisions:

```text
Google/Supabase identity
  -> active environment-scoped Admin membership and capability
  -> AAL2 plus server-recorded recent step-up where required
  -> tracked, individually revocable Admin session
  -> lecture ownership/lifecycle check
  -> personal four-digit AI PIN, dedicated AI Passkey, or remembered-browser proof
  -> two-scope lecture AI master authorization
  -> live policy/budget/concurrency/idempotency when each paid API starts
```

Normal paid-AI UX no longer asks an owner for `BILLING_PIN` on every feature or
lecture. Every AI-capable principal enrolls one easy, personal AI-unlock factor:
a four-digit AI PIN in v1, or a purpose-bound AI Passkey after the dedicated
WebAuthn gate. That factor is never sufficient on its own; it is accepted only
inside a valid Google plus AAL2 Admin session, active membership, owned lecture
and owner-managed AI policy. It unlocks the existing lecture-wide master once,
after which each provider start uses the existing short-lived single-use child
grant and repeats all live cost and lifecycle checks without another PIN prompt.

### Cross-phase lecture UX acceptance

Security acceptance does not permit a technically safe but unusable lecture.
Phases C2 through F must prove the complete happy path as well as denial paths:

- an eligible instructor signs in once with Google plus TOTP, opens an owned
  lecture, views its material and activates each permitted feature without a
  repeated TOTP challenge during the lecture;
- personal AI proof is requested only for a new lecture master or explicit
  scope expansion, then mock-provider/local evidence proves child activation,
  status, stop and recovery without a paid external call;
- students can join, follow and reopen authorized PDF material across Admin
  gate changes, while cross-lecture and revoked access remain denied;
- disabling admission or losing a paid capability still leaves status plus
  close, stop, revoke and downgrade available, with actionable recovery copy;
- Desktop and Mobile Chromium/WebKit E2E cover instructor and student success,
  source-OFF denial, rollback and reload/recovery without console errors,
  horizontal overflow or an authentication loop; and
- Production-bound UI contains no developer, experimental, placeholder or
  internal gate/error wording. Color, typography, spacing, states and copy use
  the established COMPASS design system and remain consistent across Admin,
  Student, Display and Review surfaces.

These are release blockers, not visual polish deferred until after activation.
Hosted/Human evidence must repeat the same success matrix with real identity and
browser profiles before any Production or contest enablement.

The current Google application has no `BILLING_PIN` wire/UI path; historical
database compatibility RPCs remain until the separate billing cutover after
personal-AI-PIN evidence. They are never a Google-mode factor,
browser-persisted or available to a reviewer. `ADMIN_PIN` is removed from the
current application by E, while its database issuer becomes permanently
unusable only when the separately authorized operator cutover commits.
Rollback uses an immutable Google-only application revision and operator owner
recovery, never either shared PIN. Revoked historical legacy-session rows may
remain solely for foreign-key and audit integrity.

## Invariants

- Student anonymous Supabase Auth and the Phase 0
  `participants.auth_user_id = auth.uid()` ownership boundary are unchanged.
- Student five-second snapshots, private Display acceleration and the Phase
  7.29 default-OFF Presenter contract remain separate capabilities.
- Google login creates an identity, not Admin authority. Only an active,
  explicitly provisioned database principal can enter the Admin workspace.
- AAL1 returns no lecture ledger, roster, audit or paid-control data.
- New authorization is server authoritative. UI role branching is never the
  enforcement boundary.
- Lecture continuity is a security and product invariant. Ordinary lecture
  controls, student material access and already-authorized classroom delivery
  must not acquire periodic TOTP prompts. Admission gates may deny new or
  expanded authority, but they must not remove safe read/status paths or
  gate-independent close, stop, revoke and downgrade controls.
- The four-digit AI PIN is a low-entropy intent factor, not authentication. The
  server accepts it only after AAL2, keeps only a slow verifier protected by a
  server-only pepper, and enforces atomic attempt limits and lockout. A raw PIN
  may exist only in the trusted Admin form and a bounded TLS request. It is
  cleared after the response and never enters storage, logs, audit, analytics,
  error traces or a URL.
- A remembered browser stores a non-extractable WebCrypto private key and a
  revocable opaque browser-profile credential, not the PIN. Remembering is
  opt-in and default OFF for shared devices. This is not hardware or device
  binding: same-origin XSS, dependency compromise and full-profile copying
  remain explicit threat and Hosted/Human test boundaries until WebAuthn.
- AI master authorization itself performs no provider call. It has exactly two
  scopes; selecting the caption-inclusive scope never auto-starts Realtime,
  which retains a separate start CTA and browser microphone permission.
- No Google client secret, service role, provider token, API key, factor secret
  or recovery code enters Git, browser logs or Codex Cloud. The Admin Auth
  storage adapter strips Google `provider_token` and `provider_refresh_token`
  before persisting the Supabase session.
- Migrations are expand-first, but shared PINs are not a Production rollback
  contract. Current legacy issuers remain source compatibility only until the
  Phase 7.30C cutover and personal-AI-PIN E2E; both shared secrets and their
  issue/compatibility paths are removed before Production.

## COMPASS asset reuse boundary

The separate `genellect/compass` repository is a reviewed design source, not a
credential bundle. Reuse must record its source and adapt it to Supabase rather
than copying its Cloud Run/Neon runtime.

| Classification                                  | Assets                                                                                                                                                                                                                                        | Interactive treatment                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse as design/test patterns                   | exact issuer/audience/email-verified checks; stable Google `sub`; active-principal lookup; capability shaping; append-only audit; exact route/origin allowlists; timeout/idempotency; fail-closed runtime flags; separated service identities | Translate to Supabase Auth, Postgres and Edge tests. Preserve provenance; copy no secret or production state.                                       |
| Conditionally reuse after read-only Cloud audit | organization/billing ownership, verified domain, consent branding and operational knowledge                                                                                                                                                   | Reuse only when IAM blast radius, rollback owner and environment separation are explicit. OAuth itself normally adds no meaningful provider charge. |
| Interactive-only                                | production and staging OAuth clients, redirect/origin allowlists, Supabase Google provider secret, app/session secrets, service identities, rotation and rollback                                                                             | Create separately for Interactive. Production and staging/local use different clients and preferably different Google Cloud projects.               |
| Never reuse directly                            | COMPASS OAuth client ID/secret, allowlist payload, Drive credentials, Cloud Run URL/shared secret, GCP service accounts/IAM, Neon roles/data, Python verifier, single-instance in-memory limiter                                              | Re-creation or copying is prohibited.                                                                                                               |

The prior COMPASS implementation does not provide application-enforced AAL2,
an Interactive session ledger or individual session revocation. It cannot be
used as evidence that those Phase 7.30 gates already pass.

## Principal and capability model

Roles stay deliberately small:

- `owner`: platform-wide Admin governance;
- `instructor`: own-lecture operation only.

An Admin principal is a stable identity. Role, status and AI eligibility are
held by an environment-scoped membership so one Google identity cannot inherit
Production authority in staging or contest. AI eligibility is a separate
`can_use_ai` entitlement. The two initial owner-controlled Google accounts are
provisioned as distinct `owner` memberships in the Production environment
through Hosted bootstrap input; their email values are not committed to source.
At least one active owner membership must always remain in each governed
environment.

Staging and contest do not inherit a Production owner row. Each separate
Supabase project performs its own create-only owner bootstrap using a
server-controlled environment mapping. The contest owner is responsible for
reviewer invitation, AI policy limits, individual revocation and cleanup
supervision without gaining a data path back to Production. Reviewers enroll
their own AI-unlock factor; owner intervention is not required for each lecture.

Contest reviewers do not introduce a third role. After Phase 7.30 is complete,
an invited reviewer is provisioned in the isolated contest environment as the
existing `[2] AI-capable Admin`: `role=instructor`, `can_use_ai=true`, active for
a bounded review period. That principal may exercise the real own-lecture
teacher and paid-AI workflow within its limits, but receives no owner, global
ledger, cross-lecture, deployment, budget-administration, or secret-reading
capability. The environment, invitation and expiry contract is authoritative in
[`PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`](PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md).

| Capability                                         |                                               Owner |                                          Instructor |
| -------------------------------------------------- | --------------------------------------------------: | --------------------------------------------------: |
| Create and operate own lecture                     |                                                 yes |                                                 yes |
| View own lecture history and sessions              |                                                 yes |                                                 yes |
| Use paid AI                                        | `can_use_ai` plus personal AI unlock and cost gates | `can_use_ai` plus personal AI unlock and cost gates |
| Revoke own Admin session                           |                                                 yes |                                                 yes |
| View/manage all Admin principals and sessions      |                                                 yes |                                                  no |
| Stop any lecture                                   |                      yes, explicit emergency action |                                                  no |
| View global lecture ledger and bounded Admin audit |                                                 yes |                                                  no |
| Suspend/reactivate another Admin                   |                           yes, last-owner protected |                                                  no |
| Change role, status, TOTP factors or AI policy     |             yes, five-minute TOTP step-up and audit |                                                  no |
| Change `can_use_ai`                                |  yes, live effect plus AI-authority drain and audit |                                                  no |

Account suspension and emergency lecture stop are separate, explicit and
idempotent actions. Suspension drains the target's Admin sessions and
unconsumed authority; it does not silently close lectures unless an owner also
chooses the emergency-stop action.

## Database expansion

Across the B1 and B2 source commits, Phase 7.30B adds behind default-OFF
enforcement:

- `private.admin_principals`: stable Supabase `auth_user_id`, hashed provider
  subject and issuer/provider binding, restricted normalized email/display
  name, global compromise status and bootstrap metadata;
- `private.admin_environments`: server-selected Production/staging/contest
  identity and status; its identifier is never accepted from an untrusted
  request without an exact host/audience mapping;
- `private.admin_environment_memberships`: principal/environment, role, status,
  `can_use_ai`, activation/expiry/suspension and last-owner protection;
- `private.admin_invitations`: target normalized email, environment, proposed
  role/capabilities, one-time token digest, inviter, expiry, accepted principal
  and terminal status. Acceptance atomically validates the server-side Google
  identity, consumes the invitation and creates or updates only the intended
  membership;
- `private.admin_audit_events`: append-only actor principal/session, action,
  environment, target, result/reason, request ID and content-free metadata;
- `private.admin_ai_policies`: environment/membership, allowed AI actions and
  models, per-lecture/day call/token/cost ceilings, Realtime minute ceiling,
  concurrency, validity, version and owner change audit;
- `private.admin_ai_unlock_factors`: principal/membership/environment, bcrypt
  cost-12 verifier of a versioned Edge-peppered PIN HMAC, status, factor
  version, enrollment, rotation and revocation. It stores no raw PIN or private
  key. A WebAuthn/AI-Passkey factor is not part of B2;
- `private.admin_ai_unlock_rate_limits`: atomic rolling counters keyed primarily
  by environment and membership, plus separate pepper-hashed coarse-network and
  environment circuit-breaker buckets. They are independent of factor version,
  session and browser credential so rotation cannot clear a lockout. Raw IP
  addresses are not retained;
- immutable `private.admin_ai_unlock_attempt_receipts` and short-lived
  `private.admin_ai_pin_discovery_receipts` for actor/session/input/factor-bound
  replay, exact denial reuse and pepper-version discovery without storing proof
  material;
- `private.admin_ai_browser_credentials`: principal/membership/environment,
  source factor/version, browser-generated public key, opaque credential digest,
  exact Origin, public-key fingerprint, absolute expiry, last-use and
  revocation. It stores no raw PIN or private key and is individually revocable;
- `private.admin_ai_browser_enrollment_nonces`: short-lived single-use digest,
  principal/membership/environment, tracked Admin session, server-recorded
  step-up timestamp, AI-factor version, exact Origin, proposed public-key
  fingerprint, expiry, idempotency key and terminal status; and
- `private.admin_ai_browser_assertion_challenges`: digest-only, single-use
  challenge state bound to credential, identity, session, factor, lecture,
  scope, policy, Origin and expiry. B2 constrains ES256/P-256 public JWKs and
  their RFC 7638 fingerprint, but actual browser key creation and Edge signature
  verification remain HOLD;
- nullable principal, membership, issuing-session, unlock method, factor,
  browser credential, AI-policy version and request references on the existing
  `public.lecture_ai_master_authorizations`.
  Existing `ai_billing_grants` remain internal, short-lived, single-use child
  admissions and do not become reviewer delegation tokens;
- nullable `principal_id`, `membership_id`, authentication method, AAL and
  server-recorded `step_up_verified_at` on `admin_sessions`;
- Phase 7.30C1 now adds private optional-row lecture ownership without exposing
  principal/membership UUIDs on `lecture_sessions`. It performs no inferred
  backfill or owner claim for existing lectures. Verified TOTP factor-set
  fingerprinting is implemented by B2.2a and rechecked by C1 admission.

An `admin_environments` row is defense in depth inside one deployment. It does
not authorize Production, staging or contest to share a Supabase project. Each
real environment has a separate project and authoritative host/audience mapping;
principal, membership, invitation, session, AI policy, unlock factor, browser
credential and master-authorization records never cross project boundaries.

New C1 lectures require an active owner/instructor membership in the exact
environment and are created with their private ownership row in the same
transaction. Existing unowned lectures remain unowned; owner-claim/backfill UX
is C2 HOLD and cannot infer ownership from request input. The nine C1 public
facades are fixed-empty-`search_path` `SECURITY DEFINER`, executable only by
`service_role`; C1 private tables and helpers have no runtime-role grants.
B2/B2.2a/B2.2b wrappers retain their separately documented contracts. Every
parent/expiry/ownership query receives an Advisor-verified leading index.

Audit UPDATE and DELETE are rejected. Metadata never contains TOTP secret or
challenge code, passkey material, OAuth/provider token, session token, PIN,
lecture comment or file content.

## Separate browser identity boundary

The current application shares one Supabase client between anonymous student
and Admin flows. Google Auth must not be added to that instance.

Phase 7.30B also creates an Admin-only Supabase client with:

- a distinct storage key and PKCE callback route;
- exact production, preview and local callback allowlists;
- Admin-route-only lifecycle and logout handling;
- no access from student, Demo or public Display bundles;
- a custom persistence adapter that stores the Supabase session needed for
  reload but removes Google `provider_token` and `provider_refresh_token` before
  every write, including refresh and cross-tab updates;
- a repository boundary that can recognize current legacy rows for explicit
  migration/revocation evidence but switches operational authority to Google
  sessions at the Phase 7.30C cutover. It does not keep a dual-login Production
  path.

Replacing the student anonymous session with a Google session would change
`auth.uid()` and can violate Phase 0 ownership. Cross-client and cross-tab E2E
is therefore a blocking gate.

The authentication state machine is:

```text
signed_out
  -> google_aal1
  -> active_principal_verified
  -> mfa_enrollment_or_challenge
  -> aal2
  -> tracked_app_session
  -> admin_workspace
```

OAuth callback state/nonce and return paths are exact and fail closed. Open
redirects are rejected. Provider refresh/access tokens are neither requested
for Google APIs nor retained by application code. E2E inspects all configured
browser storage before login, after callback, refresh, reload, cross-tab update
and logout and rejects either provider-token field.

The immutable Google identity binding is created only from the server-verified
Supabase Auth identity record. The server verifies the bearer with
`auth.getUser`, reads the linked identity through a service-role Admin API or an
equivalent trusted Auth record, requires provider `google` and verified email,
then atomically binds `(auth_user_id, provider, issuer, provider subject)` while
consuming bootstrap or invitation authority. Request bodies, `user_metadata`
and email comparison are never authoritative, and later requests never
reauthorize by email.

## MFA and recovery

Production v1 uses Google sign-in plus Supabase Authenticator App TOTP as the
mandatory AAL2 path. Its standard `otpauth` enrollment works with Google
Authenticator and other compatible authenticator apps; COMPASS does not build
or operate a custom MFA implementation. All Admin Edge helpers and database
authorization helpers verify AAL2; checking it only in React is insufficient.

- Authenticator app/TOTP: the only v1 MFA option and the server-recognized AAL2
  factor.
- Email: no email MFA, email OTP step-up or application-owned MFA mail flow is
  configured. Google-account and Supabase-operator recovery remain outside the
  lecture UI and do not create a second COMPASS MFA path.
- Passkey: later opt-in only after an owner-controlled custom domain and stable
  RP ID are fixed and the chosen provider contract is production-ready. The
  current Supabase feature is Beta/passwordless and is not treated as this
  phase's AAL2 second factor.

The successful TOTP challenge during Google login establishes AAL2 and the
tracked Admin application session. Phase 7.30B2 implements the following
continuous-session lifetime/invalidation behavior, and Phase 7.30C applies its
unified verifier to every operational Admin Edge/RPC path. Its absolute expiry
is the backing `auth.sessions.created_at + 8 hours`; there is no 30-minute
inactivity expiry and no periodic TOTP challenge during a lecture. Every
sensitive request still checks that the backing `auth.sessions` row,
application session, principal, environment and membership are valid. Explicit
logout, backing-session removal, principal/environment/membership invalidation,
or the eight-hour cap requires a new Google-to-TOTP login. B2.2a additionally
requires a new login on a verified TOTP factor-set change for its factor-bound
session/context paths; Phase 7.30C applies that verifier to every operational
Admin endpoint. Role changes are enforced
from current membership state without terminating the session. Removing
`can_use_ai` drains AI master/browser/pending authority but does not log the
teacher out.

JWT `aal2` alone does not prove a recent challenge for the small set of
control-plane actions that require one. A five-minute server-recorded TOTP
step-up is used only for owner/principal changes, role/status changes, verified
TOTP factor-set changes, environment AI-policy changes, global revocation and
AI PIN factor enrollment/rotation/revoke/reset. It is bound to `auth.uid()`,
membership, Admin session and intended action; success requires a server-
recorded TOTP AMR timestamp inside the five-minute boundary, atomically
consumes the mutation request and records server time. Initial PIN enrollment
immediately after Google-to-TOTP login uses that already-fresh login event and
does not add another prompt. Once an actor/session/scope-bound request ID
commits, an exact canonical-intent retry returns the committed result after the
window; the same request ID with changed PIN or policy material is rejected. Normal
lecture operations, emergency stop, AI PIN verification/use,
remembered-browser enrollment/assertion, AI-master activation or scope/cost
escalation, and child AI calls never request this five-minute step-up.

Owners cannot reset their own verified TOTP factor set and simultaneously
authorize that control-plane change. Factor reset requires a different owner
with a five-minute step-up, explicit target/effect confirmation and append-only
audit. Because both bootstrap accounts are controlled by one person, they
provide account-path resilience, not independent two-person approval. Their
TOTP factors should be held on separate trusted devices. If both accounts are
locked, documented Supabase operator owner recovery acts outside the public
client with a short expiry, explicit incident reason and audit, and is disabled
once re-enrollment succeeds. Shared `ADMIN_PIN` is removed before Production
and is never an MFA or recovery bypass.

## AI-unlock factor and lecture-wide activation

### Initial implementation

The first implementation requires all of the following before the AI master can
be authorized:

1. Google identity and a tracked Admin session at AAL2 using TOTP;
2. active principal and exact environment membership;
3. `can_use_ai=true` and an owner-managed AI policy with remaining allowance;
4. ownership of an open, non-expired lecture;
5. an enrolled personal four-digit AI PIN, or a valid remembered-browser
   assertion that was created only after that PIN was verified.

The four-digit PIN is an intentional second UI layer for paid AI, distinct from
Admin login. Its low entropy means it never substitutes for Google, AAL2,
membership or ownership. New factor enrollment, rotation, revoke and reset are rare
factor-control changes and require the five-minute boundary above. Login-time
initial enrollment uses the already-fresh TOTP event without another prompt.
Remembered-browser enrollment, PIN verification/use and master activation need
a currently valid AAL2 Admin session but do not trigger fresh TOTP. The personal
AI PIN is verified once for each new lecture master; same-scope child starts
never ask again. A new lecture or an explicit scope/cost escalation requires a
new AI-unlock proof, not another TOTP challenge.

The server stores only a per-factor salted, server-peppered verifier and compares
in constant time. Five failed verifications in a rolling 15-minute window across
the same environment and membership atomically lock AI unlock for at least 15
minutes across every session, factor version and browser. Rotation, reset and
recovery neither clear nor shorten that membership lock; it expires only at
its recorded deadline. Rotation and reset still use the rare five-minute
mutation boundary; the freshness check never clears abuse state. A separate
limit permits at most 30 failed
verifications per 15 minutes for a pepper-hashed coarse-network/environment
bucket. An environment circuit breaker fails closed for at least 60 seconds and
alerts after 300 failed verifications in one minute. Raw IP addresses are never
stored; denials return a generic message and bounded `Retry-After`. Lockout
never blocks free stop, logout or owner emergency controls.

A raw PIN exists only in the trusted form and the bounded TLS request needed for
enrollment or verification. It is cleared immediately after the response and is
excluded from database rows, browser persistence, logs, audit, URLs, analytics
and error traces.

`このブラウザで記憶` is opt-in and defaults OFF, especially on shared classroom
devices. The browser first creates a non-extractable WebCrypto key in IndexedDB.
The server then issues a short-lived, single-use enrollment nonce bound to
`auth.uid()`, environment/membership, tracked Admin session, its verified TOTP
factor-set version, AI-factor version, exact Origin and the proposed public-key
fingerprint. One transaction verifies the PIN, consumes that nonce
and creates the browser credential; an idempotent retry with the same key
converges, while replay, expiry, cross-principal/session/environment/origin or a
different public key fails closed.

The server stores only the public key and an opaque, individually revocable
browser-profile credential with an absolute maximum lifetime of 30 days. Each
use signs a fresh server challenge bound to the exact lecture, requested scope,
session and policy version and still requires a currently valid AAL2 Admin
session. Copying ordinary app storage without the non-extractable key fails, but
this is not claimed as hardware or physical-device binding. Same-origin XSS can
invoke an origin key and full-browser-profile copying is not assumed safe;
strict CSP and dependency controls plus Chrome, Edge and WebKit persistence/
copy tests are Hosted/Human gates. Clearing the profile, membership suspension,
credential revoke or expiry fails closed. No raw PIN is browser-saved.

### Dedicated AI Passkey

A purpose-bound AI Passkey is the preferred later alternative to entering or
remembering the four-digit PIN. It is implemented only after a permanent custom
Admin domain, stable RP ID and production-ready WebAuthn verification gate pass.
Enrollment requires Admin AAL2; each assertion verifies user presence or user
verification and a server challenge bound to environment, principal, lecture
and scope. The AI credential cannot sign in, enroll another factor, modify a
budget or grant owner authority. It is logically separate even if the same
platform authenticator also protects Admin login.

### Master CTA and provider admission

The existing Phase 7.28 `lecture_ai_master_authorizations` remains the canonical
lecture activation. The Admin chooses exactly one:

1. `all_except_captions` — all eligible AI except Realtime captions;
2. `all_including_captions` — the same set plus permission to start captions.

Successful AI unlock activates the selected scope uniformly until the earliest
of lecture close, the server 90-minute hard stop, explicit free stop, or a
security revoke of the Admin session, membership, principal or AI entitlement.
The master CTA itself performs no provider call. Existing scheduled or explicit
feature starts run under that scope without another AI PIN or Passkey prompt,
but every provider start atomically rechecks the live session, membership,
ownership, lecture state, scope, policy version, budget, concurrency and
idempotency before issuing its short-lived single-use `ai_billing_grants` child.
Budget exhaustion blocks child calls with an explanatory status but does not
silently clear the lecture's activated scope. Results arriving after a terminal
transition are discarded.

Summary run start and resume are scheduler controls and therefore consume no
provider child. Each five-minute window that actually reaches the model consumes
its own short-lived child and immutable dispatch claim. Insufficient-source
windows skip without cost, a lost response converges on the same window, and a
stale or revoked request settles without publishing late content. These recovery
paths never require another TOTP or AI PIN while the current Admin session and
master scope remain valid.

Academic-answer source preflight is free and persists only bounded hashes and
source coverage. Manual and Summary-derived automatic answers each issue and
consume one short-lived child only when a provider dispatch is admitted. Exact
replay converges on the same preflight, child, operation and dispatch claim;
session, membership, ownership, policy or master drift settles the already
reserved operation without publishing late content. Normal retries and
continuations require neither another TOTP nor another AI PIN while the current
Admin session and master scope remain valid.

A retry of the same active scope is idempotent and does not prompt again. A
change from `all_except_captions` to `all_including_captions` is a cost/scope
escalation: it requires a new PIN, remembered-browser or future AI-Passkey proof
inside the still-valid AAL2 Admin session and atomically creates a new
authorization version; it does not trigger a fresh TOTP prompt. Downgrading to
`all_except_captions` and explicit stop are free, require no AI-unlock proof and
take effect immediately. Scope escalation never starts Realtime by itself.

Caption-inclusive authorization never starts Realtime automatically. The
dedicated caption CTA, language/duration choice and browser microphone
permission remain mandatory, and no other AI feature may trigger it.

## Unified Edge authorization

A shared server helper verifies, in order:

1. Supabase bearer user;
2. Google provider and verified identity binding;
3. active principal and exact environment membership/capability;
4. tracked, unrevoked Admin session;
5. AAL2 and server-recorded recent-step-up requirement where applicable;
6. lecture ownership and server-time lifecycle;
7. AI policy, unlock/master scope, budget, concurrency and paid-operation
   admission gates.

Every Admin-facing Edge Function and indirect RPC path is migrated in Phase
7.30C and inventoried. This
includes lecture, Poll, comment, PDF, Display, caption, AI, archive, Admin
session and future Presenter controls. `manage-admin-sessions` changes from
global authority to instructor self-only and owner global authority. Lecture
list/create/start/close changes from global to owner-or-owned-lecture rules.
Database transactions recheck principal and ownership to prevent TOCTOU.

Revocation and policy changes use one idempotent server transition matrix:

- Admin-session revocation, backing `auth.sessions` removal or a verified TOTP
  factor-set change drains masters, pending child grants, Display and
  Presenter authority issued by that session. It does not delete a separately
  enrolled browser credential, which remains unusable until a new Google/TOTP
  AAL2 session exists;
- AI-factor rotation, reset or revoke invalidates every browser credential from
  the old AI-factor version and drains masters/pending children issued by that
  factor or proof, while preserving the Admin application session;
- individual browser-credential revoke drains masters/pending children issued by
  that credential, without affecting other enrolled browsers;
- principal, environment or membership invalidation ends the affected Admin
  session and all derived authority. A role change is enforced live without
  ending the session. `can_use_ai=false` preserves the Admin session but drains
  AI factors' usable authority, browser proofs, masters and pending children;
- policy expiry or revoke drains affected masters. A policy scope reduction
  atomically narrows `all_including_captions` to `all_except_captions` and stops
  active captions when the reduced policy permits the lower scope; otherwise it
  revokes the master. Late results are discarded;
- budget exhaustion alone preserves the visible activated scope but makes every
  new child admission fail closed with an explanatory status; and
- lecture close, the 90-minute hard stop or free explicit stop drains the master
  and pending children regardless of factor state.

All transitions use server time and transaction-time membership/policy checks.

## Admin UX

The login surface presents one Google CTA followed by a concise MFA enrollment
or challenge. After entry, the existing lecture workspace remains primary.

An AI-capable Admin enrolls a personal four-digit AI PIN after TOTP AAL2. The
lecture workspace then exposes the existing two master choices and asks for the
four digits only once per lecture unless the user opted into a valid remembered
browser. The UI calls this `AI PIN`, not `BILLING_PIN`; it never shows hashing,
browser-key, budget-ledger or infrastructure details. Passkey appears later as an
alternative `AI Passkeyを使う` action only after its own gate passes.

Owners receive a separate Admin ledger for invitation, environment membership,
role/status, AI entitlement, recent sessions, lecture ownership and bounded
audit. Instructors see only their own membership, sessions, lectures and
allowance. Anonymous student Auth users are not exposed as an Admin "user
roster"; any future student roster requires a separate privacy purpose and
consent review.

Rare control-plane actions show the target and effect, require the five-minute
TOTP step-up, carry an idempotency key and return an auditable result. This is
limited to owner/principal, role/status, verified TOTP-factor-set, environment
AI-policy, global-revoke and AI PIN factor enrollment/rotation/revoke/reset changes.
Immediate post-login PIN enrollment adds no second prompt because the login
TOTP is already fresh. Lecture operation, emergency stop, PIN verification,
browser proof, AI-master activation/escalation and child calls stay on the
continuous session and never surface that control-plane prompt. Technical
OAuth, RLS and token details belong in the runbook, not the lecture control
surface.

## Phase sequence and reasoning level

| Phase | Deliverable                                                                                                                                                                                                                                               | Primary reasoning                                   | Gate                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 7.30A | requirements, threat model, COMPASS asset/IAM inventory and Hosted manual plan                                                                                                                                                                            | **Ultra** plus external IAM review                  | Reuse matrix, credentials/environment separation, account/MFA choices approved                                             |
| 7.30B | additive identity foundation: principal/environment/invitation/session/audit, AI policy/unlock/browser-credential/rate-limit schema, existing master expansion, separate Admin client, PKCE, trusted Google binding, token sanitizer, TOTP/recent step-up | **Ultra** plus RLS/auth review                      | clean/upgrade migration, generated types, pgTAP, student UID isolation, callback/storage/AAL E2E PASS                      |
| 7.30C | RBAC/capability, owning membership, all Edge/RPC authorization, AI unlock/master/child admission, self/owner revoke and last-owner transaction                                                                                                            | **Ultra** plus external security review             | full authorization inventory, ownership/concurrency/cost and lifecycle/AI/PDF/Display/Presenter regression PASS            |
| 7.30D | Google/MFA/AI-unlock/Admin-ledger UX and accessibility                                                                                                                                                                                                    | Extra High with Ultra security/accessibility review | concise login/enrollment/recovery/ledger UX, Chromium/WebKit/mobile/visual/accessibility PASS                              |
| 7.30E | Google-only authorization cutover, explicit legacy ownership claim/backfill, full regression and shared-PIN code/secret retirement                                                                                                                        | **Ultra**                                           | no unmigrated Admin operation, no implicit ownership widening, Google-only immutable rollback PASS                         |
| 7.30F | staging and Hosted/Human Google-only identity migration                                                                                                                                                                                                   | **Ultra** plus independent final review             | two-owner real-account canary, operator recovery and immutable rollback evidence PASS; formal Phase 7.33 Gate remains HOLD |

The F source/local subgate uses only `SOURCE_READY`, `HOLD` and
`READY_FOR_SEPARATE_HOSTED_EXECUTION`. `Production PASS` is prohibited, and a
source-only manifest remains `HOLD`. Staging Hosted mutation, OAuth/provider
configuration, Human identity tests, E cutover, `ADMIN_PIN` deletion,
historical billing retirement, `BILLING_PIN` deletion and limited canary each
require a distinct approval; Production activation remains its own later HOLD.
Schema validity alone is insufficient for `SOURCE_READY`: the exact E
post-merge/base ancestry, every named candidate-SHA source check and a later
independent zero-Critical/High source review must all pass.
The exact evidence checklist and rollback
boundary are recorded in
[`PHASE7_30F_HOSTED_HUMAN_READINESS.md`](PHASE7_30F_HOSTED_HUMAN_READINESS.md).

Phase 7.30B has an enforced internal order: **B1** first establishes the separate
Admin client, Google identity binding, tracked session and mandatory TOTP AAL2;
after that boundary, **B2** adds the default-OFF four-digit AI PIN database
factor, remembered-browser state, AI policy, rate/receipt state,
master-provenance expansion and continuous-session lifetime/invalidation
migration. B2.2a then hardens factor-set trust and rare-control grants; B2.2b
adds the dedicated dormant Edge/browser proof paths and approved factor
transitions. A-D exact-head runtime DB, Local Edge and browser gates pass while
remaining default OFF. Phase 7.30C completes the unified verifier across every
operational Admin Edge/RPC path; E removes the shared application transport and
adds dormant cutover authority. AI Passkey is not part of the initial B2
implementation.

Bounded UI/document work may be combined, but AAL2, global authorization
migration and Production rollout are not combined merely to save turns. An
external reviewer receives only the exact diff, threat model, tests and
redacted evidence, never Production secrets or mutation authority.

## Local and Hosted acceptance

- The source/local gate requires clean and populated upgrade migrations,
  generated DB types, full pgTAP, local DB lint and Phase 0-7.29 regression to
  pass without contacting or mutating Hosted services.
- After the reviewed migration is separately authorized and placed in an
  isolated Hosted environment, the Supabase Security and Performance Advisors
  must be recorded with no new unresolved finding. Local DB lint is not
  represented as Hosted Advisor evidence, and the Advisor requirement does not
  authorize a Hosted migration by itself.
- Unauthorized Google users and AAL1 Admins receive no privileged data.
- Two owners remain separate principals; instructor cross-principal and
  cross-lecture access is denied.
- Self/global session revoke, suspension race, last-owner protection, 90-minute
  close and archive access converge safely.
- Owner and instructor master activation succeeds only with AAL2,
  `can_use_ai`, own open lecture, live policy and enrolled AI PIN or valid
  remembered-browser proof. AAL1, missing factor, suspended membership,
  cross-lecture use, locked PIN and exhausted allowance fail closed.
- Four-digit enrollment or verification permits the raw PIN only in the trusted
  form and its bounded TLS body, clears it after the response and proves that it
  never appears in browser/server persistence, URL, log, audit, analytics or
  error trace.
- Remembered-browser enrollment atomically consumes a short-lived single-use
  nonce bound to identity, environment, membership, Admin session, verified
  TOTP factor-set version, AI-factor version, Origin and public-key fingerprint.
  Retry, replay, expiry, cross-principal/session/origin/environment, key
  substitution and multi-tab races converge safely.
- Membership-wide 5/15-minute lockout, coarse-network 30/15-minute limit and
  environment 300/minute circuit breaker are race-tested across sessions and
  factor rotation. Raw network addresses are not retained.
- Same-origin XSS/CSP and supply-chain review, ordinary-storage copy,
  full-profile copy, clear/reload and Chrome/Edge/WebKit credential persistence
  are separate Hosted/Human gates. No hardware/device-binding claim is made
  before WebAuthn.
- Both master scopes, idempotent same-scope retry, free downgrade/stop and
  new-AI-proof caption-scope escalation pass without a fresh TOTP prompt.
  Lecture-close/90-minute, session, factor, browser-credential, membership,
  entitlement and policy transition/drain matrices converge and late results
  are discarded. Master activation creates no provider call and inclusive scope
  never auto-starts captions.
- Every child start rechecks budget, concurrency, policy, idempotency and
  lifecycle without another PIN or TOTP prompt. Legacy direct-`BILLING_PIN`
  clients and the compatibility RPC are removed after personal-AI-PIN E2E and
  before Production.
- Session continuity tests prove no 30-minute idle expiry or periodic TOTP
  challenge. Logout, backing `auth.sessions` removal, principal/environment/
  membership invalidation, verified TOTP factor-set change and the eight-hour
  cap end the session; role and AI-PIN changes do not. `can_use_ai=false`
  drains AI authority while preserving the Admin workspace session.
- PDF, Display, student snapshot and Phase 7.29 OFF behavior remain unchanged.
- Teacher and reviewer surfaces use the existing `講義資料` wording and never
  expose R2 bucket, binding, credential, namespace or secret terminology.
- Chromium, WebKit, mobile, accessibility and visual regression pass.
- Staging uses separate Supabase, OAuth client and Cloudflare preview origin;
  Codex Cloud receives no Production secret.
- Real-account Google/TOTP enrollment, recovery and revocation are human gates.
- Provider-token storage sanitizer, authoritative Google identity binding,
  invitation replay, environment mixing and recent-step-up nonce negative tests
  pass.

## Rollout and rollback

Rollout is additive and default OFF:

1. deploy DB expansion and confirm Google enforcement OFF;
2. deploy the Google verifier and operational authorization adapter with Google
   admission OFF; current shared-PIN code remains a development compatibility
   source only at this point;
3. deploy frontend Google UI OFF;
4. configure separate OAuth clients/callbacks and Supabase provider manually;
5. create-only bootstrap the two owner principals;
6. prove AAL1 denial and AAL2 success in staging;
7. explicitly claim legacy lecture ownership from approved evidence without
   inference, then use the advisory database preflight to reach zero
   unowned draft/open lectures, zero active legacy sessions and a disabled
   legacy login issuer. The preflight snapshot never authorizes cutover: after
   tombstoning legacy writers, Phase E must repeat and lock these checks in the
   same transaction that commits the fence. Close or cancel any unresolved
   active lecture before enabling the Google-only Phase 7.30C path for one owner canary, then both
   owners and instructors, and remove the `ADMIN_PIN` issuer, UI, flags and
   secret. Revoked historical rows may remain only where FK/audit integrity
   requires; and
8. after personal-AI-PIN E2E, remove `BILLING_PIN`, its compatibility RPC, UI,
   flag and secret configuration before Production.

This is a limited identity-migration release, not the integrated public/contest
or commercial release. It may be performed only under a separately authorized
default-OFF/controlled canary with an immutable rollback revision. Phase 7.33
remains the next formal integrated Production Gate.

Rollback never restores a shared identity or paid PIN. It restores a reviewed,
immutable Google-only Edge/Pages revision, keeps the additive schema/audit and
uses documented Supabase operator owner recovery if no owner can authenticate.
New paid AI starts remain disabled until Google identity, AAL2, membership and
policy are re-proven; free stop remains available. No emergency down migration,
principal deletion, `ADMIN_PIN` issuer or `BILLING_PIN` RPC is reintroduced.
The personal four-digit `AI PIN` remains a low-entropy lecture-intent factor and
never signs in an Admin or grants owner authority.

## Approved implementation decisions

- Production v1 requires the standard Supabase Authenticator App TOTP AAL2 flow,
  compatible with Google Authenticator. COMPASS configures no email MFA or
  custom MFA. Passkey remains a later option until its dedicated security phase.
- A permanent custom Admin domain is selected before any Passkey/RP-ID
  enrollment.
- Production and staging/local use separate Interactive OAuth clients and
  provider secrets after the read-only Cloud Console inventory. Secret values
  remain user-controlled.
- The two bootstrap accounts remain distinct owner principals. AI eligibility
  is separate. Initial normal AI activation requires TOTP AAL2 plus an enrolled
  personal four-digit AI PIN (or its revocable remembered-browser proof); a
  dedicated AI Passkey is a later alternative. The AI PIN is confirmed once per
  new lecture master or explicit scope/cost escalation, not per call, and its
  rotation/revocation preserves the Admin session. `BILLING_PIN` and its
  compatibility RPC are removed after personal-AI-PIN E2E and before Production.
- The Admin session has no idle timeout or periodic TOTP prompt. Its absolute
  cap is `auth.sessions.created_at + 8 hours`; only logout, backing Auth-session
  removal, principal/environment/membership invalidation, verified TOTP
  factor-set change or that cap requires a new login. Five-minute TOTP step-up
  is limited to rare control-plane owner/principal, role/status, TOTP-factor,
  environment AI-policy, global-revoke and AI PIN factor enrollment/rotation/
  revoke/reset changes. Login-time initial enrollment uses the already-fresh TOTP and
  adds no second prompt; ordinary PIN verification and lecture AI operations do
  not require freshness.
- `ADMIN_PIN` is removed after the Phase 7.30C authorization migration and
  before Production. Rollback is Google-only immutable revision plus operator
  owner recovery, never a shared PIN.
- Student anonymous Auth and the Admin Supabase client remain physically and
  logically separated.
- GitHub Education is active and main ruleset `20600565` enforces Pull Requests,
  five required CI contexts, conversation resolution and force-push/deletion
  denial. Required approving reviews remain zero for solo-owner continuity;
  manual Copilot review is advisory. Remaining Phase 7.31A supply-chain and
  protected-environment work is still separate.
- Contest reviewers reuse the normal `instructor + can_use_ai` authorization
  path in a separate real environment. No `judge` role, shared Google account,
  secret viewer, mock authorization path, or Production-data access is added.
- Google provider tokens are stripped from browser persistence, and stable
  identity is bound once from the trusted Supabase Auth identity record rather
  than `user_metadata`, request input or later email comparison.

Official implementation references must be refreshed at execution time:
[Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase MFA/AAL](https://supabase.com/docs/guides/auth/auth-mfa),
[Supabase TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), and
[Supabase Passkeys](https://supabase.com/docs/guides/auth/passkeys).
