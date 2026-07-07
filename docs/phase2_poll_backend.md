# Phase 2-H Poll Backend

Phase 2-H connects only the minimum student-facing Poll flow to Supabase.

## Implemented

- Fetch open `polls` for `VITE_DEV_LECTURE_SESSION_ID`
- Fetch matching `poll_options` ordered by `display_order`
- Insert `poll_responses`
- Treat duplicate key error `23505` as already answered
- Store answered poll ids/options locally so the current browser can show
  answered state without reading `poll_responses`
- Realtime poll result refresh through `poll_result_refresh_events`

## Not Implemented

- `poll_responses` SELECT
- raw `poll_responses` Realtime payload display
- admin poll creation/open/close backend
- answer update/upsert

## Phase 2-I Poll Results RPC

Phase 2-I adds an aggregate-only RPC for poll results.

Manual SQL:

```text
supabase/manual/create_poll_results_rpc.sql
```

The RPC is named `get_open_poll_results` and accepts:

```text
target_lecture_session_id uuid
```

It returns only:

- `poll_id`
- `option_id`
- `response_count`

It does not return `participant_id`, and the frontend still does not receive
raw `poll_responses` rows. It counts selected options with
`unnest(poll_responses.option_ids)` and includes zero-count options through a
left join from `poll_options`.

After a student submits a response, the frontend calls the RPC again and updates
the displayed counts.

## Realtime Poll Results

Poll result Realtime does not expose raw `poll_responses`.

Manual SQL:

```text
supabase/manual/create_poll_result_refresh_events.sql
```

This creates:

- `poll_result_refresh_events`
- an `after insert` trigger on `poll_responses`
- a minimal event containing only `lecture_session_id`, `poll_id`, and
  `created_at`
- Realtime publication for `poll_result_refresh_events`

When another browser submits a poll response, clients receive the minimal event
and call `get_open_poll_results()` again. The frontend still displays only
aggregate option counts.

## Seed SQL

Run this manually in Supabase SQL Editor:

```text
supabase/seed/002_seed_test_polls.sql
```

It creates five Journal Club discussion polls:

- treatment concept
- next investment experiment
- hardest remaining challenge
- CasRx vs Cas9 understanding check
- clinical use attitude

All rows are attached to:

```text
11111111-1111-4111-8111-111111111111
```

## Manual Check

1. Run `supabase/seed/002_seed_test_polls.sql` manually.
2. Run `supabase/manual/create_poll_result_refresh_events.sql` manually.
3. Open `/lecture` in Chrome and Edge.
4. Confirm the five Journal Club polls appear.
5. Answer a poll in Chrome.
6. Confirm a row appears in `poll_responses`.
7. Confirm a row appears in `poll_result_refresh_events`.
8. Confirm Edge updates poll result counts without manual refresh.
9. Confirm the same poll cannot be answered again from the same browser.

## RLS Notes

Phase 2-H assumes:

- open `polls` SELECT is allowed
- open poll `poll_options` SELECT is allowed
- `poll_responses` INSERT is allowed
- `poll_responses` SELECT is not allowed
- `poll_result_refresh_events` SELECT is allowed, but it exposes no
  `participant_id` or `option_ids`
- `participants` SELECT is not allowed
- `get_open_poll_results` is granted to anon/authenticated but returns aggregate
  counts only

If any of these are missing, do not loosen broad RLS policies. Add only a
narrow, reviewed policy in a later manual SQL step.
