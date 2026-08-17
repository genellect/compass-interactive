# COMPASS Interactive Security Contract

Last reviewed: 2026-08-12
Status: source-implemented controls through the Phase 7.30F source/local
readiness candidate; Hosted, Human and Production evidence remains separate

## 1. Security objectives

COMPASS must prevent:

- one participant acting as or reading another participant;
- a user crossing lecture boundaries by changing an ID;
- writes, Poll answers or paid starts after lecture close/expiry;
- Admin access through a client-only role check;
- paid API work without separate explicit authorization;
- exposure of API keys, service-role keys, PINs or delivery credentials;
- public access to private PDF or archive objects;
- duplicate provider work caused by retry, timeout or race;
- Demo behavior contacting hosted systems;
- a low-value or unapproved AI result being presented as teacher-approved.

## 2. Identity and participant ownership

- Student browsers use Supabase Anonymous Auth.
- The Admin Google identity client is separate from the Student singleton,
  callback handler and storage key. Student session helpers accept only users
  whose trusted Auth record is anonymous.
- Anonymous users still use the PostgreSQL `authenticated` role, so every
  student operation also verifies `(select auth.uid())` ownership.
- A participant belongs to exactly one lecture and Auth user.
- A browser-supplied participant ID, lecture ID or nickname is untrusted input.
- Participant rows and raw Poll responses are not generally listable.
- RLS, constraints and RPC validation provide overlapping enforcement.
- Turnstile protects anonymous account/join entry but does not replace RLS.

## 3. Database and RPC policy

- Enable RLS on every application table in an exposed schema.
- Grant only the table operations required by the intended client path.
- `TO authenticated` without an ownership predicate is prohibited.
- UPDATE requires a compatible SELECT policy, `USING` and `WITH CHECK`.
- Prefer `SECURITY INVOKER` for exposed RPCs.
- A required `SECURITY DEFINER` helper belongs in a non-exposed schema, has a
  fixed empty/minimal `search_path`, performs explicit caller or machine
  verification and receives minimum EXECUTE grants.
- Revoke default `PUBLIC` function execution where application functions are
  involved.
- Views exposed to clients must use invoker security or remain inaccessible.
- No public application table is intentionally published to Supabase Realtime.

Every database Phase must include two-user, two-lecture, wrong-owner and closed
lecture tests plus clean/upgrade migration verification.

## 4. Lecture lifecycle defense

- PostgreSQL server time is authoritative.
- Start sets a maximum 90-minute deadline.
- Manual and automatic close use one idempotent core transition.
- Write RPCs, Poll response RPCs and AI admission reject expiry independently of
  scheduled cleanup.
- Clients cancel polling and pending work when terminal state is observed, but
  client cancellation is not the security control.
- Closed lectures are never reopened in place.
- Archive access is read-only and has its own expiry.

## 5. Admin and paid-operation separation

In the current legacy source, the Admin PIN and API-use PIN are separate
credentials with different purposes.

- Admin PIN: creates a bounded teacher management session.
- API-use PIN: grants a bounded, one-time paid-operation start authorization.
- Stopping a paid feature does not require the API-use PIN.
- A valid Admin session alone cannot bypass lecture state, budget, concurrency
  or idempotency checks.
- Admin/paid errors use generic messages and must not disclose credential state.

Phase 6.8 application-level Admin PIN defense stores only the SHA-256 hash of
each signed Admin token, binds the
session to the authenticated user and PIN-version fingerprint, supports
individual/logout revocation, and enforces eight-hour absolute and 30-minute
inactivity expiry. A PIN rotation invalidates every prior session. PIN checks
consume keyed user, trusted-network-when-available and coarse global buckets;
raw PINs and IP addresses are not stored.

Phase 7.30A-B1 adds a separately flagged Google identity path without granting
it legacy Admin operations. Edge validates the bearer through Supabase Auth and
uses only the trusted linked Google identity; request metadata does not create
authority. Provider tokens are stripped before the Auth SDK can persist or
broadcast them. The application principal table stores the stable Google
subject only as a versioned, server-peppered HMAC binding; Supabase Auth remains
the trusted provider-identity store. A five-minute nonce binds the exact
identity, environment, membership, Auth session, intended action and
pre-challenge JWT.
Completion requires a fresh TOTP AMR at AAL2 and creates only a digest-stored
application session with an eight-hour absolute and 30-minute idle limit.
Database constraints and distinct token scopes prevent `legacy_pin`/AAL1 and
`google_totp`/AAL2 sessions from being interpreted interchangeably. Database
and Edge authorization gates default OFF; the separate frontend UI flag also
defaults OFF, while legacy compatibility defaults ON.

