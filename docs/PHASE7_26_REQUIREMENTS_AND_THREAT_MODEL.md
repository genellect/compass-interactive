# Phase 7.26 browser PDF publication requirements and threat model

Date: 2026-07-21
Status: local implementation gate
Production default: OFF

## Objective

An authenticated teacher can validate and publish a PDF from the Admin page
without starting a CLI or entering a Publisher pairing code. PDF bytes must go
directly from the browser to the Cloudflare asset Worker and private R2. They
must never transit Supabase. Local Publisher remains available only as an
explicit compatibility and recovery path.

## Mandatory requirements

| ID | Requirement | Enforcement |
| --- | --- | --- |
| P726-01 | The primary Admin flow is one browser CTA. | Browser validation, upload authorization, R2 upload, manifest commit, metadata registration and display activation are orchestrated by one frontend action. |
| P726-02 | No permanent R2 credential is exposed to the browser. | Supabase Edge signs a lecture/document/job-bound, short-lived upload ticket. R2 remains reachable only through its Worker binding. |
| P726-03 | PDF bytes never enter Supabase. | Edge accepts bounded JSON metadata and receipts only. The Worker receives the PDF stream directly. |
| P726-04 | Browser validation is not a trust boundary. | Worker independently verifies the signed ticket, exact Origin, request Content-Type, actual PDF magic, actual byte count, R2-native SHA-256, job/document/lecture binding, expiry and immutable object key. |
| P726-05 | A ticket has one effect. | A random server-issued nonce is bound into the signed ticket. Before reading the request body, the Worker calls a machine-to-machine coordinator that atomically consumes the nonce in Postgres. Private R2 ledger changes then use ETag CAS. An exact completed retry may return the already-created result but may not create a second mutation. |
| P726-06 | Uploads are immutable. | Object keys are derived as `pdf/{lecture}/{document}/{sha256}/{publication}.pdf`; first write uses `If-None-Match:*`. An existing object is accepted only for the same consumed attempt after size, magic and native SHA-256 are reverified. |
| P726-07 | Uncommitted bytes are not student-readable. | Student manifest and asset routes resolve only documents in the committed manifest. A job marker or object key alone never grants read access. |
| P726-08 | The lifecycle is explicit and recoverable. | Jobs progress `pending -> uploaded -> committed -> active`; terminal states are `aborted`, `expired` and `retired`. Each transition is idempotent and identity-bound. |
| P726-09 | Lecture lifecycle is authoritative. | Initiate, receipt acceptance, commit registration and activation recheck server-side lecture state. Closed/expired/unrelated lectures are rejected. |
| P726-10 | Browser PDF parsing remains bounded. | A dedicated Web Worker rejects non-PDF MIME/name/magic, more than 15 MiB, more than 75 pages, more than 20,000 normalized text characters, encrypted/corrupt/textless PDFs; it performs no rendering, OCR or image analysis. |
| P726-11 | Extracted text is ephemeral. | Text may exist in the validation Worker and an in-memory Admin cache. It is not stored in localStorage, sessionStorage, IndexedDB, R2 or Supabase. After reload it is re-extracted from an authorized R2 download when an explicit AI action needs it. |
| P726-12 | Worker CPU stays compatible with the Free plan. | No PDF parser is imported by the asset Worker. Upload processing uses constant-size claim parsing, the first five bytes, stream byte accounting, conditional R2 writes and R2-native checksum validation. Production activation requires CPU metrics from a 15 MiB canary. |
| P726-13 | Local Publisher remains safe and usable. | Existing loopback Origin/Host/session controls and R2 credential isolation are retained. Its controls move under a clearly labeled recovery section and are not required by the primary flow. |
| P726-14 | Rollback is immediate and non-destructive. | Frontend, Edge and Worker flags default OFF. Disabling browser publication restores Local Publisher without dropping tables, objects or compatible manifests. |

## Trust boundaries

- Browser/Admin UI: untrusted for authorization, metadata truth and upload
  integrity; trusted only to provide user intent and perform an early UX check.
- Supabase Edge: verifies the tracked Admin session and delegates every durable
  transition to service-role-only, server-time database RPCs. It never accepts
  PDF bytes.
