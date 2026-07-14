# Phase 3 requirements audit and threat model

Date: 2026-07-14 (JST)

Scope: local implementation and local validation only

Production state: unchanged; Phase 1, Phase 2 and Phase 3 client flags remain
OFF

## Audit basis

This audit was completed before Phase 3 code changes. It is based on the actual
repository rather than `PROJECT_GUIDE.md` alone. Reviewed surfaces include:

- the Milestone 4 PDF migration, pgTAP and static tests;
- `lecture_live_state`, Phase 1 split snapshots and Phase 2 archive payloads;
- Admin display controls and `update-display-state`;
- the browser and Edge copies of the fixed PDF catalog;
- `SyncedPdfViewer`, PDF.js rendering and presenter-follow behavior;
- Phase 0 participant ownership, Phase 2 deadline enforcement and Admin token;
- package, secret, Cloudflare Pages and local environment boundaries.

Status meanings:

- **Implemented**: the current pre-Phase-3 repository meets the end-to-end
  requirement.
- **Partial**: a reusable component exists but the security or delivery contract
  is incomplete.
- **Missing**: no current implementation provides the required guarantee.

## Requirement-to-implementation matrix

| ID    | Requirement                                                                                                                      | Pre-Phase-3 status | Repository evidence                                                                                                                                                                  | Phase 3 local implementation target                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | Loopback-only Publisher with pairing, Origin/Host allowlist and no browser Cloudflare secret                                     | **Missing**        | No `publisher/` service exists. The Admin page cannot discover or pair with a local service.                                                                                         | Bind only `127.0.0.1`; validate `Host`, `Origin`, method and content type before reading a body; exchange a one-time pairing code for an in-memory short session; never return or persist R2 credentials.                                                                                                   |
| P3-02 | Authoritative PDF validation: magic, MIME/name, 15 MB, 75 pages, encryption/corruption, text layer, 20,000 characters and hashes | **Partial**        | PDF.js renders two committed static assets, but no upload path or authoritative validator exists. Page count is trusted from duplicate catalogs.                                     | Add a Publisher validator using PDF.js text extraction only. Do not render pages or OCR. Reject encrypted, corrupt, textless and aggregate-limit failures before any object write.                                                                                                                          |
| P3-03 | Page-preserving local text extraction with deterministic IDs and local retention                                                 | **Missing**        | The browser renders pages but does not extract or retain text.                                                                                                                       | Normalize embedded text page by page, hash PDF/text/excerpts, save only to the Publisher data directory with restrictive modes, and provide idempotent expiry cleanup. Never upload raw text.                                                                                                               |
| P3-04 | Immutable R2 publish, upload verification, manifest CAS and failure-safe current material                                        | **Missing**        | PDFs are bundled into the main Pages build.                                                                                                                                          | Use SHA-256 object keys, verify HEAD size/hash metadata, update the manifest with `If-Match`/`If-None-Match`, serialize by lecture and reuse duplicate hashes. A manifest conflict or later failure leaves the old manifest/live state unchanged and records an orphan candidate locally.                   |
| P3-05 | Versioned private manifest                                                                                                       | **Missing**        | `src/pdf/lectureAssets.ts` and Edge `_shared/pdfAssets.ts` are fixed build-time catalogs.                                                                                            | Add schema-validated manifest version 1 with lecture public ID, monotonic version, immutable document version, limits, download permission, access expiry and delete-after metadata. Store it only in private object storage.                                                                               |
| P3-06 | Worker-local authorization, lecture/document binding, short access, download checks and no Supabase read per PDF                 | **Missing**        | Pages serves static PDFs without a lecture token.                                                                                                                                    | Verify a short ES256 lecture JWT locally with a public key, validate manifest scope and expiry, then mint a five-minute HMAC asset ticket. Stream from a private R2 binding with Range/ETag support. Do not log credentials or call Supabase.                                                               |
| P3-07 | Reload discovers new material without main app deploy and handles URL expiry/retry                                               | **Partial**        | Reload resolves only a build-time catalog. PDF.js already handles remote URLs and retryable load failure at component level.                                                         | Resolve manifest/ticket at runtime only when document/manifest version changes; refresh an expired ticket once; expose retry and protected download actions; use `no-store` for manifests/tickets and immutable caching for hash-addressed PDF bytes.                                                       |
| P3-08 | Extend lightweight page sync with document/manifest/page/visibility metadata and avoid no-op writes                              | **Partial**        | `pdf_document_id`, `current_pdf_page`, `display_mode` and `pdf_version` already use the five-second snapshot; repeated state is a no-op. Page bounds rely on the fixed Edge catalog. | Add document version, manifest version, authoritative page count and visibility. Register published metadata through a service-only RPC, validate every selection/page change in PostgreSQL, and keep old RPC signatures for compatibility.                                                                 |
| P3-09 | Migrate fixed catalogs without breaking old clients                                                                              | **Partial**        | Browser and Edge catalogs contain the same two IDs; adding a PDF requires a Pages deploy.                                                                                            | Keep the legacy catalog as flag-OFF fallback, add runtime resolver behind `VITE_PHASE3_PRIVATE_PDF=false`, and backfill selected legacy metadata without deleting old RPCs/assets.                                                                                                                          |
| P3-10 | Student access ends at day 30; recoverable day-37 deletion process                                                               | **Partial**        | Phase 2 computes canonical `archive_expires_at` and logical archive but does not manage R2.                                                                                          | Worker rejects at exact access expiry. Add an idempotent scheduled cleanup implementation that records a durable cleanup intent, removes due manifest entries with CAS, then deletes only unreferenced objects after day 37. Local tests use fake R2/time; no production Cron or lifecycle rule is created. |

