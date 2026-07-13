# Manual SQL retirement

The former one-off SQL files were consolidated into
`supabase/migrations/20260710104958_remote_baseline.sql` during Milestone 0.

Do not add new SQL here. Create every future schema change with
`supabase migration new <name>`, test it with a local database reset, and then
apply it through the migration workflow.

Data repair and demo seed operations belong in reviewed scripts or
`supabase/seed/`; they must not be mixed into schema migrations.

## Phase 0 production gate

Before deploying `20260713142227_phase0_auth_hardening.sql`:

1. Enable Anonymous Sign-Ins in Supabase Dashboard > Authentication > Providers.
2. Keep the anonymous-user IP rate limit at 30/hour or lower for the MVP.
3. Configure Cloudflare Turnstile in Supabase Auth before sharing a public URL.
4. Deploy the database migration before the matching frontend bundle. The old
   frontend sends `target_participant_id`; the new RPC intentionally rejects it.
5. Run all SQL tests, then rerun Supabase Security and Performance Advisors.
6. Verify two isolated browsers receive different participant IDs and cannot
   write with the other browser's ID.
7. Confirm `comments` is absent from `supabase_realtime` and the browser opens
   no Postgres Changes channel.

Do not add OpenAI, Cloudflare API, or billing secrets until this gate passes in
the target project. Stopping the app or rolling back the frontend does not
restore the removed RPC signature; use a reviewed forward migration instead.
