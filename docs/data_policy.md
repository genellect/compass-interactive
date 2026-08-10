# COMPASS Interactive Data Policy

Last reviewed: 2026-08-10

## 1. Purpose

COMPASS Interactive reduces the psychological barrier to classroom
participation. It therefore collects the minimum data needed for a live class,
does not create a student profile system and keeps paid AI and document delivery
within explicit boundaries.

This document describes the implemented repository policy. Institutional
privacy review and an operator-facing privacy notice remain required before a
formal production certification.

## 2. Data stored in Supabase

Supabase may store:

- anonymous Auth user identifiers;
- lecture and anonymous participant identifiers;
- lecture lifecycle state, deadlines and audit events;
- comments, likes, Polls and Poll responses;
- an optional nickname written on the comment row only;
- PDF document identifiers, manifest/object references and displayed page;
- bounded completed caption windows, never audio;
- AI operation state, usage/cost ledger and bounded output revisions;
- teacher publication, correction, pin and moderation events;
- approximate presence timestamps and cached aggregate metrics;
- sanitized archive-export state and content-free operations-digest state.
- bounded Journal Club run kind, preset version and ordered Poll-slot metadata.
- for an admitted Admin only, the normalized Google email, bounded display
  name, Supabase Auth user/session identifiers, peppered subject binding,
  environment membership and content-free identity/session audit metadata.
- for Phase 7.30B2, content-free AI policy/factor/version/rate/receipt metadata,
  bcrypt of an Edge-peppered HMAC, remembered-browser public JWK/fingerprint,
  opaque credential digest, nonce/challenge digests and authority-drain state.

An optional nickname is not a verified identity. The database default remains
`NULL`; the UI renders `匿名の参加者` when it is absent. No profile table is
created for nicknames.

## 3. Data intentionally not collected

The Interactive application does not intentionally collect:

- student names or student numbers;
- university email addresses;
- grades or formal named assessment records;
- demographic or detailed personal profiles;
- biometric identity;
- audio recordings;
- complete raw microphone streams;
- PDF bytes or image OCR output in Supabase;
- complete local transcript files in Supabase;
- plaintext current-legacy Admin/API-use PIN or lecture-code hash material in
  client data; both shared PIN systems are removed before Production by the
  Phase 7.30 contract;
- OpenAI, Supabase service-role, R2, Turnstile or email-provider secrets in the
  browser.
- raw Google subject in COMPASS application tables; Supabase Auth remains the
  trusted linked-provider identity store;
- Google `provider_token`/`provider_refresh_token`, TOTP secret, raw step-up
  nonce, invitation token or application Admin session token in COMPASS
  application tables.

Students must be told not to put personal or patient-identifying information in
comments or nicknames. Moderation and deletion procedures must handle accidental
disclosure.

## 4. Local teacher-machine data

The local Publisher recovery mode may hold:

- the source PDF while it is being validated and published;
- extracted text within the configured size/page/character limits;
- the teacher review script or transcript text;
- bucket-scoped R2 Publisher credentials in an ignored local environment file.

It is not the primary browser publication path. Its process is stopped and its
R2 write credential revoked or isolated while browser publication is enabled.

COMPASS does not intentionally store microphone audio. Local transcript and
extracted text are operator-controlled working data and require a documented
retention/cleanup routine. They must not be copied into Git, browser storage,
Supabase or public R2 objects.

## 5. Cloudflare R2 and Worker data

Private R2 may store:

- immutable lecture PDF objects;
- versioned manifests;
- bounded private publication ledgers, cleanup intents/audits and tiny permanent
  terminal sentinels that fence delayed requests;
- sanitized read-only archive payloads;
- bounded supporting metadata required to validate access and retention.

The bucket remains private. The Worker provides short-lived, scoped PDF or
archive access and supports PDF byte ranges. Object keys and archive payloads
must not reveal a plaintext lecture code, auth UID or participant ID.

## 6. OpenAI data boundary

OpenAI receives only the content required by an explicitly enabled feature:

- bounded PDF text for material analysis;
- bounded transcript/comment windows for summaries;
- live microphone media for explicitly started Realtime transcription;
- verified literature metadata and at most 6,000 transient evidence characters
  for a teacher-requested academic-reference workflow.

Before sending, the application applies feature-specific limits, lecture state,
budget and concurrency admission. Image OCR is outside the design. Low-value or
unsupported output is not forced into the student UI.

