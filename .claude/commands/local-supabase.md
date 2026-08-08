---
description: Start the isolated local Supabase stack for database, RLS, migration, and Edge Function work
---

Start the repository-only local stack:

```bash
bash .devcontainer/start-local-supabase.sh
```

Use this **only** for database, RLS, migration, Edge Function, or local integration work. It needs a Docker daemon, so it runs in the Dev Container or Codespaces — not in Codex Cloud. Ordinary UI and TypeScript work does not need it.

The script is fail-closed and will:

- start the Supabase CLI stack on the Dev Container's isolated Docker daemon
- apply every migration to an empty local database
- run pgTAP and the database lint
- verify the frontend URL is `127.0.0.1` or `localhost`
- generate only browser-public local values into the ignored `.env.local`
- refuse to overwrite an existing `.env.local` that it does not own

Hard boundaries, from `AGENTS.md`:

- Never run `supabase link`, `supabase db push`, a remote migration, or a Production data copy.
- Never copy a local or hosted `.env*` into this environment.
- If `.env.local` overwrite is refused, do not delete or force it. Report the conflict and confirm the owner and purpose.

After the stack is up, run the local gate matching the change, using `.github/workflows/ci.yml` to identify which job owns it — typically the local E2E projects (`test:e2e:phase7-27:local`, `test:e2e:phase7-28b:local`, `test:e2e:phase7-28c:local`) and `db:types:check`.

Report which migrations applied, whether pgTAP and lint passed, and which local E2E projects ran. A local gate does not substitute for a Hosted or Production gate.

$ARGUMENTS
