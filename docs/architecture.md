# COMPASS Interactive Architecture

Last reviewed: 2026-08-10
Applies to: repository implementation candidate through Phase 7.30A-C1;
B2-C1 runtime DB, later native, Human, Hosted and Production gates remain separately authoritative

## 1. Architectural goals

COMPASS Interactive combines a low-friction classroom experience with strict
ownership, bounded paid work and low recurring backend load.

The architecture is designed around these invariants:

1. the browser improves responsiveness but never decides authorization;
2. lecture expiry and paid-operation admission use server time;
3. students receive one compact versioned snapshot path rather than many
   subscriptions or periodic endpoints;
4. PDF bytes, audio and full local transcripts do not enter Supabase;
5. AI output is optional, quality-gated and teacher-controlled;
6. a closed lecture converges to read-only archive behavior and stops live work;
7. Demo behavior remains independent from all hosted services.

## 2. System map

```mermaid
flowchart LR
  Student["Student browser"] -->|"anonymous Auth + versioned RPC"| Supabase["Supabase Auth / Postgres"]
  Teacher["Teacher browser"] -->|"Admin identity and paid-intent controls"| Edge["Supabase Edge Functions"]
  Display["Classroom display"] -->|"scoped display session"| Edge
  Edge -->|"authorized RPC"| Supabase

  Teacher -->|"PDF metadata + Admin session"| Edge
  Teacher -->|"bound PDF stream"| Worker
  Worker -->|"nonce/job coordination"| Edge
  Teacher -.->|"recovery mode only"| Publisher["Local Publisher"]
  Publisher -.->|"mutually exclusive private writer"| R2["Private Cloudflare R2"]
  PowerPoint["PowerPoint for Windows"] -.->|"actual stable slide position"| Presenter["Presenter Bridge on 127.0.0.1"]
  Teacher -.->|"short-lived pairing"| Presenter
  Presenter -.->|"scoped page commit"| Edge
  Student -->|"short-lived archive/PDF access"| Worker["Cloudflare Worker"]
  Worker --> R2

  Edge -->|"bounded explicit calls"| OpenAI["OpenAI API"]
  Edge -->|"one daily operations digest"| Email["Email provider"]
  Supabase -->|"sanitized archive outbox"| Edge
  Edge -->|"machine-authenticated ingest"| Worker
```

## 3. Frontend and routes

The frontend is a Vite, React and TypeScript single-page application. Public,
Student and Display route components are lazy-loaded and share the anonymous
Student `CompassStateProvider`. The `/admin` identity shell is separately
lazy-loaded outside that provider so its PKCE callback and Auth storage cannot
replace or consume the Student anonymous session. The existing Admin workspace
mounts its provider only through the separately flagged legacy path in B1.

| Route               | Responsibility                          | Important boundary                                                            |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `/join`             | Validate live or archived lecture entry | Six-digit code is an entry identifier, not an Admin credential                |
| `/demo`             | Redirect to isolated Demo data          | No Supabase, OpenAI, Worker or Publisher network call                         |
| `/lecture`          | Mobile-first student session            | Five-second snapshot while active; stop on exit/terminal state                |
| `/lecture/comments` | Older comment history                   | Explicit cursor fetch; no periodic history polling                            |
| `/lecture/archive`  | Closed lecture preview                  | Cloudflare read-only access; no live Supabase loop                            |
| `/admin`            | Teacher identity and operations         | Separate Admin Auth client; Google B1 session grants no operational authority |
| `/display`          | Fullscreen classroom view               | Scoped display token, never an Admin token                                    |

`scripts/create-route-entrypoints.mjs` copies the production `index.html` into
each route directory. Cloudflare Pages therefore does not need an unsafe or
ambiguous catch-all redirect.

## 4. Live lecture data flow

### 4.1 Participant identity

1. Supabase Anonymous Auth creates an authenticated user identity.
2. The join RPC validates the lecture code and creates or reuses the
   participant owned by `(select auth.uid())`.
