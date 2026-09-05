# COMPASS Interactive Runbook Index

Last reviewed: 2026-09-06

This file is the entrypoint for setup, verification, deployment, rollback and
incident work. A runbook is not authorization: hosted mutation, deploy, push,
secret change and paid call still require an explicit task.

## 1. Current canonical documents

| Need                           | Document                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| Product and local entrypoint   | `README.md`                                                      |
| Current component/data flow    | `docs/architecture.md`                                           |
| Security controls and gaps     | `docs/SECURITY.md`                                               |
| Data collection/retention      | `docs/data_policy.md`                                            |
| Database responsibility map    | `docs/database_schema.md`                                        |
| Future phases and gates        | `docs/ROADMAP.md`                                                |
| Development trajectory         | `docs/CHANGELOG.md`                                              |
| Cloud source admission         | `docs/CLOUD_CANONICALIZATION_GATE.md`                            |
| Agent/reasoning routing        | `docs/AGENT_EXECUTION_ROUTING.md`                                |
| Lecture-cycle candidate plan   | `docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md`                |
| Cloud lane agent prompts       | `docs/LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md`                     |
| Production lecture activation  | `docs/LECTURE_CYCLE_PRODUCTION_ACTIVATION.md`                    |
| Phase 6.7 acceptance           | `docs/PHASE6_7_DOCUMENTATION_BASELINE.md`                        |
| Phase 6.7 local evidence       | `docs/PHASE6_7_LOCAL_GATE_2026-07-18.md`                         |
| Phase 6.8 design               | `docs/PHASE6_8_SECURITY_SESSIONS_TIMEOUTS.md`                    |
| Phase 6.8 local evidence       | `docs/PHASE6_8_LOCAL_GATE_2026-07-18.md`                         |
| Phase 6.9 design               | `docs/PHASE6_9_MODULARIZATION_AND_CI.md`                         |
| Phase 6.9 local evidence       | `docs/PHASE6_9_LOCAL_GATE_2026-07-19.md`                         |
| Phase 7.1 design               | `docs/PHASE7_1_CLASSROOM_UX_EXTENSIONS.md`                       |
| Phase 7.1 local evidence       | `docs/PHASE7_1_LOCAL_GATE_2026-07-19.md`                         |
| Phase 7.2 design               | `docs/PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS.md`            |
| Phase 7.2 local evidence       | `docs/PHASE7_2_LOCAL_GATE_2026-07-20.md`                         |
| Phase 7.2 safe-stop handoff    | `docs/PHASE7_2_HANDOFF_2026-07-20.md`                            |
| Phase 7.26 requirements        | `docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md`                |
| Phase 7.26 browser PDF design  | `docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md`                      |
| Phase 7.26 local evidence      | `docs/PHASE7_26_LOCAL_GATE_2026-07-21.md`                        |
| Phase 7.27 Journal Club design | `docs/PHASE7_27_JOURNAL_CLUB_INTEGRATION.md`                     |
| Phase 7.27 local evidence      | `docs/PHASE7_27_LOCAL_GATE_2026-07-22.md`                        |
| Phase 7.28 design              | `docs/PHASE7_28_REQUIREMENTS_AND_DESIGN.md`                      |
| Phase 7.28 local evidence      | `docs/PHASE7_28_LOCAL_GATE_2026-07-31.md`                        |
| Phase 7.29 Presenter design    | `docs/PHASE7_29_POWERPOINT_PRESENTER_BRIDGE.md`                  |
| Phase 7.29 rescue/rollout      | `docs/PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md`             |
| Phase 7.29C signed activation  | `docs/PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md`                 |
| Presenter production release  | `docs/PRESENTER_PRODUCTION_RELEASE.md`                           |
| Presenter Store submission    | `docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md`            |
| Phase 7.30 Google Admin plan   | `docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`                   |
| Phase 7.30A-B1 local record    | `docs/PHASE7_30A_B1_IMPLEMENTATION.md`                           |
| Phase 7.30B2 source record     | `docs/PHASE7_30B2_AI_UNLOCK_FOUNDATION.md`                       |
| Phase 7.30D owner ledger       | `docs/PHASE7_30D_ADMIN_LEDGER.md`                                |
| Phase 7.30E Google-only source | `docs/PHASE7_30E_GOOGLE_ONLY_CUTOVER.md`                         |
| Phase 7.30F readiness contract | `docs/PHASE7_30F_HOSTED_HUMAN_READINESS.md`                      |
| Contest/public/commercial plan | `docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md` |
| Phase 7 production decision    | `docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`                      |
| Phase 7.27 production evidence | `docs/PHASE7_27_PRODUCTION_GATE_2026-07-22.md`                   |