That idle limit and shared-PIN compatibility are historical B1 source facts,
not the current B2 session contract. Phase 7.30B2 now implements the default-OFF
continuous-session lifetime/invalidation migration: it anchors the application
session cap to `auth.sessions.created_at + 8 hours`, removes the idle expiry and
never prompts for TOTP periodically during a lecture. Phase 7.30C completes its
unified verifier across every operational Admin Edge/RPC path. The B2 database
path rejects explicit logout, backing `auth.sessions` removal, principal/
environment/membership invalidation or the eight-hour cap. B2.2a stores an
approved factor-set hash/version/count on the Admin principal and binds newly
issued Google Admin sessions only when principal approval, live verified TOTP
state, completed JWT/AMR nonce evidence and the default-OFF issue gate agree.
Changed-set sessions are reason-revoked and their pending AI authority drains.
An unverified login candidate is accepted only for a `pending_mfa`, unbound,
empty set's first 0-to-1 enrollment and is approved atomically after fresh
completion. Existing verified but unbound sets require an Edge-unwired,
default-OFF operator adoption while Google issuance is OFF; migration never
infers that approval. Adding or removing a factor beside an approved set now
uses the default-OFF B2.2b fresh-existing-set rare-control transition. It binds
the exact pre-set, target, expected post-set and canonical intent before the
Supabase Auth change, then advances the principal anchor and drains old
authority atomically. Its recovery credential is hash-only, Auth-user/session
bound and valid for at most 30 minutes within the eight-hour cap.
Phase 7.30C applies that verifier to every operational Admin Edge/RPC path. Role
changes are enforced live without session termination. For instructors,
`can_use_ai=false` drains AI authority while preserving the Admin session.
Every non-revoked Owner retains the complete capability set; paid/provider
admission remains a separate default-OFF runtime gate. Membership, invitation
and Admin-session controls live on the authenticated `/admin/settings` surface,
separate from lecture operation, and no Admin credential is placed in its URL.

Production v1 uses only Supabase Authenticator App TOTP (compatible with Google
Authenticator) for MFA. No email MFA or custom MFA path is added. A five-minute
fresh TOTP step-up is reserved for owner/principal, role/status, verified
TOTP-factor-set, environment AI-policy, global-revoke and AI PIN factor
enrollment/rotation/revoke/reset control-plane changes. Initial PIN enrollment
immediately after login uses the already-fresh login TOTP and adds no prompt.
Normal lecture operation, emergency stop, personal-AI-PIN verification/use,
remembered-browser proof, lecture-master activation or scope/cost escalation
and child AI calls never prompt for it.

The personal AI PIN is checked once per new lecture master or explicit
scope/cost escalation and never per child call. Its rotation/revocation drains
AI master, browser and pending-child authority but preserves the Admin session.
After the Phase 7.30C migration, `ADMIN_PIN` is removed before Production; after
personal-AI-PIN E2E, `BILLING_PIN` and its compatibility RPC are removed before
Production. Revoked historical session rows may remain for FK/audit integrity.
Rollback uses an immutable Google-only revision and operator owner recovery,
never a shared PIN.

## 6. AI and provider safety

- The OpenAI key is a Supabase Edge secret and is never returned to the browser.
- Realtime transcription has a dedicated explicit start and selected duration.
- Other AI operations cannot start Realtime transcription.
- Realtime and Batch use separate concurrency lanes.
- Every start checks feature flag, lecture state, one-time authorization, budget,
  call ceiling and available lane.
- Usage is reserved before the call and finalized after success/failure.
- Provider call IDs and hangup work are idempotent.
- Late Batch results are discarded if the lecture or operation is no longer
  publishable.
- AI Poll proposals and summaries require the existing quality/publication
  rules; proposals are not automatically converted to live Polls.

