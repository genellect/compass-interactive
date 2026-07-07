# Phase 2-E Realtime Comments

Phase 2-E implements only Supabase Realtime synchronization for new comments.

## Scope

Implemented:

- initial visible comments fetch remains unchanged
- `comments` table `INSERT` subscription
- lecture-scoped Realtime filter using `VITE_DEV_LECTURE_SESSION_ID`
- visible-only client-side filtering
- duplicate comment prevention by `comment.id`
- cleanup with `supabase.removeChannel(...)`
- small `/lecture` Realtime status label

Not implemented:

- likes backend
- poll backend
- admin moderation backend
- Realtime for updates or deletes
- participant ownership hardening
- lecture code verification or join RPC

## Likes Realtime Addendum

Phase 2-G adds `comment_likes` INSERT Realtime. It does not add unlike/delete or
likes Realtime for DELETE because those operations are still intentionally
blocked.

Manual check:

1. Open `/lecture` in Chrome and Edge.
2. Confirm comments and current like counts load.
3. Like a visible comment in one browser.
4. Confirm the other browser updates the like count without reload.
5. Confirm the browser that clicked like does not double count.

If this does not work while normal comment Realtime works, run the reviewed
manual publication SQL:

```text
supabase/manual/enable_realtime_comment_likes.sql
```

## Manual Check

1. Start the local dev server.
2. Open `http://127.0.0.1:5173/lecture` in two tabs or browsers.
3. Join the lecture in each tab if needed.
4. Submit a comment in one tab.
5. Confirm the other tab receives the comment without reload.
6. Confirm the posting tab does not show the same comment twice.

## Supabase Note

If comments do not arrive in the second tab, check whether Realtime is enabled
for the `comments` table in Supabase. Do not add public SELECT to
`participants`, do not loosen RLS, and do not use service role keys in the
frontend.
