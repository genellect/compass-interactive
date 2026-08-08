# COMPASS Interactive Repository Instructions

## Scope

This private repository contains the COMPASS Interactive product, including Student, Admin, Display, Archive, Supabase migrations and Edge Functions, Cloudflare asset delivery, AI orchestration, and browser verification.

Read `README.md`, `PROJECT_GUIDE.md`, the relevant file under `docs/`, and the affected source and tests before editing.

## Cloud-first development

- GitHub is the canonical source. Start new work from the latest `origin/main` in GitHub Codespaces or Codex Cloud.
- Treat the Dev Container Specification as the single environment source of truth. Codespaces, VS Code + Docker Desktop, and the Dev Container CLI must use the same `.devcontainer/devcontainer.json`.
- Use one isolated Codespace and one branch per repository and change. Do not combine this checkout with the public COMPASS repository.
- Follow `.devcontainer/devcontainer.json` and `docs/CLOUD_DEVELOPMENT.md` for setup and browser port access.
- Default to `/demo` and non-live tests. The demo must not call Supabase, OpenAI, Cloudflare R2, or other paid or Production services.
- Use the local Docker-based Supabase stack for database, RLS, migration, and integration work. Do not link or push to a hosted Supabase project during ordinary development.
- Run `npm run dev:doctor` after first container creation and environment-definition changes; never hide a missing dependency with an unrecorded global install.

## Agent interoperability

- `AGENTS.md` is authoritative for every agent. `CLAUDE.md` and `.github/copilot-instructions.md` defer to this file and `docs/CLOUD_DEVELOPMENT.md`.
- Codex, Claude Code, GitHub Copilot, and VS Code agents must use the same Dev Container, lockfile, migrations, and verification commands.
- Do not run multiple write-capable agents in the same branch or worktree. Give parallel implementations separate branches or worktrees.
- When parallel review is explicitly requested, use the read-only agents under `.codex/agents/`; the main agent owns decisions and integration.

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
- Local, CI, hosted, device, human, and Production acceptance are separate gates.

## Code Review Rules

- Flag any browser exposure of server-only secrets, especially new `VITE_` variables for API keys, service-role keys, PINs, or signing material.
- Flag ordinary development paths that can target hosted Supabase, paid OpenAI calls, R2 uploads, Cloudflare deployment, or Production data without an explicit fail-closed gate.
- Preserve server-authoritative authorization, RLS, idempotency, and repository isolation; tests and client-side feature flags do not replace these controls.
