-- Final additive hardening before the combined Phase 0-6.5 production rollout.
-- Existing RPC signatures and application data remain unchanged.

create index material_ai_operation_contexts_source_document_idx
  on public.material_ai_operation_contexts (
    lecture_session_id,
    source_document_id,
    source_document_version
  );

create index material_ai_operation_contexts_analysis_idx
  on public.material_ai_operation_contexts (analysis_id)
  where analysis_id is not null;

create index ai_poll_proposals_source_document_idx
  on public.ai_poll_proposals (
    lecture_session_id,
    source_document_id,
    source_document_version
  );

create index lecture_summary_windows_run_idx
  on public.lecture_summary_windows (run_id);

create index lecture_ai_summary_revisions_supersedes_idx
  on public.lecture_ai_summary_revisions (supersedes_id)
  where supersedes_id is not null;

create index summary_publications_active_revision_idx
  on public.summary_publications (active_revision_id, summary_id);

create extension if not exists pg_cron;

select cron.schedule(
  'compass-phase2-lifecycle-minute',
  '* * * * *',
  $$select private.run_lecture_lifecycle_maintenance(50, 25);$$
);

-- pg_cron does not prune run history automatically. Lecture lifecycle events
-- remain the durable audit trail; scheduler diagnostics are retained for
-- 30 days to bound database storage.
select cron.schedule(
  'compass-cron-history-weekly',
  '17 3 * * 0',
  $$delete from cron.job_run_details
    where jobid in (
      select jobid
      from cron.job
      where jobname in (
        'compass-phase2-lifecycle-minute',
        'compass-cron-history-weekly'
      )
    )
      and end_time < statement_timestamp() - interval '30 days';$$
);
