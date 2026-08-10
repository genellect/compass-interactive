# COMPASS Interactive Repository Instructions

## Scope

This private repository contains the COMPASS Interactive product, including Student, Admin, Display, Archive, Supabase migrations and Edge Functions, Cloudflare asset delivery, AI orchestration, and browser verification.

Read `README.md`, `PROJECT_GUIDE.md`, the relevant file under `docs/`, and the affected source and tests before editing. Any work touching Admin identity, public-source preparation, contest access, tenancy, or the next formal Production Gate must also read `docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md` and `docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md` in full.

## Cloud-first development

- `https://github.com/genellect/compass-interactive` is the canonical source. At task start, fetch it, record the exact `origin/main` SHA and its latest green CI run, then create one dedicated branch from that SHA in GitHub Codespaces or Codex Cloud.
- A local-only or ahead-only checkout is recovery input, never the new source of truth. Import it as a reviewed patch onto the current canonical branch, preserve provenance in the PR, and regenerate derived files from the current schema.
- Treat the Dev Container Specification as the single environment source of truth. Codespaces, VS Code + Docker Desktop, and the Dev Container CLI must use the same `.devcontainer/devcontainer.json`.
- Use one isolated Codespace and one branch per repository and change. Do not combine this checkout with the public COMPASS repository.
- Keep this repository private until the Phase 7.31 public-source audit is complete and the user gives a separate approval immediately before the visibility change. A plan to publish later is not authorization to publish now.
- Follow `.devcontainer/devcontainer.json` and `docs/CLOUD_DEVELOPMENT.md` for setup and browser port access.
- Default to `/demo` and non-live tests. The demo must not call Supabase, OpenAI, Cloudflare R2, or other paid or Production services.
- Use the local Docker-based Supabase stack for database, RLS, migration, and integration work. Do not link or push to a hosted Supabase project during ordinary development.
- Run `npm run dev:doctor` after first container creation and environment-definition changes; never hide a missing dependency with an unrecorded global install.
- Run `npm run cloud:doctor` after Codex Cloud setup or maintenance. It is deliberately non-Docker and does not substitute for the Dev Container, local Supabase, Windows Device, Hosted, Human or Production gates.

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
- Main ruleset `20600565` is active: integration requires a Pull Request, all five configured CI contexts, and conversation resolution; force-push and branch deletion are blocked. Required approving reviews remain zero so the solo owner is not deadlocked. `strict_required_status_checks_policy` is intentionally `false`: a later `main` update does not by itself force a PR update and another full CI run, but every candidate PR head must still pass all five checks. Sync a high-risk PR with current `main` once near its final head when practical. A manual Copilot review is advisory and does not count as a required approval. No administrator bypass is currently configured; re-audit the live ruleset before a high-risk merge and never weaken it as an ordinary integration shortcut.
- Local, CI, hosted, device, human, and Production acceptance are separate gates.
- Phase 7.29B dormant placement is not feature activation or a formal Production Gate. The next formal integrated Production Gate is Phase 7.33 and remains HOLD until the Phase 7.29 activation blockers, Phase 7.30 identity work, Phase 7.31 governance/contest environment, and Phase 7.32 commercial-readiness contract all pass.

## Contest reviewer boundary

- A contest reviewer is not a new privileged role. The approved mapping is the ordinary `[2] AI-capable Admin`: `role=instructor` plus `can_use_ai=true` in an isolated contest environment.
- Invite each reviewer's own Google account. Never distribute a shared Gmail account, password, TOTP seed, recovery code, PIN, or secret.
- Reviewers may exercise the real own-lecture teacher workflow, including permitted paid AI within server-side limits. The initial path requires Google plus Supabase Authenticator App TOTP AAL2 (compatible with Google Authenticator), active `instructor + can_use_ai`, an enrolled personal four-digit AI PIN (or its valid remembered-browser proof), and the existing two-scope AI master CTA; no owner intervention or shared API PIN is required per lecture or per call. Do not add email MFA or a custom MFA system. A dedicated AI Passkey is a later replacement after its WebAuthn gate. The server still enforces environment, principal, lecture, lifecycle, model/action scope, budget, concurrency and idempotency on every provider start. They may not receive `owner` or global-admin capabilities, inspect other principals or lectures, change budgets/deployments, or view any secret value.
- Preserve lecture continuity after the Google-to-TOTP login. The application Admin session is capped at `auth.sessions.created_at + 8 hours`, has no 30-minute idle expiry and does not periodically prompt for TOTP. Reauthentication occurs only on explicit logout, disappearance of the backing `auth.sessions` row, principal/environment/membership invalidation, a verified TOTP factor-set change, or the eight-hour cap. Role changes are enforced live without dropping the Admin session; `can_use_ai=false` drains AI authority while preserving the Admin session.
- The four-digit AI PIN is a low-entropy intent factor, never standalone authentication or authorization. It is accepted only inside a valid TOTP AAL2 Admin session with atomic membership-wide and coarse abuse limits. The raw PIN may appear only in a trusted form and bounded TLS request, is cleared after the response and is never persisted or logged. Remembered-browser enrollment atomically consumes a short-lived nonce bound to identity, membership, session, verified TOTP factor-set version, AI-factor version, Origin and public-key fingerprint without prompting for TOTP again; the browser stores only a revocable browser-profile credential backed by a non-extractable key. Do not claim hardware binding before the WebAuthn gate.
- A personal AI PIN authorizes one lecture master and is not requested again for each child call. A new lecture or an explicit scope/cost escalation requires a new AI-unlock proof; same-scope retry is idempotent and downgrade, emergency stop and stop are free. AI-PIN rotation or revocation drains its master, browser credential and pending child authority but preserves the Admin login session. Session, TOTP factor, browser credential, membership/entitlement, policy and lecture transitions must use the approved idempotent drain matrix. The dedicated AI Passkey is purpose-bound and cannot log in or grant owner authority.
- A five-minute fresh TOTP step-up is reserved for rare control-plane changes to owner/principal, role/status, the verified TOTP factor set, environment AI policy, a global revoke, or AI PIN factor enrollment/rotation/revoke/reset. Initial AI PIN enrollment immediately after Google-to-TOTP login reuses that already-fresh login boundary and must not add another prompt. Normal lecture creation/operation, emergency stop, AI PIN verification, remembered-browser proof, AI-master activation/escalation and child AI calls must not prompt for it.
- `ADMIN_PIN` and `BILLING_PIN` are source-compatibility artifacts only. After the Phase 7.30C authorization migration, retire `ADMIN_PIN` completely before Production; revoked historical session rows may remain only for foreign-key/audit integrity. Remove `BILLING_PIN` and its compatibility RPC after personal-AI-PIN E2E and before Production. Rollback uses an immutable Google-only revision plus operator owner recovery, never a shared PIN. The personal four-digit `AI PIN` remains the normal intent factor and is not an Admin login credential.
- Contest identity, Supabase data, a dedicated Private R2 bucket/binding/credential, OpenAI project/budget, audit, and cleanup are isolated from Production. Prefix-only R2 separation, a frontend-only mock, or an authorization bypass is not acceptable.

## Code Review Rules

- Flag any browser exposure of server-only secrets, especially new `VITE_` variables for API keys, service-role keys, PINs, or signing material.
- Flag ordinary development paths that can target hosted Supabase, paid OpenAI calls, R2 uploads, Cloudflare deployment, or Production data without an explicit fail-closed gate.
- Preserve server-authoritative authorization, RLS, idempotency, and repository isolation; tests and client-side feature flags do not replace these controls.