If an older Phase document conflicts with these current documents and the real
code/migrations, treat the older document as historical evidence.

## 2. Local frontend and CI

- Basic commands and environment boundary: `README.md`
- CI and browser E2E: `docs/CI_AND_BROWSER_E2E.md`
- Production environment validation: `scripts/check-production-env.mjs`
- Non-live CI allowlist: `scripts/ci/run-nonlive-suite.mjs`

Recommended pre-commit sequence:

```bash
npm run cloud:doctor
npm run typecheck
npm run typecheck:phase3
npm run typecheck:e2e
npm run lint
npm run test:phase6-7-docs
npm run test:phase6-8-static
npm run test:phase7-1-edge
npm run test:phase7-1-static
npm run test:phase7-2-edge
npm run test:phase7-2-static
npm run test:phase7-2-quality
npm run test:phase7-25-edge
npm run test:phase7-25-static
npm run test:phase7-26-browser-pdf
npm run test:phase7-26-edge
npm run test:phase7-26-static
npm run test:phase7-26-load
npm run test:phase7-27-edge
npm run test:phase7-27-static
npm run test:phase7-27-load
npm run test:phase7-28b-display-realtime
npm run test:phase7-28b-lock-order
npm run test:phase7-28c-ai-master
npm run test:phase7-28c-ai-concurrency
npm run test:phase7-28-upgrade
npm run test:phase7-28-load
npm run build
git diff --check
```

Run `npm run test:ci:nonlive` when the complete non-live regression is required.
Phase 7.27 also requires `npm run test:phase7-27-upgrade`,
`npm run test:phase7-27-concurrency`, and both `test:e2e:phase7-27` modes before
its Local Gate can be completed. As of 2026-07-22 the clean reset, 1,171 pgTAP,
49 Worker tests, 55 non-live groups, upgrade/concurrency probes, real local
Edge/Postgres integration and repeated Chromium/WebKit desktop/mobile E2E are
PASS. A temporary hosted preview is deployed with the required preview flags ON
and no Journal Club run created. Final operational and human gates remain HOLD.

Phase 7.28 additionally requires the populated Phase 7.27 upgrade probe,
Display lock-order and AI-master two-connection concurrency probes, all Phase
7.28 pgTAP tests, static security/bundle checks, and the corresponding Desktop
Chromium/WebKit plus 390px Chromium local integration suites. The dated Phase
7.28 Local Gate record is authoritative for exact final counts. Its production
rollback starts with the 7.28B DB runtime gate or 7.28C server admission gate;
the 7.28A recovery-only creation flag remains OFF in normal rollout.

Phase 7.29 additionally requires clean/populated upgrade migration, full pgTAP,
RLS/grants, two-Admin and replay/idempotency probes, deterministic native-core
traces, loopback Host/Origin/Private Network Access tests, flag-OFF/ON browser
and manual-handover E2E, complete regressions and a truthful separation of
automated evidence from Native/Human/Hosted evidence. The applicable dated Local
Gate record is authoritative; absence of that record is not PASS.

## 3. Local Supabase

- Current local setup: `docs/supabase_setup.md`
- Phase 0 ownership/RLS baseline: `docs/PHASE0_GATE_2026-07-14.md`
- Lifecycle design: `docs/PHASE2_LECTURE_LIFECYCLE.md`
- Database authority: `supabase/migrations/`, `supabase/tests/` and
  `supabase/config.toml`

Never link or push a hosted project as part of local verification. Confirm the
URL is localhost/127.0.0.1 before a browser integration test.

## 4. PDF Publisher, Worker and R2

- Architecture/threat model: `docs/PHASE3_PRIVATE_PDF_DELIVERY.md` and
  `docs/PHASE3_REQUIREMENTS_AND_THREAT_MODEL.md`
- Browser publication: `docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md` and
  `docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md`
- Recovery Publisher implementation: `publisher/`
- Worker implementation/config: `cloudflare/asset-worker/`
- Production Phase 6.6 rollout: `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`

Local recovery R2 credentials belong only in `.env.publisher.local` or the
approved OS secret launcher. Browser publication receives no permanent R2
credential. Never print values during connectivity checks, and never enable the
Local writer while browser mode is active.

