# COMPASS Interactive Development History

This is a human-readable trajectory, not a replacement for Git history or Phase
gate evidence. Commit IDs identify the main implementation landmarks.

## 2026-08-14 - Lecture Cycle Production Candidate planning and cloud handoff

- Added a 50 active person-hour private-source candidate plan that preserves
  Admin, Student, Display, Review, PDF and AI lecture UX while keeping formal
  Phase 7.33, commercial SLA, multi-tenant, Presenter-device, public-source and
  legal/GA work deferred.
- Added copy-ready controller and parallel cloud-lane task instructions with
  one write branch/worktree per task and separately approved Hosted/Human/
  Production gates.
- Added `npm run cloud:handoff`, a fail-closed check for a pushed clean non-main
  branch, canonical main ancestry and absence of tracked private evidence/env
  or runtime artifacts before the local PC disconnects.
- Kept the repository private and defined exact-SHA private source submission
  as the current contest path.

## 2026-08-12 - Phase 7.30F source/local Hosted/Human readiness contract

- Added a closed redacted evidence schema/example, pure-local readiness
  validator, postgres-owner-only
  `private.get_phase7_30f_source_readiness_preflight_v1(uuid)` projection and
  operator-reviewed read-only SQL preflight. The only decisions
  are `SOURCE_READY`, `HOLD` and `READY_FOR_SEPARATE_HOSTED_EXECUTION`;
  repository tooling cannot declare `Production PASS` or perform an external
  action.
- Added strict secret/identity rejection, exact 19-function Google-only
  inventory, separate pre/post-cutover snapshots, zero Critical/High review
  requirements and the two-owner/Admin/recovery/rollback Human checklist.
- Added read-only evidence for the six historical billing admission functions.
  This tranche does not revoke or drop them. Staging mutation, OAuth/provider
  configuration, Human testing, E cutover, `ADMIN_PIN` deletion, billing
  retirement, `BILLING_PIN` deletion and limited canary remain separate
  approval-gated HOLDs.
- Added `test:phase7-30f-static` to the non-live allowlist, increasing it from
  74 to 75 groups and the repository `test:*` inventory from 115 to 116.

## 2026-08-12 - Phase 7.30E Google-only source and dormant identity cutover

- Removed the shared Admin PIN UI, issuer, browser storage, active flags and
  legacy Admin wire transport. The 19 remaining operational Admin Edge
  adapters require a Google app session and reject legacy Admin/billing fields;
  the personal four-digit AI PIN remains an in-session intent factor.
- Added durable Google Display terminal provenance for live-invalid and expired
  descendants, including exact JTI/lecture/time binding and cross-UID denial.
- Added private append-only operator approvals and exact-replay receipts for
  explicit legacy lecture ownership claims. No request, title, creator or email
  may infer ownership.
- Added a dormant SERIALIZABLE/NOWAIT operator cutover that rechecks two owners,
  all active ownership, gates, legacy sessions and unresolved AI/PDF authority
  in one transaction before disabling legacy admission and writing an
  immutable tombstone.
- Replaced local/demo shared-PIN fixtures with separate Google AAL2 app sessions
  per browser project. Added E pgTAP, populated C2/D upgrade and two-connection
  serialization contracts. Hosted deployment attestation, operator cutover,
  secret removal, billing compatibility retirement and real-account activation
  remain HOLD.

## 2026-08-10 - Phase 7.30C1 dormant lecture AI-master admission

- Added private optional-row lecture ownership without inferred backfill or
  public principal/membership identifiers.
- Added atomic personal-PIN and remembered-browser proof consumption into a
  full-provenance dormant lecture master plus immutable exact-replay receipt.
- Added gate-independent status, free downgrade and revoke receipts, and a
  default-OFF Edge/client transport which never issues provider/child authority.
- Permanently fenced owned lectures and C1 masters from legacy master,
  `BILLING_PIN`, direct-grant and child-consume paths, including after revoke or
  expiry. C2 operational migration and shared-PIN removal remain HOLD.
