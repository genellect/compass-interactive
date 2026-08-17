-- Production hardening: an environment Owner always retains the complete
-- administrative capability set. Paid/provider admission remains controlled
-- by the existing runtime gates and is not enabled by this migration.

update private.admin_environment_memberships
set
  can_use_ai = true,
  updated_at = statement_timestamp()
where role = 'owner'
  and status <> 'revoked'
  and not can_use_ai;

create function private.normalize_admin_owner_capability_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner'
     and new.status <> 'revoked'
     and not new.can_use_ai then
    if old.role = 'owner' and old.can_use_ai then
      raise exception 'Owner capability cannot be disabled'
        using errcode = 'P7335';
    end if;
    new.can_use_ai := true;
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_admin_owner_capability_v1()
  from public, anon, authenticated, service_role;

create trigger admin_memberships_owner_capability_normalizer
before update of role, status, can_use_ai
on private.admin_environment_memberships
for each row execute function private.normalize_admin_owner_capability_v1();

create function private.apply_accepted_owner_capability_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted'
     and new.role = 'owner'
     and new.accepted_membership_id is not null then
    update private.admin_environment_memberships
    set
      can_use_ai = true,
      updated_at = greatest(updated_at, statement_timestamp())
    where id = new.accepted_membership_id
      and environment_id = new.environment_id
      and role = 'owner'
      and status <> 'revoked';
  end if;
  return new;
end;
$$;

revoke all on function private.apply_accepted_owner_capability_v1()
  from public, anon, authenticated, service_role;

create trigger admin_invitations_apply_owner_capability
after update of status on private.admin_invitations
for each row
when (old.status = 'pending' and new.status = 'accepted')
execute function private.apply_accepted_owner_capability_v1();

create function private.enforce_admin_owner_capability_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_membership private.admin_environment_memberships%rowtype;
begin
  select membership.*
  into current_membership
  from private.admin_environment_memberships as membership
  where membership.environment_id = new.environment_id
    and membership.principal_id = new.principal_id;

  if current_membership.id is not null
     and current_membership.role = 'owner'
     and current_membership.status <> 'revoked'
     and not current_membership.can_use_ai then
    raise exception 'Owner must retain the complete capability set'
      using errcode = 'P7335';
  end if;
  return null;
end;
$$;

revoke all on function private.enforce_admin_owner_capability_v1()
  from public, anon, authenticated, service_role;

create constraint trigger admin_memberships_owner_capability_guard
after insert or update of role, status, can_use_ai
on private.admin_environment_memberships
deferrable initially deferred
for each row execute function private.enforce_admin_owner_capability_v1();

comment on function private.enforce_admin_owner_capability_v1() is
  'Deferred invariant: every non-revoked Owner retains the complete administrative capability set; paid AI admission remains separately gated.';
