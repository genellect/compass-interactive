# Phase 2 Local Gate — 2026-07-14

## Decision

**LOCAL PASS / PRODUCTION PENDING**

Phase 2 is locally implementable and regression-clean. It is not authorized for
production use yet. No Hosted Supabase project, Hosted Auth setting, Cloudflare
resource, public Web deployment, external AI provider, or production feature
flag was changed. Both Phase 1 and Phase 2 client flags remain OFF by default.

The independent Git commit is the source of truth for the final hash; the hash
is reported in the final handoff because a commit cannot contain its own hash.

## Scope evidence

- Pre-implementation code audit: `docs/PHASE2_REQUIREMENTS_MATRIX.md`
- Detailed architecture, failure behavior and rollback:
  `docs/PHASE2_LECTURE_LIFECYCLE.md`
- Expand-first migration:
  `supabase/migrations/20260714080706_phase2_lecture_lifecycle.sql`
- Phase 2 lifecycle pgTAP:
  `supabase/tests/phase2_lecture_lifecycle_test.sql`
- Local Advisor-equivalent pgTAP:
  `supabase/tests/phase2_security_advisor_test.sql`

The user's unstaged `PROJECT_GUIDE.md` change was neither edited nor staged.
Ignored `dist/` and TypeScript build cache output were not included.

## Database gate

| Check | Result |
| --- | --- |
| Clean database, all migrations from zero | PASS |
| Upgrade from Phase 1 migration `20260714021129` | PASS |
| Upgrade fixture row/count preservation | PASS |
| Open legacy row hard-stop backfill/cap | PASS |
| Closed legacy row close/archive backfill | PASS |
| All pgTAP files | PASS — 8 files, 289 assertions |
| Phase 0 security baseline | PASS — original 27 assertions |
| Phase 2 lifecycle suite | PASS — 96 assertions |
| Phase 2 Advisor-equivalent suite | PASS — 14 assertions |
| `supabase db lint --local` | PASS — zero findings |
| Manual-close/worker race with two DB connections | PASS |
| Repeated close/archive execution | PASS, idempotent |

The two-connection race produced one persisted terminal transition:
`manual | concurrent-manual | 1 close event`; the automatic contender returned
`changed=false`. Exact-deadline authorization is closed (`hard_stop_at >
statement time` is required), while a lecture one instant before the deadline
remains open.

The upgrade test started from the Phase 1 schema, inserted draft/open/closed
lectures plus participant, comment and Poll data, applied only Phase 2, and
verified row counts and relationships were unchanged. New lifecycle/control
rows and 90-minute/30-day derived timestamps were populated.

## Security gate

- Phase 0 `auth.uid()` participant ownership checks remain in every student
  mutation path.
- New public tables have RLS enabled, no browser policies, and no
  `anon`/`authenticated` table privileges.
- Public RPCs are `SECURITY INVOKER`.
- Required internal `SECURITY DEFINER` functions are confined to `private`, use
  fixed empty `search_path`, schema-qualified objects, explicit caller checks at
  the exposed boundary, and minimum grants.
- UPDATE policy coverage includes both `USING` and `WITH CHECK` where browser
  updates exist.
- Deadline/archive worker predicates have partial indexes and bounded,
  `SKIP LOCKED` batches.
- No OpenAI key, Supabase service-role value, local project credential, or
  production endpoint was added to the client or migration.

Hosted Security Advisor was deliberately not called because this phase is
local-only. The local Advisor-equivalent suite checks RLS, grants, function
security and required indexes; Hosted Advisor must be rerun after Phase 6
deployment.

## Frontend and Edge gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| demo repository tests | PASS |
| Phase 1 live-state tests | PASS |
| Admin lifecycle tests | PASS |
| PDF sync tests | PASS |
| Supabase static checks | PASS |
| Phase 2 lifecycle frontend tests | PASS |
| production build | PASS |
| `git diff --check` | PASS |

The build generated only ignored local artifacts. The Phase 2 browser behavior
is gated by `VITE_PHASE2_LECTURE_LIFECYCLE=false`. With the flag OFF, Phase 1
polling behavior remains unchanged. Server deadline/RLS enforcement is additive
and does not depend on the flag.

## Load gate

The analytical 90-minute model passed for both target sizes:

| Metric | 20-person Free MVP | 300-person Pro lecture |
| --- | ---: | ---: |
| Existing Phase 1 snapshot requests | 21,600 | 324,000 |
| Phase 2 student requests added during live lecture | 0 | 0 |
| Lifecycle Realtime subscriptions added | 0 | 0 |
| Maintenance calls per 90-minute lecture | 90 | 90 |
| Maintenance steady rate | 0.0167 req/s | 0.0167 req/s |
| Terminal fallback requests per client close | at most 2 | at most 2 |
| Archive preview after close | at most 1/member | at most 1/member |

The archive payload is capped at 500 visible comments, is fetched once rather
than polled, and excludes participant-private Poll/like state. Maintenance load
is per database, not multiplied by student count. This does not constitute a
Hosted capacity guarantee; Phase 6 still requires production telemetry and a
bounded canary.

## Rollback and recovery gate

- Apply is one transactional expand-first migration.
- Operational rollback is roll-forward: flags OFF, remove/revert frontend and
  Edge artifacts, unschedule only the recorded Phase 2 Cron job, and retain
  additive lifecycle/audit columns.
- No down migration drops audit or usage data.
- Archive at day 30 is logical only. `archived` can be changed to `restored` by
  the private service-only recovery function; no lecture is reopened and no
  student access window is extended.
- Physical Supabase/Cloudflare deletion is not implemented and requires a later
  separately approved dry-run/export/recovery design.

## Production rollout prerequisites after Phase 6

1. Record production backup, schema/version, rollback thresholds and current
   Phase 0/1 gate evidence.
2. Apply the expand-first migration while both flags remain OFF.
3. Run Hosted Advisor, DB lint, grants/RLS/function checks and old v1/v2 RPC
   compatibility tests.
4. Deploy the protected lifecycle/AI-control Edge code; confirm no browser
   bundle contains privileged credentials.
5. Deploy the frontend with both flags still OFF.
6. Confirm `pg_cron` availability, owner and duplicate-job policy; manually run
   the maintenance function on an empty due set before scheduling the bounded
   minute job.
7. Run two-user ownership separation, exact-deadline, manual/automatic race,
   late-AI discard and 30-day fixture tests in the production gate environment.
8. Run the 20-person canary, observe snapshot latency, RPC failures, polling
   volume, write rejection and Cron history, then expand toward 300 only after
   thresholds pass.
9. Record the Hosted gate. Feature activation remains a separate explicit
   decision after Phase 6.

## Unresolved decisions

1. The existing Admin token can audit only `admin-session`, not an individual
   teacher. Accept that MVP identity or add teacher accounts before activation.
2. Confirm Hosted `pg_cron` ownership and scheduling policy at rollout; no job is
   created by this migration.
3. Reprice and approve the conservative AI control defaults when the actual
   models are chosen; billing PIN enforcement belongs to the paid-provider
   integration phase.
4. Define the later summary table before extending the archive response.
5. Define Cloudflare PDF access expiry/deletion and the physical Supabase
   deletion workflow separately. Neither action is safe to infer in Phase 2.
