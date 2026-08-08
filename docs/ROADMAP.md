# COMPASS Interactive Roadmap and Stop-the-Line Gates

Approved design baseline: 2026-07-18
Scope: Phase 6.7 through Phase 9

## 1. Numbering decision

Existing Phase 0-6.6 implementation and historical Phase 7-9 reservations are
preserved. Decimal phases separate risk domains without rewriting history.

| Order | Phase                        | Priority | Outcome                                              |
| ----: | ---------------------------- | -------- | ---------------------------------------------------- |
|     1 | C0                           | Highest  | GitHub/Cloud canonicalization                        |
|     2 | 6.7                          | Highest  | Documentation and release baseline                   |
|     3 | 6.8                          | High     | PIN/session/CSP/resume/timeout security foundation   |
|     4 | 6.9                          | High     | Modularization and deterministic CI quality          |
|     5 | 7.1                          | Medium   | Summary language, own comments and lecture QR        |
|     6 | 7.2                          | Medium   | Verified-primary-literature reference answers        |
|     7 | 7.25                         | Medium   | Multidisciplinary automatic academic answers         |
|     8 | 7.26                         | High     | Browser-complete private PDF publication             |
|     9 | 7.27                         | High     | Thin Journal Club operational preset                 |
|    10 | 7.28                         | High     | Operational cleanup, Display Realtime, AI activation |
|    11 | 7.29A/B                      | High     | PPT rescue and dormant hosted placement              |
|    12 | 7.29C                        | High     | Signed Presenter activation                          |
|    13 | 7.30A-F                      | Highest  | Google Admin identity, MFA, RBAC and migration       |
|    14 | Phase 7.30 Production Gate   | Highest  | Multi-admin controlled release                       |
|    15 | Phase 8                      | Low      | Export/deletion evidence and unified AI review       |
|    16 | 8.1                          | Low      | Explicit Terra advanced analysis                     |
|    17 | 8.2                          | Low      | User-selected chronological/attention ranking        |
|    18 | Phase 9                      | Final    | Long-run, human and operations certification         |

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
- Service role, API keys, PINs and delivery secrets never enter a public client.
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

- Paid starts require explicit teacher action and API-use PIN.
- Stop remains free and easy.
- Luna is the default runtime model where it meets the quality gate.
- Terra is never an automatic fallback.
- Lecture budget, call limit, concurrency and idempotency are verified before
  provider traffic.
- Realtime transcription is never started by another AI feature.
- Replacing the Admin login PIN does not implicitly remove the independent
  API-use/Billing PIN used as a paid-operation step-up control.

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
- Before activation, replace declared-installation metadata with an
  asymmetric per-install proof-of-possession contract, add server-side rate
  protection and cleanup Cron, and prove recovery after slideshow/COM loss.

### 7.29A/B/C split

- **7.29A rescue:** port the local source onto the current canonical main,
  regenerate derived DB types and add Windows x64/x86 compile plus deterministic
  Core/loopback CI. No unsigned artifact is distributed.
- **7.29B dormant placement:** apply only additive schema and compatible Edge
  and web code with DB, Edge and frontend gates independently OFF. Verify the
  old manual PDF/Display/student paths and save Hosted evidence.
- **7.29C activation:** implement signed per-user install/update/rollback,
  complete manual recovery, real Office/browser/PNA/500-transition/venue tests
  and then perform a controlled activation canary.

The complete ordering and rollback contract is
[`PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md`](PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md).

## 14. Phase 7 Production Gate

The temporary hosted preview has completed the expand-first deployment portion.
The remaining steps below are still mandatory before formal lecture operation;
preview publication alone is not final Production Gate completion.

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

For a release that includes Phase 7.29, apply its additive migration and server
capability with all three gates OFF, verify the signed per-user Bridge and real
HTTPS-to-loopback boundary, then enable server admission, DB runtime and one
controlled frontend cohort in that order. Rollback starts at the DB runtime
gate and must leave manual Admin navigation, Display snapshot fallback and the
student five-second path intact.

## 15. Phase 7.30 - Google Admin identity, MFA and RBAC

Google authentication replaces only the shared Admin login PIN after an
expand-first compatibility gate. Student anonymous Auth, participant ownership,
lecture lifecycle and the independent paid-operation PIN remain unchanged.

### 7.30A - asset reuse audit

- Read-only inventory the existing COMPASS Google platform and classify each
  item as reusable, conditionally reusable or Interactive-only.
- Reuse may include billing, verified domain and consent branding only after
  ownership and rollback are confirmed. Interactive receives separate OAuth
  clients, origins/callbacks, provider secret, service identities and rotation.
- Request only `openid`, email and profile. Do not request offline Google API
  access or retain Google provider tokens because Interactive does not need to
  call Google APIs on behalf of teachers.

### 7.30B - identity and mandatory AAL2

- Use Supabase Google OAuth/PKCE to establish the existing Supabase
  `auth.uid()` principal. Bind verified issuer, audience, `email_verified` and
  immutable Google `sub` once in an internal Admin identity ledger.
- Bootstrap the two named owner accounts create-only; subsequent authorization
  uses the immutable identity binding and ledger status, not email comparison.
- Require Supabase TOTP enrollment/challenge and JWT `aal2` for privileged Admin
  access. Social login, email OTP and magic link are AAL1 recovery/bootstrap,
  not the required second factor.
- Keep Passkey as a later opt-in after custom-domain/RP-ID stability because
  current Supabase support is experimental; do not present it as AAL2.

### 7.30C - roles, entitlements and session control

- Minimum roles: `owner`, `co_owner`, `admin_ai`, and `admin_standard`, with an
  explicit capability matrix instead of client-side role branching.
