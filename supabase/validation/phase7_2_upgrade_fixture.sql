SET search_path = public, extensions;

CREATE TABLE public.phase72_upgrade_fixture (
  lecture_id uuid PRIMARY KEY,
  participant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  used_microusd bigint NOT NULL,
  input_tokens_used bigint NOT NULL
);
GRANT SELECT ON public.phase72_upgrade_fixture TO authenticated;
GRANT SELECT, INSERT ON public.phase72_upgrade_fixture TO service_role;

SET ROLE service_role;
DO $$
DECLARE
  created_lecture_id uuid;
  created_participant_id uuid;
  operation_result jsonb;
  created_operation_id uuid;
BEGIN
  created_lecture_id := public.admin_create_lecture(
    'Phase 7.2 upgrade fixture',
    encode(extensions.digest(convert_to('729901', 'UTF8'), 'sha256'), 'hex'),
    '729901', null, null
  );
  PERFORM public.admin_set_lecture_status(created_lecture_id, 'start', null);
  PERFORM public.admin_configure_lecture_ai_control(
    created_lecture_id,
    jsonb_build_object(
      'material_analysis_enabled', true,
      'academic_answers_enabled', true,
      'academic_answer_limit', 3,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 200000,
      'output_token_limit', 50000,
      'max_concurrent_operations', 1
    ),
    'admin-session:phase72-upgrade'
  );
  operation_result := public.admin_start_lecture_ai_operation(
    created_lecture_id, 'material_analysis', 'phase72-upgrade-operation',
    1000, 0, 500, 50, 'admin-session:phase72-upgrade'
  );
  created_operation_id := (operation_result #>> '{operation,id}')::uuid;
  PERFORM public.admin_finish_lecture_ai_operation(
    created_operation_id, 'succeeded', 700, 0, 350, 40,
    'provider-before-phase72', null
  );

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    '47209900-0000-4000-8000-000000000001',
    true
  );
  SELECT participant_id INTO created_participant_id
  FROM public.join_lecture_by_code('729901');

  INSERT INTO public.comments (
    lecture_session_id, participant_id, body, created_at, updated_at
  ) VALUES (
    created_lecture_id, created_participant_id,
    'Upgrade fixture comment remains visible to its owner',
    statement_timestamp(), statement_timestamp()
  );

  RESET ROLE;
  SET LOCAL ROLE service_role;
  INSERT INTO public.phase72_upgrade_fixture (
    lecture_id, participant_id, operation_id, used_microusd, input_tokens_used
  )
  SELECT created_lecture_id, created_participant_id, created_operation_id,
    control.used_microusd, control.input_tokens_used
  FROM public.lecture_ai_control AS control
  WHERE control.lecture_session_id = created_lecture_id;
END;
$$;
RESET ROLE;