## Current data and request boundary

| Flow                       | Current pre-Phase-3 behavior                         | Required boundary                                                              |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| PDF upload                 | None; assets are committed and deployed with the app | Browser to `127.0.0.1` Publisher only; never Supabase or the main Pages deploy |
| PDF bytes at rest          | Public Pages artifact/history                        | Private R2 object with SHA-256 immutable key                                   |
| Page synchronization       | Small Supabase snapshot field                        | Retain; add only bounded metadata and update on actual changes                 |
| Student PDF fetch          | Public static path                                   | Private Worker/R2 path authorized without a Supabase round trip                |
| PDF text                   | Not extracted                                        | Local Publisher data only; never Supabase, R2, Pages or Worker manifest        |
| R2 credentials             | Not present                                          | Publisher process secret only; never Vite, response payload, manifest or Git   |
| Lecture access signing key | Not present                                          | Private key in Supabase Edge secret; public verification JWK in Worker config  |
| Asset ticket key           | Not present                                          | Worker secret only; five-minute bearer ticket                                  |

## Threat model

| Threat                                                   | Primary control                                                                                                                                                                        | Failure behavior                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DNS rebinding or hostile page reaches Publisher          | Listen on `127.0.0.1`; exact Host and Origin allowlists; reject before body read                                                                                                       | 403, no upload or secret access                                                                                                                        |
| Cross-site request with a stolen/guessed pairing code    | One-time code, short expiry, constant-time comparison and per-process invalidation                                                                                                     | Code becomes unusable after first success or expiry                                                                                                    |
| Session token replay                                     | In-memory random token, short expiry, Origin binding and constant-time comparison                                                                                                      | 401; restart revokes every session                                                                                                                     |
| Oversized upload exhausts memory                         | Validate `Content-Length`, stream with a hard byte ceiling, abort before parsing                                                                                                       | 413; no R2 write                                                                                                                                       |
| MIME spoofing or renamed file                            | Require filename `.pdf`, `application/pdf` and `%PDF-` magic together                                                                                                                  | 415/422; no R2 write                                                                                                                                   |
| Encrypted/corrupt/image-only PDF                         | PDF.js parse/text-only extraction; no password prompt, rendering or OCR                                                                                                                | 422 with a specific Admin-safe reason                                                                                                                  |
| Path traversal or key injection                          | Strict lecture/document/version regex; internally constructed object keys only                                                                                                         | 400/404; no arbitrary object access                                                                                                                    |
| Duplicate upload                                         | Content hash object key and per-lecture serialization                                                                                                                                  | Reuse verified object; create at most one new manifest version                                                                                         |
| Concurrent manifest update                               | Conditional R2 write against observed ETag                                                                                                                                             | 409; current manifest remains authoritative                                                                                                            |
| Upload succeeds but manifest fails                       | Object is not reachable because manifest is unchanged                                                                                                                                  | Record local orphan candidate for later safe cleanup                                                                                                   |
| Manifest succeeds but Supabase metadata fails            | Document is published but not selectable/live                                                                                                                                          | Admin can retry idempotent metadata registration; current live PDF stays unchanged                                                                     |
| Lecture A token requests lecture B                       | JWT lecture public ID must match path and manifest                                                                                                                                     | 403 without manifest/body disclosure                                                                                                                   |
| Token is expired, malformed or has wrong issuer/audience | ES256 verification plus `exp`, `nbf`, `iss`, `aud` checks                                                                                                                              | 401; no R2 read                                                                                                                                        |
| Asset URL leaks                                          | Ticket is document/version/mode scoped and expires in five minutes                                                                                                                     | Bearer access ends automatically; URL query is never application-logged                                                                                |
| Download attempted when disabled                         | Ticket mint and object read both enforce manifest permission/mode                                                                                                                      | 403                                                                                                                                                    |
| Student access after 30 days                             | Manifest `access_expires_at` checked against Worker time                                                                                                                               | 410 at exact boundary, even if cleanup is delayed                                                                                                      |
| Cleanup retries or partial failure                       | Durable cleanup intent, manifest CAS first, then object deletion and idempotent audit; pending intents are replayed only after confirming the manifest no longer references the object | CAS conflict leaves the object intact; interruption after CAS leaves a recoverable unreachable object, never a live manifest pointing at missing bytes |
| Service/Cloudflare outage                                | Existing selected metadata and previous manifest remain unchanged                                                                                                                      | Comments, Polls and existing Phase 1 sync continue; Admin receives retry guidance                                                                      |