Phase 6.8 adds explicit client, Edge and provider deadlines. A provider create
request receives a durable client request ID before transmission. A timeout at
the provider boundary is recorded as an uncertain outcome, conservatively
accounted and not automatically replayed. Phase 7.2 must validate literature
identifiers independently of model output.

Phase 7.1 language selection is not a paid start and never exposes an API key.
The selected value is snapshotted per future summary window; deterministic
language resolution is recorded before the existing single provider attempt.
The `mine` history RPC accepts no participant ID, derives ownership from
`auth.uid()` and returns no participant identifier. QR content is restricted to
the same-origin six-digit join URL and contains no capability token.

Phase 7.2 keeps medical literature hosts fixed to NCBI and exact DOI Crossref records,
bounds time/body/source counts and rejects redirects or metadata disagreement.
The model receives untrusted question/evidence as serialized data, has no tool,
cannot create identifiers and returns a strict claim-to-source schema. At least
one verified primary source is required; reviews/editorials are context-only
and retracted records are excluded. Drafts remain service-role-only until a
teacher publishes them. Provider dispatch, cancellation, exact settlement,
late discard and stale-operation reaping are separate audited transitions.

Phase 7.25 routes non-medical questions through fixed Crossref/OpenAlex hosts,
requires corroborated DOI and primary-study signals, and suppresses low-value or
unsupported automatic candidates. Prompt content remains serialized untrusted
data. An automatically visible answer is explicitly teacher-unconfirmed and can
be approved, hidden or corrected without mutating its immutable source revision.

## 7. Browser-safe and server-only configuration

### Browser-safe

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `VITE_PDF_PUBLISHER_URL` only in the approved Local recovery mode
- `VITE_PDF_WORKER_BASE_URL`
- explicit frontend feature flags

These values are visible to every user and must not be treated as secrets.

### Never browser-exposed

- Supabase service-role/secret key and database credentials;
- OpenAI API key;
- current legacy Admin/API-use PIN material (removed by the Phase 7.30
  Production contract) and session-signing material;
- Turnstile secret;
- R2 access/secret keys;
- Publisher signing/private key material;
- archive ingest, retention and scheduler secrets;
- email-provider credentials.

CI and production checks must scan both source and built assets for forbidden
secret-bearing variable names/patterns without printing secret values.

## 8. PDF, Publisher and R2

- Browser publication is default OFF. Edge validates a tracked Admin session and
  creates a server-time DB job/nonce before signing a short-lived ticket.
- The asset Worker independently verifies exact Origin/path, ticket binding,
  actual byte count, PDF magic, native SHA-256, expiry, nonce and immutable key;
  browser validation is only an early UX check.
- Upload, hidden commit and activation are separate fenced transitions.
  Uncommitted objects are absent from student-readable manifests.
- Terminal cleanup uses permanent immutable ledger/object sentinels, bounded
  `O(limit)` scans and object-key-unique v2 intents so delayed requests cannot
  resurrect bytes or overwrite another cleanup record.
- The R2 bucket is private. Student delivery still requires a short-lived scoped
  ticket and validated range request.
- PDF validation enforces type, byte, page and text limits; image OCR and Worker
  page parsing are not performed.
- PDF bytes, R2 credentials and extracted text do not enter Supabase or browser
  persistence. PDF addition does not redeploy Pages.
- Local Publisher binds to loopback and remains recovery-only. Browser mode hides
  its controls and rejects registration; hosted activation must also stop the
  process and revoke/isolate its R2 write credential. The two writers must never
  run concurrently.

## 9. Archive access

- Archive payloads are sanitized and recursively reject private-field names.
- Plain lecture codes are not used as object keys.
- Unknown-code lookups are protected by Turnstile and rate limiting.
- Archive access tokens and PDF tickets are distinct and short-lived.
- Expired archives fail closed even if physical cleanup is delayed.
- The current archive code/session path is not equivalent to a high-entropy
  login credential.

When its default-OFF flags are enabled, Phase 6.8 issues a lecture-scoped,
seven-day high-entropy resume token only after an owned successful join. The
browser keeps a bounded set in local storage, prefers a valid token on archive
re-entry and falls back to code plus Turnstile. Tokens never enter URLs or
responses after exchange; expiry, cross-lecture mismatch and lecture version
revocation fail closed.