Phase 7.2 does not store retrieved abstracts, article bodies or literature PDFs.
It stores bounded PMID/DOI/title/year/author/study metadata, verification facts,
claim-source mappings, usage audit and immutable revisions. Only a
teacher-confirmed projection enters the student snapshot and closed archive.

Phase 7.25 may use fixed-host Crossref/OpenAlex metadata for non-medical
questions. Retrieved metadata/evidence is transient at the provider boundary;
the same bounded identifier, claim-source, usage and immutable-revision policy
applies. Automatically visible answers remain explicitly teacher-unconfirmed.

The exact provider retention and processing terms must be rechecked at each
production gate; this repository document is not a substitute for the current
provider agreement.

## 7. Email operations digest

The daily digest contains bounded operational information such as lecture title
and aggregate API-call/cost counts. It must not include student comments,
nicknames, participant identifiers, transcript text, PDF text, PINs or tokens.
No email is sent on a day without relevant activity.

## 8. Browser storage

The browser may keep only bounded session/support state needed for re-entry and
optimistic UX. Archive/PDF access tokens remain memory-only. Lecture codes or
local participant hints must not be treated as authorization.

During an explicit Admin PDF action, browser Web Worker output and at most
20,000 normalized text characters may exist in memory. They are cleared on
Admin logout/reload and are not written to localStorage, sessionStorage,
IndexedDB, Supabase or R2. A later AI action reauthorizes the private download,
revalidates bytes and re-extracts in a new Worker.

Phase 6.8 may keep at most ten lecture-scoped high-entropy resume tokens in
local storage for seven days. A token must never be placed in a URL, analytics
event, console log or long-term user profile. Server-side storage contains only
Admin-token hashes, keyed rate-limit identifiers and resume revocation/version
metadata, never plaintext Admin or resume tokens.

## 9. Retention lifecycle

- Live write access ends when the lecture closes or reaches its server deadline.
- Closed lecture content may remain available as a read-only preview for 30
  days from the canonical close/archive timestamp.
- Access fails closed at expiry even if cleanup has not run.
- Physical object deletion may use a short recovery buffer after access expiry.
- Database/archive cleanup and Publisher-local cleanup are separate idempotent
  operations.
- Browser-publication cleanup is a third idempotent responsibility. It removes
  only an exact hidden/terminal manifest reference and mutable object/ledger,
  then retains tiny permanent sentinels so an old accepted request cannot
  recreate content. Sentinel growth and exhausted cleanup require monitoring.
- Future export/deletion evidence records counts, timestamps and hashes rather
  than retaining deleted private content.

Exact retention values and exceptions must be represented in the lifecycle and
archive configuration, not only in prose.

### Phase 7.27 Journal Club production exception

Phase 7.27 does not change the standard 30-day policy for normal lectures or
rehearsals. Each rehearsal is a fresh lecture and its comments, Poll responses,
AI output, resume state and PDF binding remain isolated from every other run.

For the single production run of the `7.23 Journal Club` preset only, the
sanitized R2 archive snapshot and final immutable PDF may remain available
without the standard archive-expiry timestamp. This exception is accepted only
when the server-generated archive payload carries exactly:

- `mode: permanent`; and
- `policy_id: phase7-27-journal-club-2026-07-23-v1`.

Unknown keys, a different policy ID, rehearsal data or client-supplied markers
do not receive the exception. Archive and PDF credentials remain short-lived
and scoped even when the underlying production record is retained. Supabase
does not become the PDF delivery path and no additional student polling or
Realtime subscription is introduced.

## 10. Access and ownership

- Anonymous Auth still receives the PostgreSQL `authenticated` role; RLS must
  additionally verify participant ownership.
- Students cannot list participant records or raw Poll responses.
- Display credentials have a narrower scope than Admin credentials.
- Admin access does not grant paid API use. The current source has a separate
  API-use PIN; Phase 7.30 replaces it before Production with a personal AI PIN
  verified once per new lecture master or explicit scope/cost escalation.
- Service-role access is restricted to trusted Edge Functions.
- Archive and PDF access are short-lived and scoped.

## 11. Incident handling

Immediately disable the affected feature and stop the rollout if any of the
following occurs:

- cross-participant or cross-lecture disclosure;
- secret or PIN exposure in a bundle, response, artifact or log;
- a paid action without explicit authorization;
- PDF/audio/raw transcript entry into Supabase;
- archive/PDF access without a valid scoped authorization;
- writes or AI starts after lecture close;
- an unapproved AI output automatically published to students.