## 5. PowerPoint Presenter Bridge

- Preferred Microsoft Store MSIX packaging, `runFullTrust` justification,
  Partner Center values, bounded certification flow, listing copy and current
  HOLD items:
  `docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md`
- Current production release sequence and classroom acceptance:
  `docs/PRESENTER_PRODUCTION_RELEASE.md`
- The public privacy source is `public/presenter-bridge/privacy/index.html`; its
  canonical URL is
  `https://compass-interactive.pages.dev/presenter-bridge/privacy/`. A 200 SPA
  fallback is not a published privacy notice and does not pass the route gate.
- Store v1 is fixed to package version `1.0.0.0`, x64, `ja-JP`, Japan,
  Windows 11 24H2/build 26100+, Free, Public audience, and available but not
  discoverable through Direct link only. Microsoft Standard Application
  License Terms apply; Additional license terms stay blank.
- Store policy 10.14 account-type classification is unresolved. Partner Center
  identity, WACK, Store signing, clean-device no-added-auth acquisition, Office
  x86/x64 and rendered Display/student latency remain blocking gates.
- The exact Partner Center `https://apps.microsoft.com/...` listing URL is the
  only allowed production installer value for `VITE_PRESENTER_STORE_URL`.
  Missing or invalid configuration hides the CTA. Do not retain the Direct EXE
  or anonymous Velopack/R2 update feed as a production fallback.
- Store review access is Owner-issued to a reviewer-controlled dedicated Google
  account, fixes `instructor` and AI disabled, expires the invitation after
  seven days and membership fourteen days after issuance, and is revoked
  immediately after review. Passwords, TOTP seeds and recovery/session material
  are never shared.
- Design, threat boundary and rollback:
  `docs/PHASE7_29_POWERPOINT_PRESENTER_BRIDGE.md`
- Canonical rescue, dormant deployment and rollback:
  `docs/PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md`
- Browser, Edge and database flags remain independently default OFF.
- Local Publisher remains the separate recovery process on `43123`; Presenter
  Bridge uses only `127.0.0.1:43124`.
- Disable the database runtime gate first for rollback, then verify all active
  bindings are terminal and manual page controls work before disabling Edge and
  frontend admission.
- Do not treat browser/database tests as approval of a native binary. The
  current Store-compiled binary's 539 ms Office-readiness observation and the
  earlier unsigned single-monitor 500/500 COM result do not prove Store signing
  or acquisition, Office x86+x64, real Edge/Chrome HTTPS-to-loopback, final
  Display/student rendering, Store servicing, PowerPoint restart or venue
  Extend-display behavior. Those remain separate blocking gates.
- If Windows Application Control blocks a native build/test, stop that process
  and preserve the evidence. Do not disable or bypass the control; record the
  native gate as HOLD and resume through an approved signed execution path.
- Keep the existing five-second student snapshot/delta polling for this release.
  Three-second transitions, selective Realtime for slides/polls/comments and a
  possible Supabase Pro upgrade belong to a separate phase after the Presenter
  Store release passes production acceptance.

## 6. Google Admin identity and MFA (A-D exact-head PASS; E/F external execution HOLD)

- Detailed requirements, reuse matrix, AAL2/RBAC design and rollout:
  `docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`.
- Implemented source/local boundary, dormant controls, evidence scope and
  rollback: `docs/PHASE7_30A_B1_IMPLEMENTATION.md`.
- Implemented B2 default-OFF database foundation (historical source record):
  `docs/PHASE7_30B2_AI_UNLOCK_FOUNDATION.md`.
- Implemented B2.2a trust-anchor/control hardening:
  `docs/PHASE7_30B22A_ADMIN_CONTROL_HARDENING.md`.
- Implemented B2.2b AI-unlock Edge/browser and factor-transition source:
  `docs/PHASE7_30B22B_AI_UNLOCK_EDGE_BROWSER.md`.
- Implemented C1 private ownership and atomic dormant master admission:
  `docs/PHASE7_30C1_GOOGLE_AI_MASTER_ADMISSION.md`.
- Implemented D owner ledger, invitation and membership/session controls:
  `docs/PHASE7_30D_ADMIN_LEDGER.md`.
- Implemented E Google-only application source and dormant operator cutover:
  `docs/PHASE7_30E_GOOGLE_ONLY_CUTOVER.md`.
