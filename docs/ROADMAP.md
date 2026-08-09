# COMPASS Interactive Roadmap and Stop-the-Line Gates

Approved design baseline: 2026-07-18
Scope: Phase 6.7 through Phase 9
Last reconciled: 2026-08-09
Future-contract approval: Phase 7.30-7.33 requirements approved; implementation
and their Hosted/Human gates have not started

## 1. Numbering decision

Existing Phase 0-6.6 implementation and historical Phase 7-9 reservations are
preserved. Decimal phases separate risk domains without rewriting history.

| Order | Phase                      | Priority | Outcome                                              |
| ----: | -------------------------- | -------- | ---------------------------------------------------- |
|     1 | C0                         | Highest  | GitHub/Cloud canonicalization                        |
|     2 | 6.7                        | Highest  | Documentation and release baseline                   |
|     3 | 6.8                        | High     | PIN/session/CSP/resume/timeout security foundation   |
|     4 | 6.9                        | High     | Modularization and deterministic CI quality          |
|     5 | 7.1                        | Medium   | Summary language, own comments and lecture QR        |
|     6 | 7.2                        | Medium   | Verified-primary-literature reference answers        |
|     7 | 7.25                       | Medium   | Multidisciplinary automatic academic answers         |
|     8 | 7.26                       | High     | Browser-complete private PDF publication             |
|     9 | 7.27                       | High     | Thin Journal Club operational preset                 |
|    10 | 7.28                       | High     | Operational cleanup, Display Realtime, AI activation |
|    11 | 7.29A/B                    | High     | PPT rescue and dormant hosted placement              |
|    12 | 7.29C                      | High     | Signed Presenter activation                          |
|    13 | 7.30A-F                    | Highest  | Google Admin identity, MFA, RBAC and migration       |
|    14 | 7.31A                      | Highest  | GitHub protection and supply-chain governance        |
|    15 | 7.31B                      | Highest  | Public-source history, rights and privacy readiness  |
|    16 | 7.31C                      | Highest  | Isolated real contest-review environment             |
|    17 | 7.32                       | Highest  | Commercial multi-tenant EdTech readiness             |
|    18 | Phase 7.33 Production Gate | Final    | Unified public, contest and commercial certification |
|    19 | Phase 8                    | Low      | Export/deletion evidence and unified AI review       |
|    20 | 8.1                        | Low      | Explicit Terra advanced analysis                     |
|    21 | 8.2                        | Low      | User-selected chronological/attention ranking        |
|    22 | Phase 9                    | Final    | Long-run, human and operations certification         |

The old Phase 7 scope is split because deterministic literature verification
must be proven before a more expensive model can be offered. The old Phase 8
ZIP/deletion evidence and old Phase 9 long-run/operations goals remain intact.

## 2. Cross-phase invariants

Every future phase must preserve all of the following.

### Security and ownership

- `auth.uid()` participant ownership is authoritative.
- Role membership alone never authorizes a row or action.
- New exposed tables receive RLS, explicit grants and two-user/two-lecture tests.
- Public RPCs remain invoker-security by default.
- Service role, provider API keys and delivery secrets never enter a public
  client. A user-entered four-digit AI PIN may exist only transiently in the
  trusted Admin form and its TLS request; the server keeps only a slow verifier
  protected by a server-only pepper, and the raw value is never bundled,
  persisted or logged. Browser remembering uses a non-extractable
  browser-profile key and revocable server credential, never the PIN; hardware
  binding is not claimed before WebAuthn. The legacy `BILLING_PIN` follows the
  same no-persistence rule until retirement.
- Privileged Admin mutations require a verified internal principal bound to
  `auth.uid()` and an AAL2 session after the Google migration; email or role
  strings alone never authorize a row.

### Lifecycle

- Server time and the shared idempotent close transition remain authoritative.
- Closed/expired lectures reject writes, Poll answers, snapshot mutation and new
  paid starts.
- Clients stop live work when terminal state is observed.
- Archive access is read-only and retention-expiring unless an exact,
  server-derived and separately reviewed permanent policy is documented.

### Supabase load and data boundary

- No PDF/audio/full transcript bytes in Supabase.
- No new student Realtime subscription.
- New periodic information is folded into the existing versioned snapshot.
- User-specific history/preferences are on-demand or local-only.
- Demo remains hosted-service independent.

### API cost

- Paid AI activation requires a valid AAL2 Admin session, active `can_use_ai`,
  an owner-managed policy, an explicit teacher action and one personal AI-unlock
  proof: a rate-limited four-digit AI PIN, a purpose-bound AI Passkey or a
  revocable remembered-browser assertion. The first implementation is TOTP plus
  the four-digit factor; AI Passkey follows its separate WebAuthn gate.
- The unlock creates or updates the existing lecture master authorization for
  exactly `all_except_captions` or `all_including_captions` until lecture close,
  90-minute hard stop, explicit free stop or a security revoke of the session,
  principal or entitlement. Creating it does not itself call a provider. Budget
  exhaustion blocks child calls with a clear status but does not silently clear
  the lecture's activated scope.
- Stop remains free and easy.
- Luna is the default runtime model where it meets the quality gate.
- Terra is never an automatic fallback.
- Lecture budget, call limit, concurrency and idempotency are verified before
  provider traffic.
- Realtime transcription is never started by another AI feature.
- A master-authorized child start never asks for the AI PIN again but still
  receives a fresh single-use internal grant after all server checks.
- Escalating from `all_except_captions` to `all_including_captions` requires a
  fresh AI-unlock proof and server-recorded recent TOTP step-up; same-scope retry
  is idempotent and downgrade/stop are free and factorless.
- `BILLING_PIN` is removed from the normal Google/AAL2 path and retained only as
  a default-OFF, owner-only, audited and time-bounded migration rollback. It is
  deleted after the rollback deadline.

### Compatibility

- Expand-first migration and default-OFF flags.
- Old RPC/client compatibility until the contract-removal gate.
- Clean database and previous-Phase upgrade verification.
- Rollback by flag/version before any destructive schema action.

### UX