- Added static, pgTAP and populated B2.2b-head no-backfill upgrade contracts.
  Docker/Local Edge/exact-head CI/Hosted/Human evidence remains HOLD.

## 2026-08-10 - Phase 7.30B2.2b default-OFF AI-unlock Edge and browser readiness

- Added the dedicated Admin-only `admin-ai-unlock` Edge/client transport for
  personal AI PIN lifecycle and ordinary verification. Raw PIN input is limited
  to a bounded TLS body, then domain-separated Edge HMAC plus the existing
  database bcrypt/rate/receipt path; configuration failures remain fail closed.
- Added opt-in remembered-browser WebCrypto P-256 non-extractable keys in
  identity-scoped IndexedDB, exact-retry enrollment state and dormant ES256
  assertion verification. Logout preserves the credential, while factor or
  provenance mismatch drains it; no lecture master or paid authority is issued.
- Added approved TOTP factor add/remove rare-control transitions with one
  aggregate pre-set snapshot, five-minute control proof, payload-bound durable
  authorization, hash-only recovery credential and maximum 30-minute recovery
  capped by the backing eight-hour Auth session. Finalize atomically advances
  the principal anchor and drains old session/AI authority.
- Added B2.2a-head populated upgrade, pgTAP/static/concurrency contracts and
  Chromium/WebKit IndexedDB/CryptoKey tests. All new gates remain default OFF;
  Docker/Local Edge/exact-head CI/Hosted/Human evidence and C/E authority
  integration remain HOLD.

## 2026-08-10 - Phase 7.30B2.2a dormant Admin control hardening

- Bound new Google/TOTP Admin sessions to a principal-approved, domain-separated
  digest/version/count for the exact verified Supabase TOTP factor set plus
  completed post-challenge JWT/AMR nonce evidence and the default-OFF issue
  gate. Pre-existing Google sessions and factor sets are never inferred or
  backfilled; sessions are reason-revoked, while initial 0-to-1 enrollment is
  approved atomically and existing-set adoption remains an Edge-unwired,
  separately gated Hosted/Human operation.
- Added canonical-intent-bound, single-use five-minute control nonce/grant state
  for rare PIN and policy mutations. Mutation facades rederive PIN, policy and
  terminal factor intent before consumption and close the old six-argument PIN
  and policy-v1 freshness bypasses while preserving exact committed replay.
- Added explicit PIN revoke/reset/profile and factor reconciliation RPCs plus
  the minimum default-OFF identity Edge/client begin/complete actions. Normal
  lecture, PIN verification and remembered-browser paths gain no periodic TOTP.
- Unified login and AI-drain lock order, added static/pgTAP/concurrency/upgrade
  contracts, and kept all Hosted, secret, deploy and paid-resource state
  unchanged. A real AAL2-to-AAL2 fresh-AMR Local Edge proof and exact-head DB CI
  remain activation HOLD.

## 2026-08-10 - Phase 7.30B2 dormant Admin AI-unlock database foundation

- Added nine default-OFF private tables for AI policy, versioned personal-PIN
  factors, atomic membership/coarse-network/environment rate state, immutable
  attempt/discovery receipts and remembered-browser enrollment, public
  credential and one-time assertion challenge state.
- Stored only bcrypt cost-12 of a versioned Edge-peppered 64-hex HMAC; no raw
  four-digit PIN enters the database. Added nonblocking environment-four/
  network-two bcrypt semaphores, atomic rate rechecks, exact positive/negative
  replay and bounded convergent cleanup.
- Migrated Google/TOTP application sessions to the backing
  `auth.sessions.created_at + 8 hours` cap with no idle extension or periodic
  TOTP prompt. New PIN factor enrollment/rotation requires the rare five-minute
  boundary; immediate post-login enrollment uses the already-fresh login TOTP.
  Ordinary PIN verification, browser proof and lecture AI work do not require
  freshness.
