# Lecture Cycle Cloud Agent Playbook

Status: Planned
Scope: copy-ready instructions for parallel private cloud tasks implementing the Lecture Cycle Production Candidate Plan
Last verified: 2026-08-14

## 1. Use and ownership

These prompts implement
[`LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md`](LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md).
Each write-capable task receives its own branch/worktree. The controller alone
integrates commits and decides whether evidence is sufficient. Review tasks are
read-only. No task receives secret values in its prompt.

Cloud tasks may prepare work in parallel, but external gates remain ordered.
Do not connect to or view Hosted values, start Hosted mutation, configure
OAuth, run Human MFA, delete a secret, call a paid provider or start a
Production canary from these prompts unless the user separately authorizes that
exact action, environment, evidence scope and expiry.

## 2. Common instruction block

Prepend this block to every implementation task:

```text
Repository: private genellect/compass-interactive.
Read AGENTS.md, README.md, PROJECT_GUIDE.md, docs/ROADMAP.md,
docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md, and the files governing your
assigned surface before editing.

Start by fetching origin/main, recording its full SHA and latest green CI, then
create one dedicated non-main branch/worktree from that SHA. Never share a
write worktree with another task. Preserve unrelated user changes.

The current objective is Lecture Cycle Production Candidate quality, not
formal Phase 7.33, public GitHub, multi-tenant, Presenter-device, commercial
SLA, legal/DPA or GA. Keep GitHub private. Retrospective Copilot review of PRs
#37/#38/#39/#42 is excluded. A line-limit review refusal is non-blocking; real
actionable review findings are not.

Do not weaken or disable existing Admin, Student, Display, Review, PDF or AI UX
to make a gate pass. Use expand-first/default-OFF changes, keep stop/close/
revoke/downgrade available, and preserve the current Production revision until
a separately approved canary.

Use one write-capable agent by default. Add a bounded read-only reviewer only
when independent judgment materially improves a security, UX or release gate.
Do not spend beyond the currently approved additional GitHub Actions budget of
$10. Classify a failure before rerunning; use at most one targeted job-only
rerun for a proven runner transient.

Never read, print, copy or commit secret values, personal identities, lecture
codes, Production data, database dumps, protected files or actual Phase 7.30F
evidence. Do not link or mutate Hosted Supabase, deploy Cloudflare, call paid
OpenAI, change OAuth, delete a secret or activate Production without exact
separate authorization.

If browser authentication is required, open the exact trusted provider page
and instruct the user to type credentials, OTP, recovery code or scan a QR
directly. Never ask the user to paste that material into a prompt, terminal,
GitHub comment, log or evidence file.

Run the gate mapped by docs/GATE_ROUTING.md. Classify failures before changing
source. Report exact files, commands, results, omissions, external effects and
remaining HOLD items. Commit intentionally, push the private branch and open a
Draft PR; do not merge your own work.
```

## 3. Controller / integrator task

```text
Role: Lecture Cycle Production Candidate controller and sole integration owner.

Build the exact dependency/evidence ledger for the four lanes. Record canonical
main SHA and CI, allocate separate branches, and reject overlapping writes.
Accept only narrow commits with their required checks. Rebase or transplant
once near the final candidate, then freeze the head.

Verify the full acceptance matrix in
docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md: source/cloud, database, Admin
identity, teacher, student, Display, AI, PDF/Archive, browser/a11y, reliability,
private source package and rollback. Require denial and usable success paths.

Do not infer Hosted/Human/Production PASS from local evidence. Stop for each
Phase 7.30F approval. At final freeze, run source/static/type/lint/build/secret
checks once, delegate the Docker/browser matrix to required Actions, reconcile
all results on one exact SHA, and produce LECTURE_CYCLE_SOURCE_READY,
READY_FOR_BOUNDED_PRODUCTION_CANARY or HOLD. Never report Phase 7.33 PASS.
```

## 4. Lane A — Cloud and private source

```text
Role: cloud workspace and private source-submission owner.
Allowed writes: .codex/, .devcontainer/, cloud/setup scripts, CI wiring, package
scripts and the plan/runbook documentation assigned by the controller.

Make a fresh Codex Cloud task reproducible with bash .codex/setup.sh and a
Codespace reproducible with the locked Dev Container. Keep Codex agent-phase
internet OFF. Acquire dependencies only in setup or maintenance; enabling
agent-phase internet requires its own explicit approval and a narrow reviewed
domain allowlist. Add no Hosted or Production secret. Validate npm run
cloud:doctor, cloud:check and cloud:handoff contract behavior.

Design the private exact-SHA submission archive and manifest. It must be built
from git-tracked files, checksum verified, private-delivery only and exclude
.git, real env/evidence files, dumps, logs, PII, protected media and secrets.
Record CI URLs without attaching unsafe CI artifacts. Do not change GitHub
visibility or require public-source readiness.

Handoff: push the branch and run npm run cloud:handoff from a clean synchronized
head. `BRANCH_HANDOFF_READY` covers repository-side source/test readiness only.
Before disconnect, separately observe and record the exact-SHA Codex Cloud task
or GitHub Actions run URL.
```