- Student mobile order remains PDF-first and semantic.
- Captions render only when fresh/active.
- Main comments remain bounded; history is separate and on-demand.
- Low-value AI panels are absent rather than empty/noisy.
- Teacher controls use educational language rather than infrastructure terms.

## 3. Global gate G0-G7

No phase may progress, deploy or enable a flag until every applicable gate is
PASS. An automated or human test that has not run is `BLOCKED`, not `PASS`.

Before G0, every task must pass the C0 source-admission contract in
[`CLOUD_CANONICALIZATION_GATE.md`](CLOUD_CANONICALIZATION_GATE.md). C0 records
the exact GitHub base, green CI evidence, branch/workspace isolation and
external-effect boundary. A local-only commit is recovery input, not a base.

### G0 Requirements traceability

- Each requirement maps to implementation, tests, evidence and rollback.
- Implemented/partial/missing classification is checked against real code,
  migrations, configuration and UI.
- No unresolved ambiguity may expand permissions, cost or data deletion.

### G1 Database and authorization

- Clean migration PASS.
- Previous-Phase upgrade and data-preservation PASS.
- All pgTAP/SQL regression PASS.
- RLS, grants, function security and Advisor/DB lint PASS.
- Teacher/student/other participant/other lecture separation PASS.
- Critical or High DB/security finding count: zero.

### G2 Code and artifact quality

- Application, Publisher, Worker and E2E typecheck PASS.
- Lint, applicable unit/static tests, production build and `git diff --check`
  PASS.
- Secret/local-path/generated-artifact scan PASS.
- Unrelated user changes remain untouched.

### G3 UX/UI and accessibility

- Student mobile/desktop, Admin, Display, Demo and Archive reviewed separately.
- Loading, empty, timeout, retry, unauthorized, closed and restored states work.
- No horizontal overflow at 390 px.
- Keyboard/focus behavior PASS.
- Phase 6.9以降はautomated accessibilityのCritical/Serious findingsがゼロ。
  Phase 6.7/6.8は既存UI契約に差分がないことと現行E2Eを確認し、UI変更が
  生じる場合はPhase 6.9を先行させる。
- Human review of the phase's main learning/teacher flow: PASS.

### G4 Browser E2E and visual regression

- Phase 6.9以降はChromium and WebKit main flows PASS。Phase 6.7/6.8は現行
  Chromium E2Eを必須とし、WebKit基盤導入前にbrowser-specific UI変更を
  行わない。
- Demo external network request count: zero.
- Phase 6.9以降はapproved deterministic visual baselines PASS。それ以前は
  既存画面のDOM/CSS差分ゼロを確認する。
- Same commit passes three consecutive clean runs without retry-dependent tests.

### G5 Load and cost

- No additional per-student periodic request or Realtime subscription unless an
  explicitly approved replacement reduces overall load.
- 20/300 models preserve the request envelope and query plan.
- Snapshot p95 does not regress more than 10 percent from the previous baseline.
- Duplicate paid operations: zero.
- Budget/state/concurrency rejection: 100 percent.

### G6 Compatibility and recovery

- Feature OFF preserves old behavior.
- Idempotent retry and partial-failure recovery PASS.
- Frontend/Edge/Worker rollback is rehearsed.
- Database rollback avoids data-destroying drops.

### G7 Evidence and release control

- Independent phase commit and local gate report.
- Required hosted and human evidence is attached.
- Known issues include owner, severity and deadline; Critical/High count is zero.
- Push, migration, deploy and flag activation require separate authorization.

## 4. Phase 6.7 - documentation and release baseline

### Tasks

- Replace Phase 0-only README with current product, setup, security and route
  entrypoint.
- Establish current architecture, security, data, database, roadmap, changelog
  and runbook-index documents.
- Classify old Phase reports as historical evidence rather than current status.
- Record Phase 0-6.6 trajectory and the exact future phase ordering.
- Add a CI-safe documentation consistency test.
- Move the package from placeholder `0.0.0` to development preview `0.7.0`.

### Acceptance

- Fresh-clone operator can find setup, tests, secret boundaries and runbooks
  from README.
- README routes/scripts/flags/relative links match the repository.
- No contradictory Phase 0-only current-state statement remains in canonical
  documents.
- No behavior, database or hosted-environment change.
- All existing automated regressions pass.
- Global G0-G7 PASS for the documentation scope.

## 5. Phase 6.8 - security, sessions and timeout

Repository status: implemented and locally verified on 2026-07-18 with every
new flag default-OFF. Production status remains HOLD until hosted CSP/header
inspection and the required human flow evidence are recorded.

### Tasks

- Add application-level Admin PIN rate limiting using user, trusted network hash
  when available and a coarse global bucket; retain generic errors.
- Introduce server-tracked, hash-at-rest Admin sessions with individual revoke,
  logout revoke, absolute/inactivity expiry and PIN-rotation revoke-all.
- Add CSP report-only, evaluate all routes, then enforce a minimal allowlist.
- Issue a high-entropy lecture-scoped short-lived resume token after successful
  join; prefer it for re-entry and retain code/Turnstile fallback.
- Add end-to-end deadlines for snapshot/admin RPCs, Realtime start/stop and Batch
  provider work; reconcile ambiguous provider outcomes through the ledger.
- Finish bounded JSON/content-type validation for exposed Edge endpoints.

### Acceptance

- Concurrent/rotated-identity PIN attacks cannot bypass limits.
- Individual/all-session revocation, replay, expiry and cross-lecture token
  tests PASS.
- Tokens never enter URL, log or analytics.
- Enforced CSP supports Join, Admin, Display, Archive, PDF, Turnstile and
  Publisher flows.
- Stalled RPC/provider work converges without duplicate charge or infinite UI.
- Student snapshot load is unchanged.
- Global G0-G7 PASS.

## 6. Phase 6.9 - modularization and CI foundation

Repository status: locally implemented and automatically verified on
2026-07-19. Hosted CI, human UX review and any production reflection remain
separate gates; see `PHASE6_9_LOCAL_GATE_2026-07-19.md`.

### Tasks

- Split `AdminPage` into auth, lecture, PDF, Poll, AI and moderation units.
- Split `CompassStateContext` into session/lifecycle, snapshot, comments/Polls
  and archive responsibilities.
