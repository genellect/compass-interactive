# Cloudflare Pages Deployment Guide

Last reviewed: 2026-07-18

Deployment is a separate authorized operation. Local PASS, CI PASS or a
documentation commit does not authorize a Pages/Worker/R2 change.

## 1. Application build

```bash
npm ci
npm run production:check
npm run build
```

The Pages build settings are:

```text
Framework: Vite
Build command: npm run build
Output directory: dist
Node: repository .node-version
```

`scripts/create-route-entrypoints.mjs` creates entry files for:

```text
/join
/demo
/lecture
/lecture/comments
/lecture/archive
/admin
/display
```

Do not add a catch-all redirect that conflicts with these route entrypoints.

## 2. Browser environment

The production frontend may receive only browser-safe values:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_TURNSTILE_SITE_KEY
VITE_PDF_PUBLISHER_URL
VITE_PDF_WORKER_BASE_URL
VITE_PHASE1_SYNC_PROTOCOL
VITE_PHASE2_LECTURE_LIFECYCLE
VITE_PHASE3_PRIVATE_PDF
VITE_PHASE4_REALTIME_CAPTIONS
VITE_PHASE5_MATERIAL_ANALYSIS
VITE_PHASE6_SUMMARIES
VITE_PHASE6_5_COMMENT_NICKNAMES
VITE_PHASE6_6_UX_INTEGRATION
```

Never configure the following as Pages/Vite variables:

```text
ADMIN_PIN
ADMIN_SESSION_SECRET
BILLING_PIN
OPENAI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
DATABASE_PASSWORD
VITE_ADMIN_PIN
VITE_OPENAI_API_KEY
VITE_TURNSTILE_SECRET_KEY
COMPASS_R2_ACCESS_KEY_ID
COMPASS_R2_SECRET_ACCESS_KEY
ARCHIVE_INGEST_SECRET
RESEND_API_KEY
```

The Turnstile site key is public. Its secret belongs only in the trusted
server/Auth configuration.

## 3. Deployment mode

Use the existing Pages project's configured deployment mode. Do not create a
replacement project merely to switch between Git integration and Direct Upload
without a migration/rollback decision.

For an explicitly approved Direct Upload:

```bash
npm run deploy:cloudflare:direct
```

That script validates the environment and builds before calling Wrangler. It
may open an interactive Cloudflare authentication flow. API tokens remain local
and uncommitted.

## 4. Expand-first order

1. Record backup, owner, stop thresholds and rollback versions.
2. Apply the compatible database expansion.
3. Deploy required Edge Functions and Worker bindings with server flags OFF.
4. Verify private bucket, exact origins, Turnstile and machine secrets.
5. Deploy Pages with frontend flags OFF.
6. Run route, Auth, ownership, Worker and closed-lecture smoke tests.
7. Enable one controlled feature/canary at a time.
8. Record telemetry and the gate result.

On incident, disable flags and restore the previous Pages/Edge/Worker version
before considering a database contract change.

## 5. Post-deploy smoke

- Every route above returns the React application on direct navigation.
- `/demo` works with hosted-service requests blocked.
- Live join requires real Anonymous Auth and Turnstile.
- Teacher and student are separate identities and cannot cross ownership.
- Comment, Poll and page updates arrive through the expected snapshot cadence.
- Admin operations require a valid Admin session.
- Paid starts require the separate API-use authorization.
- PDF and archive requests use the configured Worker and remain inaccessible
  without scoped access.
- Lecture close stops writes, Poll answers, AI starts and live polling.
- Browser console and network logs contain no secret.

Use `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md` and
`docs/PHASE6_6_HUMAN_TEST_CHECKLIST.md` for the current integrated feature
sequence. Future Phase 7 deployment must follow the gate in `docs/ROADMAP.md`.