Preserve content-free audit evidence, rotate affected credentials and follow
the current runbook index. Do not destroy evidence with an ad-hoc database
rollback.

## 12. Phase 7.28 transient and audit data

- Private Display Broadcast may temporarily contain committed PDF page/version
  metadata and at most 4,000 characters of caption text in a 12 KiB request.
  Supabase manages short Broadcast retention; COMPASS does not copy those
  deltas into an application table. Audio is never relayed or retained.
- Display binding rows contain a token-JTI SHA-256 hash, random topic, scoped
  auth/session identifiers and lifecycle timestamps. Raw tokens are not stored.
  Hourly cleanup removes at most 500 terminal rows older than one day. The
  rollback verifier reads only this metadata plus current lecture/Admin-session
  state and returns a boolean; it creates no new content or audit copy.
- AI master rows contain lecture/session/actor/action/lifecycle metadata only.
  Event rows are content-free and field-size bounded; Phase 7.28 does not yet
  define physical row-count cleanup, so monitoring and a later retention
  contract are required.
- No API PIN, prompt, PDF text, transcript content, provider response or budget
  reservation is stored merely by authorizing the master scope.
- Students receive no Phase 7.28 Realtime channel and no additional polling.

## 13. Phase 7.29 Presenter metadata

- The teacher computer retains the PowerPoint file, Slide IDs, file path and
  Office state. COMPASS does not upload PPTX/PDF bytes, slide text, speaker
  notes, animations or the local path to Supabase.
- Supabase stores only bounded coordination metadata: lecture/Admin-session
  identifiers, the public Presenter proof key/fingerprint, SHA-256/HMAC digests
  for pairing, request nonce/body receipts, coarse network buckets, PPTX,
  ordered Slide IDs and PDF version, page/slide counts, accepted sequence/page,
  lifecycle timestamps, terminal reason and content-free audit events. The
  non-exportable private proof key remains in the Windows user key store. Raw
  ticket, recovery code and active capability are never stored.
- Browser pairing and loopback session values are memory-only and must not be
  placed in a URL, local/session storage, analytics, crash logs or clipboard by
  the application. The Bridge crash log must omit tokens and document
  names/paths.
- A 200 ms PowerPoint observation loop is local and creates no backend record.
  The Bridge sends only stable changed pages plus a bounded heartbeat. Students
  receive no additional request, field, Realtime subscription or Presenter
  identifier; their existing five-second snapshot is unchanged.
- Terminal Presenter connections and dependent content-free events become
  eligible for bounded, idempotent cleanup after 30 days. Expired rows never
  authorize use while waiting for cleanup. A future retention change must keep
  FK order and audit/privacy requirements explicit.

## 14. Phase 7.30A-B2 Admin identity and AI-unlock data

### B1 identity data

The B1 identity foundation stores only the Admin data required for individual
admission, revocation and audit: trusted Auth identifiers, normalized email,
bounded display name, a versioned HMAC of the Google subject, environment role
and status, digest-only invitation/nonce/session material and bounded
content-free events. Supabase Auth separately remains the trusted store for the
linked provider identity. Normalized email remains personal data even though it
is used only for admission; it must never be exposed to Student, Display,
archive or public browser paths.

The separate Admin browser client may persist the Supabase Auth session needed
for PKCE refresh, but strips Google provider tokens before SDK persistence or
cross-tab broadcast. TOTP enrollment secret/QR and challenge codes are
memory-only and cleared after the flow. The application Admin token is opaque
and held only in `sessionStorage`; only its digest is stored in Postgres.

This source/local Gate does not establish a Hosted retention or deletion
schedule for real Google accounts. Hosted placement, privacy notice, operator
export/deletion procedure and real-account retention evidence remain a later
Hosted/Human Gate and must not be inferred from local fixtures.

### B2 AI-unlock database data

B2 stores no raw four-digit AI PIN. The database receives only a versioned
64-hex HMAC from the later trusted Edge boundary and stores its bcrypt cost-12
verifier, pepper version and factor lifecycle metadata. Attempt/discovery
receipts and rate rows contain request, actor, session, factor, bucket, count,
expiry and generic result metadata; they contain no PIN, raw IP, Auth token,
prompt, lecture body or provider response.

