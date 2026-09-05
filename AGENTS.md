# COMPASS Interactive Repository Instructions

## Scope

This repository contains the COMPASS Interactive product, including Student, Admin, Display, Archive, Supabase migrations and Edge Functions, Cloudflare asset delivery, AI orchestration, and browser verification. Repository visibility is currently public; changing visibility is not part of ordinary product work.

Read `README.md`, `PROJECT_GUIDE.md`, the relevant file under `docs/`, and the affected source and tests before editing. Any work touching the approved educator authentication, lecture preparation/control, classroom Display, PDF recovery, Presenter UX, or bounded fast Production release must first read `docs/LECTURE_UX_FINAL_REQUIREMENTS_AND_IMPLEMENTATION_PLAN.md`; it is the final requirements contract for that lane and supersedes contrary older phase text within its scope. For Presenter Store version 1 distribution or activation, also read `docs/PRESENTER_PRODUCTION_RELEASE.md` and `docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md`; those current Store records supersede Work package G's earlier Direct-installer, new-gateway, and separate-approval assumptions while preserving its teacher-UX boundary. Any work touching Admin identity, public-source preparation, contest access, tenancy, or the next formal Production Gate must also read `docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md` and `docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md` in full. Work on the historical bounded private-source lecture-cycle candidate must additionally read `docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md` and use the task boundaries in `docs/LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md`.

## Cloud-first development

- `https://github.com/genellect/compass-interactive` is the canonical source. At task start, fetch it, record the exact `origin/main` SHA and its latest green CI run, then create one dedicated branch from that SHA in GitHub Codespaces or Codex Cloud.
- A local-only or ahead-only checkout is recovery input, never the new source of truth. Import it as a reviewed patch onto the current canonical branch, preserve provenance in the PR, and regenerate derived files from the current schema.
- Treat the Dev Container Specification as the single environment source of truth. Codespaces, VS Code + Docker Desktop, and the Dev Container CLI must use the same `.devcontainer/devcontainer.json`.
- Use one isolated Codespace and one branch per repository and change. Do not combine this checkout with the public COMPASS repository.
- Preserve the current public repository boundary. Public visibility does not authorize committing secrets, personal data, private lecture content, Production traces, or restricted artifacts. Any future visibility change remains an explicit owner operation.
- Follow `.devcontainer/devcontainer.json` and `docs/CLOUD_DEVELOPMENT.md` for setup and browser port access.
- Default to `/demo` and non-live tests. The demo must not call Supabase, OpenAI, Cloudflare R2, or other paid or Production services.
- Use the local Docker-based Supabase stack for database, RLS, migration, and integration work. Do not link or push to a hosted Supabase project during ordinary development.
- Run `npm run dev:doctor` after first container creation and environment-definition changes; never hide a missing dependency with an unrecorded global install.
- Run `npm run cloud:doctor` after Codex Cloud setup or maintenance. It is deliberately non-Docker and does not substitute for the Dev Container, local Supabase, Windows Device, Hosted, Human or Production gates.
- Before the local PC is disconnected, run `npm run cloud:handoff` from the pushed clean task branch. `BRANCH_HANDOFF_READY` proves repository-side readiness only; separately observe and record a running exact-SHA Codex Cloud task or GitHub Actions URL. Only that already-started source/test work continues; Codex Remote, local Docker/browser work, Hosted operations and Production actions still require their own live execution surface and approval.
- GitHub Actions capacity is scarce. Complete focused/local/static checks before pushing, batch related fixes into one candidate, freeze one exact head, and request the full required workflow once. Never use blind same-head reruns or push-per-fix iteration. After one log fetch and failure classification, only a proven runner transient may receive one targeted job-only rerun; a source failure requires a new locally validated head. Inspect the current repository and account budget state rather than relying on historical dollar amounts, and require explicit approval before any new ceiling increase or paid/long workflow that is not necessary for the release contract.

## Agent interoperability

