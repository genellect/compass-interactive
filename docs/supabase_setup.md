# Supabase Local Setup and Safety Boundary

Last reviewed: 2026-07-18

## 1. Purpose

The local Supabase stack is the required database/Auth/Edge integration
environment for COMPASS Interactive. It applies every migration from zero,
runs pgTAP and supports the local teacher/student Playwright flow without
contacting the Hosted project.

This document supersedes the old Phase 2-A development-lecture-ID instructions.
Do not manually apply old SQL files or enable table Realtime from an obsolete
milestone document.

## 2. Requirements

- Docker Desktop running with its WSL2 per-user backend;
- Node/npm matching `.node-version` and the committed lockfile;
- repository dependency `supabase` installed through `npm ci`;
- no active `supabase link` requirement for local work.

Discover CLI syntax from the pinned CLI before using an unfamiliar command:

```bash
npx supabase --help
npx supabase db --help
```

## 3. Frontend local environment

Create ignored `.env.local` from `.env.local.example`. For local Supabase, use
the API URL and publishable/anonymous key printed by:

```bash
npx supabase status -o env
```

Only `localhost` or `127.0.0.1` is accepted by the local E2E runner. Do not copy
a service-role key into a `VITE_` variable.

The browser-safe minimum is:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:<local-port>
VITE_SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
```

Keep Phase flags explicit. A local feature may be enabled only when the matching
migration and served Edge Function are present.

## 4. Start and rebuild from zero

```bash
npx supabase start
npx supabase db reset --local --no-seed
```

`db reset` is destructive only to the disposable local database. Before running
it, confirm the command says `--local` and the project URL is local.

Run all SQL tests and lint:

```bash
npx supabase test db --local
npx supabase db lint --local --fail-on error
```

Run the real multi-connection concurrency regression:

```bash
npm run test:phase4-1-concurrency
```

Stop without saving a local backup when finished:

```bash
npx supabase stop --no-backup
```

## 5. Serve Edge Functions locally

Create ignored `.env.edge.e2e.local` containing synthetic values only:

```dotenv
ADMIN_PIN=246810
ADMIN_SESSION_SECRET=compass-local-only-admin-session-secret-at-least-32-bytes
BILLING_PIN=135790
COMPASS_EDGE_ALLOWED_ORIGINS=http://127.0.0.1:4173
PHASE4_REALTIME_CAPTIONS_ENABLED=false
PHASE5_MATERIAL_ANALYSIS_ENABLED=false
PHASE6_SUMMARIES_ENABLED=false
```

Start the local Functions runtime:

```bash
npx supabase functions serve --env-file .env.edge.e2e.local
```

These values are test fixtures, not production credentials. Do not reuse a real
PIN or secret.

## 6. Browser integration

In a second terminal, set `TEST_ADMIN_PIN` to the same synthetic Admin PIN and
run:

```bash
npm run test:e2e:local
```

The runner obtains the local API URL/key from `supabase status -o env`, blocks
non-local HTTP(S) requests and drives create/start/join/comment/close with
separate teacher and student contexts.

## 7. Migration policy

- Use `npx supabase migration new <name>` after checking `--help` when a new
  migration phase is authorized.
- Keep migrations additive and expand-first.
- Test both an empty database and the previous-Phase upgrade fixture.
- Preserve `auth.uid()` participant ownership and explicit grants.
- Every exposed table requires RLS.
- Prefer invoker RPCs; privileged helpers remain private with fixed
  `search_path`, explicit caller verification and minimum grants.
- Run all pgTAP, DB lint, typecheck and load tests before recording a gate.

Do not use the Hosted dashboard SQL editor as an untracked local iteration
surface. A Hosted migration is a separate production operation.

## 8. Generated database types

`src/types/database.ts` is the current checked source contract. Phase 6.9 will
make Supabase CLI type generation deterministic and fail CI on drift. Until
then, any database phase must regenerate/compare types as explicit gate
evidence rather than assuming the file is current.

## 9. Hosted boundary

The following are never part of a normal local or default CI run:

- `supabase link`, `db push` or Hosted migration;
- Hosted Auth/Turnstile changes;
- production Edge secrets or deployment;
- real OpenAI calls or microphone tests;
- R2/Worker/Pages mutation.

Use `docs/RUNBOOK_INDEX.md` and the approved production runbook only after an
explicit production authorization.