3. All student writes derive ownership on the server. A participant UUID sent
   by a browser is never sufficient proof.
4. Cross-participant and cross-lecture access is denied by RLS and RPC checks.

### 4.2 Synchronization

- Phase 1 introduced versioned public and participant-specific snapshots.
- The foreground cadence is normally five seconds; background tabs slow down
  and failures use bounded backoff.
- Comments, likes, Poll results, PDF page, captions, summaries and small metrics
  converge through snapshot versions.
- No public application table is intended to be in the Supabase Realtime
  publication.
- Comment history is fetched only when requested.
- Phase 7.1 `mine` history resolves the current participant from `auth.uid()`
  inside the database; the client never supplies an owner participant ID.
- Presence heartbeat writes are folded into the authenticated snapshot and
  throttled independently from the five-second reads.

Optimistic UI is permitted for the caller's own comment, like and Poll action.
The server response or next snapshot remains authoritative.

## 5. Lecture lifecycle

`lecture_sessions` is the lifecycle root. Phase 2 added the canonical hard-stop
deadline, audit events, AI-control state and archive state.

- A lecture may be draft, open or closed; archive state is tracked separately.
- Start establishes a server-time deadline capped at 90 minutes.
- Manual close and automatic expiry call the same idempotent core transition.
- Read and write RPCs independently reject expired lectures, so a missing Cron
  run cannot preserve an invalid active state.
- Closing stops write admission, Poll answers and new AI operations.
- Clients that observe terminal state cancel polling, provider work and pending
  mutations, then converge to the ended/read-only UX.
- A closed lecture is not reopened in place. The teacher may create and start a
  new lecture that copies only safe metadata such as the title.

## 6. PDF publication and delivery

The PDF path intentionally avoids Supabase Storage and database byte traffic.

1. The teacher selects a PDF through the Admin flow. A dedicated browser Worker
   validates type, actual size, page and text limits without rendering or OCR.
2. Edge validates the tracked Admin session and lecture, then Postgres creates a
   server-time job/nonce and Edge signs a short-lived, fully bound upload ticket.
3. The browser streams bytes directly to the asset Worker; they never transit
   Supabase. The Worker independently validates ticket, exact Origin/path,
   actual bytes, `%PDF-` magic, native SHA-256, binding, expiry and nonce.
4. The Worker writes an immutable R2 object, stages a hidden manifest entry and
   exposes it only after DB and Worker agree on a future access version.
5. Supabase stores only job/document identifiers, audit/lifecycle state and
   synchronized page metadata. Uncommitted objects are never student-readable.
6. The Worker validates short-lived access and serves byte ranges directly from
   the private R2 bucket.

Local Publisher remains an offline compatibility/recovery path. It may hold the
bucket-scoped R2 writer and local extracted text only after browser publication
is disabled, all jobs/cleanup are terminal and the isolated credential is
deliberately restored. Browser extraction is ephemeral in memory. PDF addition
does not redeploy the main Pages application.

## 7. AI and captions

### 7.1 Admission

The current legacy source admits paid work with all of the following:

- an explicit teacher action;
- a valid API-use PIN grant, separate from the Admin PIN;
- an open, non-expired lecture;
- an enabled server-side feature flag;
- available per-lecture call and cost budget;
- an available Realtime or Batch concurrency lane;
- a unique idempotent operation identity.

Stop is intentionally easier than start and does not require the API-use PIN.

