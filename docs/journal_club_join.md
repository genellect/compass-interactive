# Journal Club Join Flow

## 現状調査

### `/join`

`/join` は `JoinPage.tsx` で実装されており、これまでは mock repository の講義コード判定を使っていました。JC-1 では Supabase RPC `join_lecture_by_code` を呼び、成功時に `/lecture` へ遷移します。

### `VITE_DEV_LECTURE_SESSION_ID`

これまでは `src/lib/devLecture.ts` の `VITE_DEV_LECTURE_SESSION_ID` を中心に、comments、likes、polls、poll results、Realtime subscription が固定の development lecture を参照していました。

JC-1 後は、通常導線では `/join` 成功時に localStorage へ保存した `lecture_session_id` を使います。`VITE_DEV_LECTURE_SESSION_ID` は、join RPC が未実行の開発環境で画面を壊さないための dev fallback としてのみ残します。production 前には削除または無効化するべきです。

### participant 作成

participant は browser 側で UUID を生成し、`participants` へ `id`, `lecture_session_id`, `participant_key` を明示して INSERT します。INSERT 後に `participants` を SELECT しません。

既存 schema では `participants.id` が primary key です。そのため、lecture をまたいで同じ participant id を再利用すると FK 不整合の原因になります。JC-1 では participant id / participant key を lecture session ごとの localStorage key に保存します。

### lecture session の保持

join 成功後、以下を localStorage に保存します。

- `compass-interactive-lecture-session-id`
- `compass-interactive-lecture-title`
- `compass-interactive-lecture-status`
- `compass-interactive-lecture-starts-at`
- `compass-interactive-lecture-ends-at`

participant identity は lecture session ごとの key に保存します。

- `compass-interactive-participant-id:<lecture_session_id>`
- `compass-interactive-participant-key:<lecture_session_id>`
- `compass-interactive-participant-key-owner:<lecture_session_id>`

### Supabase repository / service / context

- `src/repositories/supabaseLectureRepository.ts`: `join_lecture_by_code` RPC 呼び出し
- `src/repositories/supabaseCommentRepository.ts`: comments / comment_likes / participant INSERT
- `src/repositories/supabasePollRepository.ts`: polls / poll responses / poll results RPC
- `src/context/CompassStateContext.tsx`: joined lecture session と active lecture id を保持
- `src/services/compassActions.ts`: local/mock state 操作用 helper

### schema

`lecture_sessions` は `id`, `title`, `code_hash`, `status`, `starts_at`, `ends_at` を持ちます。講義コードは平文保存せず、`code_hash` で照合します。

`participants` は `id`, `lecture_session_id`, `participant_key`, `joined_at`, `last_seen_at` を持ちます。氏名、学籍番号、メールアドレスは保存しません。

### 既存 manual SQL

- `supabase/manual/create_poll_results_rpc.sql`
- `supabase/manual/enable_comment_likes_select_policy.sql`
- `supabase/manual/enable_realtime_comment_likes.sql`
- `supabase/manual/reopen_dev_lecture.sql`

### 既存 seed SQL

- `supabase/seed/001_seed_test_lecture.sql`
- `supabase/seed/002_seed_test_polls.sql`

## `join_lecture_by_code` RPC

Manual SQL:

```text
supabase/manual/create_join_lecture_by_code_rpc.sql
```

目的は、frontend から `lecture_sessions` を直接 public SELECT せず、講義コードから参加可能な open lecture の最小情報だけを返すことです。

RPC は以下のみを返します。

- `lecture_session_id`
- `title`
- `starts_at`
- `ends_at`
- `status`

`code_hash` は返しません。closed、期限切れ、未開始、存在しないコードは拒否します。

## Journal Club MVP seed

Manual seed SQL:

```text
supabase/seed/003_seed_journal_club_mvp.sql
```

MVP code:

```text
JC2026
```

このseedは `Journal Club MVP` lecture session、seed comment、single choice poll、multiple choice poll を作成します。code は平文保存せず、`encode(digest(upper(trim('JC2026')), 'sha256'), 'hex')` を `code_hash` に保存します。

## 手動実行手順

1. Supabase SQL Editorで `supabase/manual/create_join_lecture_by_code_rpc.sql` を実行する。
2. Supabase SQL Editorで `supabase/seed/003_seed_journal_club_mvp.sql` を実行する。
3. `/join` を開く。
4. `JC2026` を入力する。
5. `/lecture` に遷移することを確認する。
6. コメント投稿できることを確認する。
7. 別ブラウザで `/join` から `JC2026` 参加し、comments Realtime を確認する。
8. Poll 表示と回答、結果表示を確認する。

## まだ実装しないこと

- `lecture_sessions` public SELECT
- `participants` public SELECT
- admin認証
- full lecture management
- OpenAI API実装
- translation
- production向けparticipant本人性保証