- Constrained remembered-browser database state to ES256/P-256 public JWKs and
  RFC 7638 fingerprints, and added factor-rotation/policy/browser authority drains plus
  nullable lecture-master provenance. Actual Edge raw-PIN/HMAC, browser
  CryptoKey/signature verification, TOTP factor-set fingerprint, lecture
  ownership and proof-to-master admission remain unimplemented.
- Added service-role-only invoker wrappers, fixed-search-path private helpers,
  generated types, pgTAP, real two-transaction concurrency and populated
  upgrade coverage. Source commit `9f1e0ec` and non-Docker static evidence are
  present; exact-head runtime DB CI, Hosted/Human and activation remain HOLD.

## 2026-08-09 - Phase 7.30A-B1 Google Admin identity local foundation

- Added a separate PKCE Admin Supabase client and fixed callback route with a
  persistence adapter that strips Google provider tokens, while preserving the
  anonymous Student client/session boundary.
- Added additive private environment, principal, membership, invitation,
  append-only audit and five-minute digest-only TOTP nonce state. Trusted
  Google issuer/subject binding uses a server-only, domain-separated HMAC.
- Required a fresh TOTP AMR timestamp and AAL2 before atomically consuming the
  nonce and creating an opaque application Admin session with an eight-hour
  absolute and 30-minute inactivity limit.
- Kept Google issuance dormant behind independent database, Edge and frontend
  default-OFF controls. Legacy Admin PIN compatibility remains default ON, and
  credential-mode constraints prevent legacy AAL1 and Google/TOTP AAL2 sessions
  from being interpreted interchangeably.
- Added source/local verification coverage and a dedicated implementation
  record. No real Google OAuth, Supabase Hosted database/Edge/provider setting,
  secret, account or Production state was changed. Hosted/Human evidence,
  Phase 7.30B2/C-F and the Phase 7.33 Production Gate remain HOLD. The local
  implementation introduces no recurring fixed-cost dependency.
- Merged PR #32 as `3b6b68a36c8ec4d1c8811181e53661716bdd24bc`
  after exact-head required CI, Dev Container and Copilot Review passed. The
  post-merge main CI and Dev Container runs also passed on their first attempt
  with no test retry, flaky failure, external deployment check or Hosted
  mutation.

## 2026-08-09 - Phase 7.29C local activation hardening

- Added a dedicated, fixed-upstream Cloudflare Presenter Gateway contract that
  preserves exact signed request bytes, injects a server-only gateway secret,
  applies coarse location/network rate protection and rejects browser,
  redirected, encoded, oversized or untrusted traffic.
- Replaced copyable installation metadata as the machine trust boundary with a
  non-exportable per-user P-256 CNG signing key, timestamp/nonce/raw-body proof
  and atomic database replay/key binding.
- Pinned Velopack SDK and `vpk` tool `1.2.0`, locked NuGet restore and placed the
  startup hook before all normal native initialization with automatic update
  apply disabled.
- Kept release builds deliberately unusable through `presenter-api.invalid`,
  kept the Gateway without workers.dev, preview or route, and separated the
  55-second automatic ticket from the five-minute manual recovery-code TTL.
- Hosted, Device, Human and activation Production gates remain HOLD until the
  owner records the exact FQDN/zone, signing identity and update feed and the
  signed Office/browser/venue canary passes. No route, secret, installer or
  feature was published by this local work.

## 2026-08-01 - Phase 7.29 PowerPoint Presenter Bridge local gate

- Added a default-OFF optional Presenter Bridge boundary for synchronizing the
  stable actual PowerPoint slide position with the existing absolute PDF-page
  live-state mutation. COM events accelerate reconciliation but are not the
  source of truth; same-page observations remain version no-ops.
- Limited the first mapping contract to a normal all-slide, windowed show with
  equal PPTX/PDF counts, no hidden slides or Custom Show, frozen deck digests
  and explicit teacher confirmation. Deck mutation stops synchronization.
- Added additive server-side connection metadata, one-unrevoked-per-lecture
  fencing, short-lived pairing/capability contracts, loopback Host/Origin/input
  controls, runtime drain and manual handover. Presenter metadata is not
  browser-readable or part of Supabase Realtime.
