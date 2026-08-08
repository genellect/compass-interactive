# Claude Code Instructions

Read and follow `AGENTS.md` first. Use `docs/CLOUD_DEVELOPMENT.md` for environment setup, Docker/Dev Container commands, verification, isolation, and secret handling. Both override this file wherever they conflict.

## Posture

Codex is the primary development environment for this repository; Claude Code is secondary. Both use the same Dev Container, the same `package-lock.json`, the same migrations, and the same verification commands. Do not introduce a Claude-specific environment, dependency, or gate.

Do not run two write-capable agents in the same branch or worktree. Give parallel implementations separate branches.

## Boundaries

- Treat GitHub as the canonical source and work on a dedicated branch. Never commit directly to `main`.
- Use the repository Dev Container instead of creating a separate machine-specific environment.
- Use `/demo` and `npm run cloud:check` for ordinary work.
- Use `.devcontainer/start-local-supabase.sh` only for the isolated local Docker stack.
- Never copy local `.env*`, hosted credentials, lecture codes, personal data, database dumps, or Production data into the repository or cloud environment.
- Do not call paid OpenAI APIs, link/push hosted Supabase, upload R2 assets, deploy Cloudflare, or change Production state without an explicit request for that external action.
- Never report a gate you did not run as passing. An unavailable gate is "not executed", not "passed".

## Repository assets for Claude Code

| Path                             | Purpose                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/`                | Read-only reviewers: `repo-mapper`, `quality-reviewer`, `security-reviewer`. Mirrors `.codex/agents/`. The main agent owns decisions and integration.     |
| `.claude/commands/`              | `/cloud-check`, `/demo-e2e`, `/local-supabase`, `/handoff`.                                                                                               |
| `.claude/hooks/session-start.sh` | SessionStart setup for Claude Code on the web. Installs npm dependencies and the Playwright browsers. Idempotent and fail-soft; it never starts Supabase. |
| `.claude/settings.json.example`  | Hook registration plus a permission allowlist encoding the `AGENTS.md` boundary.                                                                          |

Run `/handoff` before opening a Draft PR. It checks the work against the 完了基準 in `docs/CLOUD_DEVELOPMENT.md` and forces unrun gates to be recorded as not executed.

## Activating the settings example

`.claude/settings.json` is gitignored, so the permission allowlist is a per-user opt-in rather than a repository default. To activate it:

```bash
cp .claude/settings.json.example .claude/settings.json
```

The `deny` list mirrors the forbidden-command list already enforced by `scripts/ci/run-nonlive-suite.mjs`: the live OpenAI suites, `test-pdf-sync-hosted`, `supabase link`, `supabase db push`, `wrangler deploy`, and the Cloudflare deploy scripts. It also denies reads of `.env*`, `.env.publisher*`, `.dev.vars*`, and service-role material. That deny pattern also covers the committed `*.example` templates; this is deliberate fail-closed behavior, and the templates are described in `docs/` where their contents matter.

The permission list is enforcement, not instruction. It is not a substitute for `AGENTS.md`, and an action being permitted does not make it in scope.
