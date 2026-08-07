# GitHub Copilot Repository Instructions

`AGENTS.md` is the authoritative repository policy. `docs/CLOUD_DEVELOPMENT.md` defines the shared Codespaces, Docker, Codex, Claude Code, and VS Code workflow.

- Use `npm run dev:cloud` for browser development and `npm run cloud:check` for the default non-live gate.
- Use `/demo` by default. Use `.devcontainer/start-local-supabase.sh` only for isolated Docker-based database work.
- Keep COMPASS Interactive and public COMPASS in separate repositories, containers, branches, and pull requests.
- Never expose server-only keys through `VITE_`, and never generate, paste, log, or commit secrets, lecture codes, personal data, dumps, or Production environment files.
- Do not target hosted Supabase, paid OpenAI, R2, Cloudflare deployment, or Production data without an explicit task-specific approval.
- Prefer a Draft Pull Request and include the exact validation performed.