Phase 7.30B2 implements the continuous-session lifetime migration and B2.2a
adds an approved TOTP factor-set trust anchor; Phase 7.30C completes its unified
verifier across every operational Admin
Edge/RPC path. Admin identity uses Google plus Supabase Authenticator App TOTP
AAL2, compatible with Google Authenticator; there is no email MFA or custom MFA.
The application session has no idle timeout or periodic TOTP prompt and is
capped at the backing `auth.sessions.created_at + 8 hours`. B2 rejects logout,
backing-session removal, principal/environment/membership invalidation or that
cap in its database path. B2.2a stores an approved hash/version/count on the
Admin principal and issues a dormant Google Admin app session only when that
anchor, the live verified set, the immutable session hash and completed
post-challenge JWT/AMR nonce evidence agree. Missing or changed sets revoke the
session and drain pending AI authority. Only an unbound `pending_mfa` principal
with no verified factors may atomically approve the exact first factor during
fresh completion. Existing verified but unbound sets require an Edge-unwired,
default-OFF operator adoption while issuance is OFF; migration never infers an
approval. B2.2b adds a default-OFF add/remove transition: one aggregate Auth
snapshot establishes the approved pre-set, the B2.2a five-minute grant binds
the target and expected post-set, and finalize advances the principal anchor
and drains old authority. Supabase Auth mutation remains outside the database
transaction, so a hash-only Auth-session-bound recovery credential provides a
maximum 30-minute retry window within the eight-hour cap.
Role changes apply live; `can_use_ai=false`
drains AI authority without logging the teacher out.

Paid intent becomes a personal AI PIN (or valid remembered-browser/future AI
Passkey proof) checked once per new lecture master or explicit scope/cost
escalation. Child starts do not re-prompt and still recheck lecture lifecycle,
scope, policy, budget, concurrency and idempotency. AI-PIN rotation/revoke drains
AI authority but preserves the Admin session. Five-minute fresh TOTP is limited
to owner/principal, role/status, verified TOTP-factor-set, environment AI-policy,
global-revoke and AI PIN factor enrollment/rotation/revoke/reset control-plane changes.
Initial PIN enrollment after login uses the already-fresh login TOTP without an
extra prompt; ordinary lecture controls, emergency stop, PIN verification,
browser proof, AI master/escalation and child starts never prompt. `ADMIN_PIN` is removed
after the C migration and `BILLING_PIN` after personal-AI-PIN E2E, both before
Production. Rollback is a Google-only immutable revision plus operator owner
recovery.

### 7.2 Realtime transcription

- The browser sends microphone media to the provider through the approved
  WebRTC flow; COMPASS does not persist audio.
- Realtime has its own explicit start CTA and selected duration.
- It is never started by PDF analysis, Poll generation or summary generation.
- The teacher sees local partial text; students receive bounded completed
  caption windows through the snapshot path.
- Client stop, selected duration, lecture close, hard stop and provider sweeper
  converge on the same idempotent hangup ledger.

### 7.3 Batch AI

- Phase 5 performs one bounded material analysis and proposes Poll drafts.
- Phase 6 combines the lecture recap and comment pulse for a five-minute window
  where possible, skips low-information windows and keeps immutable revisions.
- AI Poll proposals and summary revisions are not automatically published.
- Teacher correction creates a new revision rather than overwriting history.
- PDF text, comments and transcript input are bounded before a provider call.
- Phase 7.1 snapshots `auto / ja / en` when a summary window is inserted.
  Manual selection is authoritative; `auto` resolves from that window's
  teacher transcript, then current PDF text, with Japanese as the deterministic
  final fallback. Resolution is local and adds no model call.
- Phase 7.2 accepts only a teacher-selected academic question, verifies at most
  five PubMed records and corroborates DOI metadata through Crossref before one
  Luna structured-output call. A primary study must support every material
  point. Retrieved abstracts are transient; only bounded citation metadata,
  claim-source mapping and immutable hidden revisions are stored. Students and
  archives receive at most three teacher-approved projections through the
  existing snapshot/export paths.
- Phase 7.25 adds automatic five-minute candidates and a multidisciplinary
  Crossref/OpenAlex path for non-medical fields. Every visible material claim
  still requires a verified primary source; low-value/unsupported candidates
  are suppressed. Before review, output carries an explicit teacher-unconfirmed
  label and remains approve/hide/correct capable.