- Preserved Phase 7.28 private Display acceleration and the student five-second
  snapshot without a new student request or subscription.
- Added server-authoritative stale-Bridge recovery, same-owner Admin-session
  handover, bounded cleanup/audit convergence and browser unmount cleanup.
- Automated web/database Local Gate passed: clean and populated upgrades,
  1,375 pgTAP assertions, concurrency, 63 non-live groups, Chromium/WebKit
  Presenter E2E, four-project demo regression, DB types, secret scan and build.
  Native execution, signed installer, Office/Edge/Chrome/venue, Human, Hosted
  and Production evidence remain HOLD. Windows Application Control was not
  weakened and no untrusted native binary was executed.

## 2026-07-31 - Phase 7.28 local operational hardening

- Retired the one-off Journal Club preset creation UI/API behind independent
  default-OFF recovery flags without deleting historical lectures or archives.
- Added a private, first-claimer-bound cross-browser Display acceleration path
  for committed page changes and bounded captions. Students remain on the
  existing five-second snapshot and receive no Realtime subscription.
- Added lecture/Admin-session/actor-bound AI master authorization with two
  scopes. Authorization performs no paid work; every explicit feature start
  still consumes a fresh child grant under the existing budget, concurrency,
  lifecycle and idempotency checks.
- Added scheduler catch-up, runtime drains, additive clean/upgrade migrations,
  pgTAP/concurrency/load/static tests and Chromium/WebKit/Mobile E2E. Hosted,
  human and formal Production evidence remain HOLD.
- Bound rollback snapshot/PDF access to a request-time DB verification of the
  exact Display, gate, lecture lifetime and issuing Admin session; later Admin
  revoke or lecture termination permanently fences the rollback binding.

## 2026-07-22 - Phase 7.27 final Admin integration

- Set the production and rehearsal title to
  `Dual-targeting CasRx for C9orf72 ALS/FTD` and moved both prepared runs into
  the conventional Admin lecture list and its existing start action.
- Applied the same exact-PDF start guard and 90-minute lifecycle to both run
  kinds. Only production uniqueness and permanent retention differ.
- Compressed teacher-facing AI guidance to the action, state and high-value
  cost/safety facts needed during a lecture.
- Added stale lecture/session convergence and dedicated real Edge/Postgres E2E
  for rehearsal and production parity. Phase 7.27 now has 56 assertions and the
  full database suite has 1,171 passing assertions across 24 files.
- Pinned `sharp` 0.35.3 for the Worker toolchain; the high-severity dependency
  audit reports zero vulnerabilities.

## 2026-07-21 - Phase 7.27 Journal Club operational preset

- Added a default-OFF, thin `7.23 Journal Club` preparation preset over the
  existing lecture, Poll, PDF, AI and archive contracts rather than introducing
  a parallel lifecycle.
- Each request creates an isolated fresh lecture UUID and six-digit code with
  six ordered single-choice Polls in draft. Rehearsals are repeatable; exactly
  one production run is permitted, and production/rehearsal cannot be open at
  the same time.
- Bound the approved 34-page PDF by exact document ID, SHA-256, byte count and
  page count. The preset does not store PDF bytes in Supabase or Git and does
  not automatically start a lecture, Poll, PDF publication, Realtime or AI.
- Preserved the normal and rehearsal 30-day archive policy. Only the exact
  server-derived production policy may retain its sanitized R2 snapshot and
  final immutable PDF permanently; archive/PDF tokens remain short-lived.
- Automated Local Gate passed with a clean reset, 1,169 pgTAP checks, 49 Worker
  tests, 55 non-live groups, upgrade/two-connection concurrency probes, real
  local Edge/Postgres integration and repeated Chromium/WebKit desktop/mobile
  E2E. Human/Hosted/Production gates remain HOLD; no deployment, hosted
  mutation, flag activation or paid call was authorized.

