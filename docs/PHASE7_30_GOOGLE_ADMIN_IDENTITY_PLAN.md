# Phase 7.30 Google Admin Identity, AAL2 and RBAC Plan

Status: Planned
Approval: requirements approved; implementation not started
Scope: Google sign-in, mandatory step-up authentication, multi-Admin authorization and audit
Last verified: 2026-08-09

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

The legacy `BILLING_PIN` becomes a default-OFF, owner-only, audited rollback
path during the expand-first migration. It is not a normal Google-mode factor,
is never browser-persisted, cannot authorize a reviewer, and is removed with its
compatibility RPC after the fixed rollback deadline.

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
- Migrations are expand-first and legacy PIN login stays available behind a
  default-ON rollback flag until the hosted Google path has passed its canary.

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
| Change role, AI entitlement or policy              |                          yes, recent AAL2 and audit |                                                  no |

Account suspension and emergency lecture stop are separate, explicit and
idempotent actions. Suspension drains the target's Admin sessions and
unconsumed authority; it does not silently close lectures unless an owner also
chooses the emergency-stop action.

## Database expansion

Phase 7.30B adds, behind default-OFF enforcement:

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
- `private.admin_ai_unlock_factors`: principal/membership/environment, factor
  kind, slow PIN verifier plus server-pepper version or WebAuthn public
  credential/counter, status, factor version, enrollment, rotation and
  revocation. It stores no raw PIN or private key;
- `private.admin_ai_unlock_rate_limits`: atomic rolling counters keyed primarily
  by environment and membership, plus separate pepper-hashed coarse-network and
  environment circuit-breaker buckets. They are independent of factor version,
  session and browser credential so rotation cannot clear a lockout. Raw IP
  addresses are not retained;
- `private.admin_ai_browser_credentials`: principal/membership/environment,
  source factor/version, browser-generated public key, opaque credential digest,
  exact Origin, public-key fingerprint, absolute expiry, last-use and
  revocation. It stores no raw PIN or private key and is individually revocable;
- `private.admin_ai_browser_enrollment_nonces`: short-lived single-use digest,
  principal/membership/environment, tracked Admin session, server-recorded AAL2
  step-up event, factor version, exact Origin, proposed public-key fingerprint,
  expiry, idempotency key and terminal status;
- nullable principal, membership, issuing-session, unlock method and AI-policy
  version references on the existing `public.lecture_ai_master_authorizations`.
  Existing `ai_billing_grants` remain internal, short-lived, single-use child
  admissions and do not become reviewer delegation tokens;
- nullable `principal_id`, `membership_id`, authentication method, AAL and
  server-recorded `step_up_verified_at` on `admin_sessions`;
- nullable owning-membership references on lectures and relevant audit/binding
  records while legacy rows remain readable through an owner-only assignment
  path.

An `admin_environments` row is defense in depth inside one deployment. It does
not authorize Production, staging or contest to share a Supabase project. Each
real environment has a separate project and authoritative host/audience mapping;
principal, membership, invitation, session, AI policy, unlock factor, browser
credential and master-authorization records never cross project boundaries.

New lectures require an owning Admin membership after the dual-read
compatibility period. That membership may have role `owner` or `instructor` and
must belong to the exact environment; it does not mean the `owner` role is
required to create a lecture. Tables use RLS, revoke browser grants and expose
only minimum service-role operations. Public control RPCs remain
`SECURITY INVOKER` and service-role-only. Any unavoidable private
`SECURITY DEFINER` helper uses an empty fixed `search_path`, explicit
principal/membership/session/AAL2 checks and minimum grants. Every
parent/expiry/ownership query receives an Advisor-verified index.

Audit UPDATE and DELETE are rejected. Metadata never contains raw email OTP,
TOTP secret, passkey material, OAuth/provider token, session token, PIN,
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
- a repository interface that can dual-read legacy PIN and Google sessions
  during migration.

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

Production v1 uses Google sign-in plus Supabase TOTP as the mandatory AAL2
path. All Admin Edge helpers and database authorization helpers verify AAL2;
checking it only in React is insufficient.

- Authenticator app/TOTP: required v1 option and server-recognized AAL2.
- Passkey: later opt-in only after an owner-controlled custom domain and stable
  RP ID are fixed and the chosen provider contract is production-ready. The
  current Supabase feature is Beta/passwordless and is not treated as this
  phase's AAL2 second factor.
- Email OTP: recovery notification by default. Treating it as a second factor
  requires a separate, atomically single-use, rate-limited, replay-protected
  step-up ledger and is not equivalent to TOTP when the same Google mailbox is
  compromised.

JWT `aal2` proves factor assurance but does not by itself prove a recent
challenge. For login and dangerous actions, the server first issues a
single-use, short-lived step-up nonce bound to `auth.uid()`, membership, Admin
session and intended action. After TOTP verification it accepts only a newly
minted AAL2 JWT whose server-validated `iat` is not older than the challenge,
atomically consumes the nonce, and records server time in
`admin_sessions.step_up_verified_at`. Client time and an old AAL2 JWT never
satisfy recency.

