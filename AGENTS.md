# COMPASS Interactive Repository Instructions

## Scope

This private repository contains the COMPASS Interactive product, including Student, Admin, Display, Archive, Supabase migrations and Edge Functions, Cloudflare asset delivery, AI orchestration, and browser verification.

Read `README.md`, `PROJECT_GUIDE.md`, the relevant file under `docs/`, and the affected source and tests before editing.

## Cloud-first development

- `https://github.com/genellect/compass-interactive` is the canonical source. At task start, fetch it, record the exact `origin/main` SHA and its latest green CI run, then create one dedicated branch from that SHA in GitHub Codespaces or Codex Cloud.
- A local-only or ahead-only checkout is recovery input, never the new source of truth. Import it as a reviewed patch onto the current canonical branch, preserve provenance in the PR, and regenerate derived files from the current schema.
- Treat the Dev Container Specification as the single environment source of truth. Codespaces, VS Code + Docker Desktop, and the Dev Container CLI must use the same `.devcontainer/devcontainer.json`.
- Use one isolated Codespace and one branch per repository and change. Do not combine this checkout with the public COMPASS repository.
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
- This private user-owned repository currently has no enforceable branch protection without GitHub Pro. Until protection is enabled, PR-only integration and no-direct-main are mandatory procedural controls; never describe them as technically enforced.
- Local, CI, hosted, device, human, and Production acceptance are separate gates.

## Code Review Rules

- Flag any browser exposure of server-only secrets, especially new `VITE_` variables for API keys, service-role keys, PINs, or signing material.
- Flag ordinary development paths that can target hosted Supabase, paid OpenAI calls, R2 uploads, Cloudflare deployment, or Production data without an explicit fail-closed gate.
- Preserve server-authoritative authorization, RLS, idempotency, and repository isolation; tests and client-side feature flags do not replace these controls.
