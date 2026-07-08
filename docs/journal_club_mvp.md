# Journal Club MVP Development Strategy

## 1. Purpose

この文書は、COMPASS Interactive の短期開発目標を、薬学英語講義 200 名規模の本番運用から、2 週間後の研究室 Journal Club / Lab Seminar DX MVP へ切り替えるための baseline です。

今回の MVP は、20 名規模の研究室内 Journal Club で、匿名コメント、like、poll、Display 表示、将来的な OpenAI API による英語字幕生成を使い、英語発表の理解支援と質疑促進に使えるかを検証するものです。

200 名規模の講義本番運用、成績連携、学籍情報連携、大学全体展開は今回の直接目標ではありません。

## 2. Current State

現在の実装は、Vite + React + TypeScript の frontend と Supabase backend を使う prototype です。

### Routes

- `/join`: lecture code 入力用の参加画面
- `/lecture`: 学生・参加者がコメント、like、poll に参加する画面
- `/admin`: 教員・運営者向け dashboard の prototype
- `/display`: 講義室スクリーン・Zoom 共有向けの読み取り表示

### Main Components

- `src/components/LiveBoard/`: comments、comment input、comment card
- `src/components/LivePoll/`: polls、poll cards、poll result display
- `src/components/DisplayView/`: display 表示
- `src/context/`: app state、Supabase 連携、local/mock state の統合
- `src/repositories/`: mock repository と Supabase repository
- `src/services/`: app action の責務分離
- `src/types/`: lecture、participant、comment、poll の TypeScript 型

### Supabase and Repositories

- Supabase client は `src/lib/supabaseClient.ts` に実装済み
- `participants` は anonymous participant を localStorage と UUID で管理
- `participants` の public SELECT は開けていない
- `comments` は visible comments の取得・投稿を Supabase に接続済み
- `comments` INSERT Realtime は実装済み
- `comment_likes` は取得・追加を Supabase に接続済み
- `comment_likes` は5秒同期で集計表示
- `polls` / `poll_options` は open poll の取得を Supabase に接続済み
- `poll_responses` は INSERT のみ Supabase に接続済み
- `poll_responses` SELECT は開けていない
- poll 結果は `get_open_poll_results` RPC で集計値のみ取得する設計

### Manual SQL

SQL は自動実行せず、Supabase SQL Editor で手動実行する運用です。

- `supabase/migrations/001_initial_schema.sql`: 初期 schema / RLS
- `supabase/manual/enable_comment_likes_select_policy.sql`: visible comments に限定した likes SELECT policy
- `supabase/manual/disable_non_comment_realtime.sql`: comments以外のRealtime publication整理
- `supabase/manual/create_poll_results_rpc.sql`: poll results aggregate RPC
- `supabase/manual/reopen_dev_lecture.sql`: development lecture の再 open 用

Journal Club MVP 前に特に確認すべき SQL は、`create_poll_results_rpc.sql` と `reopen_dev_lecture.sql` です。poll 結果表示が必要な場合は RPC が実行済みであること、コメント投稿が RLS で拒否される場合は dev lecture が open かつ `ends_at` が未来であることを確認します。

### Seed SQL

- `supabase/seed/001_seed_test_lecture.sql`: development lecture と anonymous participant の seed
- `supabase/seed/002_seed_test_polls.sql`: single choice / multiple choice poll の seed

### Docs

既存 docs は Phase 2 の Supabase 設計と実装経緯を記録しています。

- `docs/database_schema.md`
- `docs/supabase_setup.md`
- `docs/phase2_seed_data.md`
- `docs/phase2_realtime_comments.md`
- `docs/phase2_realtime_likes.md`
- `docs/phase2_poll_backend.md`
- `docs/phase2_poll_results_rpc.md`

## 3. MVP Goal

2 週間後の研究室 Journal Club で、20 名程度が各自の端末から参加し、以下を確認できる状態にします。

- lecture code で参加できる
- anonymous comments を投稿できる
- comments が複数端末へ Realtime 反映される
- comments に like できる
- like 数が複数端末へ最大5秒程度で反映される
- open poll に回答できる
- poll 結果の集計値を表示できる
- 発表・討論用 Display を使える
- OpenAI API を frontend に置かない安全方針で、英語字幕 MVP へ進める

