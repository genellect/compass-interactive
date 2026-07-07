-- Journal Club MVP manual SQL.
-- Creates a narrow RPC for lecture-code join without opening public SELECT on
-- lecture_sessions. Run manually in Supabase SQL Editor.
--
-- Supabase commonly installs pgcrypto functions in the extensions schema.
-- Therefore this file schema-qualifies extensions.digest.
--
-- Code hashing convention for this MVP:
--   code_hash = encode(extensions.digest(convert_to(upper(trim(<plain_code>)), 'UTF8'), 'sha256'), 'hex')
--
-- Do not store plain lecture codes in lecture_sessions.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.join_lecture_by_code(lecture_code text)
returns table (
  lecture_session_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  normalized_code text;
  hashed_code text;
  matched_lecture record;
begin
  normalized_code := upper(trim(coalesce(lecture_code, '')));

  if normalized_code = '' then
    raise exception 'lecture code is empty'
      using errcode = 'P0001';
  end if;

  hashed_code := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );

  select
    ls.id,
    ls.title,
    ls.starts_at,
    ls.ends_at,
    ls.status
  into matched_lecture
  from public.lecture_sessions ls
  where ls.code_hash = hashed_code
  limit 1;

  if not found then
    raise exception 'lecture code not found'
      using errcode = 'P0001';
  end if;

  if matched_lecture.status <> 'open' then
    raise exception 'lecture is not open'
      using errcode = 'P0001';
  end if;

  if matched_lecture.starts_at is not null and matched_lecture.starts_at > now() then
    raise exception 'lecture is not open yet'
      using errcode = 'P0001';
  end if;

  if matched_lecture.ends_at is not null and matched_lecture.ends_at < now() then
    raise exception 'lecture has expired'
      using errcode = 'P0001';
  end if;

  return query
  select
    matched_lecture.id::uuid,
    matched_lecture.title::text,
    matched_lecture.starts_at::timestamptz,
    matched_lecture.ends_at::timestamptz,
    matched_lecture.status::text;
end;
$$;

grant execute on function public.join_lecture_by_code(text)
to anon, authenticated;