- Split large repositories into transport, mapping and error/timeout policy while
  preserving public interfaces.
- Pin Supabase CLI type generation and fail CI on generated-type drift.
- Pin GitHub Actions by immutable SHA and add dependency review, CodeQL, secret
  scanning, vulnerability policy and SBOM.
- Add WebKit, accessibility, keyboard and deterministic visual regression.

### Acceptance

- Characterization E2E proves no route/DOM/request/schema behavior change.
- Bundle/runtime/snapshot p95 remains within the G5 threshold.
- Generated database type diff is zero in CI.
- Critical/High supply-chain vulnerability count is zero or a blocking,
  time-bounded exception is approved.
- Chromium/WebKit/a11y/visual tests pass three consecutive clean runs.
- Global G0-G7 PASS.

## 7. Phase 7.1 - classroom UX extensions

Status: locally implemented on 2026-07-19. Automated local gates are PASS;
real-phone QR decoding and human Admin/student/Display review remain HOLD, so
Phase 7.2 and production enablement are not authorized by this status.

### Summary language

- Add `auto | ja | en`, default `auto`, to teacher-controlled lecture AI
  configuration.
- Manual choice is authoritative; auto uses recent teacher transcript first and
  PDF language second, not student comments alone.
- Record resolved language/reason and apply a change only to future windows.
- Do not create parallel bilingual calls.

### Own comments

- Add `みんな / 自分` to comment history.
- Resolve current participant through `auth.uid()` in an on-demand cursor RPC.
- Do not add periodic polling or a profile/preference row.

### QR

- Generate an SVG locally from the canonical `/join?code=######` URL.
- Show it in Admin and open-lecture Display; hide it after close.
- Do not call an external QR service or store an image in Supabase/R2.

### Acceptance

- Japanese/English/mixed and manual override tests PASS with no extra AI call.
- Two-user own-comment isolation and cursor tests PASS with no periodic load.
- Independent decoder and real-phone camera read the QR; no secret is encoded.
- Mobile/Desktop/Admin/Display/Demo E2E and global G0-G7 PASS.

## 8. Phase 7.2 - evidence-grounded academic reference answers

Status: locally implemented on 2026-07-20. Automated database, security,
quality, cost/load and browser gates are recorded in the Phase 7.2 local gate;
teacher literature review and hosted evidence remain HOLD. Phase 7 production
enablement is not authorized by this status.

### Tasks

- Accept only an academic-question candidate or explicit teacher selection.
- Require teacher CTA, API-use PIN, open lecture, budget and Batch lane.
- Retrieve a small candidate set from trusted primary metadata sources.
- Validate PMID/DOI/title/year/author/study type without trusting model-created
  citations.
- Prefer primary studies; label reviews/editorials as context.
- Store bounded citation metadata and claim-source mapping, not copyrighted PDF
  corpora.
- Use Luna for a single structured draft from verified evidence.
- Emit no answer when evidence is insufficient.
- Reuse immutable revision/publication and require teacher approval.

### Acceptance

- Fabricated/mismatched identifiers are rejected.
- Every material claim maps to verified evidence.
- Source/comment prompt injection does not alter system rules.
- Unapproved/failed/late answers are invisible to students.
- Release evaluation achieves 100 percent identifier validity and at least 95
  percent reviewed claim support.
- Teacher human review and global G0-G7 PASS.

## 9. Phase 7.25 - multidisciplinary automatic academic answers

Status: locally implemented and automated-verified on 2026-07-21. Human teacher
literature review and Hosted/Production evidence remain HOLD.

### Tasks

- Route medical/biological questions to PubMed and other fields to fixed-host
  Crossref/OpenAlex corroboration without trusting model-created identifiers.
- Admit at most three academic-answer provider calls per lecture through the
  existing Batch lane, API-use PIN, lecture-state and budget controls.
- At the five-minute summary boundary, suppress low-value questions and answers
  without a verified primary source; otherwise expose a bounded answer labelled
  as not yet teacher-confirmed.
- Let Admin approve, hide or create a corrected immutable revision without
  mutating the original model output.
- Keep literature metadata, prompt input and response size bounded and add no
  per-student periodic request or Realtime subscription.

### Acceptance

- Identifier/source contradiction, retraction, review-only evidence, prompt
  injection, close-race, budget and concurrency tests PASS.
- Every material claim maps to a verified primary source and unsupported output
  is absent from the student snapshot/archive.
- Phase 6.6 UX and Phase 6.8-7.2 database/browser/load regressions PASS.
- Teacher literature/wording review and global G0-G7 remain blocking human work.

## 10. Phase 7.26 - browser-complete private PDF publication

Status: automated Local Gate PASS on 2026-07-21. The feature remains default
OFF; Human, Hosted and Production gates remain HOLD.

### Tasks

- Replace the primary CLI/pairing flow with one Admin browser CTA while keeping
  Local Publisher as an ordered, mutually exclusive recovery mode.
- Keep PDF bytes outside Supabase. Edge issues a short-lived bound ticket;
  Postgres owns nonce/job state; the Worker independently validates Origin,
  actual bytes, PDF magic, SHA-256, binding, expiry and immutable upload.
- Enforce `pending -> uploaded -> committed -> active` with hidden commit,
  future-version activation, idempotent discovery/finalize and permanent
  terminal fences against delayed requests.
- Bound cleanup linearly by due job, preserve legacy recovery compatibility and
  make same-hash/different-object cleanup intent collision-free.
- Keep Worker PDF parsing/OCR absent and prove the 15 MiB path against the real
  Workers Free CPU/memory envelope before hosted activation.

### Acceptance

- Clean and Phase 7.2 upgrade migrations, all pgTAP, two-connection races,
  Worker/Edge/Publisher tests and Chromium/WebKit flag-ON/OFF E2E PASS.
- No PDF byte/text enters Supabase or browser persistence; uncommitted objects
  are not student-readable and terminal cleanup is restartable.
- Production activation is blocked until Local Publisher is stopped, its R2
  write credential is revoked/isolated, cross-service R2 canaries, two-Admin
  races, WAF/rate protection, cleanup monitoring and human PDF/UI review PASS.

