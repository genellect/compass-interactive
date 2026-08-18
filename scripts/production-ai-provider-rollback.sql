-- Tracked Hosted rollback: block new child grants first, then new AI-master
-- admission. No identity, operations, ledger or AI-unlock gate is changed;
-- status, stop, close, downgrade and revoke paths remain available.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';

do $$
declare
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
begin
  select gate.*
  into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for update;
  if not found then
    raise exception 'production AI rollback blocked: AI gate row missing';
  end if;

  update private.admin_ai_unlock_runtime_gate
  set
    google_ai_child_grant_enabled = false,
    updated_at = statement_timestamp()
  where singleton;

  update private.admin_ai_unlock_runtime_gate
  set
    google_ai_master_admission_enabled = false,
    updated_at = statement_timestamp()
  where singleton;
end;
$$;

commit;
