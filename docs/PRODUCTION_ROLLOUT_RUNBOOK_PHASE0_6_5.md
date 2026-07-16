# Phase 0-6.5 production rollout runbook

This runbook starts only after the local Production Gate report is accepted.
Every feature flag stays OFF until the relevant canary step.

## 1. Preflight

1. Record the production database backup, rollback owner, change window and
   stop thresholds.
2. Confirm the target Git commit and a clean build from `npm ci`.
3. Run `npm run production:check` with the intended Pages environment.
4. Confirm no existing Cron job uses either COMPASS job name.
5. Confirm the stable Pages origin. If it is not
   `https://compass-interactive.pages.dev`, update both Edge
   `COMPASS_EDGE_ALLOWED_ORIGINS` and the Worker production config before
   deployment.

## 2. Database first

1. Keep all frontend and Edge feature flags OFF.
2. Apply all outstanding expand migrations through
   `20260716073719_production_gate_hardening.sql`.
3. Run Hosted Advisors and DB lint.
4. Verify:

   ```sql
   select jobid, jobname, schedule, active, username, command
   from cron.job
   where jobname like 'compass-%'
   order by jobname;
   ```

5. Run the maintenance function once:

   ```sql
   select private.run_lecture_lifecycle_maintenance(50, 25);
   ```

6. Inspect `cron.job_run_details` after the next minute.
7. Confirm legacy snapshot/archive RPCs still exist and Phase 0 two-user
   ownership separation still passes.

## 3. Edge secrets and functions

Set secrets in Supabase Edge only:

```text
ADMIN_PIN
ADMIN_SESSION_SECRET        # random, independent, at least 32 bytes
BILLING_PIN                 # separate from ADMIN_PIN
COMPASS_EDGE_ALLOWED_ORIGINS
OPENAI_API_KEY
PHASE4_REALTIME_CAPTIONS_ENABLED=false
PHASE5_MATERIAL_ANALYSIS_ENABLED=false
PHASE6_SUMMARIES_ENABLED=false
PDF_ACCESS_PRIVATE_JWK
PDF_ACCESS_PUBLIC_JWK
PDF_ACCESS_ISSUER
PDF_ACCESS_AUDIENCE
PDF_ASSET_TICKET_SECRET
PDF_RETENTION_SYNC_SECRET
```

Deploy all Edge Functions. Keep `verify_jwt=true` for browser functions and
`verify_jwt=false` only for the separately authenticated retention feed.

The implementation currently retains the Hosted-provided legacy
`SUPABASE_SERVICE_ROLE_KEY` for privileged internal clients while the project
uses a publishable key in the browser. Do not deactivate legacy keys until the
Edge service-client migration to the new secret-key model is completed and
tested.

## 4. R2, Publisher and Worker

1. Create private R2 Standard bucket `compass-private-pdf-assets`.
2. Do not enable public bucket access.
3. Create a bucket-scoped Object Read & Write token for the teacher Publisher.
4. Install Publisher credentials through the approved OS secret launcher.
5. Set Worker secrets:

   ```text
   PDF_ACCESS_PUBLIC_JWK
   PDF_ASSET_TICKET_SECRET
   PDF_RETENTION_SYNC_SECRET
   PDF_RETENTION_FEED_URL
   ```

6. Dry-run:

   ```powershell
   npm run worker:deploy:production:dry-run
   ```

7. Deploy with `cloudflare/asset-worker/wrangler.production.jsonc`.
8. Record the Worker URL and verify the 30-minute Cron Trigger.
9. Publish and remove a disposable PDF before enabling Phase 3.

## 5. Pages with all flags OFF

Set:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_TURNSTILE_SITE_KEY
VITE_PDF_PUBLISHER_URL=http://127.0.0.1:43123
VITE_PDF_WORKER_BASE_URL=<production Worker HTTPS URL>
VITE_PHASE1_SYNC_PROTOCOL=false
VITE_PHASE2_LECTURE_LIFECYCLE=false
VITE_PHASE3_PRIVATE_PDF=false
VITE_PHASE4_REALTIME_CAPTIONS=false
VITE_PHASE5_MATERIAL_ANALYSIS=false
VITE_PHASE6_SUMMARIES=false
VITE_PHASE6_5_COMMENT_NICKNAMES=false
```

Never set a server secret with a `VITE_` prefix.

Deploy Pages, then verify `/join`, `/lecture`, `/display`, `/admin` and
`/demo`, including the security headers in `public/_headers`.

## 6. Combined canary window

Within one controlled rollout window:

1. Enable Phase 1 and Phase 2; verify five-second polling, deadline close and
   archive preview.
2. Enable Phase 3 after real Publisher/Worker checks.
3. Enable Phase 6.5 and verify nullable nicknames from two user profiles.
4. Enable paid server/frontend flags only for the named canary lecture and
   only after Billing PIN, maximum spend and stop owner are confirmed.
5. Run the real microphone, Phase 5 analysis and Phase 6 summary canaries.
6. Stop immediately on ownership leakage, repeated paid replay, unexpected
   Realtime subscriptions, missing deadline close, Worker public access,
   unbounded cost or material UI/accessibility regression.

## 7. Rollback

1. Turn OFF the affected frontend and Edge flags.
2. Stop all paid operations; stopping never requires Billing PIN.
3. If required, unschedule only:

   ```sql
   select cron.unschedule('compass-phase2-lifecycle-minute');
   select cron.unschedule('compass-cron-history-weekly');
   ```

4. Roll back Pages/Worker to the recorded previous deployment.
5. Preserve DB audit, usage, summary revision and lifecycle rows.
6. Do not run destructive down migrations or physical data deletion during the
   incident.