## 11. Phase 7.27 - Journal Club operational integration

Status: automated Local Gate PASS and temporary hosted preview deployed on
2026-07-22. Clean reset, 1,171 pgTAP
checks, 49 Worker tests, 55 non-live groups, upgrade/two-connection concurrency,
real local Edge/Postgres integration and repeated Chromium/WebKit
desktop/mobile E2E are PASS. Expand-first migrations, Edge Functions, Worker and
Pages are staged in hosted services and the preview flags are explicitly ON.
No rehearsal or production run was created. Final operational evidence remains
HOLD for hosted authenticated/R2/device checks and operator UX review.

### Tasks

- Add a thin `7.23 Journal Club` preparation preset without creating a parallel
  lecture lifecycle or changing the existing Admin start/close, Poll, PDF or AI
  contracts.
- Create each rehearsal and the single production run with a fresh lecture UUID,
  fresh six-digit code, fresh PDF binding and six ordered single-choice Polls in
  `draft`; never copy comments, responses, AI output or resume state between runs.
- Bind the approved 34-page PDF to its exact document ID, SHA-256, byte count and
  page count while keeping the bytes outside Supabase and Git.
- Keep preparation free of side effects: no lecture/Poll start, PDF publication,
  Realtime transcription, AI request or other paid work occurs automatically.
- Preserve the standard 30-day archive for rehearsals and all other lectures.
  Only a sanitized R2 archive carrying the exact production policy ID and its
  final PDF receives the permanent-retention exception; access tokens remain
  short-lived and scoped.
- Keep frontend and Edge flags independently default OFF and retain Local
  Publisher as the Phase 7.26 compatibility/recovery path.
  The temporary preview may explicitly enable them without changing that code
  default or authorizing a lecture run.

### Acceptance

- Idempotent request replay, production uniqueness, repeatable rehearsal
  isolation, single-open-run enforcement and exact PDF descriptor checks PASS.
- The six Polls are ordered and remain draft until the teacher explicitly opens
  and closes them; creation emits no paid provider request.
- Normal/rehearsal archive expiry remains 30 days, malformed permanent policy is
  rejected and exact production cleanup/access behavior is deterministic.
- Clean/upgrade migrations, all pgTAP, DB lint/advisors, two-connection races,
  Worker/Edge tests, full non-live regression and Chromium/WebKit desktop/mobile
  flag-ON/OFF E2E PASS before the Local Gate may be marked complete.
- Human Admin/student/Display/PDF review and Hosted R2, 15 MiB, WAF/rate,
  cleanup-Cron and two-Admin evidence remain blocking before production.

## 12. Phase 7.28 - operational cleanup and activation reliability

Status: automated Local Gate PASS on 2026-07-31. Human UI, Hosted and formal
Production gates remain HOLD. No hosted migration, secret/flag change, push or
deployment is authorized by this status.

### Tasks

- Retire only the one-off Journal Club preset creation UI/API by default while
  preserving all existing lectures, Polls, archives and compatibility paths.
- Give only an Admin-issued, independently authenticated Display browser a
  private low-latency acceleration channel for committed PDF-page changes and
  bounded caption deltas. Students remain on the existing five-second snapshot.
- Add lecture- and Admin-session-bound master AI authorization with exactly two
  scopes: all eligible AI except captions, or all eligible AI including
  captions. Authorization never starts a provider operation by itself.
- Preserve the explicit CTA, fresh single-use billing grant, budget, lane,
  lifecycle and idempotency checks for every actual paid start.
- Make summary activation state explicit and catch up server-time-derived due
  windows after ordinary browser suspension without adding student requests.

### Acceptance

- Creation retirement is reversible by flags and does not delete or hide
  historical/archive evidence.
- Display token replay, cross-user/cross-topic subscription, cached-policy
  misuse and post-close relay are rejected; terminal archive access remains
  independent from the expired live Display binding.
- Master scope, actor, revocation, expiry, child single-use, direct-PIN bypass,
  budget/concurrency and close/revoke races converge without orphaned work or
  duplicate billing.
- Clean and populated-7.27 upgrade migrations, complete pgTAP, generated types,
  DB lint, static/non-live regression, load model and Chromium/WebKit E2E PASS.
- Human UI, hosted Realtime/R2/Edge, provider and production evidence remain
  blocking for the formal Production Gate.

## 13. Phase 7.29 - optional PowerPoint Presenter Bridge

Status: canonical rescue and dormant placement in progress. The 2026-08-01
automated web/database Local Gate is historical evidence from the former local
branch and must be rerun against the current GitHub base. All browser, Edge and
database flags remain default OFF. Signed distribution, Device, Human and
activation gates remain HOLD until separately recorded.

### Tasks

- Treat PowerPoint COM events only as reconciliation triggers. The canonical
  position is the stable actual `View.Slide.SlideID` and absolute slide index,
  observed after a short event delay and by a 200 ms local monitor.
- Support only a normal all-slide, windowed show with no hidden slides, Custom
  Show or Presenter View. Require equal PPTX/PDF counts and explicit teacher
  confirmation of the displayed document pair.
- Freeze ordered Slide IDs and the local PPTX fingerprint for the connection;
  stop rather than guess after add/delete/reorder/hide/save mutation.
- Bind the Bridge only to `127.0.0.1:43124`, enforce exact Host/Origin and
  bounded requests, and exchange only short-lived single-use pairing material
  and short-lived lecture/deck bearer capabilities. Pin the native remote
  endpoint to the canonical Supabase host. No Admin token, PIN, service-role
  key or PPTX/PDF content enters loopback or browser storage.
- Keep the server runtime gate, Edge admission and frontend flag independently
  default OFF. An active binding fences manual page writes; explicit handover,
  expiry, lecture close, Admin revoke or gate shutdown restores the established
  manual path safely.
- Reuse the existing committed live-state mutation and private Display
  acceleration. Do not add a Presenter subscription, polling path or payload
  field to the student five-second snapshot.

### Acceptance

- Clean and populated upgrade migration, full pgTAP, RLS/grants, replay,
  two-Admin race, lock order, idempotency, same-page no-op and load checks PASS.