## 5. Lane B — Staging identity and Hosted evidence

```text
Role: Phase 7.30F staging identity/evidence owner.
Read docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md and
docs/PHASE7_30F_HOSTED_HUMAN_READINESS.md in full.

Begin offline. Prepare the exact query, redaction, rollback and evidence-shape
procedure without connecting to or viewing Hosted values. Stop and request
`LECTURE_CYCLE_STAGING_READONLY_INVENTORY`, bound to the exact source SHA,
staging environment, expiry and permitted metadata fields. Only after that
approval may the operator verify source/deployment/rollback digests,
staging-only environment kind, frontend/server/database gate topology, 19
operational plus 3 identity/control Edge functions, secret-name presence
metadata, pre-cutover snapshot, Advisor counts and six historical billing
authority paths. Never record project refs, URLs, email, UUID, secret value,
TOTP, token, PIN or recovery material.

Stop separately for staging mutation, OAuth/provider configuration, Human run,
Google-only cutover, ADMIN_PIN deletion, billing retirement, BILLING_PIN
deletion and limited canary. For an approved Human run, prove two owners,
AI-enabled/standard/suspended instructors, AAL1-to-AAL2, recovery, factor/session
drain, account disable, last-owner, cross-user/cross-lecture denial and
personal-AI-PIN lifecycle. Rehearse immutable Google-only rollback and operator
owner recovery. The maximum local decision is a request for the next approval.
```

## 6. Lane C — Lecture UX and AI continuity

```text
Role: end-to-end teacher/student/Display/Review and AI quality owner.

Map each existing user-visible workflow before editing. Run the canonical Demo,
local Supabase and browser tests for desktop Chromium/WebKit and mobile/390px.
Prove one Google+TOTP login carries the instructor through a complete lecture
without periodic reauthentication. Verify Student join/reload/PDF/comments/
Poll/captions/summaries/Review and Display one-use replacement/revoke.

For AI, distinguish the grant-free lecture master/scheduler from actual provider
dispatch. Each provider dispatch must have one bounded child reservation and
ledger result; duplicate retries converge, limits fail closed and stop/
downgrade remain free. Provider failure must not interrupt basic lecture UX.

Do not relax replay protection, RLS, CORS, lifecycle, budget, browser-safety or
exact locators. A stale test may be corrected only after proving the production
contract. Pin every fixed regression with a narrow static or browser assertion.
Report screenshots/trace identifiers only when they contain no private data.
```

## 7. Lane D — Reliability, rollback and release

```text
Role: reliability and bounded-release safety owner.

Prepare backup/restore identifiers, previous immutable revision, owner recovery,
feature stop, provider outage, retry/idempotency, post-close denial, cleanup and
forward-repair evidence in staging. Confirm current Production stays untouched
during preparation.

Define measurable stop thresholds: ownership/AAL2 breach; unauthorized or
duplicate paid work; student or teacher workflow regression; Display replay;
post-close write; secret/PII leak; browser console/page error; overflow;
Critical/Serious a11y; backup/restore or rollback failure. Test that disabling
new admission preserves status, close, stop, revoke and downgrade.

Produce the exact rollout order: backup -> additive DB -> Edge/Worker OFF ->
Frontend OFF -> read-only health -> owner canary -> one complete lecture ->
bounded cohort. No automatic expansion. A natural zero-active-lecture window is
required; never end a class to manufacture one.
```

## 8. Independent review task

```text
Role: read-only security, lecture UX and release reviewer.

Review the exact frozen diff and evidence without editing. Look for existing UX
loss, auth loops, repeated TOTP, missing Student/Display/Review success paths,
RLS/ownership drift, post-close writes, secret or PII exposure, unexpected paid
calls, idempotency/concurrency gaps, rollback dependency on shared PIN, unsafe
source-package contents and overclaimed gate language.

Return findings ordered Critical, High, Medium, Low with exact file/evidence
locations. Critical/High block. A missing external gate is HOLD, not a source
failure. Do not access secret values or perform Hosted/Production actions.
```

## 9. Cross-task handoff record

Every task finishes with this exact structure:

```text
Base SHA:
Head SHA:
Branch and upstream:
Owned files:
Commits:
Tests PASS:
Tests NOT RUN and reason:
External actions performed:
Secrets/PII accessed: none | exact approved metadata class only
User-visible lecture impact:
Rollback/stop impact:
Findings remaining by severity:
Decision: GO for integration | HOLD
Next exact command or approval:
```

The controller rejects a handoff that omits head identity, tests, external
effects, user-visible impact or remaining HOLD items.
