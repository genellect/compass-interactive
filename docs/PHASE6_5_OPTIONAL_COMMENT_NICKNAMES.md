# Phase 6.5 Optional Comment Nicknames

Date: 2026-07-16
Scope: local implementation only; production remains unchanged

## Outcome

Phase 6.5 adds an optional display nickname to each student comment without
creating a participant profile, preference record, Realtime channel, or
additional polling request.

- The default UI label is `匿名の参加者`.
- The canonical anonymous database value is `NULL`.
- A nickname is optional, comment-scoped, and limited to 10 Unicode
  characters.
- A named comment is still one `comments` row insert and one existing
  `comments_version` bump.
- Demo mode uses the same UI contract but stores data only in the existing
  versioned browser `localStorage`.
- Live mode is protected by `VITE_PHASE6_5_COMMENT_NICKNAMES=false` and also
  requires the Phase 1 sync protocol flag.

## Requirements and implementation map

| Requirement | Implementation |
| --- | --- |
| Anonymous by default | Nickname checkbox starts unchecked; `NULL` maps to `匿名の参加者` |
| Maximum 10 characters | Shared frontend normalizer and DB `CHECK` constraint |
| No profile or preference row | Nullable `comments.nickname`; no new identity table |
| No extra Supabase request | Nickname is included in the existing comment `INSERT` |
| No extra Realtime load | `comments` remains outside `supabase_realtime` |
| Existing five-second sync | Snapshot v2 decoration propagates through v3 and v4 |
| History and 30-day preview | Cursor history v2 and archive v2/v3 include nickname |
| Ownership preserved | Existing Phase 0 `auth.uid()` participant ownership RLS remains unchanged |
| Closed lectures reject writes | Existing Phase 2 server-side open-state RLS remains unchanged |
| Demo is Supabase-independent | Demo repository writes only the existing versioned browser state |
| Safe rollout | Additive migration first; frontend and flag later; flag defaults OFF |

## Data contract

`public.comments.nickname text NULL`

The constraint accepts only:

- `NULL`, or
- 1 through 10 database characters;
- no leading or trailing whitespace;
- no control characters.

The frontend additionally:

- applies Unicode NFKC normalization;
- replaces control/format characters with a space;
- collapses whitespace;
- trims;
- slices by Unicode code point, not UTF-16 code unit.

An empty or whitespace-only nickname normalizes to `NULL`. Nicknames are not
unique and do not identify, authenticate, or authorize a participant.

## Write and sync sequence

1. Student leaves `ニックネームをつける` unchecked by default.
2. Comment submission passes `NULL`; if checked, the normalized nickname is
   passed with the body.
3. `supabaseCommentRepository` performs one insert into `public.comments`.
4. The existing comment trigger increments `comments_version` exactly once.
5. The shared five-second snapshot returns the nickname with the comment JSON.
6. The client hides nickname fields while the Phase 6.5 live feature flag is
   OFF, preserving the existing anonymous UI.

The nickname is deliberately excluded from AI comment-analysis context. It
does not improve educational evidence and would add unnecessary personal data
to provider input.

## Snapshot compatibility

The migration decorates the current private Phase 1 snapshot, history, and
archive implementations. Later contracts already delegate to these functions:

- snapshot v2 -> snapshot v3 -> snapshot v4;
- archive v2 -> archive v3;
- comment history v2.

Public RPC signatures remain unchanged and remain `SECURITY INVOKER`. The
private decorators are fixed-`search_path` `SECURITY DEFINER` functions, are
not directly executable by browser roles, and delegate membership and lecture
state authorization to the existing private cores before enriching comment
JSON.

Old rows receive `NULL`. Old clients ignore the additional JSON property.

## Demo behavior

Demo mode always exposes the nickname UI because it is isolated from live
Supabase operation. The nickname:

- is stored only beside the comment in
  `compass-interactive:demo:v1`;
- survives reload through the existing schema-versioned demo state;
- is normalized to `NULL` when an older stored comment has no nickname;
- creates no network request, profile, cookie, or live participant record.

## Load impact

For both the 20-student Free-plan model and the 300-student Pro-plan model:

- additional student requests: `0`;
- additional Realtime subscriptions: `0`;
- additional participant/profile rows: `0`;
- comment writes per post: `1`;
- maximum added text per named comment: 10 characters plus JSON/row metadata.

No nickname index is added because nickname is neither filtered nor sorted.

## Migration and production order

1. Back up and verify rollback conditions.
2. Apply `20260716062858_phase6_5_optional_comment_nicknames.sql`.
3. Run Advisor/DB lint and SQL regression.
4. Deploy the frontend with the Phase 6.5 flag still OFF.
5. Verify old clients and two-user ownership separation.
6. Enable the flag only in the later combined Phase 0-6.5 production gate.

Do not deploy the new frontend before the additive migration because its
comment insert/select contract includes the new column even while the UI flag
is OFF.

## Rollback

The primary rollback is to keep the additive column and turn the live feature
flag OFF. This immediately restores anonymous display and prevents new
nickname input without deleting historical comments.

Physical schema rollback is not part of the emergency path. If later required,
use a separate contract migration after:

1. all nickname-capable clients are disabled;
2. historical nickname retention/export is explicitly decided;
3. previous private function names and grants are restored;
4. the nullable column is dropped only after data-loss approval.
