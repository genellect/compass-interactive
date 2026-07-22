begin;

-- Permit at most two explicitly PIN-authorized material-analysis attempts per
-- lecture. This gives the teacher one bounded recovery attempt after a model,
-- provider, or educational-quality failure without rewriting billed history.
-- The existing per-lecture budget, token limits, batch concurrency lane, and
-- immutable usage ledger continue to bound and audit both attempts.
alter table public.lecture_ai_control
  alter column material_analysis_call_limit set default 2;

update public.lecture_ai_control as control
set material_analysis_call_limit = 2
from public.lecture_sessions as lecture
where lecture.id = control.lecture_session_id
  and lecture.status in ('draft', 'open')
  and control.material_analysis_call_limit = 1;

comment on column public.lecture_ai_control.material_analysis_call_limit is
  'Maximum explicitly authorized material-analysis calls per lecture; default 2 permits one bounded recovery attempt.';

commit;
