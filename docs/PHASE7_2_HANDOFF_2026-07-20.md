# Phase 7.2 Safe-Stop Handoff - 2026-07-20

Status: paused by user request at a safe local-only checkpoint
Production/hosted state: unchanged
Expected local branch: `phase7-2-local-checkpoint-20260720`

## 1. Completed work

- Implemented the Phase 7.2 teacher-requested academic answer flow across Edge,
  DB/RPC/RLS, Admin, student, Demo, live snapshot and R2 archive contracts.
- Added fixed-host bounded PubMed/Crossref verification, strict one-call Luna
  output, primary-source claim mapping and no-answer quality gates.
- Added exact-once cost settlement, dispatch audit, free pre-dispatch cancel,
  conservative ambiguous settlement, late-result discard and stale-operation
  recovery.
- Added hidden immutable drafts and teacher approve/hide/reject publication.
- Preserved older snapshot/history/archive RPCs and generated current DB types.
- Tightened direct comments/display compatibility reads to lecture members.
- Added requirements/design, quality fixture, load/static/Edge tests, pgTAP and
  clean/upgrade validation fixtures.
- Fixed defects found during integration: service-role fixture misuse, missing
  FK indexes, generic Batch settlement bypass, wrong usage-ledger lookup,
  missing live-state mapper import, Admin bundle regression, academic badge
  contrast and collapsed-source E2E behavior.

## 2. Evidence completed before pause

| Evidence | Result |
| --- | --- |
| Clean migration from zero | PASS |
| Full pgTAP | PASS - 20 files / 963 assertions |
| Phase 7.1 to 7.2 upgrade fixture | PASS - 12 assertions before the final prompt-audit refinement |
| App-schema DB lint | PASS - zero errors; only two older compatibility warnings |
| DB generated type drift | PASS - zero |
| Phase 7.2 Edge/static/load/quality | PASS - 9 Edge tests; 100% identifier validity; 20/20 claim support; zero per-student periodic load |
| Complete non-live suite | PASS - 45 groups before the final UI/bundle fixes |
| TypeScript and production build | PASS after mapper/lazy-load fixes |
| Bundle budget | PASS - Admin 78,758 / 92,109 B; CSS 85,555 / 88,449 B |
| Demo browser | PASS - 60/60, Desktop/Mobile Chromium/WebKit, three repetitions |
| Local Edge smoke | PASS - Auth, bounded input, tracked Admin sessions, PIN throttle and paid flags fail closed |
| Dependency audit | PASS - zero vulnerabilities |

No live OpenAI call was made. No microphone, hosted Supabase, Cloudflare,
production flag, public site, push or deployment was changed.

## 3. Safe-stop cleanup completed

- The local `supabase functions serve` process tree started for this gate was
  stopped and verified at zero remaining processes.
- The ignored synthetic `.env.edge.e2e.local` file was deleted.
- The normal Docker-based local Supabase stack remains available; it is not a
  production connection.
- Pre-existing user edits in the three protected Phase 6.6 documents remain
  outside the checkpoint commit.

## 4. Mandatory work on resume

Do not mark the Phase 7.2 Local Gate PASS until all items below pass after the
checkpoint commit:

1. Repeat the Phase 7.1-data upgrade sequence because the migration later added
   prompt-version audit storage:
   - reset through migration `20260719114320` with
     `validation/phase7_2_upgrade_fixture.sql`;
   - apply remaining migrations;
   - run `validation/phase7_2_upgrade_check.sql`;
   - restore the latest schema with a clean no-seed reset.
2. Recreate the ignored synthetic Edge env exactly as documented in
   `docs/CI_AND_BROWSER_E2E.md`, start local Functions and wait for readiness.
3. Run `npm run test:production-local-edge` and
   `npm run test:e2e:local:triple` with the matching synthetic Admin PIN.
4. Stop the local Edge process and delete the synthetic env again.
5. Run the final post-fix regression: full pgTAP, app-schema DB lint,
   `db:types:check`, all three typechecks, lint, `test:ci:nonlive`, production
   build, bundle test, secret scan, npm audit and `git diff --check`.
6. Inspect all staged files and confirm the protected Phase 6.6 documents,
   local env, test artifacts, credentials and generated transient output are
   absent.
7. Replace the checkpoint decision in the Local Gate report only after the
   evidence above is recorded. Human and Hosted gates must remain HOLD.

## 5. Human and hosted items that remain HOLD

- Teacher review of representative Japanese/English answers against the source
  papers, including insufficient/conflicting evidence and hide/reject paths.
- Human Admin/student/archive/mobile/desktop UX review.
- Phase 7.1 real-phone QR scan.
- Committed-SHA GitHub Actions evidence.
- Hosted Advisor, production two-user separation, live literature availability,
  current OpenAI model/price/entitlement check and controlled canary.

These are not authorized by the checkpoint and must not be inferred as PASS.