- `AGENTS.md` is authoritative for every agent. `CLAUDE.md` and `.github/copilot-instructions.md` defer to this file and `docs/CLOUD_DEVELOPMENT.md`.
- Codex, Claude Code, GitHub Copilot, and VS Code agents must use the same Dev Container, lockfile, migrations, and verification commands.
- Do not run multiple write-capable agents in the same branch or worktree. Give parallel implementations separate branches or worktrees.
- When parallel review is explicitly requested, use the read-only agents under `.codex/agents/`; the main agent owns decisions and integration.
- Reuse from another repository starts with a read-only asset and license/configuration audit. Never copy its secrets, OAuth clients, service accounts, production data, migration history or deployment state. Shared Google Cloud projects or billing may be considered only through the separately approved Hosted IAM gate.

## Secrets and privacy

- Never commit `.env*`, `.dev.vars`, credentials, lecture codes, personal data, database dumps, tokens, or protected materials.
- Never put `OPENAI_API_KEY`, service-role credentials, PINs, signing keys, or private R2 credentials behind a `VITE_` prefix.
- Codespaces secrets must be personal or organization-managed and repository-scoped. Do not copy a local Production env file into a Codespace.
- Do not print secret values in terminal output, logs, screenshots, issues, PRs, or Codex prompts.

## Verification

For normal TypeScript changes, run the relevant subset and report omissions:

```bash
npm run security:secrets
npm run typecheck
npm run lint
npm run test:ci:nonlive
```

For UI changes, run the relevant Playwright demo test. For database, RLS, Edge Function, or local integration changes, start the isolated local Supabase stack and use the matching tests from `.github/workflows/ci.yml`.

`docs/GATE_ROUTING.md` maps each change surface to its responsible gate, records what `cloud:check` does _not_ cover, and lists the local Supabase gate in CI order. Use it instead of guessing from the phase number in a script name.

Do not run `test:phase5-openai-live`, `test:phase6-openai-live`, hosted migrations, R2 uploads, Cloudflare deploys, or Production checks unless the user explicitly requests that exact external action.

## Git and review

- Do not commit directly to `main`.
- Keep changes narrow, commit intentionally, push the branch, and open a Draft Pull Request.
- For this Lecture Cycle Production Candidate task, the controller has standing authorization to execute **Squash merge** without another user prompt after it verifies the exact repository and PR, fixes the expected head SHA, confirms the intended scope and private boundary, observes all eight required contexts green, confirms zero unresolved review threads and a mergeable PR, and finds no head or `main` drift. Lane agents hand off and do not merge independently. A missing or failing check, changed head, unresolved thread, scope drift, or any step that would imply Hosted, Human, secret, paid-provider or Production authorization remains `HOLD`. The controller records GitHub's returned merge SHA and inspects the automatic post-merge workflows; it must not start a manual rerun merely because Squash merge created a new SHA.
- Main rulesets `20600565` and `21259111` are active; the stricter `21259111` (`Protect main public source`) is the effective integration contract. It requires a Pull Request, conversation resolution, linear history, **Squash merge only**, and eight exact-head contexts: the five application/native CI jobs, `Build and verify the cloud workspace`, `Dependency review`, and `CodeQL JavaScript and TypeScript`. Force-push and branch deletion are blocked. Required approving reviews remain zero so the solo owner is not deadlocked, and no administrator bypass is configured. `strict_required_status_checks_policy=true` requires the candidate branch to include current `main`; any base or head change requires all eight contexts on the resulting head. A manual Copilot review is advisory and does not replace CodeQL or another required context. Re-audit the live rulesets before a high-risk merge and never weaken them as an ordinary integration shortcut.
- Retrospective Copilot review of private PRs #37, #38, #39 and #42 is excluded from the current gate. An exact-head Copilot line-limit refusal is non-blocking, while actionable review comments or Critical/High findings remain blocking.
- Local, CI, hosted, device, human, and Production acceptance are separate gates.
- Phase 7.29B dormant placement is not feature activation or a formal Production Gate. The next formal integrated Production Gate is Phase 7.33 and remains HOLD until the Phase 7.29 activation blockers, Phase 7.30 identity work, Phase 7.31 governance/contest environment, and Phase 7.32 commercial-readiness contract all pass.
- The Lecture Cycle Production Candidate is a narrower private-source, no-regression and bounded-canary contract. It may report only the states defined in `docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md` and never substitutes for Phase 7.33, commercial SLA, multi-tenant, Presenter-device, public-source or legal/GA acceptance.

