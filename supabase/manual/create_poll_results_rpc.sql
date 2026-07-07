-- Phase 2-I manual SQL: aggregated poll results RPC.
--
-- Purpose:
-- - Let the frontend read option-level counts without reading poll_responses.
-- - Do not expose participant_id.
-- - Do not add SELECT policy/grant on poll_responses.
-- - Return results only for open polls in an open lecture.
--
-- Run manually in Supabase SQL Editor. Do not run from frontend code.

create or replace function public.get_open_poll_results(
  target_lecture_session_id uuid
)
returns table (
  poll_id uuid,
  option_id uuid,
  response_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    po.poll_id,
    po.id as option_id,
    count(selected_options.option_id)::bigint as response_count
  from public.poll_options po
  join public.polls p
    on p.id = po.poll_id
   and p.lecture_session_id = po.lecture_session_id
  left join (
    select
      pr.poll_id,
      unnest(pr.option_ids) as option_id
    from public.poll_responses pr
    where pr.lecture_session_id = target_lecture_session_id
  ) selected_options
    on selected_options.poll_id = po.poll_id
   and selected_options.option_id = po.id
  where po.lecture_session_id = target_lecture_session_id
    and p.status = 'open'
    and public.is_lecture_open(p.lecture_session_id)
  group by po.poll_id, po.id, po.display_order
  order by po.poll_id, po.display_order;
$$;

grant execute on function public.get_open_poll_results(uuid)
to anon, authenticated;
