# COMPASS Interactive Data Policy

Last reviewed: 2026-07-18

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
- plaintext Admin PIN, API-use PIN or lecture-code hash material in client data;
- OpenAI, Supabase service-role, R2, Turnstile or email-provider secrets in the
  browser.

Students must be told not to put personal or patient-identifying information in
comments or nicknames. Moderation and deletion procedures must handle accidental
disclosure.

## 4. Local teacher-machine data

The local Publisher may hold:

- the source PDF while it is being validated and published;
- extracted text within the configured size/page/character limits;
- the teacher review script or transcript text;
- bucket-scoped R2 Publisher credentials in an ignored local environment file.

COMPASS does not intentionally store microphone audio. Local transcript and
extracted text are operator-controlled working data and require a documented
retention/cleanup routine. They must not be copied into Git, browser storage,
Supabase or public R2 objects.

## 5. Cloudflare R2 and Worker data

Private R2 may store:

- immutable lecture PDF objects;
- versioned manifests;
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
- later, verified literature metadata and bounded evidence for an approved
  academic-reference workflow.

Before sending, the application applies feature-specific limits, lecture state,
budget and concurrency admission. Image OCR is outside the design. Low-value or
unsupported output is not forced into the student UI.

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
optimistic UX. Current archive tokens remain memory-only where implemented.
Lecture codes or local participant hints must not be treated as authorization.

Phase 6.8 will introduce a short-lived high-entropy resume token. That token
must never be placed in a URL, analytics event, console log or long-term profile.

## 9. Retention lifecycle

- Live write access ends when the lecture closes or reaches its server deadline.
- Closed lecture content may remain available as a read-only preview for 30
  days from the canonical close/archive timestamp.
- Access fails closed at expiry even if cleanup has not run.
- Physical object deletion may use a short recovery buffer after access expiry.
- Database/archive cleanup and Publisher-local cleanup are separate idempotent
  operations.
- Future export/deletion evidence records counts, timestamps and hashes rather
  than retaining deleted private content.

Exact retention values and exceptions must be represented in the lifecycle and
archive configuration, not only in prose.

## 10. Access and ownership

- Anonymous Auth still receives the PostgreSQL `authenticated` role; RLS must
  additionally verify participant ownership.
- Students cannot list participant records or raw Poll responses.
- Display credentials have a narrower scope than Admin credentials.
- Admin access does not grant paid API use; the API-use PIN is separate.
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