## Contest reviewer boundary

- A contest reviewer is not a new privileged role. The approved mapping is the ordinary `[2] AI-capable Admin`: `role=instructor` plus `can_use_ai=true` in an isolated contest environment.
- Invite each reviewer's own Google account. Never distribute a shared Gmail account, password, TOTP seed, recovery code, PIN, or secret.
- Reviewers may exercise the real own-lecture teacher workflow, including permitted paid AI within server-side limits. The initial path requires Google plus Supabase Authenticator App TOTP AAL2 (compatible with Google Authenticator) and active `instructor + can_use_ai`. While that bounded application session remains valid, the own-lecture AI master CTA and a pre-start AI activation intent must work without a personal AI PIN, remembered-browser proof, owner intervention, shared API PIN, or another TOTP prompt. Do not add email MFA or a custom MFA system. The server still enforces environment, principal, membership, lecture ownership, lifecycle, model/action scope, budget, concurrency and idempotency on every provider start. Reviewers may not receive `owner` or global-admin capabilities, inspect other principals or lectures, change budgets/deployments, or view any secret value.
- Preserve lecture continuity after the Google-to-TOTP login. The application Admin session is capped at `auth.sessions.created_at + 8 hours`, has no 30-minute idle expiry and does not periodically prompt for TOTP. Reauthentication occurs only on explicit logout, disappearance of the backing `auth.sessions` row, principal/environment/membership invalidation, a verified TOTP factor-set change, or the eight-hour cap. Role changes are enforced live without dropping the Admin session; `can_use_ai=false` drains AI authority while preserving the Admin session.
- Personal AI PIN and remembered-browser enrollment surfaces are legacy control-plane compatibility only and are not prerequisites for ordinary own-lecture operation. New lecture UI and authorization paths must not depend on them. If retained temporarily, they may never authenticate an Admin, elevate a role, bypass AAL2, authorize another principal's lecture, or expose raw secret material. Any retained legacy `AI PIN factor enrollment/rotation/revoke/reset` remains a rare control-plane mutation requiring a fresh five-minute TOTP boundary and must not enter the ordinary lecture UI.
- A fresh TOTP step-up is reserved for rare control-plane changes to owner/principal, role/status, the verified TOTP factor set, environment AI policy, or a global revoke. Normal lecture creation/operation, pre-start preparation, Poll handling, AI-master activation, child AI calls, emergency stop, downgrade, stop, and close must not prompt for it.
- Phase 7.30E removes the `ADMIN_PIN` application path; the dormant operator cutover permanently fences its database verifier only after independently verified Hosted deployment evidence. Revoked historical session rows may remain only for foreign-key/audit integrity. Historical `BILLING_PIN` compatibility RPCs are retired in a separate boundary before Production. Rollback uses an immutable Google-only revision plus operator owner recovery, never a shared PIN.
- Contest identity, Supabase data, a dedicated Private R2 bucket/binding/credential, OpenAI project/budget, audit, and cleanup are isolated from Production. Prefix-only R2 separation, a frontend-only mock, or an authorization bypass is not acceptable.

## Code Review Rules

- Flag any browser exposure of server-only secrets, especially new `VITE_` variables for API keys, service-role keys, PINs, or signing material.
- Flag ordinary development paths that can target hosted Supabase, paid OpenAI calls, R2 uploads, Cloudflare deployment, or Production data without an explicit fail-closed gate.
- Preserve server-authoritative authorization, RLS, idempotency, and repository isolation; tests and client-side feature flags do not replace these controls.
