BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT ok(
  to_regprocedure(
    'private.admin_ai_policy_matches_production_preset_v1(text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) IS NOT NULL,
  'the database owns one canonical Production AI policy predicate'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'private.admin_ai_policy_matches_production_preset_v1(text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.admin_ai_policy_matches_production_preset_v1(text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ),
  'the canonical preset predicate is not an application RPC surface'
);

SELECT ok(
  private.admin_ai_policy_matches_production_preset_v1(
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '30 days' - interval '1 minute',
    statement_timestamp()
  ),
  'the exact bounded 30-day Production preset is canonical'
);

SELECT ok(
  NOT private.admin_ai_policy_matches_production_preset_v1(
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 5000001, 20000000,
    90, 180, 2,
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '30 days' - interval '1 minute',
    statement_timestamp()
  )
  AND NOT private.admin_ai_policy_matches_production_preset_v1(
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '30 days' - interval '1 minute',
    statement_timestamp()
  ),
  'over-budget and incomplete action policies are never covered'
);

SELECT ok(
  NOT private.admin_ai_policy_matches_production_preset_v1(
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    statement_timestamp() - interval '31 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp()
  )
  AND NOT private.admin_ai_policy_matches_production_preset_v1(
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '31 days',
    statement_timestamp()
  ),
  'stale and overlong policies are never covered or activation-ready'
);

SELECT ok(
  to_regprocedure(
    'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)'
  ) IS NOT NULL,
  'the service-role policy intent facade exists'
);

SELECT ok(
  to_regprocedure(
    'public.get_admin_ai_policy_status_v1(text,uuid,uuid)'
  ) IS NOT NULL,
  'the service-role policy topology facade exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'policy intent preparation is service-role-only'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.get_admin_ai_policy_status_v1(text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.get_admin_ai_policy_status_v1(text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_admin_ai_policy_status_v1(text,uuid,uuid)',
    'EXECUTE'
  ),
  'policy topology status is service-role-only'
);

SELECT ok(
  (
    SELECT procedure.prosecdef
    FROM pg_proc AS procedure
    WHERE procedure.oid = to_regprocedure(
      'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)'
    )
  ),
  'policy intent preparation is a security-definer boundary'
);

SELECT ok(
  pg_get_functiondef(
    to_regprocedure(
      'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)'
    )
  ) LIKE '%private.admin_ai_policy_control_intent_digest_v1%',
  'policy preparation reuses the canonical database digest'
);

SELECT ok(
  pg_get_functiondef(
    to_regprocedure(
      'public.prepare_admin_ai_policy_change_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamp with time zone,timestamp with time zone,uuid)'
    )
  ) LIKE '%private.require_admin_ai_context_v1%false,%true%',
  'policy preparation requires the current Owner membership context'
);

SELECT ok(
  pg_get_functiondef(
    to_regprocedure('public.get_admin_ai_policy_status_v1(text,uuid,uuid)')
  ) LIKE '%membership.status = ''active''%'
  AND pg_get_functiondef(
    to_regprocedure('public.get_admin_ai_policy_status_v1(text,uuid,uuid)')
  ) LIKE '%membership.can_use_ai%'
  AND pg_get_functiondef(
    to_regprocedure('public.get_admin_ai_policy_status_v1(text,uuid,uuid)')
  ) LIKE '%active_count = covered_count%',
  'topology compares every active AI-enabled membership with live coverage'
);

SELECT is(
  private.admin_ai_policy_control_intent_digest_v1(
    '00000000-0000-4000-8000-00000000a101'::uuid,
    ARRAY['summaries', 'captions', 'academic_answers', 'poll_suggestions', 'material_analysis'],
    ARRAY['gpt-realtime-whisper', 'gpt-5.6-luna'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    '2030-01-01T00:00:00Z'::timestamptz,
    '2030-01-31T00:00:00Z'::timestamptz
  ),
  private.admin_ai_policy_control_intent_digest_v1(
    '00000000-0000-4000-8000-00000000a101'::uuid,
    ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
    90, 180, 2,
    '2030-01-01T00:00:00Z'::timestamptz,
    '2030-01-31T00:00:00Z'::timestamptz
  ),
  'canonical policy intents are independent of action and model order'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_admin_ai_policy_change_v1(
      repeat('0', 64),
      '00000000-0000-4000-8000-00000000a102'::uuid,
      '00000000-0000-4000-8000-00000000a103'::uuid,
      null,
      ARRAY['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
      ARRAY['gpt-5.6-luna', 'gpt-realtime-whisper'],
      24, 96, 200000, 800000, 40000, 160000, 500000, 2000000,
      90, 180, 2,
      statement_timestamp() - interval '1 minute',
      statement_timestamp() + interval '30 days' - interval '1 minute',
      '00000000-0000-4000-8000-00000000a104'::uuid
    )
  $$,
  '22023',
  'invalid Admin AI policy preparation',
  'policy preparation rejects a missing target membership before issuing intent'
);

SELECT is(
  public.get_admin_ai_policy_status_v1(
    repeat('0', 64),
    '00000000-0000-4000-8000-00000000a105'::uuid,
    '00000000-0000-4000-8000-00000000a106'::uuid
  ),
  null::jsonb,
  'policy status fails closed without an exact current Owner session'
);

SELECT * FROM finish();
ROLLBACK;
