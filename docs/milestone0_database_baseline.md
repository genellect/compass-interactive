# Milestone 0 database baseline

## Production safety rule

`supabase/migrations/20260710104958_remote_baseline.sql` is a snapshot of the
application schema that already exists in project `pfvedtqccblecuyjlfqh`.
Never push or execute this SQL against that project. Milestone 0 also leaves
the production migration history unchanged. Registering the baseline as
already applied, if ever required, is a separate production operation that
needs explicit approval after this milestone.

## Captured remote state

- PostgreSQL 17, PostgREST 14.5
- 10 application tables, all with RLS enabled
- 10 RLS policies
- Public RPCs: `join_lecture_by_code`, `get_lecture_session_state`, and
  `get_open_poll_results`
- Realtime publication: `comments` only
- Active Edge Functions: `verify-admin-pin`, `manage-lectures`, and
  `update-display-state`; all require JWT verification
- `lecture_sessions` and `lecture_admin_codes` intentionally have no public
  policy. They are reached through narrow RPCs or the service role.

The machine-readable inventory is in
`supabase/baseline/remote-schema-manifest.json`. Generated Data API types are in
`src/types/database.ts`.

## Platform-managed RLS event trigger

Remote inspection showed `public.rls_auto_enable()` is owned by `postgres`, has
`search_path=pg_catalog`, and is attached to the `ensure_rls` event trigger for
table creation. It is treated as platform configuration and intentionally not
included in the application baseline. Every application table still enables
RLS explicitly in the migration.

## Empty-environment reconstruction

The hosted validation uses a temporary empty Free project so production stays
untouched. The same reconstruction can be repeated locally when Docker Desktop
is available:

```powershell
supabase start
supabase db reset --local --no-seed
supabase test db supabase/tests/baseline_smoke_test.sql --local
npm run test:supabase:static
```

The pgTAP smoke test reconstructs the schema from the migration, checks RLS and
Realtime configuration, and exercises anonymous join, comment, like, poll, and
aggregate-RPC flows inside a transaction. Hosted validation additionally checks
Data API status codes, a live Realtime insert subscription, and all three Edge
Functions with validation-only dummy secrets.

## Hosted validation result

The baseline was applied once to the empty temporary Free project
`compass-interactive-baseline-validation` in Tokyo. The production database,
production migration history, and production secrets were not changed.
After all checks passed, temporary project `ekeayjrxepmhkoonbwdw` was deleted
with explicit approval. The project list was then rechecked and contained only
the healthy production project `pfvedtqccblecuyjlfqh`; its migration history
remained unchanged.

- pgTAP: 19/19 passed
- Data API: public RPCs returned 200; permitted RLS inserts returned 201;
  private table reads returned 401
- Realtime: an anonymous `comments` INSERT subscription received the expected
  event after the new project's platform Realtime migrations completed
- Edge Functions: all three sources matched the production deployments,
  remained `verify_jwt=true`, and returned 200 with validation-only dummy
  secrets; a request without JWT returned 401
- Canonical schema comparison: tables, columns, constraints, indexes, policies,
  triggers, functions, table/function privileges, and publication membership
  all matched the captured production application schema

The Advisor output also matched the captured design. The only expected
differences were the excluded platform-managed `rls_auto_enable` function and
unused-index statistics on the fresh validation database. Existing warnings
are intentionally not repaired in this baseline; security and performance
hardening must be additive migrations after Milestone 0.

## SECURITY DEFINER classification

The three public RPCs are intentional public API endpoints. The following are
internal helpers in the current remote schema:

- `is_lecture_open`
- `participant_belongs_to_lecture`
- `is_poll_open`
- `emit_poll_result_refresh_event`

The first three are referenced by RLS policies. PostgreSQL evaluates policy
expressions with the caller's privileges, so simply revoking `EXECUTE` from
`anon` and `authenticated` would make the existing INSERT/SELECT policies fail.
The safe follow-up is an additive migration that moves those helpers to a
non-exposed schema, updates policies and RPC bodies to use qualified names, and
then removes their public-schema definitions. That change must not be hidden in
this already-applied baseline.

`emit_poll_result_refresh_event` currently has no trigger attached and its
table is not in Realtime. It can be moved or removed in the same reviewed
follow-up migration.

## Edge Function smoke checks

The remote function inventory was read back during baseline capture. The local
static test confirms each deployed function has corresponding source and an
explicit `verify_jwt = true` entry in `config.toml`. A full local invocation
test runs with `supabase start`; production smoke tests must use invalid or
read-only requests and must never expose service-role or Admin secrets.

## Future changes

Do not restore SQL under `supabase/manual/`. Create every schema change with:

```powershell
supabase migration new descriptive_name
```

Reset and test the local database before pushing the new migration.