- Phase F source/local evidence, approval and rollback contract:
  `docs/PHASE7_30F_HOSTED_HUMAN_READINESS.md`.
- Phase order, role model, compatibility and gates: `docs/ROADMAP.md`, Phase 7.30.
- Agent/reviewer allocation: `docs/AGENT_EXECUTION_ROUTING.md`.
- Google session issuance is authorized only when the database runtime control
  and `PHASE730_ADMIN_IDENTITY_ENABLED` are both enabled. The separate
  `VITE_PHASE7_30_ADMIN_IDENTITY` flag controls UI exposure, not authorization;
  normal activation still enables all three together. The current application
  source has no shared Admin PIN login path. E's legacy database gate and
  historical rows remain until the separately authorized operator cutover; do
  not enable any Google control or apply the migration as evidence that the
  cutover is safe.
- B1 HMAC-binds the trusted Google subject, consumes a digest-only nonce within
  five minutes, verifies a fresh TOTP AMR timestamp, and only then creates one
  opaque AAL2 application session with eight-hour absolute and 30-minute idle
  expiry. An exact same-caller/session/JWT retry returns that same session;
  other nonce reuse is rejected. This is the exact transitional B1 source
  behavior; B1 does not grant lecture-workspace authority.
- The Phase 7.30B2 source migration now removes the idle expiry and anchors the
  application cap to `auth.sessions.created_at + 8 hours`. B2 implements the
  default-OFF continuous-session lifetime/invalidation database behavior; C2
  completed its unified verifier across every operational Admin Edge/RPC path.
  It never prompts for TOTP periodically during a lecture. Logout, backing
  `auth.sessions` removal, principal/environment/membership invalidation or the
  cap requires login again. B2.2a stores an approved factor-set
  hash/version/count on the principal
  and issues a dormant Google Admin session only when approval, the live set,
  the session binding and completed post-challenge JWT/AMR nonce evidence agree.
  Changed sets are reason-revoked and drain pending AI authority. The only
  automatic approval is an unbound `pending_mfa` principal's exact first 0-to-1
  factor during fresh completion. Existing verified but unbound sets require
  Edge-unwired, default-OFF operator adoption while issuance is OFF; migration
  performs no inferred backfill. B2.2b adds default-OFF factor add/remove
  rare-control with an exact pre/post-set transition and hash-only recovery. C1 adds private
  no-backfill lecture ownership and atomic PIN/browser proof-to-master admission
  while fencing child/provider authority. C2 applies the verifier to every
  operational Admin Edge/RPC path. D adds the owner ledger. E makes the 19
  remaining operational Admin Edge adapters Google-app-session only and adds
  explicit ownership claim/cutover evidence without activating it.
  Role changes take effect live; `can_use_ai=false` drains AI authority without
  ending the Admin session.
- Reuse from COMPASS is read-only and design-led. Interactive requires separate
  OAuth clients, callbacks/origins, Supabase provider secret, service identities
  and rollback; never copy secrets or deployment state.
- Google social login establishes AAL1. Privileged Admin access requires the
  separately verified Supabase Authenticator App TOTP AAL2 session in the
  initial implementation. The standard flow supports Google Authenticator;
  COMPASS configures no email MFA or custom MFA.
- Phase 7.30D exact-head DB/Local Edge/browser CI is recorded as PASS. E source
  evidence does not prove a Hosted release or authorize its irreversible
  database tombstone. Before E cutover, require fresh migration, pgTAP,
  two-connection concurrency, populated C2/D-head upgrades, generated types,
  DB lint, Google AAL2 browser coverage, an independently reviewed Hosted
  function/secret inventory and a two-owner recovery rehearsal.
- The B2 foundation and completed C integration retire repeated shared API-use PIN entry from the
  normal paid-AI UX. The initial path requires Google plus TOTP AAL2, active
  `can_use_ai`, an owner-managed server policy, a personal four-digit AI PIN (or
  its valid remembered-browser proof) and one lecture master CTA. The AI PIN is
  confirmed once for each new lecture master or explicit scope/cost escalation,
  never for each provider call; every provider start still rechecks scope,
  budget, concurrency, idempotency and lifecycle.
  The four-digit factor is server-verified only inside AAL2 with atomic rate
  limiting, and a remembered browser stores only a revocable
  browser-profile-bound credential backed by a non-extractable key. Dedicated
  AI Passkey and hardware-bound claims follow its separate gate. Browser
  enrollment uses a short-lived identity/session/TOTP-factor-set/Origin/key-bound
  nonce without another TOTP prompt. Caption-scope escalation rechecks only the
  AI proof inside the valid AAL2 session; downgrade and stop are free. AI-PIN
  rotation/revoke drains AI authority but preserves the Admin session.