## 10. HTTP and browser hardening

Phase 6.8 adds two CSP layers to the static Pages headers:

1. report-only with a narrow allowlist for application, Supabase, Worker,
   Turnstile and necessary loopback Publisher communication;
2. an enforced minimal allowlist compatible with the current core flows.

CSP reports must remove query strings/fragments and must not become a token
leak. Clickjacking, MIME sniffing, referrer and permissions policies remain part
of the header regression.

## 11. CI and supply chain

Current CI uses locked npm installation and no production credentials. It runs
quality, non-live tests, disposable local Supabase and Chromium browser E2E.

Phase 6.9 added and CI enforces:

- immutable GitHub Action SHA pins;
- minimum workflow permissions;
- dependency review, CodeQL and secret scanning;
- vulnerability policy and SBOM;
- deterministic generated Supabase types;
- WebKit, automated accessibility and visual regression.

No pull-request workflow may receive a production secret or perform a deploy.

## 12. Logging and audit

Audit records may contain operation IDs, actor class, lecture ID, result,
server timestamp and bounded usage/cost. Logs and email must not contain:

- PINs or tokens;
- authorization headers;
- raw comments/transcripts/PDF text unless a narrowly scoped local debug process
  is explicitly approved;
- full IP addresses when a keyed/rotating rate-limit hash is sufficient;
- API keys or environment-file contents.

## 13. Stop conditions

Disable the affected feature and stop rollout immediately for:

- any ownership or lecture-boundary breach;
- unauthorized Admin or paid action;
- secret exposure;
- public R2 object access;
- write or AI start after close;
- duplicate paid provider operation;
- unapproved AI publication;
- unexpected student Realtime subscription;
- migration or rollback that threatens data integrity.

Record the evidence, preserve audit rows, rotate affected credentials and repair
forward. A destructive cleanup is not an acceptable first response.

## 14. Phase 6.8 security acceptance summary

The Phase 6.8 local gate covers application-level PIN limiting, tracked Admin
session revocation, CSP header contracts, resume-token expiry/version/
cross-lecture rejection, bounded Edge input and explicit communication/provider
deadlines. Hosted CSP route inspection and a human Admin/Join/Archive UX review
remain blocking production evidence under `docs/ROADMAP.md`.

## 15. Phase 7.28 Display and AI authorization controls

- Display Realtime requires a valid signed Display token, a server-side hashed
  JTI registration, first-claimer anonymous-auth UID, exact lecture, active
  issuing Admin session, open lifecycle and enabled DB runtime gate.
- Replays from another UID, cross-topic subscriptions, post-close relay and
  claimed-token fallback are rejected. A new client may use snapshot fallback
  only for an absent (`404`) or disabled (`503`) claim service.
- Registered bindings remain enforced when the Edge flag is OFF. An intentional
  DB-runtime shutdown may downgrade only the same claimed UID to the signed
  snapshot/PDF path. A service-role-only DB RPC rechecks the disabled gate,
  exact binding/browser, binding lifetime, open lecture, hard stop, and issuing
  Admin revoke/absolute/idle expiry on every snapshot and PDF request;
  replacement and lifecycle/security revocations cannot downgrade.
- Admin revoke and lecture terminal triggers permanently overwrite an earlier
  `feature_disabled` reason, preventing a rollback binding from resurfacing.
- A recognized same-UID expired binding receives only a data-free expiry
  control response so the Display can clear quietly. Cross-UID, unclaimed and
  invalid credentials retain HTTP 401 semantics on the live/rollback path.
  The pre-existing signed terminal-Review window is a separate time-bounded
  capability and never grants live Realtime or active-lecture access.
- Supabase private Broadcast temporarily carries only bounded caption text or
  page/version metadata. No audio is relayed, no service key reaches the
  browser, and students have no Realtime policy.
- The claim is UID-level rather than strict tab-level. Legacy unbound tokens
  remain an expand-first compatibility path until the documented production
  cutover and maximum token TTL have completed.
- AI master authorization binds lecture, tracked Admin session, actor and exact
  scope. It stores no PIN and creates no provider call, billing reservation or
  microphone request.
- Every paid start consumes a fresh child grant after the existing budget,
  concurrency, lifecycle and idempotency checks. An active master fences old
  direct-PIN clients to prevent double admission.