The successful TOTP challenge performed during Google login is the initial
server-recorded step-up event. While that event remains inside the applicable
server-side freshness window, master activation does not ask for TOTP again. If
it is stale, only then does the intended action trigger a new nonce and TOTP
challenge. This preserves one-click lecture activation after a normal fresh
login without treating the four-digit AI PIN as MFA.

Owners cannot reset their own factor and simultaneously authorize the reset.
Factor reset requires a different recently stepped-up owner, explicit
target/effect confirmation and append-only audit. Because both bootstrap
accounts are controlled by one person, they provide account-path resilience,
not independent two-person approval. Their TOTP factors should be held on
separate trusted devices. If both accounts are locked, a documented Supabase
operator break-glass uses provider-supported factor recovery outside the public
client, a short expiry, explicit incident reason and audit; it is disabled once
re-enrollment succeeds. The legacy shared `ADMIN_PIN` login path has a fixed
retirement deadline and is not a permanent MFA bypass.

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
membership or ownership. Enrollment, rotation, reset, remembered-browser
enrollment, first master issue and caption-scope escalation require a
server-recorded recent TOTP step-up. A Google-to-TOTP login inside the configured
freshness window satisfies that requirement without another prompt. The window
is server-side, never client-time-derived, and cannot exceed the tracked Admin
session's eight-hour absolute lifetime. Factor recovery and owner policy or
entitlement changes use a shorter dangerous-action window.

The server stores only a per-factor salted, server-peppered verifier and compares
in constant time. Five failed verifications in a rolling 15-minute window across
the same environment and membership atomically lock AI unlock for at least 15
minutes across every session, factor version and browser. Rotation or reset does
not clear that membership lock without an explicit recent-AAL2 recovery event
and audit. A separate limit permits at most 30 failed verifications per 15
minutes for a pepper-hashed coarse-network/environment bucket. An environment
circuit breaker fails closed for at least 60 seconds and alerts after 300 failed
verifications in one minute. Raw IP addresses are never stored; denials return a
generic message and bounded `Retry-After`. Lockout never blocks free stop,
logout or owner emergency controls.

A raw PIN exists only in the trusted form and the bounded TLS request needed for
enrollment or verification. It is cleared immediately after the response and is
excluded from database rows, browser persistence, logs, audit, URLs, analytics
and error traces.

`このブラウザで記憶` is opt-in and defaults OFF, especially on shared classroom
devices. The browser first creates a non-extractable WebCrypto key in IndexedDB.
The server then issues a short-lived, single-use enrollment nonce bound to
`auth.uid()`, environment/membership, tracked Admin session, the exact
server-recorded TOTP step-up event, factor version, exact Origin and the proposed
public-key fingerprint. One transaction verifies the PIN, consumes that nonce
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

A retry of the same active scope is idempotent and does not prompt again. A
change from `all_except_captions` to `all_including_captions` is a cost/scope
escalation: it requires a new PIN, remembered-browser or future AI-Passkey proof
plus a server-recorded TOTP step-up still inside the master freshness window,
and atomically creates a new authorization version. Downgrading to
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

- Admin-session revocation drains masters, pending child grants, Display and
  Presenter authority issued by that session. It does not delete a separately
  enrolled browser credential, which remains unusable until a new Google/TOTP
  AAL2 session exists;
- AI-factor rotation, reset or revoke invalidates every browser credential from
  the old factor version and drains masters/pending children issued by that
  factor or proof;
- individual browser-credential revoke drains masters/pending children issued by
  that credential, without affecting other enrolled browsers;
- principal or membership suspension, `can_use_ai=false` or owner emergency
  revoke invalidates factors and browser credentials and drains all affected
  masters/pending children;
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

Dangerous actions show the target and effect, require recent AAL2, carry an
idempotency key and return an auditable result. Technical OAuth, RLS and token
details belong in the runbook, not the lecture control surface.

## Phase sequence and reasoning level

| Phase | Deliverable                                                                                                                                                                                                                                               | Primary reasoning                                   | Gate                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 7.30A | requirements, threat model, COMPASS asset/IAM inventory and Hosted manual plan                                                                                                                                                                            | **Ultra** plus external IAM review                  | Reuse matrix, credentials/environment separation, account/MFA choices approved                                  |
| 7.30B | additive identity foundation: principal/environment/invitation/session/audit, AI policy/unlock/browser-credential/rate-limit schema, existing master expansion, separate Admin client, PKCE, trusted Google binding, token sanitizer, TOTP/recent step-up | **Ultra** plus RLS/auth review                      | clean/upgrade migration, generated types, pgTAP, student UID isolation, callback/storage/AAL E2E PASS           |
| 7.30C | RBAC/capability, owning membership, all Edge/RPC authorization, AI unlock/master/child admission, self/owner revoke and last-owner transaction                                                                                                            | **Ultra** plus external security review             | full authorization inventory, ownership/concurrency/cost and lifecycle/AI/PDF/Display/Presenter regression PASS |
| 7.30D | Google/MFA/AI-unlock/Admin-ledger UX and accessibility                                                                                                                                                                                                    | Extra High with Ultra security/accessibility review | concise login/enrollment/recovery/ledger UX, Chromium/WebKit/mobile/visual/accessibility PASS                   |
| 7.30E | dual-read compatibility, legacy backfill, full regression and time-bounded PIN-login retirement                                                                                                                                                           | **Ultra**                                           | old/new client parity, recovery deadline, rollback and no privilege expansion PASS                              |
| 7.30F | staging, Hosted/Human identity migration and legacy PIN retirement                                                                                                                                                                                        | **Ultra** plus independent final review             | two-owner real-account canary, rollback and human recovery evidence PASS; formal Phase 7.33 Gate remains HOLD   |