- Deterministic early/duplicate/missing-event traces, rapid jumps, retry,
  PowerPoint restart and mutation-stop behavior PASS without COM access from a
  non-STA thread.
- Browser flag-OFF/ON, manual handover, loopback absence, exact CORS/Host/Private
  Network Access, keyboard/accessibility and Chromium/WebKit/Mobile regressions
  PASS locally.
- Local automated success does not waive signed per-user installer, SmartScreen,
  Office x86/x64/build matrix, real Edge/Chrome HTTPS-to-loopback, 500 physical
  transitions, PowerPoint restart, venue Extend-display and teacher binding UX.
  Those Native/Human/Hosted checks remain blocking before activation.
- A local application-control block or untrusted native binary is a HOLD, not a
  reason to weaken Windows security or report the native gate as PASS.
- The rescued 7.29C source now adds asymmetric per-install proof, the dedicated
  Gateway and server-side rate/cleanup controls. Activation still requires the
  final-candidate Hosted/Device/Human evidence, signed distribution and
  bounded recovery-credential proof defined below; source presence is not
  acceptance.

### 7.29A/B/C split

- **7.29A rescue:** port the local source onto the current canonical main,
  regenerate derived DB types and add Windows x64/x86 compile plus deterministic
  Core/loopback CI. No unsigned artifact is distributed.
- **7.29B dormant placement:** apply only additive schema and compatible Edge
  and web code with DB, Edge and frontend gates independently OFF. Verify the
  old manual PDF/Display/student paths and save Hosted evidence.
  The public `presenter-bridge-session` machine endpoint, its secret and native
  distribution are explicitly excluded from 7.29B.
- **7.29C activation:** place the native machine endpoint behind the dedicated
  fixed-upstream Cloudflare Gateway; require per-install P-256 request proof,
  replay/rate controls and the fail-closed `.invalid` release placeholder;
  package with pinned Velopack and a signed per-user install/update/rollback
  path; prove the 55-second automatic ticket, five-minute manual recovery-code
  TTL, one-time positive/negative receipts and real
  Office/browser/PNA/500-transition/venue behavior before a controlled canary.
  Hosted, Device and Human gates remain HOLD until the owner supplies the exact
  FQDN/zone, signing identity and update feed.

The complete ordering and rollback contract is
[`PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md`](PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md).
The signed activation contract is
[`PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md`](PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md).

## 14. Legacy Phase 7 release checklist

The temporary hosted preview has completed the expand-first deployment portion.
The remaining steps below are still mandatory compatibility evidence, but this
section is no longer the next formal integrated Production Gate. The approved
next formal decision is Phase 7.33 after the identity, repository-publication,
contest-isolation and commercial-readiness contracts are complete. Preview or
dormant publication alone is not final Production Gate completion.

Only after Phase 6.7, 6.8, 6.9, 7.1, 7.2, 7.25, 7.26, 7.27, 7.28 and the
applicable Phase 7.29 gates are individually PASS. Phase 7.29 may remain OFF
and be excluded from a release; it may not be activated on the strength of
browser/database evidence alone.

1. record backup, owner, change window, stop and rollback thresholds;
2. apply expand-first migration;
3. deploy server/Worker capability with flags OFF and verify route protection;
4. deploy frontend with flags OFF;
5. run Advisor, DB lint and production two-user separation;
6. validate CSP, resume, QR, literature, timeout and cross-service PDF paths;
7. stop Local Publisher, revoke/isolate its R2 writer and drain all browser jobs;
8. run a real 15 MiB PDF canary, two-Admin race and cleanup/Cron monitoring;
9. keep the Phase 7.28A recovery-only preset-creation flags OFF. For 7.28B,
   enable and verify the DB runtime gate, then Edge capability, then frontend;
   for 7.28C, enable server admission before frontend. Use one controlled
   lecture and run a 20-person canary;
10. review 300-person query/request model and observed telemetry;
11. on a 7.28B failure, disable the DB runtime gate first, verify bindings are
    terminal/drained, the same claimed Display has downgraded to snapshot and a
    different UID is rejected, then verify an Admin revoke/expiry also ends that
    fallback before disabling Edge/frontend. On a 7.28C failure, disable server
    start/child issuance, drain/revoke, then hide frontend. Follow the applicable
    older-phase rollback for unrelated failures;
12. record human, hosted and production evidence before normal activation.

For Phase 7.29B, apply its additive migration and deploy only the named
JWT-protected management and compatible Display functions with all gates OFF;
leave the machine endpoint, its secret and native Bridge undeployed. Phase
7.29C separately requires the fixed-upstream Gateway, rate/PoP, signed-native,
bounded automatic/manual recovery credentials and real HTTPS-to-loopback gates
before machine admission, DB runtime and a controlled frontend cohort may be
enabled. Rollback starts at the DB runtime gate and must leave manual Admin
navigation, Display snapshot fallback and the student five-second path intact.

## 15. Phase 7.30 - Google Admin identity, MFA and RBAC

Google authentication replaces the shared Admin login PIN after an expand-first
compatibility gate. Student anonymous Auth, participant ownership and lecture
lifecycle remain unchanged. Repeated `BILLING_PIN` entry and owner-issued
per-lecture delegation are replaced in the normal path by an individual
AI-unlock factor, owner-managed policy and the existing lecture master
authorization; the old PIN survives only as a bounded rollback control.

### 7.30A - asset, IAM and threat inventory

- Read-only inventory the COMPASS Google platform and classify each asset as a
  reusable pattern, conditionally reusable account resource, Interactive-only
  credential/runtime or prohibited copy.
- Freeze the identity, AAL2, role/capability, environment, recovery, audit,
  invitation, AI-unlock and paid-policy threat model before schema or Hosted
  changes.
- Reuse no OAuth credential, service account, allowlist payload, Cloud Run/Neon
  state or process-local rate limiter. Interactive environments get separate
  OAuth clients, origins/callbacks, provider secrets and rollback ownership.

### 7.30B - additive identity foundation