- Five-minute fresh TOTP is used only for owner/principal, role/status, verified
  TOTP-factor-set, environment AI-policy, global-revoke and AI PIN factor
  enrollment/rotation/revoke/reset control-plane changes. Initial PIN enrollment
  immediately after login uses the already-fresh login TOTP with no additional
  prompt. Normal lecture operation, emergency stop, PIN verification, browser
  proof, AI master/escalation and child calls never prompt.
- E removes the `ADMIN_PIN` UI, issuer, browser storage and accepted application
  transport. Do not call its postgres-only cutover until every Hosted Admin Edge
  is independently confirmed Google-only and the deployment evidence digest is
  recorded. After personal-AI-PIN evidence, retire historical `BILLING_PIN`
  compatibility authority in a separate default-OFF migration before
  Production. Rollback is an immutable Google-only revision plus operator owner
  recovery, never a shared PIN.
- Phase F's local validator is read-only and defaults to `HOLD`. A valid
  source-only example can report `SOURCE_READY`, and the highest readiness
  decision is `READY_FOR_SEPARATE_HOSTED_EXECUTION`; `Production PASS` is not a
  valid output. It rejects Production/contest targets and any project ref,
  domain, email, user ID, credential, PIN, token or recovery material.
- Source-only evidence keeps frontend/server and new database activation OFF
  while legacy login remains true. Complete staging evidence records only
  separately approved ON-state observations (legacy login OFF), requires the
  corresponding frontend/server/post-DB values to match and can request only
  the next separately approved step; validation itself proves no Hosted state.
- `scripts/phase7-30f-hosted-readonly-preflight.sql` is an operator-reviewed
  staging evidence query, not an automated CI or cutover command. It keeps
  `preCutover` and `postCutover` distinct and inventories all six historical
  billing admission functions without revoking them.
- `private.get_phase7_30f_source_readiness_preflight_v1(uuid)` is the
  postgres-owner-only raw projection installed by
  `20260812142023_phase7_30f_source_readiness_preflight.sql`; `PUBLIC`, `anon`,
  `authenticated` and `service_role` cannot execute it. Raw operator output is
  never a tracked manifest. Store the redacted private manifest only at the
  repository-root ignored name `.phase7-30f-evidence*.json` and never force-add
  or upload it.
- Stop for separate approval before each staging mutation, OAuth/provider
  configuration, Human identity run, E cutover, `ADMIN_PIN` deletion, billing
  compatibility retirement, `BILLING_PIN` deletion and limited identity
  canary. No approval authorizes another row.

## 7. Contest publication and commercial readiness (planned)

- The authoritative contract is
  `docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`.
- GitHub Education is active. Main ruleset `20600565` enforces Pull Requests,
  the five configured exact-head CI contexts, conversation resolution and
  force-push/deletion denial. Required approving reviews remain zero for
  solo-owner continuity, and manual Copilot review is advisory. Phase 7.31A
  still requires the remaining supply-chain and protected-environment gates.
- A reviewer is the existing `[2] AI-capable Admin`: an invited personal Google
  identity with TOTP AAL2, `role=instructor`, and `can_use_ai=true` in an
  isolated real contest environment. It is not a new role, owner account,
  shared credential, secret viewer, or frontend mock.
- The contest environment uses separate Supabase/OAuth/OpenAI resources and a
  dedicated Private R2 bucket, binding and credential. Prefix-only separation
  from Production is prohibited.
- Repository visibility must remain private until the full history/PII/license
  audit passes and the user separately approves the exact visibility change.
- Phase 7.29B dormant placement does not satisfy this plan. The next formal
  integrated Production Gate is Phase 7.33 after Phase 7.29C, 7.30, 7.31 and
  7.32 requirements and their Hosted/Human evidence are complete.

### Private-source lecture-cycle candidate

- The contest-week candidate is governed by
  `docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md` and keeps GitHub private.
- Source is submitted as a privately delivered exact-SHA tracked-tree archive,
  manifest and checksums. It does not require Phase 7.31B public visibility.
- `docs/LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md` contains the controller and four
  lane task prompts. Write lanes use separate branches/worktrees; only the
  controller integrates.