- Owner/co-owner can manage the Admin ledger, revoke an individual account or
  session, stop any lecture and inspect bounded audit/usage records. Only owner
  can change owners or destructive governance settings; no one can remove the
  last active owner.
- AI entitlement permits eligible controls but every paid start still requires
  lecture ownership/state, explicit CTA, fresh API-use PIN grant, budget,
  concurrency and idempotency checks.
- Replace global `manage-admin-sessions` authority with principal-scoped list,
  self-revoke and separately authorized owner revoke; preserve append-only
  audit and hash-at-rest session material.

### 7.30D - Admin UX migration

- One Google sign-in CTA, clear MFA enrollment/challenge, account/role display,
  session/device list and owner-only management views.
- Preserve the existing lecture workspace after authentication. Infrastructure
  details move to documentation; lockout/recovery guidance remains concise.
- Accessibility, mobile/desktop, cross-browser OAuth callback and session expiry
  E2E are mandatory.

### 7.30E - expand-first compatibility

- Introduce identity/RBAC tables and dual-read server authorization behind
  default-OFF gates before removing PIN login.
- Keep the existing PIN path as a time-bounded recovery-only rollback during a
  controlled cohort; it cannot grant broader roles or bypass AAL2 once Google
  enforcement is enabled.
- Migrate tracked sessions and Edge/RPC authorization without weakening
  `auth.uid()`, RLS, lecture ownership or post-close rejection. Contract removal
  is a later explicit migration.

### 7.30F - Hosted/Human/Production Gate

- Two owners, one AI-enabled Admin, one standard Admin, suspended Admin,
  cross-user/cross-lecture denial, individual/global revoke and last-owner
  protection all PASS.
- Google callback/origin allowlists, OAuth consent, AAL1-to-AAL2 enforcement,
  recovery, token rotation, stale session and account-disable behavior PASS.
- Full Phase 0-7.30 DB, Edge, browser, CI, load, security, accessibility and
  rollback regression PASS with zero Critical/High finding.
- Exact hosted state and human MFA/recovery evidence are recorded before the
  Google enforcement flag is enabled.

Current official implementation references are [Supabase Google
login](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase MFA/AAL](https://supabase.com/docs/guides/auth/auth-mfa), and the
[experimental Passkey boundary](https://supabase.com/docs/guides/auth/passkeys).
Recheck them at implementation and Production Gate.

## 16. Phase 8 - export, deletion evidence and unified AI review

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

## 17. Phase 8.1 - explicit Terra advanced analysis

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

## 18. Phase 8.2 - chronological or attention ranking

- Default to chronological order.
- Store the user's `時系列 / 注目` choice locally, not in Supabase.
- Rank only from recent five-minute like growth, with deterministic tie, pin and
  hide rules.
- Compute a lecture-shared cache at most once per five seconds and place only
  bounded top IDs/scores in the existing snapshot.
- Do not add per-student ranking calls or sentiment/personal scoring.
- Boundary, concurrency, query-plan, 20/300 load, visual stability and global
  G0-G7 must PASS.

## 19. Phase 9 - final production certification

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

## 20. Codex implementation reasoning profile

The implementation model and the application's runtime AI model are independent.
The recommended default for repository work is GPT-5.6 Sol with Extra High
reasoning.

| Phase        | Recommended Codex effort                                                                                  | Rationale                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.7          | Sol Extra High                                                                                            | Cross-document consistency is broad but mostly sequential and verifiable                                                                     |
| 6.8          | **Sol Ultra for threat-model/final audit; Extra High for edits**                                          | PIN/session, CSP, resume and provider timeout are separable security streams whose interaction needs a root integration audit                |
| 6.9          | **Sol Ultra for decomposition plan and final regression audit; Extra High for sequential refactors**      | Parallel read-only characterization is valuable, but simultaneous edits to large shared modules increase conflict risk                       |
| 7.1          | Sol Extra High                                                                                            | Three bounded UX features with clear load contracts                                                                                          |
| 7.2          | **Sol Ultra strongly recommended for design/eval/security review; Extra High for bounded implementation** | Literature verification, injection resistance, claim mapping, cost and publication can be independently challenged before integration        |
| C0           | Extra High, with Ultra final contract review                                                               | Repository governance and cloud reproducibility are broad but deterministic                                                                  |
| 7.29A/B      | **Sol Ultra primary; external Opus Max review recommended**                                                | Recovery provenance, DB/Edge/native boundaries and dormant multi-service rollout must be reconciled without activation                      |
| 7.29C        | **Sol Ultra primary plus external Opus Max and device specialists**                                        | Signing, installer, COM/STA, localhost/PNA and venue behavior cross native and physical trust boundaries                                    |
| 7.30A-C      | **Sol Ultra primary; external IAM/RLS review recommended**                                                 | OAuth asset separation, AAL2, immutable identity binding, roles and session revocation create the new Admin trust root                      |
| 7.30D        | Extra High for implementation; Ultra security/accessibility review                                        | UX work is bounded after the identity contract is fixed                                                                                       |
| 7.30E-F      | **Sol Ultra primary plus external final review**                                                           | Compatibility, account recovery, hosted state and rollback determine whether Google enforcement can safely replace shared PIN login         |
| Phase 7 Gate | **Sol Ultra strongly recommended for read-only integrated audit**                                         | DB/RLS, provider cost, frontend UX/E2E and rollback evidence can be independently audited; deployment itself remains one controlled sequence |

Ultra should not be used merely as a stronger single-agent slider. Its value is
highest when meaningful independent review tracks can run in parallel and a
primary agent integrates contradictions. Most routine file edits and focused
tests remain better suited to Sol Extra High.
