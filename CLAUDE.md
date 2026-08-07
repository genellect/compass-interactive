# Claude Code Instructions

Read and follow `AGENTS.md` first. Use `docs/CLOUD_DEVELOPMENT.md` for environment setup, Docker/Dev Container commands, verification, isolation, and secret handling.

- Treat GitHub as the canonical source and work on a dedicated branch.
- Use the repository Dev Container instead of creating a separate machine-specific environment.
- Use `/demo` and `npm run cloud:check` for ordinary work.
- Use `.devcontainer/start-local-supabase.sh` only for the isolated local Docker stack.
- Never copy local `.env*`, hosted credentials, lecture codes, personal data, database dumps, or Production data into the repository or cloud environment.
- Do not call paid OpenAI APIs, link/push hosted Supabase, upload R2 assets, deploy Cloudflare, or change Production state without an explicit request for that external action.