- Before disconnecting the local PC, push the clean branch and run
  `npm run cloud:handoff`. `BRANCH_HANDOFF_READY` covers repository-side
  readiness only; record the separately observed running exact-SHA Codex Cloud
  task or GitHub Actions URL before disconnecting. That source/test work may
  continue, but Codex Remote, local Docker and Hosted/Human/Production actions
  do not continue autonomously.
- Retrospective Copilot review of private PRs #37/#38/#39/#42 and a line-limit
  refusal are non-required. Actionable findings remain normal review input.
- This path defers formal Phase 7.33, commercial 300-person SLA, multi-tenant,
  Presenter-device, public-source and legal/DPA/GA acceptance.

## 8. OpenAI and paid features

- Realtime billing/captions: `docs/PHASE4_BILLING_AND_REALTIME_CAPTIONS.md`
- Concurrency lanes: `docs/PHASE4_1_AI_CONCURRENCY_LANES.md`
- Material analysis/Poll proposals: `docs/PHASE5_MATERIAL_ANALYSIS_AND_POLL_PROPOSALS.md`
- Five-minute summaries: `docs/PHASE6_FIVE_MINUTE_SUMMARIES.md`

Live OpenAI scripts and real microphone tests are intentionally outside default
CI. They require an explicit cost boundary and separate human gate.

## 9. Production deployment

- Pages routing/build guidance: `docs/cloudflare_pages_deploy.md`
- Phase 0-6.5 integrated gate: `docs/PRODUCTION_GATE_PHASE0_6_5_2026-07-16.md`
- Development Production Review record:
  `docs/PRODUCTION_REVIEW_DEPLOYMENT_2026-07-16.md`
- Phase 6.6 production sequence: `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`
- Phase 6.6 human checks: `docs/PHASE6_6_HUMAN_TEST_CHECKLIST.md`
- Phase 7 production decision: `docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`
- Phase 7.27 production evidence: `docs/PHASE7_27_PRODUCTION_GATE_2026-07-22.md`
- Phase 7.27 temporary preview handoff:
  `docs/PHASE7_27_TEMPORARY_PREVIEW_HANDOFF_2026-07-22.md`

Standard order:

This order remains the formal operational gate. Completing a temporary preview
does not by itself authorize a rehearsal or production lecture.

1. backup, owner, change window and stop thresholds;
2. expand migration;
3. Edge/Worker capability and secrets with server flags OFF;
4. frontend with Vite flags OFF;
5. Advisor/lint/two-user/hosted smoke;
6. for browser PDF, stop Local Publisher and revoke/isolate its R2 writer;
7. real cross-service, 15 MiB and cleanup/rollback canaries;
8. enable Worker, then Edge, then frontend for a controlled flag canary;
9. telemetry and cost review;
10. gate record.

If Phase 7.29B is in scope, deploy its additive schema, then only the
JWT-protected `manage-presenter-connection` and compatible
`update-display-state` by explicit function name with runtime/admission OFF.
Leave `presenter-bridge-session`, its dedicated secret and the native Bridge
undeployed. Unscoped all-function deployment is prohibited. After the separate
7.29C Gateway, rate, proof-of-possession, signed-native, bounded automatic and
manual recovery credentials, real loopback and PowerPoint gates pass, the
machine endpoint can enter a separately authorized activation sequence. The
student five-second snapshot is never changed as part of this rollout.

Do not drop schema on rollback. Disable the feature and restore the previous
application/server version first.

## 10. Incident sequence

1. Stop/disable the affected feature; stopping paid work must not require a PIN.
2. Preserve audit and provider-ledger evidence.
3. Confirm whether ownership, secrets, data integrity or cost is affected.
4. Rotate the narrowest affected credential.
5. Roll back frontend/Edge/Worker or disable flags.
6. Repair forward with a clean/upgrade migration and regression evidence.
7. Record the incident and new prevention test.

Cross-user disclosure, unauthorized paid work, secret exposure, public R2 access
or post-close writes are immediate stop conditions.

## 11. Historical evidence

Files named `PHASE*_LOCAL_GATE_*`, `PRODUCTION_GATE_*` and dated deployment
records are immutable evidence for the commit and environment they describe.
They are not automatically current after a later migration or deployment.

Old milestone/Journal Club drafts remain useful for design history but may
describe removed Realtime behavior, development lecture IDs or manual SQL. Do
not execute an old manual instruction without checking current migrations and
the canonical documents above.
