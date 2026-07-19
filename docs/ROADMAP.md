# COMPASS Interactive Roadmap and Stop-the-Line Gates

Approved design baseline: 2026-07-18
Scope: Phase 6.7 through Phase 9

## 1. Numbering decision

Existing Phase 0-6.6 implementation and historical Phase 7-9 reservations are
preserved. Decimal phases separate risk domains without rewriting history.

| Order | Phase                   | Priority | Outcome                                            |
| ----: | ----------------------- | -------- | -------------------------------------------------- |
|     1 | 6.7                     | Highest  | Documentation and release baseline                 |
|     2 | 6.8                     | High     | PIN/session/CSP/resume/timeout security foundation |
|     3 | 6.9                     | High     | Modularization and deterministic CI quality        |
|     4 | 7.1                     | Medium   | Summary language, own comments and lecture QR      |
|     5 | 7.2                     | Medium   | Verified-primary-literature reference answers      |
|     6 | Phase 7 Production Gate | Medium   | Next controlled production release                 |
|     7 | Phase 8                 | Low      | Export/deletion evidence and unified AI review     |
|     8 | 8.1                     | Low      | Explicit Terra advanced analysis                   |
|     9 | 8.2                     | Low      | User-selected chronological/attention ranking      |
|    10 | Phase 9                 | Final    | Long-run, human and operations certification       |

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

### Lifecycle

- Server time and the shared idempotent close transition remain authoritative.
- Closed/expired lectures reject writes, Poll answers, snapshot mutation and new
  paid starts.
- Clients stop live work when terminal state is observed.
- Archive access is read-only and retention-expiring.

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

## 9. Phase 7 Production Gate

Only after Phase 6.7, 6.8, 6.9, 7.1 and 7.2 are individually PASS:

1. record backup, owner, change window, stop and rollback thresholds;
2. apply expand-first migration;
3. deploy server/Worker capability with flags OFF;
4. deploy frontend with flags OFF;
5. run Advisor, DB lint and production two-user separation;
6. validate CSP, resume, QR, literature and timeout paths;
7. enable one controlled lecture and run a 20-person canary;
8. review 300-person query/request model and observed telemetry;
9. disable flags/rollback on any G0-G7 failure;
10. record the production gate before normal activation.

## 10. Phase 8 - export, deletion evidence and unified AI review

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

## 11. Phase 8.1 - explicit Terra advanced analysis

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

## 12. Phase 8.2 - chronological or attention ranking

- Default to chronological order.
- Store the user's `時系列 / 注目` choice locally, not in Supabase.
- Rank only from recent five-minute like growth, with deterministic tie, pin and
  hide rules.
- Compute a lecture-shared cache at most once per five seconds and place only
  bounded top IDs/scores in the existing snapshot.
- Do not add per-student ranking calls or sentiment/personal scoring.
- Boundary, concurrency, query-plan, 20/300 load, visual stability and global
  G0-G7 must PASS.

## 13. Phase 9 - final production certification

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

## 14. Codex implementation reasoning profile

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
| Phase 7 Gate | **Sol Ultra strongly recommended for read-only integrated audit**                                         | DB/RLS, provider cost, frontend UX/E2E and rollback evidence can be independently audited; deployment itself remains one controlled sequence |

Ultra should not be used merely as a stronger single-agent slider. Its value is
highest when meaningful independent review tracks can run in parallel and a
primary agent integrates contradictions. Most routine file edits and focused
tests remain better suited to Sol Extra High.
