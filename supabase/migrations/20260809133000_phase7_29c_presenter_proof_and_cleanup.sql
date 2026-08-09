-- Phase 7.29C: Presenter machine proof-of-possession, replay receipts,
-- application rate limiting, bounded timeouts and scheduled cleanup.
--
-- Expand-first and default OFF. The existing v1 service-only RPCs remain for
-- rollback compatibility. Hosted activation still requires the Edge/WAF,
-- signed-native, Device and Human gates described in the Phase 7.29C contract.

alter table public.presenter_connections
  add column proof_key_id text,
  add column proof_public_key_spki text,
  add constraint presenter_connections_proof_key_id_format_check check (
    proof_key_id is null or proof_key_id ~ '^[0-9a-f]{64}$'
  ),
  add constraint presenter_connections_proof_public_key_spki_format_check check (
    proof_public_key_spki is null
    or (
      char_length(proof_public_key_spki) between 80 and 256
      and proof_public_key_spki ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  add constraint presenter_connections_proof_pair_check check (
    (proof_key_id is null) = (proof_public_key_spki is null)
  );

-- The signed loopback ticket still expires after 55 seconds in the Edge token.
-- The stored pairing window is extended to five minutes only so that the
-- separately rate-limited manual recovery code remains usable by a teacher.
do $$
declare
  legacy_constraint name;
begin
  select constraint_row.conname into legacy_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.presenter_connections'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%ticket_expires_at%issued_at%00:01:00%';

  if legacy_constraint is null then
    raise exception 'Presenter 60-second expiry constraint was not found.';
  end if;

  execute format(
    'alter table public.presenter_connections drop constraint %I',
    legacy_constraint
  );
end;
$$;

alter table public.presenter_connections
  add constraint presenter_connections_pairing_window_check check (
    ticket_expires_at <= issued_at + interval '5 minutes'
  );

create index presenter_connections_proof_key_idx
  on public.presenter_connections (proof_key_id, state, capability_expires_at)
  where proof_key_id is not null and revoked_at is null;

create table private.presenter_request_receipts (
  proof_key_id text not null
    check (proof_key_id ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null
    check (nonce_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid
    references public.presenter_connections(id) on delete set null,
  action text not null
    check (action in ('inspect', 'claim', 'update', 'heartbeat', 'disconnect')),
  request_body_sha256 text not null
    check (request_body_sha256 ~ '^[0-9a-f]{64}$'),
  response_body jsonb,
  request_issued_at timestamptz not null,
  consumed_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  primary key (proof_key_id, nonce_hash),
  check (request_issued_at <= consumed_at + interval '2 minutes'),
  check (request_issued_at >= consumed_at - interval '2 minutes'),
  check (consumed_at < expires_at),
  check (
    (response_body is null and completed_at is null)
    or (
      response_body is not null
      and jsonb_typeof(response_body) = 'object'
      and completed_at is not null
      and completed_at >= consumed_at
      and completed_at < expires_at
    )
  )
);

create index presenter_request_receipts_connection_idx
  on private.presenter_request_receipts (connection_id, consumed_at desc);

create index presenter_request_receipts_cleanup_idx
  on private.presenter_request_receipts (expires_at, proof_key_id, nonce_hash);

create table private.presenter_machine_rate_limits (
  action text not null
    check (action in ('inspect', 'claim', 'update', 'heartbeat', 'disconnect')),
  bucket_kind text not null
    check (bucket_kind in ('proof_key', 'network', 'global')),
  bucket_hash text not null
    check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 0
    check (request_count between 0 and 100000),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (action, bucket_kind, bucket_hash)
);

create index presenter_machine_rate_limits_cleanup_idx
  on private.presenter_machine_rate_limits (updated_at, action, bucket_kind);

create table private.presenter_cleanup_health (
  singleton boolean primary key default true check (singleton),
  last_succeeded_at timestamptz,
  last_connection_delete_count integer not null default 0
    check (last_connection_delete_count between 0 and 20000),
  last_receipt_delete_count integer not null default 0
    check (last_receipt_delete_count between 0 and 20000),
  last_rate_delete_count integer not null default 0
    check (last_rate_delete_count between 0 and 20000),
  receipt_backlog_count bigint not null default 0
    check (receipt_backlog_count >= 0),
  oldest_receipt_expires_at timestamptz,
  rate_backlog_count bigint not null default 0
    check (rate_backlog_count >= 0),
  oldest_rate_updated_at timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.presenter_cleanup_health (singleton)
values (true)
on conflict (singleton) do nothing;

alter table private.presenter_request_receipts enable row level security;
alter table private.presenter_machine_rate_limits enable row level security;
alter table private.presenter_cleanup_health enable row level security;

revoke all on private.presenter_request_receipts
  from public, anon, authenticated;
revoke all on private.presenter_machine_rate_limits
  from public, anon, authenticated;
revoke all on private.presenter_cleanup_health
  from public, anon, authenticated;

grant select, insert, update, delete on private.presenter_request_receipts
  to service_role;
grant select, insert, update, delete on private.presenter_machine_rate_limits
  to service_role;
grant select, update on private.presenter_cleanup_health
  to service_role;

create function private.consume_presenter_machine_rate_v2(
  target_action text,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  effective_now timestamptz := statement_timestamp();
  normalized_window timestamptz := date_trunc('minute', effective_now);
  bucket record;
  observed_count integer;
begin
  if target_action is null
     or target_action not in ('inspect', 'claim', 'update', 'heartbeat', 'disconnect')
     or (
       target_proof_key_bucket_hash is not null
       and target_proof_key_bucket_hash !~ '^[0-9a-f]{64}$'
     )
     or (
       target_action <> 'inspect'
       and target_proof_key_bucket_hash is null
     )
     or target_global_bucket_hash is null
     or target_global_bucket_hash !~ '^[0-9a-f]{64}$'
     or (
       target_network_bucket_hash is not null
       and target_network_bucket_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'Invalid Presenter rate-limit request.'
      using errcode = '22023';
  end if;

  for bucket in
    select configured.bucket_kind, configured.bucket_hash,
      configured.request_limit
    from (
      values
        (
          1,
          'network'::text,
          target_network_bucket_hash,
          case target_action
            when 'update' then 720
            when 'heartbeat' then 60
            else 30
          end
        ),
        (
          2,
          'proof_key'::text,
          target_proof_key_bucket_hash,
          case target_action
            when 'update' then 360
            when 'heartbeat' then 12
            when 'claim' then 30
            else 10
          end
        ),
        (
          3,
          'global'::text,
          target_global_bucket_hash,
          case target_action
            when 'update' then 5000
            when 'heartbeat' then 2000
            else 600
          end
        )
    ) as configured(priority, bucket_kind, bucket_hash, request_limit)
    where configured.bucket_hash is not null
    order by configured.priority
  loop
    insert into private.presenter_machine_rate_limits (
      action,
      bucket_kind,
      bucket_hash,
      window_started_at,
      request_count,
      updated_at
    ) values (
      target_action,
      bucket.bucket_kind,
      bucket.bucket_hash,
      normalized_window,
      1,
      effective_now
    )
    on conflict (action, bucket_kind, bucket_hash) do update
    set
      window_started_at = case
        when private.presenter_machine_rate_limits.window_started_at
          < normalized_window then normalized_window
        else private.presenter_machine_rate_limits.window_started_at
      end,
      request_count = case
        when private.presenter_machine_rate_limits.window_started_at
          < normalized_window then 1
        else least(
          private.presenter_machine_rate_limits.request_count + 1,
          bucket.request_limit + 1
        )
      end,
      updated_at = effective_now
    returning request_count into observed_count;

    if observed_count > bucket.request_limit then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function private.begin_presenter_request_v2(
  target_action text,
  target_proof_key_id text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  existing_receipt private.presenter_request_receipts%rowtype;
begin
  if target_action is null
     or target_action not in ('inspect', 'claim', 'update', 'heartbeat', 'disconnect')
     or target_proof_key_id is null
     or target_proof_key_id !~ '^[0-9a-f]{64}$'
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_request_body_sha256 is null
     or target_request_body_sha256 !~ '^[0-9a-f]{64}$'
     or target_request_issued_at is null
     or target_global_bucket_hash is null
     or target_global_bucket_hash !~ '^[0-9a-f]{64}$'
     or (
       target_action <> 'inspect'
       and target_proof_key_bucket_hash is null
     ) then
    return jsonb_build_object('proof_rejected', 'invalid_request');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_proof_key_id || ':' || target_nonce_hash,
      729
    )
  );

  select receipt.* into existing_receipt
  from private.presenter_request_receipts as receipt
  where receipt.proof_key_id = target_proof_key_id
    and receipt.nonce_hash = target_nonce_hash;

  if found then
    if existing_receipt.action <> target_action
       or existing_receipt.request_body_sha256 <> target_request_body_sha256
       or existing_receipt.request_issued_at <> target_request_issued_at then
      return jsonb_build_object('proof_rejected', 'nonce_reused');
    end if;
    if existing_receipt.expires_at <= statement_timestamp() then
      return jsonb_build_object('proof_rejected', 'nonce_expired');
    end if;
    if existing_receipt.response_body is null then
      raise exception 'Presenter request receipt is incomplete.'
        using errcode = 'P7297';
    end if;
    return jsonb_build_object(
      'proof_cached', true,
      'response', existing_receipt.response_body
    );
  end if;

  if target_request_issued_at < statement_timestamp() - interval '2 minutes'
     or target_request_issued_at > statement_timestamp() + interval '2 minutes' then
    return jsonb_build_object('proof_rejected', 'invalid_request');
  end if;

  if not private.consume_presenter_machine_rate_v2(
    target_action,
    target_proof_key_bucket_hash,
    target_network_bucket_hash,
    target_global_bucket_hash
  ) then
    return jsonb_build_object('proof_rate_limited', true);
  end if;

  insert into private.presenter_request_receipts (
    proof_key_id,
    nonce_hash,
    connection_id,
    action,
    request_body_sha256,
    response_body,
    request_issued_at,
    consumed_at,
    completed_at,
    expires_at
  ) values (
    target_proof_key_id,
    target_nonce_hash,
    null,
    target_action,
    target_request_body_sha256,
    null,
    target_request_issued_at,
    statement_timestamp(),
    null,
    statement_timestamp() + interval '10 minutes'
  );

  return jsonb_build_object('proof_cached', false);
end;
$$;

create function private.finish_presenter_request_v2(
  target_connection_id uuid,
  target_action text,
  target_proof_key_id text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_response_body jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  updated_count integer;
begin
  if target_response_body is null
     or jsonb_typeof(target_response_body) <> 'object' then
    raise exception 'Invalid Presenter response receipt.' using errcode = '22023';
  end if;

  update private.presenter_request_receipts as receipt
  set
    connection_id = (
      select connection.id
      from public.presenter_connections as connection
      where connection.id = target_connection_id
    ),
    response_body = target_response_body,
    completed_at = statement_timestamp()
  where receipt.proof_key_id = target_proof_key_id
    and receipt.nonce_hash = target_nonce_hash
    and receipt.action = target_action
    and receipt.request_body_sha256 = target_request_body_sha256
    and receipt.request_issued_at = target_request_issued_at
    and receipt.response_body is null;
  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception 'Presenter request receipt could not be completed.'
      using errcode = 'P7297';
  end if;
end;
$$;

create function private.presenter_proof_binding_matches_v2(
  target_connection_id uuid,
  target_proof_key_id text,
  target_proof_public_key_spki text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '3s'
as $$
  select exists (
    select 1
    from public.presenter_connections as connection
    where connection.id = target_connection_id
      and connection.proof_key_id = target_proof_key_id
      and connection.proof_public_key_spki = target_proof_public_key_spki
  );
$$;

create function private.presenter_business_error_v2(
  target_action text,
  target_connection_id uuid,
  target_credential_kind text,
  target_credential_hash text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_credential_kind not in ('ticket', 'manual_code', 'capability')
     or target_credential_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('presenter_error', 'credential_invalid');
  end if;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where (
      target_credential_kind = 'ticket'
      and connection.id = target_connection_id
      and connection.ticket_jti_hash = target_credential_hash
    )
    or (
      target_credential_kind = 'manual_code'
      and connection.manual_code_hmac = target_credential_hash
      and (
        target_connection_id is null
        or connection.id = target_connection_id
      )
    )
    or (
      target_credential_kind = 'capability'
      and connection.id = target_connection_id
      and connection.capability_jti_hash = target_credential_hash
    );

  if not found then
    return jsonb_build_object('presenter_error', 'credential_invalid');
  end if;
  if connection_row.revoked_at is not null
     or connection_row.state = 'revoked' then
    return jsonb_build_object('presenter_error', 'revoked');
  end if;
  if connection_row.hard_stop_at <= effective_now
     or (
       connection_row.state <> 'active'
       and connection_row.ticket_expires_at <= effective_now
     )
     or (
       connection_row.state = 'active'
       and connection_row.capability_expires_at <= effective_now
     ) then
    return jsonb_build_object('presenter_error', 'expired');
  end if;
  if target_action = 'claim'
     and connection_row.state in ('pairing', 'inspected') then
    return jsonb_build_object('presenter_error', 'confirmation_pending');
  end if;

  return jsonb_build_object('presenter_error', 'credential_rejected');
end;
$$;

create function public.issue_presenter_connection_v2(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid,
  target_ticket_jti_hash text,
  target_manual_code_hmac text,
  target_pairing_ticket_expires_at timestamptz,
  target_manual_code_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  issued jsonb;
  connection_row public.presenter_connections%rowtype;
  actual_pairing_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_pairing_ticket_expires_at is null
     or target_manual_code_expires_at is null
     or target_pairing_ticket_expires_at <= effective_now
     or target_pairing_ticket_expires_at > effective_now + interval '60 seconds'
     or target_manual_code_expires_at < target_pairing_ticket_expires_at
     or target_manual_code_expires_at > effective_now + interval '5 minutes' then
    raise exception 'Invalid Presenter recovery window.' using errcode = '22023';
  end if;

  issued := public.issue_presenter_connection_v1(
    target_lecture_session_id,
    target_admin_session_id,
    target_admin_auth_user_id,
    target_ticket_jti_hash,
    target_manual_code_hmac,
    target_pairing_ticket_expires_at
  );
  actual_pairing_expires_at := (issued ->> 'ticket_expires_at')::timestamptz;

  update public.presenter_connections as connection
  set
    ticket_expires_at = least(
      target_manual_code_expires_at,
      connection.hard_stop_at
    ),
    updated_at = effective_now
  where connection.id = (issued ->> 'connection_id')::uuid
  returning * into connection_row;

  if not found then
    raise exception 'Presenter recovery window could not be recorded.'
      using errcode = 'P7297';
  end if;

  return issued || jsonb_build_object(
    'pairing_ticket_expires_at', actual_pairing_expires_at,
    'ticket_expires_at', connection_row.ticket_expires_at
  );
end;
$$;

create function public.inspect_presenter_connection_v2(
  target_connection_id uuid,
  target_credential_kind text,
  target_credential_hash text,
  target_installation_hash text,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text,
  target_slide_count integer,
  target_hidden_slide_count integer,
  target_custom_show_active boolean,
  target_proof_key_id text,
  target_proof_public_key_spki text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  admission jsonb;
  result jsonb;
  resolved_connection_id uuid;
begin
  admission := private.begin_presenter_request_v2(
    'inspect',
    target_proof_key_id,
    target_nonce_hash,
    target_request_body_sha256,
    target_request_issued_at,
    target_proof_key_bucket_hash,
    target_network_bucket_hash,
    target_global_bucket_hash
  );
  if admission ? 'proof_rate_limited' or admission ? 'proof_rejected' then
    return admission;
  end if;
  if coalesce((admission ->> 'proof_cached')::boolean, false) then
    return admission -> 'response';
  end if;
  if target_installation_hash <> target_proof_key_id
     or char_length(target_proof_public_key_spki) not between 80 and 256
     or target_proof_public_key_spki !~ '^[A-Za-z0-9_-]+$' then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      null, 'inspect', target_proof_key_id, target_nonce_hash,
      target_request_body_sha256, target_request_issued_at, result
    );
    return result;
  end if;

  if exists (
    select 1
    from public.presenter_connections as connection
    where connection.ticket_consumed_at is not null
      and (
        (
          target_credential_kind = 'ticket'
          and connection.id = target_connection_id
          and connection.ticket_jti_hash = target_credential_hash
        )
        or (
          target_credential_kind = 'manual_code'
          and connection.manual_code_hmac = target_credential_hash
        )
      )
  ) then
    result := jsonb_build_object('presenter_error', 'credential_invalid');
    perform private.finish_presenter_request_v2(
      target_connection_id, 'inspect', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  result := public.inspect_presenter_connection_v1(
    target_connection_id,
    target_credential_kind,
    target_credential_hash,
    target_installation_hash,
    target_pptx_file_sha256,
    target_slide_id_order_sha256,
    target_slide_count,
    target_hidden_slide_count,
    target_custom_show_active
  );
  if result is null then
    result := private.presenter_business_error_v2(
      'inspect', target_connection_id,
      target_credential_kind, target_credential_hash
    );
    perform private.finish_presenter_request_v2(
      target_connection_id, 'inspect', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;
  resolved_connection_id := (result ->> 'connection_id')::uuid;

  update public.presenter_connections as connection
  set
    proof_key_id = target_proof_key_id,
    proof_public_key_spki = target_proof_public_key_spki,
    updated_at = statement_timestamp()
  where connection.id = resolved_connection_id
    and (
      (connection.proof_key_id is null and connection.proof_public_key_spki is null)
      or (
        connection.proof_key_id = target_proof_key_id
        and connection.proof_public_key_spki = target_proof_public_key_spki
      )
  );
  if not found then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      resolved_connection_id, 'inspect', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  perform private.finish_presenter_request_v2(
    resolved_connection_id,
    'inspect',
    target_proof_key_id,
    target_nonce_hash,
    target_request_body_sha256,
    target_request_issued_at,
    result
  );
  return result;
end;
$$;

create function public.claim_presenter_connection_v2(
  target_connection_id uuid,
  target_credential_kind text,
  target_credential_hash text,
  target_installation_hash text,
  target_capability_jti_hash text,
  target_proof_key_id text,
  target_proof_public_key_spki text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  admission jsonb;
  result jsonb;
begin
  admission := private.begin_presenter_request_v2(
    'claim', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at,
    target_proof_key_bucket_hash, target_network_bucket_hash,
    target_global_bucket_hash
  );
  if admission ? 'proof_rate_limited' or admission ? 'proof_rejected' then
    return admission;
  end if;
  if coalesce((admission ->> 'proof_cached')::boolean, false) then
    return admission -> 'response';
  end if;
  if target_installation_hash <> target_proof_key_id
     or not private.presenter_proof_binding_matches_v2(
       target_connection_id,
       target_proof_key_id,
       target_proof_public_key_spki
     ) then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      target_connection_id, 'claim', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  result := public.claim_presenter_connection_v1(
    target_connection_id,
    target_credential_kind,
    target_credential_hash,
    target_installation_hash,
    target_capability_jti_hash
  );
  if result is null then
    result := private.presenter_business_error_v2(
      'claim', target_connection_id,
      target_credential_kind, target_credential_hash
    );
    perform private.finish_presenter_request_v2(
      target_connection_id, 'claim', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;
  perform private.finish_presenter_request_v2(
    target_connection_id, 'claim', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at, result
  );
  return result;
end;
$$;

create function public.apply_presenter_page_v2(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text,
  target_sequence bigint,
  target_event_id uuid,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text,
  target_slide_id integer,
  target_slide_index integer,
  target_pdf_page integer,
  target_proof_key_id text,
  target_proof_public_key_spki text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  admission jsonb;
  result jsonb;
begin
  admission := private.begin_presenter_request_v2(
    'update', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at,
    target_proof_key_bucket_hash, target_network_bucket_hash,
    target_global_bucket_hash
  );
  if admission ? 'proof_rate_limited' or admission ? 'proof_rejected' then
    return admission;
  end if;
  if coalesce((admission ->> 'proof_cached')::boolean, false) then
    return admission -> 'response';
  end if;
  if target_installation_hash <> target_proof_key_id
     or not private.presenter_proof_binding_matches_v2(
       target_connection_id,
       target_proof_key_id,
       target_proof_public_key_spki
     ) then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      target_connection_id, 'update', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  result := public.apply_presenter_page_v1(
    target_connection_id,
    target_capability_jti_hash,
    target_installation_hash,
    target_sequence,
    target_event_id,
    target_pptx_file_sha256,
    target_slide_id_order_sha256,
    target_slide_id,
    target_slide_index,
    target_pdf_page
  );
  if result is null then
    result := private.presenter_business_error_v2(
      'update', target_connection_id,
      'capability', target_capability_jti_hash
    );
    perform private.finish_presenter_request_v2(
      target_connection_id, 'update', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;
  perform private.finish_presenter_request_v2(
    target_connection_id, 'update', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at, result
  );
  return result;
end;
$$;

create function public.heartbeat_presenter_connection_v2(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text,
  target_proof_key_id text,
  target_proof_public_key_spki text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  admission jsonb;
  result jsonb;
begin
  admission := private.begin_presenter_request_v2(
    'heartbeat', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at,
    target_proof_key_bucket_hash, target_network_bucket_hash,
    target_global_bucket_hash
  );
  if admission ? 'proof_rate_limited' or admission ? 'proof_rejected' then
    return admission;
  end if;
  if coalesce((admission ->> 'proof_cached')::boolean, false) then
    return admission -> 'response';
  end if;
  if target_installation_hash <> target_proof_key_id
     or not private.presenter_proof_binding_matches_v2(
       target_connection_id,
       target_proof_key_id,
       target_proof_public_key_spki
     ) then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      target_connection_id, 'heartbeat', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  result := public.heartbeat_presenter_connection_v1(
    target_connection_id,
    target_capability_jti_hash,
    target_installation_hash,
    target_pptx_file_sha256,
    target_slide_id_order_sha256
  );
  if result is null then
    result := private.presenter_business_error_v2(
      'heartbeat', target_connection_id,
      'capability', target_capability_jti_hash
    );
    perform private.finish_presenter_request_v2(
      target_connection_id, 'heartbeat', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;
  perform private.finish_presenter_request_v2(
    target_connection_id, 'heartbeat', target_proof_key_id,
    target_nonce_hash, target_request_body_sha256,
    target_request_issued_at, result
  );
  return result;
end;
$$;

create function public.disconnect_presenter_connection_v2(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text,
  target_proof_key_id text,
  target_proof_public_key_spki text,
  target_nonce_hash text,
  target_request_body_sha256 text,
  target_request_issued_at timestamptz,
  target_proof_key_bucket_hash text,
  target_network_bucket_hash text,
  target_global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  admission jsonb;
  result jsonb;
begin
  admission := private.begin_presenter_request_v2(
    'disconnect', target_proof_key_id, target_nonce_hash,
    target_request_body_sha256, target_request_issued_at,
    target_proof_key_bucket_hash, target_network_bucket_hash,
    target_global_bucket_hash
  );
  if admission ? 'proof_rate_limited' or admission ? 'proof_rejected' then
    return admission;
  end if;
  if coalesce((admission ->> 'proof_cached')::boolean, false) then
    return admission -> 'response';
  end if;
  if target_installation_hash <> target_proof_key_id
     or not private.presenter_proof_binding_matches_v2(
       target_connection_id,
       target_proof_key_id,
       target_proof_public_key_spki
     ) then
    result := jsonb_build_object('presenter_error', 'proof_binding_rejected');
    perform private.finish_presenter_request_v2(
      target_connection_id, 'disconnect', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;

  result := public.disconnect_presenter_connection_v1(
    target_connection_id,
    target_capability_jti_hash,
    target_installation_hash
  );
  if result is null then
    result := private.presenter_business_error_v2(
      'disconnect', target_connection_id,
      'capability', target_capability_jti_hash
    );
    perform private.finish_presenter_request_v2(
      target_connection_id, 'disconnect', target_proof_key_id,
      target_nonce_hash, target_request_body_sha256,
      target_request_issued_at, result
    );
    return result;
  end if;
  perform private.finish_presenter_request_v2(
    target_connection_id, 'disconnect', target_proof_key_id,
    target_nonce_hash, target_request_body_sha256,
    target_request_issued_at, result
  );
  return result;
end;
$$;

create function public.cleanup_presenter_security_v2(
  target_limit integer default 10000
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '1s'
as $$
declare
  connection_delete_count integer;
  receipt_delete_count integer;
  rate_delete_count integer;
  remaining_receipt_count bigint;
  remaining_oldest_receipt_expires_at timestamptz;
  remaining_rate_count bigint;
  remaining_oldest_rate_updated_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_limit not between 1 and 10000 then
    raise exception 'Invalid cleanup limit.' using errcode = '22023';
  end if;

  connection_delete_count := public.cleanup_presenter_connections_v1(
    least(target_limit, 500)
  );

  with candidates as (
    select receipt.proof_key_id, receipt.nonce_hash
    from private.presenter_request_receipts as receipt
    where receipt.expires_at <= effective_now
    order by receipt.expires_at, receipt.proof_key_id, receipt.nonce_hash
    for update skip locked
    limit target_limit
  )
  delete from private.presenter_request_receipts as receipt
  using candidates
  where receipt.proof_key_id = candidates.proof_key_id
    and receipt.nonce_hash = candidates.nonce_hash;
  get diagnostics receipt_delete_count = row_count;

  with candidates as (
    select rate.action, rate.bucket_kind, rate.bucket_hash
    from private.presenter_machine_rate_limits as rate
    where rate.updated_at <= effective_now - interval '10 minutes'
    order by rate.updated_at, rate.action, rate.bucket_kind, rate.bucket_hash
    for update skip locked
    limit target_limit
  )
  delete from private.presenter_machine_rate_limits as rate
  using candidates
  where rate.action = candidates.action
    and rate.bucket_kind = candidates.bucket_kind
    and rate.bucket_hash = candidates.bucket_hash;
  get diagnostics rate_delete_count = row_count;

  select count(*), min(receipt.expires_at)
  into remaining_receipt_count, remaining_oldest_receipt_expires_at
  from private.presenter_request_receipts as receipt
  where receipt.expires_at <= effective_now;

  select count(*), min(rate.updated_at)
  into remaining_rate_count, remaining_oldest_rate_updated_at
  from private.presenter_machine_rate_limits as rate
  where rate.updated_at <= effective_now - interval '10 minutes';

  update private.presenter_cleanup_health as health
  set
    last_succeeded_at = effective_now,
    last_connection_delete_count = connection_delete_count,
    last_receipt_delete_count = receipt_delete_count,
    last_rate_delete_count = rate_delete_count,
    receipt_backlog_count = remaining_receipt_count,
    oldest_receipt_expires_at = remaining_oldest_receipt_expires_at,
    rate_backlog_count = remaining_rate_count,
    oldest_rate_updated_at = remaining_oldest_rate_updated_at,
    updated_at = effective_now
  where health.singleton;

  return jsonb_build_object(
    'connection_delete_count', connection_delete_count,
    'receipt_delete_count', receipt_delete_count,
    'rate_delete_count', rate_delete_count,
    'receipt_backlog_count', remaining_receipt_count,
    'oldest_receipt_expires_at', remaining_oldest_receipt_expires_at,
    'rate_backlog_count', remaining_rate_count,
    'oldest_rate_updated_at', remaining_oldest_rate_updated_at,
    'succeeded_at', effective_now
  );
end;
$$;

revoke all on function private.consume_presenter_machine_rate_v2(
  text, text, text, text
) from public, anon, authenticated;
revoke all on function private.begin_presenter_request_v2(
  text, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function private.finish_presenter_request_v2(
  uuid, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function private.presenter_proof_binding_matches_v2(
  uuid, text, text
) from public, anon, authenticated;
revoke all on function private.presenter_business_error_v2(text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function private.consume_presenter_machine_rate_v2(
  text, text, text, text
) to service_role;
grant execute on function private.begin_presenter_request_v2(
  text, text, text, text, timestamptz, text, text, text
) to service_role;
grant execute on function private.finish_presenter_request_v2(
  uuid, text, text, text, text, timestamptz, jsonb
) to service_role;
grant execute on function private.presenter_proof_binding_matches_v2(
  uuid, text, text
) to service_role;
grant execute on function private.presenter_business_error_v2(text, uuid, text, text)
  to service_role;

revoke all on function public.issue_presenter_connection_v2(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.issue_presenter_connection_v2(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.inspect_presenter_connection_v2(
  uuid, text, text, text, text, text, integer, integer, boolean,
  text, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.claim_presenter_connection_v2(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text
) from public, anon, authenticated;
revoke all on function public.apply_presenter_page_v2(
  uuid, text, text, bigint, uuid, text, text, integer, integer, integer,
  text, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.heartbeat_presenter_connection_v2(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text
) from public, anon, authenticated;
revoke all on function public.disconnect_presenter_connection_v2(
  uuid, text, text, text, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.cleanup_presenter_security_v2(integer)
  from public, anon, authenticated;

grant execute on function public.inspect_presenter_connection_v2(
  uuid, text, text, text, text, text, integer, integer, boolean,
  text, text, text, text, timestamptz, text, text, text
) to service_role;
grant execute on function public.claim_presenter_connection_v2(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text
) to service_role;
grant execute on function public.apply_presenter_page_v2(
  uuid, text, text, bigint, uuid, text, text, integer, integer, integer,
  text, text, text, text, timestamptz, text, text, text
) to service_role;
grant execute on function public.heartbeat_presenter_connection_v2(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text
) to service_role;
grant execute on function public.disconnect_presenter_connection_v2(
  uuid, text, text, text, text, text, text, timestamptz, text, text, text
) to service_role;
grant execute on function public.cleanup_presenter_security_v2(integer)
  to service_role;

do $$
declare
  existing_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    raise exception 'pg_cron is required for Presenter cleanup.';
  end if;
  for existing_job_id in
    select job.jobid
    from cron.job as job
    where job.jobname = 'compass-presenter-cleanup'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
  perform cron.schedule(
    'compass-presenter-cleanup',
    '* * * * *',
    $cleanup$select public.cleanup_presenter_security_v2(10000);$cleanup$
  );
end;
$$;

comment on column public.presenter_connections.proof_key_id is
  'SHA-256 fingerprint of the per-user non-exportable Presenter P-256 public key.';
comment on column public.presenter_connections.proof_public_key_spki is
  'Base64url DER SubjectPublicKeyInfo for the Presenter P-256 proof key; public material only.';
comment on table private.presenter_request_receipts is
  'Content-free, bounded Presenter request receipts. Stores only hashes and the already-returned response for exact transport retry.';
comment on table private.presenter_machine_rate_limits is
  'Hash-only authoritative one-minute rate buckets for the public Presenter machine endpoint.';
comment on table private.presenter_cleanup_health is
  'Content-free last-success and backlog marker for the one-minute Presenter cleanup Cron.';
comment on function public.cleanup_presenter_security_v2(integer) is
  'Bounded Presenter lifecycle, proof-receipt and rate-bucket cleanup invoked every minute.';
