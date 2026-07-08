# Lecture Lifecycle

## 目的

講義を親データとして安定させ、講義コード参加、コメントRealtime、5秒同期、session timeout、講義終了を一貫して扱います。

## 状態

`lecture_sessions.status` は既存schemaに合わせて以下を使います。

| status | 意味 |
| --- | --- |
| `draft` | 準備中。学生は参加できません。 |
| `open` | 受付中。`/join` から参加できます。 |
| `closed` | 終了。投稿、いいね、Poll回答はRLS/API側で拒否されます。 |

Admin UIでは、`draft -> open -> closed` の順だけを通常操作として扱います。

## Lecture code

Adminが講義を作成すると、`JC-XXXXXX` 形式の講義コードを自動発行します。

- `lecture_sessions.code_hash`: 講義コードのSHA-256 hash
- `lecture_admin_codes.lecture_code`: AdminだけがEdge Function経由で見る平文コード

`lecture_sessions` はpublic SELECTしません。学生は `join_lecture_by_code` RPCで、openな講義だけに参加します。

## Admin Edge Function

講義管理は以下のEdge Functionで行います。

```text
supabase/functions/manage-lectures
```

action:

- `list`
- `create`
- `start`
- `close`

React frontendはAdmin PINを保持しません。既存の `verify-admin-pin` が返す `adminToken` を使い、`manage-lectures` がSupabase側の `ADMIN_SESSION_SECRET` で検証します。

## Student session timeout

学生の `/lecture` 画面では以下を行います。

- 最終操作時刻を記録
- 30分無操作で同期停止
- 長時間バックグラウンドで同期停止
- 復帰ボタンで講義状態を再確認してから同期再開
- 講義がclosedなら復帰不可

Display画面は発表中に無操作時間が長くなりやすいため、30分無操作停止の対象にはしていません。

## Sync stop on lecture close

学生側は5秒同期で `get_lecture_session_state` RPCを呼び、講義状態を確認します。

講義が `closed` になると:

- 「講義は終了しました」と表示
- comments Realtimeをunsubscribe
- likes / polls / display state pollingを停止
- comment投稿、like、Poll回答をfrontendで止める
- DB/RLS側でも `public.is_lecture_open()` によりINSERTが拒否される

## 手動実行が必要なSQL

Supabase SQL Editorで以下を実行します。

```text
supabase/manual/create_lecture_lifecycle_support.sql
```

このSQLは:

- `lecture_admin_codes` を作成
- service_roleに必要な権限を付与
- `get_lecture_session_state` RPCを作成

## Deployが必要なEdge Function

```powershell
supabase functions deploy manage-lectures --project-ref pfvedtqccblecuyjlfqh
```

必要なSecrets:

```text
ADMIN_PIN
ADMIN_SESSION_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## 確認手順

1. SQL Editorで `create_lecture_lifecycle_support.sql` を実行する。
2. `manage-lectures` Edge Functionをdeployする。
3. `/admin` を開く。
4. Admin PINでログインする。
5. 講義タイトルを入力し、講義コードを発行する。
6. 作成された講義を「開始」する。
7. `/join` で発行された講義コードを入力する。
8. `/lecture` でコメント投稿できることを確認する。
9. `/admin` で講義を「終了」する。
10. 学生画面に「講義は終了しました」と表示され、投稿・いいね・Poll回答が停止することを確認する。