## Fixed implementation decisions

1. Private R2 is accessed through a Worker binding for reads. Five-minute
   Worker tickets are used instead of exposing R2 API presigned URLs because
   direct presigned URLs are bearer credentials tied to the S3 API hostname and
   do not provide the manifest-aware custom authorization boundary.
2. Publisher writes use the R2 S3-compatible API with bucket-scoped Object Read
   & Write credentials. The code accepts credentials only from the Publisher
   process environment/secret provider, never a browser request or committed
   file.
3. Supabase stores metadata only. The Publisher upload body and PDF response body
   must never enter Supabase Storage, Edge Functions, RPCs or database columns.
4. `archive_expires_at` from the canonical Phase 2 close is the student access
   deadline. `delete_after` is seven days later. Draft/open manifests may have no
   final access deadline; the scheduled Worker obtains a secret-authenticated,
   metadata-only Edge retention feed and reconciles exact close timestamps with
   manifest CAS before cleanup.
5. Phase 3 remains expand-first and default OFF. Legacy static IDs and old RPC
   signatures remain available while the flag is OFF.

## Local-only limitations requiring the production gate

- No R2 bucket, Worker route, Worker secret, Supabase Edge secret, R2 lifecycle
  rule or Cron Trigger is created in Phase 3 local implementation.
- Local Worker tests use a fake private bucket and generated test keys. Hosted
  Range/CORS/cache behavior must be canary-tested after deployment.
- Windows Credential Manager integration is an operational launcher concern;
  the Publisher refuses credentials in files and documents the required
  injection contract, but Phase 3 does not create a persistent machine secret.
- Cloudflare object deletion is exercised against fake R2 only. Production
  deletion requires an inventory/dry-run and explicit authorization.
