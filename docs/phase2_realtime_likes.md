# Phase 2-G Realtime Comment Likes

Phase 2-G adds Supabase Realtime synchronization for new `comment_likes` rows
only.

## Scope

Implemented:

- `comment_likes` `INSERT` subscription
- lecture-scoped filter using `VITE_DEV_LECTURE_SESSION_ID`
- duplicate prevention by `comment_id` + `participant_id`
- cleanup with `supabase.removeChannel(...)`
- small `/lecture` status label for likes Realtime

Not implemented:

- unlike/delete
- `comment_likes` DELETE policy
- poll backend
- admin moderation backend
- participant ownership hardening

## Manual Check

1. Open `http://127.0.0.1:5173/lecture` in two browsers.
2. Confirm visible comments and like counts load.
3. Press like on one visible comment in one browser.
4. Confirm the other browser updates the like count without reload.
5. Confirm the posting browser does not double count.

## Supabase Publication

If INSERT events for `comment_likes` do not arrive, manually run:

```text
supabase/manual/enable_realtime_comment_likes.sql
```

Do not run it from frontend code. Do not change RLS or open `participants`
SELECT for this phase.