## 2026-07-21 - Phase 7.25/7.26 academic answers and browser PDF publication

- Added multidisciplinary Crossref/OpenAlex corroboration and bounded automatic
  five-minute academic-answer candidates. Unsupported or low-value candidates
  remain absent; visible drafts are teacher-unconfirmed and retain
  approve/hide/correct controls.
- Added the default-OFF browser-complete PDF publication saga across Admin,
  Supabase Edge/Postgres and the Cloudflare Worker while keeping PDF bytes out
  of Supabase.
- Added ticket/Origin/actual-size/PDF-magic/SHA-256/binding/expiry/nonce checks,
  immutable R2 upload, hidden commit, future-version activation, restartable
  discovery/finalize/abort and permanent terminal fences.
- Fixed cleanup manifest-conflict work from potential `O(limit^2)` to
  per-due `O(limit)` and made same-hash/different-object cleanup intents
  collision-free while preserving legacy v1 intent recovery.
- Made Local Publisher a mutually exclusive recovery path with a manifest/access
  receipt fence. Browser mode hides Local controls and rejects every Local
  registration; hosted activation still requires process stop and R2 writer
  credential revocation/isolation.
- Automated Local Gate regression passed; Human, Hosted and Production gates
  remain HOLD. No push, deployment, hosted setting, feature flag or paid call
  was changed by this local phase.

## 2026-07-20 - Phase 7.2 evidence-grounded academic answers

- Added teacher-triggered, API-PIN-gated academic reference drafts using a
  bounded primary-literature workflow and one low-cost Luna Responses call.
- Added fixed-host PubMed retrieval, exact Crossref DOI corroboration,
  retraction/context classification and deterministic claim-source gates; the
  model cannot create identifiers or invoke browsing tools.
- Added exact-once reservation settlement, explicit provider-dispatch audit,
  free pre-dispatch cancellation and idempotent stale-operation recovery.
- Added hidden immutable drafts, teacher approve/hide/reject control and a
  maximum-three public answer projection in live snapshots and R2 archives.
- Tightened direct compatibility reads to lecture participants and preserved
  Phase 7.1 data/old RPCs through an expand-first upgrade test.
- Adopted development preview version `0.11.0`; no hosted service, production
  flag, live paid request, push or deployment was changed.

## 2026-07-19 - Phase 7.1 classroom UX extensions

- Added `auto / ja / en` teacher summary-language control with an immutable
  per-window snapshot and recorded deterministic resolution reason.
- Kept one provider call per five-minute window: auto reads teacher transcript
  first and current PDF second, never student comments alone, and does not call
  a model to detect language.
- Added an authenticated on-demand `みんな / 自分` cursor RPC that derives the
  participant through `auth.uid()` and adds no polling, preference row or
  Realtime subscription.
- Added local SVG lecture QR generation on the selected open Admin lecture and
  open Display; no external QR service or stored image is used.
- Fixed Display fragment initialization and operator-credential sync races
  found by the new Admin/Display browser E2E.
- Adopted development preview version `0.10.0`; hosted services, public web and
  paid OpenAI were not changed.

## 2026-07-19 - Phase 6.9 modularization and deterministic CI

- Split the Admin workspace into auth/session, lecture, PDF, AI, Poll and
  moderation units without changing its route or user-visible workflow.
- Split state/archive helpers and Supabase mapping, transport and timeout/error
  policy while preserving the existing public context and repository APIs.
- Added deterministic local Supabase type generation and CI drift rejection.
- Pinned GitHub Actions to immutable SHAs and added dependency review, CodeQL,
  secret scanning, high-severity audit policy and CycloneDX SBOM evidence.
- Added Chromium/WebKit Desktop/Mobile accessibility, keyboard and deterministic
  visual-contract tests with three-consecutive-run gates.
- Adopted development preview version `0.9.0`. No hosted setting, public web,
  migration, secret, paid API call, push or deployment was changed.

## 2026-07-18 - Phase 6.8 security/session foundation

