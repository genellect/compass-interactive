-- Phase 6.6 trusted schedulers invoke private Edge Functions asynchronously.
-- pg_cron is already enabled; pg_net supplies net.http_post for those jobs.
create extension if not exists pg_net with schema extensions;
