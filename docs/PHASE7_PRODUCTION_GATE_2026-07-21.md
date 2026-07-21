# Phase 7 Production Gate — 2026-07-21

## Verdict

**HOLD — production reflection is not authorized.**

The repository's automated local gates through Phase 7.26 pass, but required
human and hosted evidence has not been executed against production-like Edge,
private R2 and Supabase services. Consequently this audit performed no push,
deploy, hosted migration, setting/secret change, feature-flag activation or paid
API request.

## Phase readiness

| Phase | Automated local | Human | Hosted/production |
| --- | --- | --- | --- |
| 6.7 documentation baseline | PASS | n/a | carry-forward review required |
| 6.8 security/session/timeout | PASS | HOLD where hosted auth UX applies | HOLD |
| 6.9 modularization/CI | PASS | n/a | committed-SHA CI not yet observed |
| 7.1 language/own comments/QR | PASS | real-phone QR and classroom review HOLD | HOLD |
| 7.2 verified academic answers | PASS | teacher literature review HOLD | HOLD |
| 7.25 automatic multidisciplinary answers | PASS | teacher source/wording review HOLD | HOLD |
| 7.26 browser PDF publication | automated Local PASS | real-PDF Admin/student/Display review HOLD | HOLD |

No Local PASS may be reinterpreted as hosted parity.

## Blocking evidence

1. Record production DB/R2/frontend backups, owners, change window, explicit stop
   thresholds and the currently deployed commit/deployment IDs. Preserve the
   current production build as an independently addressable rollback artifact.
2. Apply the additive migrations in a staging/hosted rehearsal, then run DB lint,
   Advisor, privilege/RLS inspection and two-user/two-lecture separation.
3. Run a real Edge -> Worker -> private R2 -> DB E2E proving hostile Origin,
   private/uncommitted denial, committed short-lived access, CSP/CORS and exact
   lecture/document binding.
4. Stop Local Publisher and revoke or isolate its R2 write credential. A flag or
   Local `register` rejection alone cannot stop an old credential from writing a
   manifest, so credential revocation is a hard gate.
5. Upload a representative 15 MiB/75-page bounded PDF and record Worker CPU,
   memory, wall duration, subrequests, R2 mutations and errors against the
   deployed Workers Free limits.
6. Race two real tracked Admin sessions through initiate, upload, discovery,
   finalize, abort and retry; prove idempotency, lecture-close behavior and
   merge-aware rollback.
7. Configure and test WAF or equivalent rate protection for the public
   publication route. Verify coordinator/JWK secret placement, least privilege,
   rotation and non-exposure.
8. Verify cleanup Cron ownership, execute permission, frequency and retry.
   Monitor backlog, error rate, `cleanup_exhausted_at` and permanent-sentinel
   object/storage growth.
9. Complete human review using a real PDF on Admin, student mobile/desktop and
   Display, plus real-phone QR and Phase 7.2/7.25 literature wording review.
10. Observe the immutable-Action CI on the final committed SHA, then execute the
    controlled 20-person canary and review the 300-person request/query model
    against hosted telemetry.

## Authorized rollout order after every blocker passes

1. Archive the current production commit, Pages deployment, Worker version,
   hosted migration state and R2 manifest generation.
2. Take/verify backups and announce the change window/owner/stop thresholds.
3. Apply expand-first database migrations; keep every new flag OFF.
4. Deploy Edge Functions/secrets with orchestration OFF.
5. Deploy Worker capability with upload/commit routes OFF.
6. Deploy the frontend with all new Vite flags OFF.
7. Run Advisor, hosted two-user separation and flag-OFF compatibility smoke.
8. Stop Local Publisher, revoke/isolate the R2 writer and prove it cannot mutate
   the bucket.
9. Enable and canary in this order: Worker route, Edge orchestration, frontend.
10. Run one controlled lecture, observe lifecycle/error/cost/cleanup telemetry,
    then record the final production decision before wider use.

## Stop and rollback

Stop immediately for an ownership/lecture-boundary breach, public/unscoped R2
access, secret exposure, unauthorized paid work, post-close mutation, orphan
growth without converging cleanup, unexpected Worker resource exhaustion or any
global G0-G7 failure.

Rollback order is not a simple version revert:

1. disable the frontend flag to stop new browser starts;
2. keep Edge/Worker available while every in-flight job becomes `active`,
   `aborted`, `expired` or `retired` and all due cleanup reaches a terminal state;
3. disable Edge orchestration, then Worker upload/commit routes;
4. only after the inflight/cleanup audit is empty, reissue an isolated Local R2
   credential and start Local Publisher recovery mode;
5. retain additive schema and active immutable objects until a later contract
   migration is separately approved.

## Evidence reference

- `docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md`
- `docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md`
- `docs/PHASE7_26_LOCAL_GATE_2026-07-21.md`
- `docs/ROADMAP.md`
- `docs/RUNBOOK_INDEX.md`

Production Gate can move from HOLD only through a new dated evidence record; a
commit, push, CI PASS or local browser inspection alone is insufficient.
