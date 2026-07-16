SET search_path = public, extensions;

CREATE TABLE public.phase6_upgrade_fixture (
  lecture_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  used_microusd bigint NOT NULL,
  material_calls_used integer NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON public.phase6_upgrade_fixture TO service_role;

SET ROLE service_role;

DO $$
DECLARE
  created_lecture_id uuid;
  operation_result jsonb;
  created_operation_id uuid;
  created_poll_id uuid;
BEGIN
  created_lecture_id := public.admin_create_lecture(
    'Phase 6 upgrade fixture',
    encode(extensions.digest(convert_to('P6-UPGRADE', 'UTF8'), 'sha256'), 'hex'),
    'P6-UPGRADE', null, null
  );
  PERFORM public.admin_set_lecture_status(created_lecture_id, 'start', null);
  UPDATE public.lecture_sessions
  SET started_at = statement_timestamp() - interval '10 minutes',
      hard_stop_at = statement_timestamp() + interval '80 minutes',
      ends_at = statement_timestamp() + interval '80 minutes'
  WHERE id = created_lecture_id;
  PERFORM public.admin_register_pdf_document(
    created_lecture_id,
    'doc-phase6-upgrade', repeat('a', 64), 1, 'Upgrade PDF',
    3, 3000, 300, repeat('a', 64), repeat('b', 64), true
  );
  PERFORM public.admin_configure_lecture_ai_control(
    created_lecture_id,
    jsonb_build_object(
      'material_analysis_enabled', true,
      'summary_call_limit', 18,
      'budget_limit_microusd', 2500000,
      'max_concurrent_operations', 2
    ),
    'admin-session:p6-upgrade'
  );
  operation_result := public.admin_start_lecture_ai_operation(
    created_lecture_id,
    'material_analysis',
    'phase6-upgrade-old-operation',
    1000, 0, 500, 50,
    'admin-session:p6-upgrade'
  );
  created_operation_id := (operation_result #>> '{operation,id}')::uuid;
  PERFORM public.admin_finish_lecture_ai_operation(
    created_operation_id,
    'succeeded',
    1000, 0, 500, 50,
    'provider-before-phase6', null
  );
  created_poll_id := public.admin_create_poll(
    created_lecture_id,
    'Existing teacher Poll survives the Phase 6 expansion',
    'single',
    ARRAY['Yes', 'No']
  );
  INSERT INTO public.phase6_upgrade_fixture (
    lecture_id, operation_id, poll_id, used_microusd, material_calls_used
  )
  SELECT
    created_lecture_id,
    created_operation_id,
    created_poll_id,
    control.used_microusd,
    control.material_analysis_calls_used
  FROM public.lecture_ai_control AS control
  WHERE control.lecture_session_id = created_lecture_id;
END;
$$;

RESET ROLE;
