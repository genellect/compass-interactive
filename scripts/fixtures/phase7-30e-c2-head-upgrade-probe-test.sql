begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select ok(
  exists (
    select 1
    from private.admin_google_display_sessions as display_session
    where display_session.id =
        '73034000-0000-4000-8000-00000000000d'::uuid
      and display_session.token_jti_hash = repeat('e', 64)
      and display_session.lecture_session_id =
        '73034000-0000-4000-8000-000000000009'::uuid
      and display_session.admin_session_id =
        '73034000-0000-4000-8000-000000000008'::uuid
      and display_session.admin_auth_user_id =
        '73034000-0000-4000-8000-000000000002'::uuid
      and not display_session.realtime_enabled
      and display_session.display_auth_user_id is null
      and display_session.claimed_at is null
      and display_session.issued_at =
        '2026-01-01 00:00:00+00'::timestamptz
      and display_session.expires_at =
        '2026-01-01 00:05:00+00'::timestamptz
      and display_session.hard_stop_at =
        '2026-01-01 00:00:00+00'::timestamptz
  ),
  'the populated C2-head Google Display root survives the E upgrade exactly'
);

set role service_role;
select ok(
  public.verify_google_display_terminal_session_v1(
    repeat('e', 64),
    '73034000-0000-4000-8000-000000000009'::uuid,
    '73034000-0000-4000-8000-00000000000e'::uuid,
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-01-01 00:05:00+00'::timestamptz
  ) @> '{"recognized":true,"valid":false}'::jsonb,
  'the legacy binding is recognized but terminal access remains disabled'
);
select ok(
  public.verify_google_display_terminal_session_v1(
    repeat('e', 64),
    '73034000-0000-4000-8000-000000000009'::uuid,
    '73034000-0000-4000-8000-00000000000f'::uuid,
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-01-01 00:05:00+00'::timestamptz
  ) @> '{"recognized":true,"valid":false}'::jsonb,
  'a different Display Auth user also receives an invalid terminal compatibility result'
);
reset role;

select ok(
  exists (
    select 1
    from private.admin_google_display_sessions as display_session
    where display_session.id =
        '73034000-0000-4000-8000-00000000000d'::uuid
      and display_session.token_jti_hash = repeat('e', 64)
      and display_session.lecture_session_id =
        '73034000-0000-4000-8000-000000000009'::uuid
      and display_session.admin_session_id =
        '73034000-0000-4000-8000-000000000008'::uuid
      and display_session.admin_auth_user_id =
        '73034000-0000-4000-8000-000000000002'::uuid
      and not display_session.realtime_enabled
      and display_session.display_auth_user_id is null
      and display_session.claimed_at is null
      and display_session.issued_at =
        '2026-01-01 00:00:00+00'::timestamptz
      and display_session.expires_at =
        '2026-01-01 00:05:00+00'::timestamptz
      and display_session.hard_stop_at =
        '2026-01-01 00:00:00+00'::timestamptz
  ),
  'terminal compatibility verification does not claim Display browser metadata'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.verify_google_display_terminal_session_v1(text,uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.verify_google_display_terminal_session_v1(text,uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.verify_google_display_terminal_session_v1(text,uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.verify_google_display_terminal_session_v1(text,uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the service-role public facade can execute terminal verification'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.admin_google_display_sessions',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'anon',
    'private.admin_google_display_sessions',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated',
    'private.admin_google_display_sessions',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'the populated private Display binding remains inaccessible to runtime roles'
);

select * from finish();
rollback;