## 4. In Scope

Journal Club MVP に含めるものは以下です。

- lecture code join
- anonymous comments
- comments Realtime
- comment likes
- comment likes 5秒同期
- polls
- poll responses
- poll results
- minimal admin login / admin gate
- Display MVP
- AI transcript placeholder
- OpenAI API を frontend に置かない設計方針
- runbook / fallback plan

## 5. Out of Scope

今回の MVP から除外するものは以下です。

- 日本語への自動翻訳
- 200 名講義負荷試験
- Google Form / GAS 連携
- COMPASS Web / 将来戦略ライブラリ統合
- community 掲示板
- full admin lecture management
- full moderation backend
- student 向け字幕配信
- AI 要約 / FAQ 生成
- Stripe 決済
- OpenAI API 本実装
- API key の frontend 配置

## 6. OpenAI API Design Note

今回の JC-0 では OpenAI API 呼び出しを実装しません。ただし、将来的な英語字幕生成の安全方針は先に固定します。

- `OPENAI_API_KEY` は React frontend に置かない
- `VITE_OPENAI_API_KEY` は禁止
- API key は Supabase Edge Function または server-side endpoint 側で扱う
- browser 側には ephemeral credential / client secret 方式を検討する
- 最初の字幕 MVP は Display-local transcription を第一候補にする
- 字幕を Supabase DB へ保存する方式は後続 phase で検討する
- 今回の MVP では翻訳を実装しない

OpenAI の公式ドキュメントでは、Realtime API は browser / mobile client では WebRTC、server-to-server では WebSocket を使う構成が示されています。また、browser から直接長期 API key を使うのではなく、server 側で client secret を発行して接続する設計が案内されています。ライブ字幕は Realtime transcription を優先候補とし、録音ファイルの後処理には Speech to text API を別候補として扱います。

References:

- https://developers.openai.com/api/docs/guides/realtime
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/guides/speech-to-text

## 7. Recommended Two-Week Roadmap

1. JC-0: Scope Freeze and Baseline
2. JC-1: Lecture Code Join
3. JC-2: Realtime Core Stabilization
4. JC-3: Minimal Admin Login
5. JC-4: Display MVP
6. JC-5: OpenAI Live Transcript MVP
7. JC-6: Deployment and Rehearsal

## 8. Immediate Next Step

次に実装へ進むなら、最優先は JC-1: Lecture Code Join です。

現状は `VITE_DEV_LECTURE_SESSION_ID` による development lecture 固定で動いています。Journal Club で使うには、参加者が入力した lecture code を安全に検証し、open な lecture session と anonymous participant を返す narrow RPC が必要です。

JC-1 では以下を行います。

- `join_lecture_by_code` RPC 案を作成する
- lecture code は平文保存しない
- frontend から `lecture_sessions` や `participants` を広く SELECT しない
- `/join` から `/lecture` への実参加導線を固定する
- dev lecture 固定依存を段階的に外す

## 9. Fallback Plan

当日失敗しても Journal Club が成立するよう、以下を fallback とします。

- AI 字幕が落ちた場合: comments / polls / Display のみで運用
- Display が落ちた場合: 発表者または司会者の `/lecture` 画面を共有
- Join がうまくいかない場合: dev lecture URL と固定コードを事前配布
- Supabase Realtime が不安定な場合: 手動 reload を許容
- OpenAI API が使えない場合: 字幕なしで質疑支援 MVP として実施

## 10. Success Criteria

JC-0 の成功条件は、次 phase へ安全に進むための baseline が文書化され、既存実装を壊さないことです。

- 現在の実装状態が整理されている
- Journal Club MVP の In Scope / Out of Scope が明確である
- OpenAI API key を frontend に置かない方針が明確である
- manual SQL と seed SQL の確認対象が明確である
- `.env.local.example` と `.gitignore` が secret 流出を避ける形になっている
- typecheck / build / lint が通る、または失敗理由が説明されている