- DB runtime disable/close/session revoke terminalize Display bindings and AI
  authorization. Stop and revoke remain free and idempotent.

The Phase 7.28 Local Gate does not authorize hosted secrets, migrations, flags,
provider calls or deployment. Production requires refreshed Admin clients,
legacy-link expiry, hosted policy tests, telemetry and human/device evidence.

## 16. Phase 7.29 native and loopback controls

- Presenter Bridge binds only IPv4 `127.0.0.1:43124`, validates exact Host and
  production/development Origin allowlists, explicitly handles preflight and
  Local/Private Network Access, rejects transfer ambiguity and bounds headers,
  JSON and request rate. A hostile website receives no pairing or control
  capability.
- The browser keeps pairing material and the loopback session in memory only.
  It never sends an Admin session token, API-use PIN, service-role key or other
  long-lived credential to loopback, URL, browser storage or logs.
- The server signs Presenter material with a dedicated
  `PRESENTER_BRIDGE_TOKEN_SECRET` of at least 32 bytes. A pairing token is
  Origin/audience/scope bound, lives at most 60 seconds and is atomically
  single-use. The active capability is a short-lived bearer credential bound
  to connection, lecture, installation key and hard stop. Phase 7.29B's
  dormant bearer-plus-declared-installation boundary remains historical; the
  7.29C source adds a user-scoped, non-exportable CNG P-256 key and signs the
  method, fixed path, timestamp, nonce and exact raw-body digest on every
  machine request. Edge verifies proof of possession and, in the same database
  transaction as the lifecycle decision, atomically consumes the nonce and
  completes its bounded positive or negative receipt.
- The automatic ticket is issued for 55 seconds and may never exceed 60
  seconds. The separately rate-limited manual recovery code may live for at
  most five minutes. Only its domain-separated HMAC and expiry are stored; the
  raw value is never stored in browser persistence, the database, a URL,
  command line, log or telemetry. Exact retries reuse the signed receipt,
  while body substitution or nonce reuse is rejected.
- A dedicated Cloudflare Presenter Gateway preserves exact request bytes,
  injects a separate server-only gateway secret and forwards to one fixed Edge
  upstream. Browser traffic, redirects, encoded/oversized bodies, missing
  Cloudflare network identity and unavailable rate bindings fail closed. The
  Worker retains `workers_dev=false`, preview disabled and no route until an
  owner approves the exact FQDN; 7.29C activation remains Hosted/Device/Human
  HOLD.
- Database RPCs are service-role only, `SECURITY INVOKER`, execute with server
  time and recheck the runtime gate, tracked Admin session, lecture lifecycle,
  PDF/deck binding, sequence, rate and capability on every write or heartbeat.
  Presenter tables have RLS ON, no browser grants/policies and no Realtime
  publication membership.
- COM callbacks are acceleration signals only. Office objects remain on one
  STA thread, observation loss/timeout faults the connection within a bounded
  grace, metadata and errors are bounded, and crash logs must omit tokens,
  recovery codes and document paths/names.
- A Presenter binding cannot authorize paid AI, captions, PDF publication or
  another lecture. Runtime disable, Admin revoke, close, expiry, mutation or
  explicit disconnect terminalizes it; stopping and handover remain free.
- Production activation requires a signed per-user installer, SmartScreen and
  update policy, x86/x64 Office matrix, real Edge/Chrome HTTPS-to-loopback tests
  and venue/human evidence. Windows Application Control must never be disabled
  or bypassed to make an unsigned native test pass.

## 17. Phase 7.30A-B1 identity controls

- AAL1 admission returns eligibility only, never role, lecture, AI, ledger or
  operational Admin data.
- The first successful completion consumes its nonce and creates one tracked
  session. An exact same-caller/Auth-session/JWT retry within five minutes
  returns that same result; cross-principal, cross-session, altered or expired
  reuse fails closed.
- Status/touch rechecks environment, principal, membership, Auth session,
  runtime gate, absolute expiry and idle expiry. Self-logout can revoke the
  matching application session even after its normal expiry.
- Google B1 tokens use a distinct scope and cannot pass legacy Admin verifiers.
  The B1 session deliberately carries no lecture-operation authority before
  Phase 7.30C.