- Postgres: canonical job state, actor, lecture state, idempotency key, expected
  metadata, nonce digest and audit timestamps.
- Cloudflare Worker: canonical byte-level upload gate and manifest committer.
- Private R2: immutable PDF bytes, manifest and private short-lived job markers.
- Local Publisher: compatibility/recovery only; its R2 key remains outside the
  browser and repository.

## Threats and controls

| Threat | Required control | Failure result |
| --- | --- | --- |
| Replayed upload ticket | DB atomically consumes the nonce digest before body ingestion; the private ledger identity and R2 ETag CAS fence later transitions. | Same completed attempt is recoverable; another attempt or altered binding is `409/403`. |
| Concurrent first upload | Exactly one service-role RPC can claim `pending` with the signed generation, nonce, JTI, Admin session and full binding. | Losing request does not read or store its body. |
| Hostile website targets local/account Worker | Exact Origin allowlist and ticket `origin` claim; CORS is not treated as authorization. | `403` before the body is read. |
| Tampered lecture/document/path | Worker derives object key and compares every path field with signed claims. | `403`; no R2 write. |
| Lying Content-Length | Signed expected size, header equality, streaming cap and returned R2 object size are all compared. | Upload aborts; no committed manifest. |
| Non-PDF payload | Actual first five bytes must be `%PDF-`. | `415/400` before object commit. |
| Hash mismatch | R2 `put` receives the signed SHA-256 checksum; returned object metadata and size are verified. | R2 rejects or Worker deletes/abandons the attempt. |
| Overwrite of an existing document | Publication-scoped content-addressed key plus conditional put; an exact completed-attempt retry is read-only recovery. | Conflicting object is rejected. |
| Upload succeeds, browser/Edge crashes | The Worker records the verified upload through its private coordinator; Admin recovery asks Edge to inspect the bound ledger and reconciles DB state. | No second upload; state remains recoverable until recovery expiry. |
| Manifest commit conflicts | The Worker first stages a hidden document at the current access version, then activates it only at a future access version using bounded CAS. | Previous active document remains intact until the future version is published by DB. |
| Lecture closes mid-flight | Every DB transition rechecks canonical server state. A post-upload rejection leaves an unreferenced object for cleanup; rollback removes any hidden stage. | No DB activation or live-state update. |
| Orphan object/marker | Marker is written before body storage; scheduled cleanup deletes expired unreferenced objects and markers. | Active manifest references are checked before deletion. |
| Worker CPU exhaustion | No server PDF parsing; request body remains streamed; bounded metadata and retry loops. | Feature stays OFF if 15 MiB canary exceeds the Free CPU envelope. |
| Prompt injection in PDF | Extraction is data only, existing Phase 5/6 source delimiters and no-tools/store-false rules remain. | No new provider privilege is introduced. |

## Cloudflare constraints used by the design

The 2026-07-21 review used the official Cloudflare Workers limits, R2 Worker
API and R2 consistency documentation. Workers Free allows 10 ms CPU per HTTP
request and 128 MB memory. R2 provides strong read-after-write consistency,
conditional puts and native SHA-256 checking. The design therefore does not
perform page parsing, full-buffer hashing or OCR in the Cloudflare Worker.

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/r2/reference/consistency/

## Local gate

The phase cannot pass unless all of the following pass:

- clean reset and Phase 6.8 through 7.26 upgrade migration paths;
- pgTAP ownership, RLS, GRANT, server time, replay, concurrency, transition,
  lecture-close and idempotent-recovery cases;
- Worker tests for wrong Origin/ticket/path/size/magic/hash, concurrent replay,
  immutable deduplication, manifest conflict and orphan cleanup;
- browser validation tests for all PDF limits and no image/OCR path;
- Chromium and WebKit E2E for primary publication and recovery UI;
- Phase 6.6 visual/interaction regression and all Phase 6.8-7.25 regressions;
- typecheck, lint, production build, dependency/secret checks and
  `git diff --check`;
- modeled 20/300-person load with zero student upload-path calls;
- human local visual confirmation.

Hosted activation additionally requires a valid 15 MiB R2 canary, Worker CPU
and error metrics, two-Admin replay/concurrency tests and confirmed rollback.