- Added keyed application-level Admin PIN throttling and hash-at-rest,
  individually revocable Admin sessions with absolute/inactivity expiry.
- Added lecture-scoped seven-day resume tokens, version revocation and a private
  Worker archive index while retaining code plus Turnstile compatibility.
- Added CSP enforcement/report-only policy, bounded JSON/content-type handling
  across exposed Edge Functions and explicit frontend/provider deadlines.
- Added durable provider request correlation and conservative ambiguous-timeout
  accounting without an automatic paid-operation replay.
- Kept every new capability default-OFF; no hosted service, public web, secret,
  paid call or deployment was changed by the local Phase.

## 2026-07-18 - Phase 6.7 documentation baseline

- Replaced the Phase 0-only README with the Phase 0-6.6 implementation entrypoint.
- Established current architecture, security, data, database, roadmap and
  runbook-index documents.
- Added documentation consistency checks to prevent stale routes/scripts/flags.
- Adopted development preview version `0.7.0`.
- No classroom behavior, migration, hosted setting, paid call or deployment was
  introduced by this Phase.

## 2026-07-17 - Phase 6.6 integration and CI

- `74fa86d`: integrated the teacher/student UX, approximate presence metrics,
  code/Poll safeguards, R2 closed-lecture archive, daily operations digest and
  server-side Realtime provider control.
- `b979e37`: enabled trusted `pg_net` scheduler support.
- `8689f02`: prevented archive claims for code-less lectures.
- `cc1ae93`: added GitHub Actions, Playwright Demo E2E and disposable local
  Supabase teacher/student E2E.

Phase 6.6 local/human/hosted evidence remains separated. A Git commit or local
PASS does not by itself prove production parity.

## 2026-07-16 - AI learning support and integrated review

- `5bcdd1b`: Phase 5 bounded PDF text analysis and teacher-only AI Poll proposals.
- `d211079`: Phase 6 five-minute lecture summaries, comment pulse and immutable
  teacher review/publication revisions.
- `f7cecb2`: Phase 6.5 nullable per-comment nickname, ten-character maximum and
  local Demo behavior.
- `926488f`: Phase 0-6.5 integrated production-gate hardening.
- `ecda82d`: recorded the Development Production Review deployment.

## 2026-07-15 - private documents and paid realtime controls

- `d8a5354`: Phase 3 local Publisher, private R2/Worker PDF delivery and page
  synchronization.
- `66d3051`: Phase 4 separate API-use PIN, usage ledger and Realtime captions.
- `ac12a6a`: completed the Phase 4 local gate without real microphone storage.
- `4b6744b`: Phase 4.1 split Realtime and Batch concurrency lanes.

## 2026-07-14 - authentication, synchronization and lifecycle

- `0181112`, `c57239f`, `f7c5b68`: Phase 0 ownership/RLS hardening, validation,
  anonymous Auth and Turnstile.
- `9e213bc`: Phase 1 versioned five-second synchronization and cursor history.
- `e0531d2`: Phase 2 server-time 90-minute lifecycle, idempotent close, AI
  admission and archive state.

## Earlier MVP foundation

- `9d17b4e`: initial React/Vite classroom MVP.
- Milestone commits added Supabase live state, Admin lifecycle and PDF page
  synchronization.
- Subsequent UI commits established the mobile-first light learning experience,
  Demo mode and COMPASS branding.

Those early Phase 0/milestone documents are retained for traceability but may
describe mock-only or Realtime behavior that the Phase 1-6 design replaced.

## Planned trajectory

- Phase 7.1: locally implemented; real-phone/human sign-off remains.
- Phase 7.2: verified-primary-literature academic reference answers.
- Phase 7.25/7.26: locally automated-verified; human/hosted production evidence
  remains blocking.
- Phase 7 Gate: next controlled production reflection.
- Phase 8/8.1/8.2: export/deletion evidence, Terra advanced analysis and optional
  comment attention ranking.
- Phase 9: full long-run, human and operations production certification.

See `docs/ROADMAP.md` for requirements and non-negotiable gates.