- Real Google OAuth, Hosted provider configuration, real-account recovery and
  Hosted Advisor evidence remain separate Hosted/Human gates.

The status/touch idle check above describes the transitional B1 implementation.
Phase 7.30B2 now removes that idle branch in the default-OFF database source,
anchors absolute expiry to the backing
`auth.sessions.created_at + 8 hours`, and implements live role/AI-entitlement
handling under the Section 5 session-continuity contract. Phase 7.30C completes
the unified verifier across every operational Admin Edge/RPC path.

## 18. Phase 7.30B2 Admin AI-unlock database controls

- Nine private tables hold the runtime gate, policy, PIN factor, three atomic
  rate tiers, immutable attempt/discovery receipts and remembered-browser
  enrollment/credential/assertion state. They have RLS enabled and no direct
  browser or service-role table grants.
- Public wrappers are service-role-only `SECURITY INVOKER`. Minimum private
  `SECURITY DEFINER` helpers fix an empty `search_path` and revalidate principal,
  membership, Admin session and backing `auth.sessions` state.
- The database accepts only a versioned 64-hex Edge-peppered HMAC and stores a
  bcrypt cost-12 verifier. It never accepts or stores the raw four-digit PIN.
  B2.2b Edge validation/HMAC and immediate client input clearing implement that
  source boundary; Local Edge and Human evidence remain HOLD.
- Bcrypt admission uses nonblocking environment-four/network-two advisory
  semaphores. Membership, pepper-hashed coarse-network and environment limits
  are locked and updated atomically after verification; immutable receipts make
  exact positive and negative retry converge without another count or bcrypt.
- New PIN enrollment/rotation requires the five-minute rare-mutation boundary.
  Once an actor/session/scope-bound request ID commits, any retry with that same
  binding returns its committed result without comparing PIN material or
  running bcrypt again. Initial post-login enrollment uses the already-fresh
  login TOTP. Future reset follows the same boundary.
- Browser state accepts only ES256/P-256 public JWKs, rejects private `d` and
  JSON-null substitutions, verifies the RFC 7638 fingerprint, and binds nonce,
  credential and one-time challenge state to exact identity, session, factor,
  Origin, lecture, scope and policy provenance. B2.2b creates a non-extractable
  P-256 private key in identity-scoped IndexedDB and verifies ES256/P1363 at the
  Edge. It returns only a dormant proof and never a lecture master.
- Factor rotation, policy and browser transitions drain their derived AI
  authority while preserving the Admin session where the contract requires.
  B2.2a adds explicit factor revoke/reset RPCs whose mutation transaction
  consumes an action/request/session/factor-set/JWT/AMR and canonical-intent
  bound grant. B2.2b implements the raw-PIN Edge/client path and approved TOTP
  add/remove transitions without exposing them to operational Admin authority. Bounded
  cleanup uses nonblocking membership serialization plus `SKIP LOCKED`, returns
  `has_more` and permits only safe terminal child states.
- Lecture-master provenance columns are additive and nullable. C1 now stores
  new-lecture ownership privately with no inferred backfill and atomically
  consumes a PIN/browser proof into a full-provenance dormant master. It fences
  legacy conversion and all child/provider authority. C2 adds the unified
  verifier, policy matrix and same-transaction provider/child paths.

The A-D from-zero migration, populated upgrade, pgTAP, concurrency, generated
types, DB lint, Local Edge and browser gates pass exact-head CI. All runtime
gates remain default OFF; Hosted/Human activation evidence remains HOLD.

## 19. Phase 7.30E Google-only identity cutover controls

- The Admin browser and all 19 remaining operational Admin Edge adapters accept
  only the opaque Google Admin application session. Legacy Admin-token,
  billing-PIN and billing-grant request fields are rejected before action
  dispatch. The personal four-digit AI PIN remains a separate in-session intent
  factor.
- Display terminal access requires an exact durable Google issuance binding for
  JTI hash, lecture, issued/expires timestamps and Display Auth UID. Unknown
  legacy descendants and cross-UID claims fail closed whether the signed token
  is expired or merely no longer live-authorized.