- Add private principal, environment membership, invitation, tracked session,
  append-only audit, AI-unlock factor, browser-profile credential, one-time
  enrollment nonce, atomic membership/network/environment rate limits and
  owner-managed AI policy schema behind default-OFF enforcement. Expand the existing
  `lecture_ai_master_authorizations` with principal/membership/session/factor/
  policy provenance instead of creating reviewer delegation grants. Require
  RLS/grants/indexes and clean/upgrade migration tests.
- Create a physically separate Admin Supabase client/storage key and PKCE route.
  Its persistence adapter strips Google `provider_token` and
  `provider_refresh_token` on login, refresh, reload and cross-tab updates.
- Bind `auth.uid()` to the Google provider/issuer/subject exactly once from a
  server-side Supabase Auth identity record while consuming bootstrap or a
  one-time invitation. Request body, `user_metadata` and later email comparison
  are not authorization sources.
- Require TOTP AAL2 and a server-recorded short-lived recent-step-up nonce for
  sensitive actions. Supabase Passkeys are Beta/passwordless and remain a later
  option after custom-domain/RP-ID stability; they are not v1 AAL2.
- Execute B in order: B1 must pass Google identity, tracked-session and mandatory
  TOTP AAL2 gates before B2 adds the four-digit AI PIN, remembered-browser
  credential, AI policy and master-provenance expansion. Dedicated AI Passkey is
  deferred from the initial implementation.

### 7.30C - RBAC, ownership and all server authorization

- Minimum roles are `owner` and `instructor`; `can_use_ai` remains a separate
  environment-scoped entitlement. Lecture ownership binds to either role's
  active membership, not specifically to the `owner` role.
- Migrate every Admin Edge/RPC path to verified bearer, immutable Google
  binding, active membership/capability, tracked session, AAL2/step-up,
  ownership/lifecycle and feature/cost checks, with transaction-time rechecks.
- Owners can manage the Admin ledger, revoke an account/session, stop any
  lecture and inspect bounded audit. Instructors are self/own-lecture only, and
  no operation may suspend, demote or remove the last active owner.
- Paid AI requires `can_use_ai`, an explicit master CTA and a personal AI-unlock
  proof within a valid AAL2 session. Four-digit verification, Passkey challenge
  and remembered-browser assertion are atomically replay/rate protected and
  environment/principal/session/lecture/scope bound. Each later provider start
  consumes only an internal single-use child grant after live policy, budget,
  concurrency, idempotency and lifecycle checks.
- AI PIN registration/verification permits the raw PIN only in the trusted form
  and bounded TLS body and clears it after the response. Browser persistence
  stores only a non-extractable profile key plus revocable public credential.
  Short-lived one-time enrollment is bound to identity, membership, session,
  exact TOTP step-up event, factor version, Origin and key fingerprint.
- Five failures per 15 minutes lock the environment+membership across every
  session/factor/browser; separate pepper-hashed network and environment circuit
  breakers fail closed without retaining raw IP. Factor rotation cannot clear
  the primary lockout.
- Session, factor, browser credential, membership/entitlement, policy and lecture
  transitions each have explicit idempotent master/child drain behavior. Budget
  exhaustion alone preserves the activated master but denies child admissions.

### 7.30D - Google, MFA and Admin-ledger UX

- Provide one Google sign-in CTA, concise TOTP enrollment/challenge,
  account/role display, own session list and owner-only membership/lecture/audit
  management without displacing the lecture workspace.
- Provide a short AI-unlock enrollment: personal four-digit AI PIN in v1 and a
  dedicated AI Passkey after the stable custom-domain/WebAuthn gate. The lecture
  surface keeps exactly two master choices, and optional trusted-browser memory
  is default OFF on shared devices and stores no raw PIN. It is described as
  browser-profile-bound, not hardware/device-bound, until the WebAuthn gate.
- Dangerous actions name target/effect, require recent step-up and are
  idempotent/audited. Infrastructure details stay in the runbook.
- Accessibility, mobile/desktop, Chromium/WebKit OAuth callback, storage
  sanitizer, expiry, recovery and ledger E2E are mandatory.

### 7.30E - dual-read compatibility and full regression

- Run Google and legacy shared-login-PIN authorization in an expand-first,
  default-OFF dual-read period; backfill/assign legacy lecture ownership without
  widening it.
- Keep the PIN-login path as time-bounded break-glass rollback only. It cannot
  grant broader roles or bypass AAL2 after Google enforcement, and it receives a
  tested retirement deadline.
- Keep legacy `BILLING_PIN` admission behind its own default-OFF, owner-only
  rollback flag. Google-enforced clients fail closed on direct legacy PIN use;
  after the deadline the secret and compatibility RPC are removed in a contract
  migration.
- Keep the names and authority separate: `ADMIN_PIN` is only legacy shared
  login, `BILLING_PIN` is only the default-OFF Google-owner/AAL2 paid rollback,
  and the personal four-digit `AI PIN` is only the normal intent factor. A full
  shared-`ADMIN_PIN` revision rollback keeps new paid starts disabled because it
  cannot prove an individual owner at AAL2; free stop remains available.
- Inventory and regress every Admin Edge/RPC plus Phase 0-7.29 student, PDF,
  Display, Poll, AI, Archive and Presenter-OFF contract before migration.

### 7.30F - Hosted/Human identity migration gate

- In separate staging, test two owners, one AI-enabled Admin, one standard
  Admin, suspended Admin,
  cross-user/cross-lecture denial, individual/global revoke and last-owner
  protection all PASS.
- Google callback/origin allowlists, OAuth consent, AAL1-to-AAL2 enforcement,
  recovery, token rotation, stale session and account-disable behavior PASS.
- Full Phase 0-7.30 DB, Edge, browser, CI, load, security, accessibility and
  rollback regression PASS with zero Critical/High finding.
- Exact hosted state and human MFA/recovery evidence are recorded before the
  Google enforcement flag is enabled.
- This is a separately authorized limited identity-migration canary only. It
  neither changes repository visibility nor invites contest reviewers, and the
  formal integrated Phase 7.33 Gate remains HOLD.