### 7.4 Lecture join QR

Admin and Display generate an SVG from the same-origin canonical
`/join?code=######` URL. The QR contains no token, lecture UUID, Admin state or
secret, calls no external QR service and is not stored in Supabase or R2. It is
rendered only for the currently selected open Admin lecture and an open Display.

The application model router and the Codex model used to develop the repository
are separate concerns. Runtime application calls remain governed by the AI
budget and model policy in `PROJECT_GUIDE.md` and `docs/ROADMAP.md`.

## 8. Closed-lecture archive

Phase 6.6 exports a sanitized, bounded view rather than keeping student clients
attached to live Supabase state.

- Supabase prepares an idempotent archive export outbox record.
- A machine-authenticated Edge Function claims bounded batches.
- The Worker revalidates the payload and stores private R2 archive objects.
- Archive lookup uses Origin controls, Turnstile, rate limits and short-lived
  access.
- PDF access remains separately ticketed.
- The archive contains no auth UID, participant ID, Admin token, PIN, lecture
  code, code hash, raw PDF text, raw transcript or audio.
- At expiry, access fails closed before eventual physical deletion.

Phase 6.8 can issue a seven-day, lecture-scoped resume token after an owned live
join. The browser exchanges it in a request body, never a URL, and the Worker
resolves a private public-ID index before issuing the existing short-lived
archive/PDF credentials. Code plus Turnstile remains the compatibility fallback.
The capability is default-OFF until the database, Edge and Worker deployment
sequence and hosted CSP gate pass.

## 9. Daily operations digest

At most once per active day, a trusted scheduler may call the digest Edge
Function. It reports bounded lecture and AI usage metadata, uses an idempotency
key and makes no AI call. No email-provider credential or scheduler secret is
available to the browser or database client.

## 10. Trust zones and secret placement

| Zone                        | May contain                                                                                             | Must not contain                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Browser                     | Supabase URL/publishable key, Turnstile site key, public Worker URL; transient user-entered AI PIN form | service role, OpenAI key, persisted PINs, R2 secret, Turnstile secret |
| Supabase Edge secrets       | OpenAI key, current legacy PIN material until Phase 7.30 removal, service role, trigger secrets         | values returned to browser or committed to Git                        |
| Local Publisher environment | recovery-only bucket-scoped R2 credential and signing material                                          | values in frontend variables or simultaneous browser mode             |
| Cloudflare Worker secrets   | archive/publication verification keys, JWK/coordinator material, bindings                               | plaintext lecture codes or Supabase service role                      |
| PostgreSQL                  | ownership, lifecycle, audit, bounded metadata                                                           | PDF/audio bytes, raw local transcript, plaintext secrets              |

See `docs/SECURITY.md` for the enforceable security contract and remaining
hosted/human Phase 6.8 evidence.

## 11. Migration and compatibility policy

- Migrations are append-only and expand-first.
- New capabilities deploy with frontend and server flags OFF.
- Legacy RPCs remain until the minimum supported client no longer calls them.
- A rollback normally disables flags and restores the previous frontend/Edge
  version; it does not drop newly added columns or destroy audit records.
- Every database phase must pass a clean reset and an upgrade fixture.
- All public tables require RLS and explicit grants; `authenticated` alone is
  not an ownership rule.

## 12. Current structural debt

Phase 6.9 split the largest Admin, state and Supabase repository responsibilities
behind stable interfaces and characterization tests. Remaining debt is managed
through bundle budgets, generated DB types and characterization/E2E gates; a
future split must not redesign the UI, add requests or weaken lifecycle/RLS
behavior.

## 13. Authoritative sources

1. `supabase/migrations/` and `supabase/config.toml` for database and Edge
   runtime state.
2. `src/App.tsx`, repositories and feature flags for frontend behavior.
3. `cloudflare/asset-worker/` and `publisher/` for PDF/archive delivery.
4. `docs/ROADMAP.md` for future work and gates.
5. Phase gate reports for historical test evidence.

