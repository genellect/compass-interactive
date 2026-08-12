-- Phase 7.30E Google-only Admin cutover.
--
-- This migration is additive and dormant with respect to Hosted activation.
-- It first closes the legacy Display-descendant ambiguity: an expired signed
-- Display token may reach terminal review only when its exact JTI and bounded
-- timestamps were durably issued by the Google Admin authority transaction.

create function private.verify_google_display_terminal_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_token_issued_at timestamptz,
  target_token_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  binding private.admin_google_display_sessions%rowtype;
begin
  if target_token_jti_hash is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null
     or target_token_issued_at is null
     or target_token_expires_at is null
     or target_token_issued_at >= target_token_expires_at then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  select session.*
  into binding
  from private.admin_google_display_sessions as session
  where session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
    and session.issued_at = target_token_issued_at
    and session.expires_at = target_token_expires_at
  for update;

  if not found then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  if binding.display_auth_user_id is not null
     and binding.display_auth_user_id <> target_display_auth_user_id then
    return jsonb_build_object('recognized', true, 'valid', false);
  end if;

  if binding.display_auth_user_id is null then
    update private.admin_google_display_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where id = binding.id
      and display_auth_user_id is null;
    if not found then
      raise exception 'Google Display terminal claim did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  return jsonb_build_object(
    'recognized', true,
    'valid', true
  );
end;
$$;

revoke all on function private.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function public.verify_google_display_terminal_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_token_issued_at timestamptz,
  target_token_expires_at timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.verify_google_display_terminal_session_v1(
    target_token_jti_hash,
    target_lecture_session_id,
    target_display_auth_user_id,
    target_token_issued_at,
    target_token_expires_at
  );
$$;

revoke all on function public.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) to service_role;
