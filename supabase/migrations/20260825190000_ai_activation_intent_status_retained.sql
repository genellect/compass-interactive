-- Keep the provider-free activation-intent status read available while an
-- in-flight request crosses the lecture's open-to-closed transition. The
-- closed C2 policy inventory remains migration-owned and immutable at runtime.

drop trigger admin_google_operation_policies_immutable
  on private.admin_google_operation_policies;

do $$
declare
  updated_policy_count integer;
begin
  update private.admin_google_operation_policies
  set lecture_state = 'retained'
  where operation_key = 'manage-ai-activation-intent.status'
    and edge_function = 'manage-ai-activation-intent'
    and action_name = 'status'
    and access_scope = 'owned_lecture'
    and lecture_state = 'draft_or_open'
    and gate_mode = 'gate_independent'
    and operation_class = 'read'
    and lecture_lock_mode = 'share'
    and instructor_requires_ai = false
    and owner_requires_ai = false
    and request_binding_required = false
    and control_step_up_action is null;

  get diagnostics updated_policy_count = row_count;
  if updated_policy_count <> 1 then
    raise exception
      'expected to update exactly one manage-ai-activation-intent.status policy, updated %',
      updated_policy_count
      using errcode = 'P0001';
  end if;
end;
$$;

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
for each row execute function private.reject_admin_c1_evidence_mutation_v1();
