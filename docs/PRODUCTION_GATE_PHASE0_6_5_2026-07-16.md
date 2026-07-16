# Phase 0-6.5 integrated Production Gate

Date: 2026-07-16 (JST)

Decision:

- **Git Push gate: PASS after the independent audit commit.**
- **All-flags-OFF application deployment gate: CONDITIONAL PASS.** The code,
  migrations, local Edge runtime, Worker bundle and Pages artifact are ready.
  Hosted backup, migration, secrets, Advisors, R2/Worker resource creation and
  two-user checks are deployment-time operations and were intentionally not
  performed.
- **Paid-feature activation gate: HOLD.** Real microphone/WebRTC, a full
  90-minute lecture, real Publisher/R2, teacher educational review,
  accessibility/visual sign-off and measured 20-person canary remain human or
  Hosted checks.

No production Supabase, Hosted Auth, Cloudflare resource, public Web, OpenAI
configuration, Git remote, feature flag, push or deployment was changed during
this audit.

## 1. Integrated result by phase

| Phase | Production requirement                                                                                            | Audit result                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Anonymous Auth, Turnstile, `auth.uid()` participant ownership, RLS/GRANT separation                               | PASS. Phase 0 27/27 remains in the 613-assertion SQL regression. Every public application table has RLS; no application function grants `PUBLIC` execute.                                       |
| 1     | Five-second versioned snapshots, cursor history, no comment Realtime, old RPC compatibility                       | PASS. No public application table is in `supabase_realtime`; 20/300 load models retain zero added Realtime subscriptions.                                                                       |
| 2     | Server-time 90-minute close, idempotent manual/automatic close, 30-day archive, closed-write/AI rejection         | PASS. RPC/RLS guards remain authoritative and the final migration now schedules bounded lifecycle maintenance every minute. Cron succeeded locally.                                             |
| 3     | Local Publisher, private R2, short-lived PDF access, manifest/page sync, no Supabase PDF bytes                    | CODE PASS / EXTERNAL HOLD. Worker production config, exact production origin, private production bucket binding and 30-minute retention Cron are prepared; real R2 and secrets are not created. |
| 4     | Separate Billing PIN, budget/usage ledger, local transcript only, no audio retention, short-lived Realtime secret | CODE PASS / HUMAN HOLD. Standard API key remains Edge-only; real microphone/WebRTC is still deliberately deferred.                                                                              |
| 4.1   | Separate realtime/batch concurrency lanes and race-safe admission                                                 | PASS. Parallel start/finish/stop/close completed without deadlock after the final clean reset.                                                                                                  |
| 5     | PDF text analysis, strict limits, evidence-bound Poll suggestions, teacher adoption only                          | PASS. PDF bytes and raw text remain outside Supabase; strict structured output, quality gates, budget and single batch lane remain intact.                                                      |
| 6     | Five-minute recap/comment pulse, review/pin/correct/hide, low-value suppression                                   | PASS locally. Zero additional student requests/Realtime subscriptions; real teacher educational-value review remains human work.                                                                |
| 6.5   | Nullable per-comment nickname, maximum 10 characters, default `匿名の参加者`, demo-only local mode                | PASS. One comment write, no profile row, no added request/subscription; visual and assistive-technology checks remain human work.                                                               |

## 2. Defects found and corrected

1. **New publishable-key Admin login incompatibility**
   - `verify_jwt=true` rejects a bare `sb_publishable_*` value as a JWT.
   - Admin login now creates/reuses a Turnstile-protected anonymous Auth
     session before invoking `verify-admin-pin`, so the function receives a
     real user access token.

2. **Admin session signing secret could fall back to the Admin PIN**
   - The fallback was removed.
   - `ADMIN_SESSION_SECRET` is mandatory and must contain at least 32 bytes.

3. **Edge Functions accepted every browser Origin**
   - All browser-facing functions now enforce
     `COMPASS_EDGE_ALLOWED_ORIGINS`.
   - Missing production configuration fails closed to localhost-only defaults.
   - JSON responses are `no-store` and `nosniff`.

4. **Six foreign keys lacked supporting leading indexes**
   - Added indexes for Phase 5 material/source references and Phase 6
     run/revision/publication references, using partial indexes for nullable
     relationships.

5. **Phase 2 maintenance was implemented but never scheduled**
   - The hardening migration enables `pg_cron` and schedules
     `private.run_lecture_lifecycle_maintenance(50, 25)` every minute.
   - Scheduler history cleanup is limited to COMPASS jobs only and retains
     30 days; unrelated Cron history is not touched.

6. **Phase 3 Worker retention handler had no production Cron config**
   - `wrangler.production.jsonc` schedules it every 30 minutes and binds the
     non-public production R2 bucket name.

7. **Direct deploy bypassed the lockfile-pinned Wrangler**
   - `npx wrangler@latest` was replaced with the pinned local Wrangler
     4.110.0.

8. **Local Supabase could not exercise Auth/REST/Edge E2E**
   - Local API is enabled, deprecated `[inbucket]` is replaced by
     `[local_smtp]`, and Auth URLs now match Vite port 5173.

9. **Pages artifact lacked a release-level document identity and headers**
   - Added Japanese language metadata, production title/description/theme and
     Cloudflare `_headers` for clickjacking, MIME sniffing, referrer,
     permissions and immutable hashed assets.
   - Pages-local verification caught and corrected an initial cache-rule
     overlap; HTML is now `no-store` while hashed assets are only one-year
     `immutable`.