If an older document conflicts with those sources, treat it as historical and
open a documentation correction before implementing a new phase.

## 14. Phase 7.28 operational boundaries

Phase 7.28A retires only the one-off Journal Club creation surface. Its
frontend and Edge creation flags default OFF; historical lectures, Polls and
archives remain readable through the established paths.

Phase 7.28B adds one private, claimed Display Realtime identity per lecture.
Committed PDF page changes and bounded caption deltas accelerate through a
private topic; the durable five-second snapshot remains authoritative and is
the fallback. A claim binds the first anonymous-auth UID to a hashed token JTI.
Students receive no binding, Realtime subscription or new periodic request.
The caption relay accepts at most 12 KiB and 4,000 characters per request and
never carries audio. The DB runtime gate is the first rollback switch. Its
`feature_disabled` transition permits only the same claimed UID to continue on
the signed snapshot/PDF fallback, and a service-role-only DB RPC revalidates the
gate, binding lifetime, lecture lifecycle/hard stop and issuing Admin session
on every fallback request. Later Admin revoke, lecture close/hard stop or link
replacement permanently rewrites that binding's terminal reason. Every other
registered-token failure remains closed even when the Edge flag is OFF.

Phase 7.28C adds a lecture/Admin-session/actor-bound AI master authorization
with two scopes: eligible AI excluding captions, or including captions. It
stores no PIN and performs no provider call. Every explicit feature start still
requires a new short-lived single-use child grant and the existing budget,
lane, lifecycle and idempotency admission. Status and free revoke remain
available while paid admission is disabled.

## 15. Phase 7.29 Presenter Bridge boundary

Phase 7.29 adds an optional Windows-native operating boundary without changing
the student or Display transport contracts. PowerPoint COM events only request
a reconciliation; the canonical source is a stable observation of the actual
`View.Slide.SlideID` and absolute slide index. A 200 ms local monitor covers
missing, early, duplicate, back and jump events. Same-page observations do not
advance the existing live-state version.

The initial mapping is intentionally narrow: a normal all-slide, windowed show,
no hidden slides, Custom Show or Presenter View, equal PPTX/PDF counts, and an
explicit teacher confirmation after seeing both document identities and the
PDF first page. Ordered Slide IDs and the PPTX digest are frozen for the active
connection; a structural or save mutation revokes synchronization rather than
guessing a mapping.

The per-user Bridge binds only `127.0.0.1:43124`; Local Publisher remains on
`43123`. Exact Host/Origin and bounded-request checks protect loopback. The
browser sends no Admin token, PIN or service credential to the Bridge. Pairing
and active capabilities are short-lived, single-purpose and bound to Origin,
lecture, deck and installation. PowerPoint/PPTX/PDF bytes never enter Supabase.

Every machine request also carries a per-user, non-exportable P-256 proof bound
to the exact raw body, method, fixed path, timestamp and nonce. A dedicated
Cloudflare Gateway forwards only those bounded bytes to one source-pinned Edge
upstream, overwrites its server-only gateway/network headers and applies coarse
location/network rate protection. Edge and the database remain authoritative
for signature, replay, lifecycle, binding and global-rate decisions. Release
builds retain a `.invalid` endpoint and the Worker has no public route until an
owner-approved FQDN exists.

Database and Edge admission use independent default-OFF gates. At most one
unrevoked Presenter binding may fence a lecture's manual page writes. Explicit
handover, runtime disable, expiry, lecture close, Admin revoke, disconnect or
document mutation terminalizes it and returns the teacher to the established
manual control. The final commit still flows through the existing live-state
mutation, so Phase 7.28 Display acceleration remains unchanged and students
continue the five-second snapshot with no Presenter request, table or Realtime
subscription.

Signed Velopack distribution, exact Custom Domain/update feed, physical Office
and browser testing, and verification of the 55-second automatic ticket versus
the five-minute manual recovery-code TTL are separate Phase 7.29C
Hosted/Device/Human gates; source or CI PASS cannot activate them.