- Existing lecture ownership is never inferred. A postgres-only approval binds
  one environment, lecture status/lifecycle version, principal, membership,
  approving Google session and evidence digest. Claim consumes only that
  immutable approval and stores an append-only exact-replay receipt.
- Migration application is dormant. The final cutover is a separately invoked
  SERIALIZABLE operator function requiring a digest of independently verified
  Hosted deployment evidence. It serializes by environment/request, takes
  `ACCESS EXCLUSIVE NOWAIT` locks and rechecks owners, ownership, gates, legacy
  sessions and every unresolved legacy AI/PDF descendant in the same
  transaction.
- A successful cutover disables legacy admission, terminally revokes live
  legacy sessions through their existing descendant-drain triggers, revokes
  service-role execution of the legacy verifier and inserts one immutable
  tombstone. Triggers then prevent legacy gate re-enable, session issuance,
  relabel, extension or resurrection and prevent a new draft/open lecture from
  committing without explicit ownership. Exact committed replay remains
  available.
- SQL cannot verify that a stateless old Hosted Edge bundle has been removed.
  Source deletion and test success do not authorize the operator cutover. The
  Hosted function inventory, release digest, secret inventory, two-owner
  recovery and immutable Google-only rollback revision are mandatory Human
  gates.
- The identity cutover does not delete historical rows or retire historical
  billing compatibility RPCs. Billing retirement follows personal-AI-PIN
  evidence in a separate transaction. Rollback never restores a shared PIN.

Phase E static, type, non-live and mocked browser evidence passes locally.
Fresh database, concurrency, populated-upgrade, Local Edge and exact-head CI
remain required before the source candidate may merge. Hosted cutover and
activation remain HOLD regardless of repository CI status.

## 20. Phase 7.30F evidence and approval controls

- The evidence validator is pure local, read-only and default `HOLD`. It has no
  network, database, child-process, deployment, secret-management or approval
  capability. It emits only `SOURCE_READY`, `HOLD` or
  `READY_FOR_SEPARATE_HOSTED_EXECUTION`; `Production PASS` is invalid.
- The source example keeps frontend/server flags OFF and only the legacy-login
  database gate true. A complete staging dossier instead records separately
  approved frontend/server flags and post-cutover database gates ON, with
  legacy login OFF and every corresponding value equal. These are untrusted
  evidence inputs until independent review; the validator does not query or
  independently prove Hosted state.
- The closed manifest rejects unknown/missing fields, Production/contest
  targets, inconsistent pre/post-cutover claims and secret/identity-shaped
  keys or values. JWTs, bearer strings, PEM, service-role, OAuth secret/token,
  raw PIN, TOTP, recovery material, project refs, real domains, email, user IDs
  and database dumps never enter evidence, logs, Git, PRs or CI artifacts.
- Each function-inventory entry contains exactly `name`, positive integer
  `version` and Boolean `verifyJwt`; immutable revision and deployment-evidence
  digests live at the enclosing Hosted evidence level. Secret evidence contains
  only the secret name, presence/absence, rotation-state metadata and timestamp;
  never a value or value digest.
- `preCutover` preserves the E advisory function's exact non-authoritative
  16-key result and separate direct safety observations. `postCutover` is a
  distinct observation after separately approved execution and must agree with
  the immutable receipt/deployment digest. CI never fabricates or executes
  either Hosted observation.
- The six historical billing admission functions are inventoried read-only.
  Their remaining effective runtime authority is a Production `HOLD`, but this
  tranche performs no revoke, rename, drop or secret deletion. Billing
  retirement and `BILLING_PIN` deletion are two later approval boundaries.
- Staging mutation, OAuth/provider configuration, Human identity testing, E
  cutover, `ADMIN_PIN` deletion, billing retirement, `BILLING_PIN` deletion and
  limited identity canary each require a fresh exact-SHA/environment/action-
  digest approval. An earlier requirements approval or green CI is not
  transitive authority.
- Any identity/lecture/environment leak, AAL1 privileged data, callback/Origin
  widening, old-session resurrection, last-owner bypass, secret exposure,
  deployment/receipt mismatch, disabled fence trigger or unresolved
  Critical/High finding stops the run. Containment disables new admission and
  paid starts, revokes the affected cohort and returns to the immutable
  Google-only revision; rollback never restores a shared PIN.
