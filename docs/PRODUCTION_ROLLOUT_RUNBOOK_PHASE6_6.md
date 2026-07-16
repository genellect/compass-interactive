# Phase 6.6 production rollout runbook

This runbook is not authorization to change production. Run it only in an
approved change window after the Phase 6.6 local gate is accepted.

## 1. Stop conditions

Stop and roll back feature flags if any of the following occurs:

- cross-user comment, participant or Poll ownership leakage;
- unknown or closed lecture codes reveal different unauthenticated responses;
- archive payload contains a participant/auth/admin/secret/raw-source field;
- more than one open Poll exists for a lecture;
- Realtime continues beyond its reserved duration or lecture hard stop;
- any stopped Realtime provider call remains active after the retry window;
- an Admin/display credential can read another lecture or a display credential
  can read hidden comments;
- duplicate email delivery for one JST date;
- unexpected student Realtime subscription or PDF byte path through Supabase;
- snapshot error rate, p95 latency, egress or database CPU exceeds the approved
  canary threshold.

## 2. Preflight

1. Record database backup reference, previous Pages/Worker versions, rollback
   owner and canary lecture.
2. Confirm the target commit and clean build.
3. Keep all existing flags and the new flag OFF:

   ```text
   VITE_PHASE6_6_UX_INTEGRATION=false
   PHASE6_6_ARCHIVE_EXPORT_ENABLED=false
   DAILY_DIGEST_ENABLED=false
   ```

4. Confirm private R2 has no public development URL or custom public domain.
5. Confirm the exact Pages hostname used by Turnstile and Worker CORS.
6. Confirm the current OpenAI model and price immediately before enabling paid
   work.

## 3. Database first

Apply the additive Phase 6.6 migration after all earlier migrations.

Verify:

- new columns and indexes on `lecture_live_state`;
- RLS and no browser grants on join-rate, archive-export and digest-job tables;
- v1-v4 snapshot RPCs and the legacy join RPC still exist;
- v5 snapshot and join v2 execute only for `authenticated`;
- archive/digest claim/finalize RPCs execute only for `service_role`;
- the one-open-Poll partial unique index is valid;
- no Phase 6.6 table was added to `supabase_realtime`;
- named maintenance Cron exists once and is owned by the expected database
  role.

Run all SQL regression, Hosted Advisors and DB lint before deploying callers.

## 4. Supabase Edge Functions

Deploy:

- `export-lecture-archives` with platform JWT verification disabled;
- `send-daily-operations-digest` with platform JWT verification disabled;
- `sweep-realtime-provider-calls` with platform JWT verification disabled;
- updated browser functions with platform JWT verification enabled.

The three machine endpoints fail closed using their own independent Bearer
secrets. Do not reuse Admin, API PIN, OpenAI, R2 or service-role values.

Set Edge-only secrets:

```text
PHASE6_6_ARCHIVE_EXPORT_ENABLED=false
ARCHIVE_EXPORT_TRIGGER_SECRET=<random 32+ bytes>
ARCHIVE_WORKER_INGEST_URL=https://<worker>/internal/v1/archives
ARCHIVE_INGEST_SECRET=<same dedicated Worker ingest secret>

DAILY_DIGEST_ENABLED=false
DAILY_DIGEST_TRIGGER_SECRET=<different random 32+ bytes>
DAILY_DIGEST_RECIPIENT=matsui.yuto@st.kitasato-u.ac.jp
DAILY_DIGEST_FROM=COMPASS Interactive <verified-sender@example>
DAILY_DIGEST_REPLY_TO=matsui.yuto@st.kitasato-u.ac.jp
RESEND_API_KEY=<sending-only provider key>

REALTIME_SWEEP_TRIGGER_SECRET=<third distinct random 32+ byte secret>
```

Keep provider and machine secrets out of Pages variables and browser storage.

## 5. Cloudflare Worker

Configure the production Worker with:

```text
ARCHIVE_ACCESS_SECRET=<random 32+ bytes>
ARCHIVE_CODE_LOOKUP_SECRET=<different random 32+ bytes>
ARCHIVE_INGEST_SECRET=<same dedicated Edge/Worker ingest secret>
TURNSTILE_SECRET_KEY=<server secret>
TURNSTILE_EXPECTED_HOSTNAME=<exact Pages hostname>
```

Retain the existing PDF access/retention secrets and private R2 binding.
Confirm both archive rate-limit bindings, the
`ARCHIVE_FAILURE_GUARD` Durable Object binding/migration and the retention Cron
in the dry-run bundle.

Test before frontend activation:

1. machine ingest rejects a wrong Bearer token;
2. archive resolve rejects wrong Origin, invalid Turnstile action and wrong
   hostname;
3. a nonexistent code cannot be tested before Turnstile validation;
4. eight failed unknown-code lookups trigger the per-IP failure guard, while
   successful codes from the same simulated NAT remain available;
5. object keys contain only HMAC lookup hashes;
6. archive access and PDF tickets expire and can be renewed only by resolving
   the lecture code again;
7. private fields and malformed retention dates are rejected;
8. cleanup waits through the recovery buffer.

## 6. Trusted schedules

Use Supabase Vault plus `pg_cron`/`pg_net`, or another approved trusted
scheduler. Never write Bearer secrets directly into migration SQL.

Recommended schedules:

- archive export: every two minutes with a batch limit of five;
- daily digest: `0 11 * * *` UTC, which is 20:00 JST.
- Realtime provider hangup sweep: every minute with a batch limit of ten.

Use distinct named jobs, for example:

```text
compass-phase6-6-archive-export
compass-phase6-6-daily-digest-jst
compass-realtime-provider-hangup-minute
```

Observe the first invocation with both server feature flags OFF. It should
return a fail-closed response and send no email.

## 7. Pages with Phase 6.6 OFF

Deploy the frontend with the existing production Supabase/Turnstile/Worker
public values and:

```text
VITE_PHASE6_6_UX_INTEGRATION=false
```

Verify route shells and headers:

```text
/join
/lecture
/lecture/comments
/lecture/archive
/display
/admin
/demo
```

The teacher UX changes may be deployed only after the database and updated Edge
functions are compatible, because lecture creation now uses the v2 RPC.

## 8. Controlled activation

1. Enable archive export server-side.
2. Close a disposable lecture and observe one sanitized R2 archive.
3. Confirm the same closed code opens the archive without creating a Supabase
   Auth session or participant.
4. Confirm a live code still creates/uses the correct owned participant.
5. Enable `VITE_PHASE6_6_UX_INTEGRATION` for the canary Pages deployment.
6. Run two-user ownership, join lockout, approximate participant count, one-open
   Poll, exit/re-entry and comment-history tests.
7. Enable the daily digest server flag before 20:00 JST and verify exactly one
   email with correct lecture/API totals and cost classification.
8. Run Realtime for ten minutes with an approved maximum cost. Verify client,
   Edge and database all stop at the reservation boundary and the OpenAI call
   reaches the terminal provider state.
9. Run the 20-person canary. Review actual snapshot count/bytes, p95 latency,
   errors, database CPU, Worker requests, R2 operations and OpenAI spend.
10. Review the 300-person target only after the canary passes.

## 9. Rollback

1. Turn OFF Phase 6.6, archive export, digest and affected paid feature flags.
2. Stop active AI operations; stopping never requires the API PIN.
3. Unschedule only the named Phase 6.6 jobs.
4. Roll Pages and Worker back to the recorded versions if needed.
5. Preserve migration columns, audit rows, usage ledger, archive outbox and
   digest jobs.
6. Do not drop tables, reopen closed lectures or physically delete recovery
   data during incident response.

## 10. Required evidence

- backup and rollback record;
- migration version and Advisor output;
- RLS/GRANT/function check;
- named Cron definitions and successful run details;
- Worker version, bindings and private bucket confirmation;
- sanitized archive inspection;
- two-user/two-Admin result;
- ten-minute Realtime stop record and actual cost;
- daily email provider ID without email body secrets;
- desktop/mobile/classroom visual and accessibility sign-off;
- 20-person canary metrics and final activation decision.