Passing 7.30F authorizes only the bounded Google-identity migration described
above. It does not declare the repository public, invite contest reviewers,
complete commercial readiness or satisfy the formal Phase 7.33 Production
Gate.

Current official implementation references are [Supabase Google
login](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase MFA/AAL](https://supabase.com/docs/guides/auth/auth-mfa), and the
[Beta/passwordless Passkey boundary](https://supabase.com/docs/guides/auth/passkeys).
Recheck them at implementation and Production Gate.

## 16. Phase 7.31 - protected publication and real contest review

### 7.31A - GitHub governance

- GitHub Education is active. Main ruleset `20600565` enforces Pull Request
  integration, the five configured exact-head CI contexts, conversation
  resolution and force-push/deletion denial. Required approving reviews remain
  zero for solo-owner continuity; manual Copilot review is advisory and cannot
  substitute for a required check or human/Production decision.
- Add CodeQL, dependency review, secret scanning/push protection, action SHA
  pinning, least-privilege workflow tokens, ownership and release provenance.
- Add and negative-test protected deployment environments. The active main
  ruleset is real enforcement, but Phase 7.31A remains incomplete until these
  remaining supply-chain and deployment controls pass.

### 7.31B - public-source readiness

- Audit every branch, tag, Git history, artifact, release and attachment for
  secrets, PII, lecture data, internal paths and materials without public
  redistribution rights. Revoke and rotate every possibly exposed credential.
- Decide the repository and third-party-content licenses explicitly; do not
  infer a permissive license. Provide security, contribution, vulnerability,
  architecture, build, SBOM and provenance documentation.
- Keep the repository private until this gate passes and the user separately
  approves the exact visibility change immediately before publication.

### 7.31C - isolated real reviewer environment

- Invite each reviewer's own Google account. The reviewer uses the existing
  `[2] AI-capable Admin` contract: `role=instructor`, `can_use_ai=true`, TOTP
  AAL2 and an individually revocable, bounded-expiry principal.
- This is a real lecture environment using the Production-grade authentication,
  RLS, PDF, Poll, Display, comments, AI and Archive paths. It is not a mock or
  authorization bypass.
- Each reviewer initially enrolls a personal four-digit AI PIN after TOTP AAL2
  and may opt into the safe remembered-browser flow, then unlocks its own lecture
  with the ordinary two-scope master CTA. Dedicated AI Passkey is added only
  after its WebAuthn gate. Owner intervention and `BILLING_PIN` are not required
  per lecture or per call. The owner preconfigures `can_use_ai`, allowed
  features/models and bounded lecture/day/cost/Realtime limits; reviewers cannot
  change those policies.
- Browser remembering atomically consumes a short-lived enrollment nonce bound
  to the reviewer, environment, membership, Admin session, exact TOTP step-up,
  factor version, Origin and public-key fingerprint. It stores no PIN, is
  individually revocable and is browser-profile-bound rather than hardware-bound.
- Caption-scope escalation rechecks the AI factor and recent TOTP step-up;
  downgrade/stop are free. The complete session/factor/browser/membership/policy
  revoke matrix, membership-wide and coarse abuse limits, XSS/profile-copy tests
  and no-R2-infrastructure UI acceptance are mandatory.
- Isolate Supabase, OAuth client, Cloudflare environment/domain, a dedicated
  Private R2 bucket/binding/credential,
  OpenAI project/budget, audit and cleanup from Production. Reviewers receive no
  owner/global authority, cross-lecture access, secret viewing or deployment /
  budget administration.
- Enforce reviewer/lecture/day budgets, concurrency, Realtime minutes, 90-minute
  closure, expiry, individual revoke, idempotent cleanup and environment-level
  negative tests.

The complete Phase 7.31 contract and acceptance matrix is
[`PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`](PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md).

## 17. Phase 7.32 - commercial EdTech readiness

- Add explicit university/organization tenancy to principals, lectures, PDF,
  comments, AI ledger, audit and Archive, with RLS/Edge/transaction isolation.
- Separate staging, Production and contest through reproducible infrastructure;
  add SLO/SLI, monitoring, cost alerts, incident response, backup/restore drills,
  RTO/RPO and vendor-outage/exit procedures.
- Validate Free 20-person and Pro approximately 300-person lectures, concurrent
  institutions, accessibility (WCAG 2.2 AA), major browsers/devices, privacy,
  retention/export/delete, support, onboarding and legal/DPA obligations.
- Do not promote the contest tenant into Production; migrate the same approved
  code and authorization contract into separately governed commercial
  environments.

## 18. Phase 7.33 - unified Production Gate

This is the next formal integrated Production Gate. It revalidates, on one exact
SHA, all Phase 0-7.32 contracts and specifically requires:

Independently approved dormant placement and limited identity canaries may
precede this Gate under their own evidence, but they do not count as its PASS
and do not authorize public visibility, reviewer invitation or commercial
release.

- Phase 7.29 signed/native/device/venue/rate-limit/cleanup activation blockers
  resolved;
- Phase 7.30 Google identity, TOTP AAL2, principal/RBAC, all Edge/RPC ownership,
  recovery and legacy-PIN migration Hosted/Human evidence;
- Phase 7.31 protected main, public-source audit and explicit publication
  approval, isolated reviewer E2E, expiry/revoke/cleanup/cost evidence;
- Phase 7.32 tenant isolation, commercial operations, accessibility, privacy,
  load, observability, backup/restore and support evidence;
- clean and populated migration, all pgTAP, generated types, Advisor/lint,
  supply-chain, Chromium/WebKit/mobile/visual/accessibility, real hosted services,
  two-Admin/two-reviewer concurrency and human evidence.

Any ownership/environment/secret leak, AAL2 bypass, duplicate or unbounded paid
operation, post-close write, cleanup non-convergence, public-history secret/PII,
rights ambiguity, Production/contest mixing or existing UX regression is an
automatic HOLD. Only a complete PASS permits the staged final release.

## 19. Phase 8 - export, deletion evidence and unified AI review

- Generate teacher ZIP locally from permitted comments, published summaries,
  citations and optionally local transcript.
- Include manifest/checksums; exclude internal IDs, secrets, unpublished AI and
  PDF bytes by default.
- Record content-free, idempotent deletion evidence across Supabase, R2 and
  teacher-local responsibilities.
- Consolidate existing summary publish/hide/pin/correct actions into a review
  queue with diff preview; do not replace immutable revision tables.
- Verify interruption recovery, Windows/macOS extraction, retention boundaries
  and global G0-G7.

## 20. Phase 8.1 - explicit Terra advanced analysis

- Keep Luna as default.
- Offer Terra only for multi-study conflict, methodological appraisal, advanced
  causal reasoning or mechanistic synthesis.
- Require explicit teacher `高度解析`, API-use PIN and a displayed cost ceiling.
- Never auto-fallback from a Luna failure.
- Apply a separate per-lecture call/budget ceiling and the same verified sources
  and teacher approval.
- Recheck current model ID and pricing at implementation and production gate.
- Routing false positives, state/budget/close behavior and global G0-G7 must
  PASS.

## 21. Phase 8.2 - chronological or attention ranking

- Default to chronological order.
- Store the user's `時系列 / 注目` choice locally, not in Supabase.
- Rank only from recent five-minute like growth, with deterministic tie, pin and
  hide rules.
- Compute a lecture-shared cache at most once per five seconds and place only
  bounded top IDs/scores in the existing snapshot.
- Do not add per-student ranking calls or sentiment/personal scoring.
- Boundary, concurrency, query-plan, 20/300 load, visual stability and global
  G0-G7 must PASS.

## 22. Phase 9 - final production certification

- Full 90-minute real lecture and real 20-person canary.
- 300-person modeled and appropriate measured Pro-plan review.
- iOS Safari, Android Chrome, WebKit, desktop and classroom Display.
- Real microphone at bounded 10/30/90-minute gates with no audio retention and
  confirmed provider stop.
- QR, resume, archive expiry, export and deletion drill.
- Literature answer human review.
- Backup, rollback, session revoke, PIN lock and credential-rotation drills.
- Human keyboard/screen-reader/contrast/reduced-motion review.

Final PASS requires zero Critical/High security defect, zero ownership leak,
zero secret exposure, zero duplicate paid operation, zero post-close write/start,
three consecutive E2E passes and complete human/hosted evidence.

## 23. Codex implementation reasoning profile

The implementation model and the application's runtime AI model are independent.
The recommended default for repository work is GPT-5.6 Sol with Extra High
reasoning.

| Phase           | Recommended Codex effort                                                                                  | Rationale                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 6.7             | Sol Extra High                                                                                            | Cross-document consistency is broad but mostly sequential and verifiable                                                              |
| 6.8             | **Sol Ultra for threat-model/final audit; Extra High for edits**                                          | PIN/session, CSP, resume and provider timeout are separable security streams whose interaction needs a root integration audit         |
| 6.9             | **Sol Ultra for decomposition plan and final regression audit; Extra High for sequential refactors**      | Parallel read-only characterization is valuable, but simultaneous edits to large shared modules increase conflict risk                |
| 7.1             | Sol Extra High                                                                                            | Three bounded UX features with clear load contracts                                                                                   |
| 7.2             | **Sol Ultra strongly recommended for design/eval/security review; Extra High for bounded implementation** | Literature verification, injection resistance, claim mapping, cost and publication can be independently challenged before integration |
| C0              | Extra High, with Ultra final contract review                                                              | Repository governance and cloud reproducibility are broad but deterministic                                                           |
| 7.29A/B         | **Sol Ultra primary; external Opus Max review recommended**                                               | Recovery provenance, DB/Edge/native boundaries and dormant multi-service rollout must be reconciled without activation                |
| 7.29C           | **Sol Ultra primary plus external Opus Max and device specialists**                                       | Signing, installer, COM/STA, localhost/PNA and venue behavior cross native and physical trust boundaries                              |
| 7.30A           | **Sol Ultra primary; external IAM/threat review recommended**                                             | Asset reuse, environment separation, recovery and AI-unlock/cost policy define the new trust root before code                         |
| 7.30B           | **Sol Ultra primary; Supabase Auth/RLS/token-storage review**                                             | B1 identity/TOTP must pass before B2 low-entropy AI PIN, browser credential/rate-limit and policy/master state intersect              |
| 7.30C           | **Sol Ultra primary; external authorization/concurrency/cost review**                                     | Every Edge/RPC, ownership, last-owner, unlock factor, AI policy and master authorization must converge transactionally                |
| 7.30D           | Extra High for implementation; Ultra security/accessibility review                                        | UX work is bounded after the identity contract is fixed                                                                               |
| 7.30E           | **Sol Ultra primary; old-client/backfill/rollback review**                                                | Dual-read migration and break-glass retirement can cause lockout or privilege expansion                                               |
| 7.30F           | **Sol Ultra primary plus external final review and Human Gate**                                           | Exact Hosted state, MFA/recovery and rollback decide the limited identity-migration canary                                            |
| 7.31A-B         | **Sol Ultra primary plus independent supply-chain/history/license review**                                | Repository governance and public visibility can irreversibly expose history and define release authority                              |
| 7.31C           | **Sol Ultra primary plus independent identity/isolation/cost review**                                     | Real reviewer access must exercise AI-capable instructor UX without crossing Production or owner boundaries                           |
| 7.32            | **Sol Ultra for tenancy/security/operations; Extra High for bounded UX work**                             | Commercial readiness joins multi-tenancy, resilience, privacy, accessibility, support and cost                                        |
| Phase 7.33 Gate | **Sol Ultra primary plus external final review and human owner approval**                                 | Every local, hosted, device, publication, reviewer and commercial evidence stream must reconcile on one exact SHA                     |

Ultra should not be used merely as a stronger single-agent slider. Its value is
highest when meaningful independent review tracks can run in parallel and a
primary agent integrates contradictions. Most routine file edits and focused
tests remain better suited to Sol Extra High.

Recheck current model guidance before each phase. The official OpenAI guidance
recommends higher reasoning effort only when it produces a measured quality
gain and describes Ultra-style multi-agent work as most useful when complex
work divides cleanly into independent streams:
<https://developers.openai.com/api/docs/guides/latest-model>.