10. **No pre-deploy environment contract**
    - `production:check` rejects placeholder core values, accidental public
      secrets, non-boolean flags, invalid feature dependencies and missing
      Phase 3 Worker URL.

## 3. Database and backend evidence

| Gate                                              | Result                             |
| ------------------------------------------------- | ---------------------------------- |
| Phase 6.5 -> hardening upgrade fixture            | PASS, 8/8                          |
| Empty PostgreSQL 17 -> all 14 migrations          | PASS                               |
| Full SQL regression                               | PASS, 15 files / 613 assertions    |
| Phase 0 authentication suite                      | PASS, 27/27 within full regression |
| DB lint (`public,private`, warning fails)         | PASS, zero findings                |
| Public application tables without RLS             | 0                                  |
| Public FKs without supporting leading index       | 0                                  |
| Public application tables in Realtime publication | 0                                  |
| Application functions with `PUBLIC` execute       | 0                                  |
| Lifecycle Cron owner                              | `postgres`                         |
| Lifecycle Cron observed result                    | `succeeded`, one row               |
| Phase 4.1 real concurrency                        | PASS, no deadlock                  |
| Local Auth/Edge HTTP                              | PASS                               |
| Hostile Origin                                    | HTTP 403                           |
| Admin Auth -> token -> management RPC             | PASS                               |
| AI feature server flags OFF                       | HTTP 503 fail-closed               |

The database remains the final authority if Cron, the browser or a polling
timer stops. Deadline-aware RPCs and RLS do not treat an expired lecture as
active, and the scheduled job only materializes the same idempotent transition.

## 4. Frontend, UI and delivery evidence

| Gate                                    | Result                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| TypeScript app / Publisher / Worker     | PASS                                                                      |
| Oxlint                                  | PASS, zero warnings                                                       |
| All Phase 0-6.5 unit/static/load suites | PASS                                                                      |
| Production build                        | PASS                                                                      |
| Pages Worker production dry-run         | PASS, 31.80 KiB / gzip 7.70 KiB                                           |
| Cloudflare Pages local routes           | `/`, `/join/`, `/lecture/`, `/display/`, `/admin/`, `/demo/` all HTTP 200 |
| Pages headers                           | `no-store`, `nosniff`, `DENY` observed                                    |
| Hashed asset cache                      | `public, max-age=31536000, immutable`, without `no-store`                 |
| Production environment validator        | PASS with all flags OFF                                                   |
| Tracked secret-pattern scan             | PASS                                                                      |
| `git diff --check`                      | PASS                                                                      |

The latest automated build did not change the established lecture/comment/Poll
layout. The current audit verified the deploy artifact and route shells. The
previous Phase 6 desktop/mobile browser shell evidence remains valid, while
Phase 6.5 nickname visual/AT checks and the combined real-device review remain
explicit human gates.

## 5. Load and cost conclusions

- Phase 1 retains 21,600 snapshot calls for 20 students and 324,000 for 300
  students over 90 minutes, with zero comment Realtime subscriptions.
- Phase 2 Cron is one bounded indexed database call per minute and is
  participant-independent.
- Phase 3 adds no Supabase PDF bytes and no per-PDF main-app redeploy.
- Phase 4 caption writes/heartbeats are teacher-side and do not scale with
  student count.
- Phase 5/6 keep batch concurrency at one.
- Phase 6 adds zero student requests and zero Realtime subscriptions.
- Phase 6.5 keeps one write per comment and adds no participant profile row.
- Current Luna constants remain USD 1/M input and USD 6/M output; Phase 6's
  conservative schema-retry ceiling remains USD 0.8496 per 90-minute lecture.

## 6. Rollback and failure behavior

- Keep every frontend and Edge feature flag OFF during migration, function,
  Worker and Pages deployment.
- If the hardening migration fails, PostgreSQL rolls it back as one migration.
- Incident rollback should first disable flags and stop paid operations.
- Unschedule only the named COMPASS jobs with `cron.unschedule`; do not edit
  `cron.job` directly.
- Keep the six additive indexes unless a measured regression proves otherwise.
- If Worker retention fails, access still expires from canonical Supabase
  timestamps; physical R2 cleanup is delayed and retried without exposing the
  bucket.
- If `COMPASS_EDGE_ALLOWED_ORIGINS` or `ADMIN_SESSION_SECRET` is missing,
  browser management fails closed.
- Do not physically delete Phase data during an incident. Repair forward after
  preserving audit and usage rows.

## 7. Remaining non-code gates

1. Explicit production backup reference, rollback owner and stop thresholds.
2. Hosted migration, Advisors, grants/RLS inspection and Cron history.
3. Exact production Edge origin and 32-byte-or-longer Admin session secret.
4. Private R2 bucket, least-privilege Publisher token, Worker secrets and real
   Worker URL.
5. Real Publisher PDF and 30-day retention canary.
6. Two students and two Admin sessions against Hosted.
7. Real microphone/WebRTC and mixed-language caption test.
8. Full 90-minute lecture and 20-person measured canary.
9. Teacher educational-value, keyboard, screen-reader, contrast and responsive
   visual sign-off, including Phase 6.5 nicknames.
10. External npm advisory lookup. It was not run because it would transmit the
    local dependency graph to the npm registry; run it only with explicit
    approval or through the repository's trusted dependency-scanning CI.

Official current references used by the audit:

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API security and grants](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Supabase publishable/secret key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare Worker Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

The independent commit containing this report is recorded in the final handoff;
a commit cannot contain its own final hash.
