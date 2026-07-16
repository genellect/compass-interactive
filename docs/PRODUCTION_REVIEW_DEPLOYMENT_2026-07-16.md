# Phase 0-6.5 Development Production Review deployment record

Date: 2026-07-16 (JST)

Scope: Development Production Review with Phase 0 through Phase 6.5 enabled.
This is not the final Journal Club production acceptance.

## 1. Release identity

- Release-candidate base commit: `0408a7c`
- Previous GitHub `origin/main`: `f7c5b68`
- The publication commit containing this record is reported in the deployment
  handoff because a commit cannot contain its own final hash.
- Existing commits remain independent and were not squashed.

## 2. Rollback references

- Pre-migration application schema and `public/private` data dump:
  operator-local backup reference `2026-07-16-pre-phase0-6-5`
- Schema dump SHA-256:
  `09A51D49DF6E1227A5EF0D05369098676331F6A960F14644BA4E550AA9B0AB71`
- Data dump SHA-256:
  `07D1D1C610370A1D734DEEF70982148A2F4F04C67F62DFE695E6ED5BE92D2CCB`
- Previous Pages deployment:
  `11be8df0-f687-4041-84c4-2a44530f013b`
- Previous PDF Worker: not present
- Initial PDF Worker production version:
  `4241e89a-52c9-4044-86ae-5df26f148ce1`

Rollback order:

1. Stop paid AI operations and close any review lecture.
2. Disable the Phase 4-6 server flags if AI behavior is involved.
3. Roll Pages back to the recorded previous deployment.
4. Roll the PDF Worker back or disable its route if PDF delivery is involved.
5. Preserve audit, usage and archive rows. Prefer a forward database repair;
   restore from the recorded backup only for confirmed data corruption.

## 3. Hosted Supabase evidence

- All 14 migrations through
  `20260716073719_production_gate_hardening.sql` match remote history.
- The nine Phase 1-6.5/hardening migrations were applied after the backup.
- All 15 pgTAP files passed against Hosted inside `BEGIN ... ROLLBACK`.
- Phase 0 ownership suite remained 27/27.
- Hosted Advisor returned no Error or Critical issue.
- Expected anonymous-auth policy warnings remain documented.
- Every public application table has RLS.
- Application functions grant no `PUBLIC` execute privilege.
- No public application table is in `supabase_realtime`.
- The lifecycle Cron runs every minute as `postgres` and completed
  successfully.
- Hosted Anonymous Sign-In is enabled and rejects requests without a valid
  Turnstile token.

## 4. Edge Functions and secrets

- 15 Edge Functions are ACTIVE.
- 14 browser functions use `verify_jwt=true`.
- `get-pdf-retention-feed` alone uses `verify_jwt=false` and requires a
  separate 32-byte shared secret.
- Browser functions rejected missing JWT with HTTP 401.
- The retention feed rejected missing/wrong secrets with HTTP 401 and accepted
  the Worker secret with HTTP 200.
- Required production secret names are present. Values were not printed or
  committed.
- Phase 4, Phase 5 and Phase 6 server flags are enabled for the review.
- The existing OpenAI key is Edge-only.
- Billing PIN remains separate from the Admin PIN and Admin session secret.
- OpenAI live calls during deployment preparation: zero.
- Review budget ceiling: USD 2.50 per lecture, with a short Realtime test and
  one bounded Phase 5/6 review run only.

## 5. Private PDF delivery evidence

- R2 bucket: `compass-private-pdf-assets`
- Location hint: APAC
- Default storage class: Standard
- Public bucket access: not enabled
- Initial object count and size: zero
- Worker URL:
  `https://compass-private-pdf-assets.my270yuto0413.workers.dev`
- Worker Cron: `*/30 * * * *`
- Worker allowed origin:
  `https://compass-interactive.pages.dev`
- Worker allowed preflight: HTTP 204 with the exact origin
- Hostile preflight: HTTP 403
- Missing lecture JWT: HTTP 401
- Missing asset ticket: HTTP 401
- Publisher R2 token is Object Read & Write and scoped to this bucket.
- Disposable Publisher connectivity test passed:
  Put, Head, byte Range Get, Delete and post-delete 404.
- The disposable object was deleted; no review object remained.

## 6. Frontend preflight

- All seven Vite Phase flags are explicitly enabled.
- Production environment validation passed.
- TypeScript app and Phase 3 type checks passed.
- Oxlint passed.
- Production build passed.
- No secret-bearing `VITE_*` variable exists.
- Production PDF Worker URL, Turnstile site key, Supabase HTTPS URL and
  publishable key are configured in a Git-ignored environment file.

## 7. Immediate stop conditions

Stop the review and rollback the affected layer if any of the following occurs:

- cross-participant or cross-lecture private-data exposure;
- Admin operation by an unrelated actor;
- a paid action without Billing PIN authorization;
- duplicate billing reservation for one operation;
- unauthenticated R2 object access;
- a key, PIN or secret in a browser bundle, response or log;
- a write to a closed lecture;
- automatic publication of an AI Poll proposal;
- automatic publication of an unapproved summary;
- unexpected Realtime subscriptions;
- maintenance acting on unrelated data;
- OpenAI usage approaching the lecture ceiling.

## 8. Post-deployment human gates

- Two real anonymous browser sessions with Turnstile.
- Teacher Admin login and ownership separation.
- Real Publisher PDF upload and student Range/download flow.
- Short real-microphone Realtime transcription.
- One Phase 5 analysis and one or two Phase 6 windows.
- Desktop, mobile and Display visual/keyboard review.
- Lecture close, delayed-result discard and read-only archive checks.
- Full 90-minute, 20-person and 300-person tests remain later gates.