## 16. Phase 7.30A-B1 Admin identity boundary

Phase 7.30A-B1 adds a separate Admin Supabase Auth client with a distinct
storage key, explicit PKCE exchange on `/admin/auth/callback`, and URL-session
detection disabled everywhere else. The Student client continues to accept
only an anonymous Auth user. Google provider tokens are removed from Auth JSON
before the SDK can persist or broadcast a session and are stripped again by
the Admin storage adapter.

The local identity path binds a trusted Supabase Auth user and linked Google
identity to one environment membership, then requires a five-minute,
digest-only step-up nonce and a fresh TOTP AAL2 AMR before issuing an
application Admin session. The database and Edge authorization gates are
default OFF; the separate frontend flag controls only UI exposure and is also
default OFF. Legacy PIN compatibility remains default ON. The B1 Google
session is identity-only and cannot invoke the existing lecture, PDF, AI,
Display or Presenter Admin operations. That capability migration belongs to
Phase 7.30C, while real Google OAuth and Hosted/Human evidence remain HOLD.

Phase 7.30B2 now migrates the default-OFF database source for that B1 identity-
only session to the continuous
teacher-session contract described in Section 7.1: no 30-minute idle expiry and
no periodic TOTP. Phase 7.30C completes the unified verifier across every
operational Admin Edge/RPC path. The later cutover makes Production authority
Google-only and removes the shared `ADMIN_PIN`/`BILLING_PIN` paths before
Production.

## 17. Phase 7.30B2 Admin AI-unlock database boundary

B2 adds a default-OFF private database subsystem for AI policy, versioned PIN
factor, rate limits, immutable attempt/discovery receipts, browser enrollment,
public credential and one-time assertion challenge state. The database accepts
only a 64-hex versioned Edge-peppered HMAC, stores its bcrypt cost-12 verifier,
and never accepts raw four-digit input. Nonblocking environment/network bcrypt
semaphores bound expensive work before atomic membership/network/environment
rate updates.

Remembered-browser rows constrain ES256/P-256 public JWK and RFC 7638
fingerprint state and bind nonce/challenge state to identity, session, factor,
Origin, lecture, scope and policy. B2.2b stores a non-extractable browser private
`CryptoKey` only in identity-scoped IndexedDB and verifies its ES256/P1363
assertion in the dedicated Admin Edge. Policy, factor-rotation/revoke/reset and browser
transitions plus bounded cleanup drain derived AI authority while preserving
the Admin session where required. B2.2a adds service-only factor revoke/reset,
safe profile and single-use rare-control APIs whose grants bind a DB-recomputed
canonical mutation-intent digest. Existing lecture masters gain nullable provenance columns,
but B2 does not issue a master from an AI proof.

All B2/B2.2 public wrappers are service-role-only `SECURITY INVOKER`; private privileged
helpers use a fixed empty `search_path`, minimum grants and database context
revalidation. The source/static gate is PASS, while exact-head from-zero/
populated upgrade, pgTAP, database concurrency, generated types and lint remain
pending. B2.2a implements the TOTP factor-set fingerprint and dormant identity
Edge begin/complete/reconcile transport. B2.2b implements default-OFF raw-PIN,
AI mutation, browser proof and approved factor-transition source paths, but
issues no master. C1 adds four RLS-enabled private evidence tables for
absence-based lecture ownership, atomic proof-to-master admission, proof-free
same-scope request observation and downgrade/revoke replay. Its nine public
facades are fixed-search-path `SECURITY DEFINER` functions restricted to
`service_role`. It never backfills an existing lecture, exposes
principal UUIDs on `lecture_sessions`, issues child/provider authority or
converts a pre-C1 master. The remaining all-operational Admin verifier, AI
Passkey, Local Edge, Hosted/Human and activation are C2/later HOLD boundaries.