Remembered-browser tables store a public ES256/P-256 JWK, RFC 7638 fingerprint,
opaque credential digest and digest-only nonce/challenge state bound to
identity, Admin session, factor, Origin, lecture, scope, policy and expiry. They
store neither the browser private key nor raw signature proof. B2.2b creates the
non-extractable private `CryptoKey` only in identity-scoped IndexedDB and sends
only a bounded signature to the dedicated Edge verifier. Pending enrollment
stores an opaque nonce and request IDs for at most the server five-minute
window; it stores no PIN. Other teachers' same-origin records are hidden rather
than treated as current identity authority.

TOTP factor-transition recovery stores a random raw recovery credential only in
Auth-user/Auth-session-scoped IndexedDB and only for the bounded transition
window. Postgres stores its SHA-256 hash plus content-free request, action,
factor, pre/post set and expiry metadata. The window is at most 30 minutes and
never exceeds the application/Auth eight-hour cap. TOTP code, secret and QR
material are not persisted in that recovery record.

C1 adds only content-free private ownership and AI-master evidence. Ownership
is represented by an optional row; migration does not infer or backfill one for
an existing lecture. Admission receipts bind request, Admin/Auth session,
lecture, scope, policy/version, factor/version and a PIN-attempt or browser-
challenge identifier. Control receipts bind downgrade/revoke requests and the
recorded master result. They contain no raw PIN, TOTP, browser private key,
lecture code, prompt, provider response or recovery credential. The raw lecture
code remains transient input to the established code/hash verifier.

B2 cleanup is bounded and retention-cutoff-driven. Expired or superseded child
state remains non-authorizing while awaiting deletion. The Hosted retention
schedule, privacy notice, operator export/deletion procedure and real-account
evidence remain unproven.

### Approved Phase 7.30 Production boundary

- MFA uses only Supabase Authenticator App TOTP, compatible with Google
  Authenticator, and configures no email MFA or custom MFA path. Supabase Auth
  exclusively manages persistent factor material. COMPASS application tables,
  application logs and browser persistence store no TOTP secret, enrollment QR
  or challenge code. During enrollment, the Supabase Auth client receives the
  secret/QR only ephemerally for display, scan and verification; the UI clears
  it on completion or cancellation and never sends it to COMPASS logs,
  analytics or application storage.
- The Admin application session has no idle timeout or periodic TOTP prompt. Its
  cap is `auth.sessions.created_at + 8 hours`; logout, backing-session removal,
  principal/environment/membership invalidation, verified TOTP factor-set
  change or that cap requires login again. Role changes are applied live;
  `can_use_ai=false` drains AI authority without deleting the Admin session.
- B2.2a authorizes a dormant Google Admin session only when the principal's
  approved factor-set hash/version/count, the live verified set, the immutable
  session binding and completed post-challenge JWT/AMR nonce evidence agree.
  Migration infers neither an approval nor a session hash. First-factor approval
  is atomic only for an unbound `pending_mfa` 0-to-1 completion; existing sets
  require the Edge-unwired, default-OFF operator-adoption HOLD.
- B2.2b changes an approved factor set only after a fresh existing-set control
  proof binds the exact pre-set, target and expected post-set. Finalize advances
  the anchor and drains old authority only when the live post-set matches.
  Remove-to-zero is rejected. The transition path is default OFF and its Local
  Edge, Hosted and Human evidence remains HOLD.
- C1 creates ownership only for a lecture created in the same verified Admin
  transaction and atomically exchanges one PIN/browser proof for a dormant
  full-provenance master plus immutable receipt. Exact replay/status/free
  downgrade/revoke remain available gate-OFF. Existing lectures and masters
  receive no inferred ownership or receipt, and child/provider authority is
  fenced until C2.
- A five-minute TOTP step-up record exists only for rare owner/principal,
  role/status, verified TOTP-factor-set, environment AI-policy, global-revoke
  and AI PIN factor enrollment/rotation/revoke/reset control-plane actions. It is
  content-free and never contains a TOTP code. Initial PIN enrollment after
  login uses the already-fresh login timestamp without another prompt; normal
  PIN verification and lecture AI operations do not require freshness.
- The personal AI PIN remains transient in the trusted form and bounded TLS
  request. Its verifier, factor version and content-free lifecycle metadata may
  be stored server-side. Rotation/revocation drains AI master, browser and
  pending-child authority while preserving the Admin session.
- `ADMIN_PIN` is removed after the Phase 7.30C authorization migration;
  `BILLING_PIN` and its compatibility RPC are removed after personal-AI-PIN E2E.
  Both removals occur before Production. Revoked historical session rows may
  remain only for foreign-key and audit integrity. Rollback restores no shared
  secret and uses a Google-only immutable revision plus operator owner recovery.
