begin;

-- Permit at most two explicitly PIN-authorized material-analysis attempts for
-- new lectures. Existing rows are deliberately left unchanged so this
-- expand-first migration cannot override an operator's explicit one-call cap.
-- The existing per-lecture budget, token limits, batch concurrency lane, and
-- immutable usage ledger continue to bound and audit both attempts.
alter table public.lecture_ai_control
  alter column material_analysis_call_limit set default 2;

comment on column public.lecture_ai_control.material_analysis_call_limit is
  'Maximum explicitly authorized material-analysis calls per lecture; default 2 permits one bounded recovery attempt.';

commit;
