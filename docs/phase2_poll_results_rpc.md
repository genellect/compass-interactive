# Phase 2-I Poll Results RPC

Phase 2-I displays Poll results through an aggregate-only Supabase RPC.

## Manual SQL

Run this file manually in Supabase SQL Editor:

```text
supabase/manual/create_poll_results_rpc.sql
```

Do not run it from frontend code.

## RPC

Function:

```text
get_open_poll_results(target_lecture_session_id uuid)
```

Returned columns:

- `poll_id`
- `option_id`
- `response_count`

The RPC does not return `participant_id` and does not return raw
`poll_responses` rows.

## Frontend Behavior

- Fetch open polls and options.
- Fetch aggregate result counts through the RPC.
- Submit `poll_responses` with INSERT only.
- Refresh RPC result counts after a successful response.
- Keep answered state in localStorage/local state.

## Still Not Implemented

- `poll_responses` SELECT policy
- poll result Realtime
- admin poll creation/open/close backend
- answer update/upsert
- participant ownership hardening
