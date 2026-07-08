# Supabase Setup

Phase 2-A prepares the Supabase client only. It does not create tables, policies, repository implementations, realtime subscriptions, or production authentication.

## Required Environment Variables

Create `.env.local` in the project root with:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_DEV_LECTURE_SESSION_ID=
```

Only variables prefixed with `VITE_` are exposed to the Vite frontend.

`VITE_DEV_LECTURE_SESSION_ID` is a Phase 2-D development-only value. Set it to
the UUID of the seed `lecture_sessions` row after manually running the seed SQL.
It is used only to verify visible comment reading and comment creation before
lecture code verification or RPC-based join is implemented.

## Frontend-Safe Key

`VITE_SUPABASE_PUBLISHABLE_KEY` is intended for browser use when Row Level Security policies are properly configured. The key identifies the frontend client; it must not be treated as a password.

Because this key runs in the browser, assume users can see it. Security must come from Supabase RLS policies, table permissions, and careful schema design.

## Keys Never Allowed in Frontend

Never place these in `.env.local` for the Vite frontend:

- service role key
- secret key
- database password
- JWT secret
- any key that bypasses RLS

The service role key can bypass Row Level Security and belongs only in trusted server-side environments.

## Current Client Entry Point

The client is initialized in:

```text
src/lib/supabaseClient.ts
```

It reads only:

- `import.meta.env.VITE_SUPABASE_URL`
- `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`

Phase 2-D comment verification also reads:

- `import.meta.env.VITE_DEV_LECTURE_SESSION_ID`

## Current Non-Goals

Not implemented in Phase 2-A:

- database tables
- SQL migrations
- RLS policies
- repository methods backed by Supabase
- realtime subscriptions
- Google Form / GAS integration
- admin authentication

## Phase 2-D Comment Connection

Phase 2-D connects only `comments` read/create operations to Supabase.

The current frontend does not publicly read `lecture_sessions` or
`participants`, because the RLS draft keeps those tables closed for broad
anonymous SELECT access. For this reason, Phase 2-D uses a manually seeded open
lecture and the development-only `VITE_DEV_LECTURE_SESSION_ID` environment
variable.

The comment repository:

- selects only `visible` comments for the configured lecture session
- creates an anonymous participant row with a UUID participant id when needed
- inserts only `visible` comments
- subscribes only to `comments` INSERT events for the configured lecture session
- does not implement moderation, likes, polls, admin auth, or lecture
  code verification

This is not the final production join design. A later phase should replace the
development lecture id with a lecture-code verification flow or a narrow RPC.

## Phase 2-E Realtime Comments

Phase 2-E adds Supabase Realtime only for new `comments` rows.

The frontend subscribes to:

- table: `comments`
- event: `INSERT`
- filter: `lecture_session_id=eq.VITE_DEV_LECTURE_SESSION_ID`

Incoming rows are accepted only when `status` is `visible`. Hidden or deleted
comments are ignored client-side as an additional guard. The existing initial
fetch remains in place, and realtime INSERT payloads are merged by comment id so
that the posting tab does not display the same comment twice.

The subscription is removed when the React provider unmounts. Realtime status is
shown on `/lecture` as a small diagnostic label.

If the browser does not receive realtime events, confirm in Supabase that
Realtime is enabled for the `comments` table/publication. Do not loosen RLS or
open `participants` SELECT for this check.

## Phase 2-F Comment Likes

Phase 2-F connects only comment like fetch/insert operations.

Implemented in the frontend:

- fetch `comment_likes` for the development lecture when SELECT is allowed
- calculate `likeCount` per comment from fetched rows
- mark the current local participant as liked when its `participant_id` appears
- insert a new `comment_likes` row when the student presses like
- treat PostgreSQL duplicate key error `23505` as already liked

Not implemented:

- unlike/delete
- `comment_likes` Realtime
- backend moderation
- poll backend

Current RLS note: the initial migration grants INSERT on `comment_likes`, but it
does not grant broad public SELECT. If like counts must be loaded by anonymous
students, add a narrow SELECT grant/policy manually after review. The policy
should allow reading only likes for visible comments in open lectures, and must
not open `participants` SELECT.

Phase 2-G stores the reviewed manual SQL here:

```text
supabase/manual/enable_comment_likes_select_policy.sql
```

The policy does this:

- grants SELECT only on `comment_likes`
- allows rows only when the related lecture is open
- allows rows only when the related comment is `visible`
- does not grant SELECT on `participants`
- does not add DELETE / unlike permissions

```sql
grant select on public.comment_likes to anon, authenticated;

