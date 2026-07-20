# COMPASS Interactive Security Contract

Last reviewed: 2026-07-19
Status: locally implemented controls through Phase 7.2; new capabilities remain
default-OFF and pending hosted/human production evidence

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

The Admin PIN and API-use PIN are separate credentials with different purposes.

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

Phase 7.2 keeps literature hosts fixed to NCBI and exact DOI Crossref records,
bounds time/body/source counts and rejects redirects or metadata disagreement.
The model receives untrusted question/evidence as serialized data, has no tool,
cannot create identifiers and returns a strict claim-to-source schema. At least
one verified primary source is required; reviews/editorials are context-only
and retracted records are excluded. Drafts remain service-role-only until a
teacher publishes them. Provider dispatch, cancellation, exact settlement,
late discard and stale-operation reaping are separate audited transitions.

## 7. Browser-safe and server-only configuration

### Browser-safe

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `VITE_PDF_PUBLISHER_URL` when it is the approved loopback endpoint
- `VITE_PDF_WORKER_BASE_URL`
- explicit frontend feature flags

These values are visible to every user and must not be treated as secrets.

### Never browser-exposed

- Supabase service-role/secret key and database credentials;
- OpenAI API key;
- Admin PIN, API-use PIN and session-signing material;
- Turnstile secret;
- R2 access/secret keys;
- Publisher signing/private key material;
- archive ingest, retention and scheduler secrets;
- email-provider credentials.

CI and production checks must scan both source and built assets for forbidden
secret-bearing variable names/patterns without printing secret values.

## 8. PDF, Publisher and R2

- Publisher binds to loopback and uses a short-lived pairing/session flow.
- Allowed Origin and Host are validated.
- PDF validation enforces type, byte, page and text limits; image OCR is not
  performed.
- R2 credentials are bucket-scoped and live only on the teacher machine.
- The R2 bucket is private.
- The Worker validates Origin, short-lived access, range requests and retention.
- PDF object addition updates a manifest rather than redeploying Pages.
- PDF bytes, R2 credentials and extracted text do not enter Supabase or browser
  persistence.

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

Phase 6.9 must add:

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
