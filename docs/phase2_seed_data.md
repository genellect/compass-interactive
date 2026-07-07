# Phase 2-D Seed Data

この文書は、Phase 2-DでSupabase comments取得・投稿だけを検証するためのseed data手順です。

## 目的

Phase 2-Dでは講義コード認証、RPC、admin認証、Realtimeをまだ実装しません。そのため、開発用に固定UUIDのopen lectureを1件作成し、frontendは`.env.local`の`VITE_DEV_LECTURE_SESSION_ID`を使ってcommentsだけを読み書きします。

## 手動実行するSQL

Supabase SQL Editorで次のファイルを手動実行してください。自動実行はしません。

```text
supabase/seed/001_seed_test_lecture.sql
```

このSQLは以下を作成します。

- open状態の開発用`lecture_sessions`
- 匿名`participants`を1件
- 表示用の`visible` commentを2件

開発用lectureは、RLSの`public.is_lecture_open()`を満たす必要があります。
古いseedでは`ends_at`が短く、PC再起動や翌日以降に期限切れになることがありました。
現在のseedは再実行時に同じlecture rowの`status`, `starts_at`, `ends_at`を更新し、
30日間openになるようにしています。

## `.env.local`に設定する値

seed SQLでは開発用lecture idを固定しています。SQL実行後、`.env.local`に以下を追加してください。

```env
VITE_DEV_LECTURE_SESSION_ID=11111111-1111-4111-8111-111111111111
```

既存の以下2つはそのまま維持します。

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

`.env.local`の実値はGitに公開しないでください。

## 講義コードについて

seed SQLの`code_hash`には開発用dummy hashを入れています。平文の講義コードではありません。

このseedは本番用の講義コード認証ではありません。後続Phaseでは、lecture codeをfrontendで直接照合せず、hash照合用RPCまたは安全なjoin flowへ置き換える想定です。

## RLS上の注意

現行RLSでは、public frontendから`lecture_sessions`と`participants`を自由にSELECTしない方針です。

Phase 2-Dで確認する範囲は以下だけです。

- open lectureに紐づくvisible commentsの取得
- open lectureに対する匿名participant作成
- open lectureに対するvisible comment投稿

hidden comments、admin moderation、poll responses、comment likesはPhase 2-Dの対象外です。

## 確認手順

1. Supabase SQL Editorで`supabase/seed/001_seed_test_lecture.sql`を手動実行する。
2. `.env.local`に`VITE_DEV_LECTURE_SESSION_ID=11111111-1111-4111-8111-111111111111`を追加する。
3. ローカル開発サーバーを再起動する。
4. `/join`で既存のmock lecture codeを使って参加する。
5. `/lecture`でseed commentが表示されることを確認する。
6. 120字以内のcommentを投稿し、画面に反映されることを確認する。

## Phase 2-Dで実施しないこと

- Supabase Realtime
- comment likes backend化
- poll responses backend化
- admin認証
- lecture code hash照合
- lecture join用RPC
- Google Form / GAS連携

## 期限切れ時の修復

コメント投稿時に以下が出る場合:

```text
new row violates row-level security policy for table "participants"
```

開発用lectureの`ends_at`が期限切れになっている可能性があります。
Supabase SQL Editorで次を手動実行してください。

```text
supabase/manual/reopen_dev_lecture.sql
```

このSQLは開発用lecture 1件の`status`, `starts_at`, `ends_at`だけを更新し、
RLS policyや参加者データは変更しません。