drop policy if exists "students can read likes for visible comments in open lectures"
on public.comment_likes;

create policy "students can read likes for visible comments in open lectures"
on public.comment_likes
for select
to anon, authenticated
using (
  public.is_lecture_open(comment_likes.lecture_session_id)
  and exists (
    select 1
    from public.comments c
    where c.id = comment_likes.comment_id
      and c.lecture_session_id = comment_likes.lecture_session_id
      and c.status = 'visible'
  )
);
```

Do not add DELETE until participant ownership is strengthened with auth or a
safe RPC.

After running the SQL manually, reload `/lecture` and confirm that like counts
load without the `comment_likes` RLS warning. Then press like once and confirm a
single `comment_likes` row appears in Supabase Table Editor.

## Phase 2-G Realtime Comment Likes

Phase 2-G subscribes only to `comment_likes` INSERT events.

The frontend subscribes to:

- table: `comment_likes`
- event: `INSERT`
- filter: `lecture_session_id=eq.VITE_DEV_LECTURE_SESSION_ID`

Incoming likes are merged into the existing comments state by `comment_id` and
`participant_id`. If the same participant is already present in
`likedByParticipantIds`, the event is ignored so the count is not doubled.
Hidden comments do not update because the merge function only changes visible
comments currently present in state.

If cross-tab like updates do not arrive, confirm that `public.comment_likes` is
enabled in Supabase Realtime. The manual SQL is:

```text
supabase/manual/enable_realtime_comment_likes.sql
```

## Journal Club Realtime Reduction

Journal Club MVP now keeps Supabase Realtime only for new board comments.
`comment_likes`, poll results, and display state are synchronized by frontend
polling every 5 seconds while the tab is active, and every 30 seconds while the
tab is hidden.

To reduce server-side Realtime load further, manually review and run:

```text
supabase/manual/disable_non_comment_realtime.sql
```

This keeps `comments` Realtime untouched and removes unnecessary Realtime
publication entries for likes, poll refresh events, and display state. It also
stops the poll result refresh event trigger so poll responses do not create an
extra event row.

## Lecture Lifecycle Support

Admin-side lecture creation and lecture start/end require this manual SQL:

```text
supabase/manual/create_lecture_lifecycle_support.sql
```

It creates an admin-only `lecture_admin_codes` table and a minimal
`get_lecture_session_state` RPC. The RPC returns only lecture id, title,
starts_at, ends_at, and status; it does not expose `code_hash`.

After running the SQL, deploy:

```text
supabase/functions/manage-lectures
```

This Edge Function uses `ADMIN_SESSION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`
server-side. Do not put service role keys or Admin PIN values in React or
Cloudflare Pages frontend variables.

Do not change RLS, do not open `participants` SELECT, and do not add DELETE.

## Phase 2-H Poll Backend

Phase 2-H connects only the minimum Poll flow:

- fetch open `polls`
- fetch `poll_options`
- insert `poll_responses`
- store answered poll state locally

It does not read `poll_responses`, does not aggregate results from Supabase, and
does not implement poll Realtime.

Manual seed SQL:

```text
supabase/seed/002_seed_test_polls.sql
```

The frontend uses Supabase polls when they can be fetched for
`VITE_DEV_LECTURE_SESSION_ID`. If fetching fails, the existing mock polls remain
available so the lecture screen does not break.

Duplicate response error `23505` is treated as already answered. Re-answering is
intentionally disabled in the UI until update/upsert and ownership rules are
designed.

## Phase 2-I Poll Results RPC

Phase 2-I adds aggregate Poll result display without opening
`poll_responses` SELECT.

Manual SQL:

```text
supabase/manual/create_poll_results_rpc.sql
```

The RPC `get_open_poll_results(target_lecture_session_id uuid)` returns:

- `poll_id`
- `option_id`
- `response_count`

It does not return `participant_id` and does not expose raw `poll_responses`
rows. The function is `security definer`, uses `set search_path = public`, and
only counts options for open polls in an open lecture.

The frontend calls this RPC on initial Poll load and again after a successful
Poll response insert. Poll answered state remains local/localStorage because
`poll_responses` SELECT remains closed.

## Next Steps: Schema and RLS Design

Before creating tables in the Supabase dashboard, prepare SQL and RLS policy drafts for:

- `lecture_sessions`
- `participants`
- `comments`
- `comment_likes`
- `polls`
- `poll_options`
- `poll_responses`

Start backend integration with comments first:

1. read visible comments
2. create comments
3. add moderation policies
4. then add likes and poll responses

This keeps the first backend step small and testable.