Phase 7.30B has an enforced internal order: **B1** first establishes the separate
Admin client, Google identity binding, tracked session and mandatory TOTP AAL2;
only after the AAL2 negative/positive gate passes may **B2** add the four-digit
AI PIN, remembered-browser credential, AI policy and master-authorization
expansion. AI Passkey is not part of the initial B2 implementation.

Bounded UI/document work may be combined, but AAL2, global authorization
migration and Production rollout are not combined merely to save turns. An
external reviewer receives only the exact diff, threat model, tests and
redacted evidence, never Production secrets or mutation authority.

## Local and Hosted acceptance

- Clean and populated upgrade migrations, generated DB types, full pgTAP,
  lint, Advisor and Phase 0-7.29 regression pass.
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
  nonce bound to identity, environment, membership, Admin session, exact TOTP
  step-up event, factor version, Origin and public-key fingerprint. Retry,
  replay, expiry, cross-principal/session/origin/environment, key substitution
  and multi-tab races converge safely.
- Membership-wide 5/15-minute lockout, coarse-network 30/15-minute limit and
  environment 300/minute circuit breaker are race-tested across sessions and
  factor rotation. Raw network addresses are not retained.
- Same-origin XSS/CSP and supply-chain review, ordinary-storage copy,
  full-profile copy, clear/reload and Chrome/Edge/WebKit credential persistence
  are separate Hosted/Human gates. No hardware/device-binding claim is made
  before WebAuthn.
- Both master scopes, idempotent same-scope retry, free downgrade/stop and
  proof-plus-recent-AAL2 caption-scope escalation pass. Lecture-close/90-minute,
  session, factor, browser-credential, membership, entitlement and policy
  transition/drain matrices converge and late results are discarded. Master
  activation creates no provider call and inclusive scope never auto-starts
  captions.
- Every child start rechecks budget, concurrency, policy, idempotency and
  lifecycle without another PIN prompt. Legacy direct-`BILLING_PIN` clients are
  rejected in Google mode; the separately flagged owner rollback is tested and
  retired on schedule.
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
2. deploy Edge dual-read with Google admission OFF;
3. deploy frontend Google UI OFF;
4. configure separate OAuth clients/callbacks and Supabase provider manually;
5. create-only bootstrap the two owner principals;
6. prove AAL1 denial and AAL2 success in staging;
7. enable one owner canary, then both owners, then instructors;
8. disable legacy shared-PIN login only after recovery evidence passes.

This is a limited identity-migration release, not the integrated public/contest
or commercial release. It may be performed only under a separately authorized
default-OFF/controlled canary with an immutable rollback revision. Phase 7.33
remains the next formal integrated Production Gate.

Rollback keeps three non-interchangeable controls explicit:

- `ADMIN_PIN` is the legacy shared Admin-login path and exists only behind its
  time-bounded login-compatibility flag or a full immutable-revision incident
  rollback;
- `BILLING_PIN` is the legacy paid-cost path. Its separate default-OFF rollback
  flag may be used only by a verified Google owner at AAL2 and never substitutes
  for the personal four-digit AI PIN; and
- the personal four-digit `AI PIN` is the normal low-entropy intent factor and
  never signs in an Admin or grants owner authority.

If an incident requires restoring a revision that has only shared `ADMIN_PIN`
identity, new paid AI starts remain server-disabled because owner identity and
AAL2 cannot be proven; free stop remains available. Rollback restores prior
immutable Edge/Pages revisions and keeps the additive schema/audit. No emergency
down migration or principal deletion is performed.

## Approved implementation decisions

- Production v1 requires TOTP AAL2. Email remains recovery notification and
  Passkey remains a later option until its dedicated security phase.
- A permanent custom Admin domain is selected before any Passkey/RP-ID
  enrollment.
- Production and staging/local use separate Interactive OAuth clients and
  provider secrets after the read-only Cloud Console inventory. Secret values
  remain user-controlled.
- The two bootstrap accounts remain distinct owner principals. AI eligibility
  is separate. Initial normal AI activation requires TOTP AAL2 plus an enrolled
  personal four-digit AI PIN (or its revocable remembered-browser proof); a
  dedicated AI Passkey is a later alternative. `BILLING_PIN` is owner-only
  rollback state and is removed after the compatibility deadline.
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
