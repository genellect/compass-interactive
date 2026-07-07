# COMPASS Interactive Database Schema Draft

この文書は Phase 2-B の設計案です。まだSupabase SQL Editorでは実行しません。今回の目的は、COMPASS Interactiveを本番DBへ移行する前に、PostgreSQL/Supabase向けのスキーマとRLS方針を人間がレビューできる状態にすることです。

## 1. 設計方針

COMPASS Interactiveは、薬学英語講義などで約200名が匿名参加し、講義中にコメント、いいね、投票を行う教育支援Webシステムです。したがってDB設計では、講義単位の分離、匿名性、重複防止、moderation、安全側のRLSを優先します。

このスキーマでは、すべての主要データを `lecture_sessions` に紐づけます。参加者、コメント、Poll、選択肢、回答、いいねはすべて講義sessionを起点に管理します。これにより、複数講義を扱う段階になっても、講義Aのparticipantが講義BのコメントやPollに混ざる事故をDB制約で防ぎやすくなります。

匿名participantは `participants` に保存します。保存するのは `participant_key` という匿名識別子のみです。氏名、学籍番号、大学メールアドレス、成績情報はInteractive本体では扱いません。現段階ではブラウザ側で生成した匿名IDを `participant_key` として扱う想定です。

講義コードは平文保存しません。`lecture_sessions.code_hash` には、講義コードをhash化した値を保存する前提です。講義コードは参加入口として機能するため、平文で保存すると、DB閲覧権限や誤ったselect policy経由で漏れた場合に講義へ不正参加されるリスクがあります。実際の検証は後続PhaseでRPCまたはサーバー側処理として実装する想定です。

comments、likes、polls、responsesは分離しています。コメント本体は `comments`、いいねは `comment_likes`、Poll本体は `polls`、選択肢は `poll_options`、回答は `poll_responses` に分けます。これにより、コメントのmoderation、同一participantの重複like防止、Pollごとの集計、同一Pollへの重複回答防止をDB制約で扱えます。

Google Form / GASは講義後の記名フィードバック用です。Interactive本体は匿名・講義中リアルタイム反応用に限定し、記名式の講義評価、メールアドレス、学籍番号などはGoogle Form側へ分離します。この責務分離により、講義中の心理的安全性と、講義後の正式評価の管理を混ぜない設計にします。

## 2. 各テーブルの役割

### `lecture_sessions`

講義sessionの親テーブルです。主なカラムは `id`, `title`, `code_hash`, `status`, `starts_at`, `ends_at`, `created_at`, `updated_at` です。

`status` は `draft`, `open`, `closed` のいずれかです。学生が参加できるのは原則 `open` の講義だけです。`code_hash` には講義コードのhashを保存し、平文コードは保存しません。

### `participants`

匿名参加者を表します。主なカラムは `id`, `lecture_session_id`, `participant_key`, `joined_at`, `last_seen_at` です。

`participant_key` は匿名IDであり、氏名や学籍番号ではありません。`unique(lecture_session_id, participant_key)` により、同じ講義内で同じ匿名参加者が重複登録されないようにします。

### `comments`

Live Boardの匿名コメントを表します。主なカラムは `id`, `lecture_session_id`, `participant_id`, `body`, `status`, `is_pinned`, `created_at`, `updated_at` です。

`status` は `visible`, `hidden`, `deleted` を許可します。MVPでは `visible` / `hidden` が中心です。`deleted` は将来のsoft delete用です。`is_pinned` はDisplay Viewで優先表示するために使います。`body` は120文字以内に制限します。

### `comment_likes`

コメントへのいいねを表します。主なカラムは `id`, `lecture_session_id`, `comment_id`, `participant_id`, `created_at` です。

`unique(comment_id, participant_id)` により、同一participantが同じcommentへ複数回likeできないようにします。

### `polls`

Poll本体を表します。主なカラムは `id`, `lecture_session_id`, `question`, `type`, `status`, `created_at`, `updated_at` です。

`type` は `single`, `multiple` のいずれかです。`status` は `draft`, `open`, `closed` のいずれかです。学生が回答できるのは原則 `open` のPollだけです。

### `poll_options`

Poll選択肢を表します。主なカラムは `id`, `lecture_session_id`, `poll_id`, `label`, `display_order`, `created_at` です。

`unique(poll_id, display_order)` により、同一Poll内で表示順が重複しないようにします。`lecture_session_id` も持たせることで、Pollと選択肢が別講義に混ざらないよう複合外部キーで制約します。

### `poll_responses`

Poll回答を表します。主なカラムは `id`, `lecture_session_id`, `poll_id`, `participant_id`, `option_ids`, `created_at`, `updated_at` です。

`option_ids` は `uuid[]` です。7テーブルに限定するため、回答選択肢を配列として持たせます。正規化をさらに進めるなら、後続Phaseで `poll_response_options` のような補助テーブルを追加できます。今回のSQL案ではtriggerで、選ばれたoptionが対象Pollに属していること、single choiceでは1つだけ選ばれていること、重複optionがないことを検証します。

## 3. 重複防止設計

同一participantによる同一commentへの重複likeは、`comment_likes` の `unique(comment_id, participant_id)` で防ぎます。

同一participantによる同一pollへの重複回答は、`poll_responses` の `unique(poll_id, participant_id)` で防ぎます。再回答を許可する場合は、後続Phaseでinsertではなくupsert/updateの扱いを設計します。

poll optionが所属Poll以外で使われることは、`poll_responses.option_ids` の検証triggerで防ぎます。`uuid[]` は通常のforeign keyを各要素へ直接張れないため、`validate_poll_response_option_ids()` で `poll_options.poll_id = poll_responses.poll_id` を確認します。

lecture sessionに紐づかないparticipant / comment / pollはforeign keyで防ぎます。また、`comments`, `comment_likes`, `poll_options`, `poll_responses` には `lecture_session_id` を持たせ、複合foreign keyで「participantやpoll/commentが同じlectureに属していること」を保証します。

## 4. index設計

200名程度の同時参加では、講義単位での取得が中心になります。そのため、ほとんどのindexは `lecture_session_id` を先頭にしています。

- `lecture_sessions_status_time_idx`  
  open中講義の判定、時間範囲チェックに使います。

- `participants_lecture_idx`  
  講義ごとの参加者一覧、admin dashboardの参加者数確認に使います。

- `comments_lecture_created_idx`  
  講義単位で新着コメントを取得するために使います。

- `comments_lecture_status_created_idx`  
  student/display向けにvisible commentsだけを取得するために使います。

- `comments_lecture_pinned_likes_idx`  
  Display Viewでpinnedコメントを優先し、visibleコメントを並べる用途に使います。like数は現案では `comment_likes` から集計する想定なので、将来必要なら集計用viewやmaterialized viewを検討します。

- `comment_likes_participant_idx`  
  participantがどのcommentをlike済みか確認する用途に使います。

- `polls_lecture_status_idx`  
  講義内のopen poll取得、admin dashboardのPoll一覧に使います。

- `poll_options_poll_order_idx`  
  Poll選択肢を表示順に並べるために使います。

- `poll_responses_poll_idx`  
  Poll集計に使います。

- `poll_responses_participant_idx`  
  participantが回答済みか確認する用途に使います。

## 5. RLS方針

全テーブルでRLSを有効化します。publishable keyを使うfrontendからは、RLS policyで許可された操作だけが可能です。

安全上、`lecture_sessions` には現時点でpublic select policyを作りません。理由は `code_hash` を同じテーブルに持つためです。RLSは行単位の制御であり、列単位に `code_hash` だけを隠す用途には向きません。後続Phaseでは、`code_hash` を返さないRPCまたはviewで最小限の講義metadataを返す設計にします。

student/displayに見せてよいのは、open講義に属する `visible` comments、open Poll、open Pollの選択肢です。`hidden` commentsはstudent/displayには見せません。

admin認証は未実装のため、commentsのhidden / visible切替、pin / unpin、pollのopen / close、lecture_sessionsの作成・更新、poll作成、admin dashboard用の全件読み取りは現時点ではblockedまたはplaceholder扱いです。

重要な制約として、現時点のSQL案では匿名participantがブラウザ内で生成される前提です。RLSは講義がopenであること、participantやcomment/pollが同じlectureに属することは検証できますが、「そのブラウザが本当にそのparticipant_idの所有者である」ことまでは暗号的に証明できません。したがって、production前にはSupabase Anonymous Authを使って `auth.uid()` とparticipantを結びつける、またはprivate participant tokenを検証するSECURITY DEFINER RPCを用意するなど、participant本人性の補強が必要です。

Phase 2-Dでcomments取得・投稿だけをbackend化する場合、`participants` にはpublicなSELECT policyをまだ付けない方針です。そのため、participant作成時はフロントエンド側で `crypto.randomUUID()` などによりUUIDを生成して `participants.id` としてinsertするか、後続でSECURITY DEFINER RPCを用意してparticipant rowを作成・返却する方式を検討します。広いparticipant SELECTを開けると、匿名IDの一覧が読めてしまい、なりすましの足場になるためです。

Phase 2-Fでcomment likesの件数表示を行う場合、`comment_likes` のSELECTが必要になります。ただし、広いSELECTではなく、open lectureに属するvisible commentのlikesだけを読ませるpolicyに限定します。Phase 2-Gでは、このための手動実行SQLを `supabase/manual/enable_comment_likes_select_policy.sql` として作成します。`participants` のSELECTは引き続き開けません。unlike/deleteは、localStorage上のparticipant本人性だけでは安全に許可しにくいため、participant所有確認を強化するまでblockedにします。

service_role key、secret key、database passwordはfrontendで使いません。service_role keyはRLSを迂回できるため、信頼されたサーバー側環境だけで扱うべきです。

後続Phaseでadmin認証を導入した後、以下のpolicyを追加します。

- adminだけが `lecture_sessions` を作成・更新できる
- adminだけがhidden commentsを読める
- adminだけがcommentsのstatusとpinを更新できる
- adminだけがpolls / poll_optionsを作成・更新できる
- adminだけがpoll_responsesの集計用raw dataを読める

## 6. 現時点で意図的に未対応とすること

- admin認証
- Realtime subscription
- repositoryのSupabase実装
- commentsのbackend化
- likesのdelete / Realtime backend化
- poll responsesのbackend化
- Google Form / GAS連携
- Word Cloud / Emoji Reaction / Quiz / Q&A
- 複数講義sessionの管理UI
- 本番運用向けの詳細な監査ログ

## 7. Phase 2-C以降の推奨手順

1. SQL案を人間がレビューする
2. Supabase SQL Editorでmigration SQLを手動実行する
3. seed用のテストlectureを作成する
4. comments取得・投稿のみSupabase repository化する
5. commentsのRealtime同期を試す
6. comment likesをbackend化する
7. poll status / poll responsesをbackend化する
8. student/admin/displayの取得範囲を整理する
9. admin認証とRLS policyを強化する

最初のbackend化はcomments取得・投稿に限定するのが安全です。likesやpoll responsesは重複防止、再回答、削除、集計が絡むため、commentsで接続確認してから進めます。

Phase 2-Dで必要なseed dataは、少なくともopen状態の `lecture_sessions` 1件です。`lecture_sessions` はpublic SELECT policyを持たないため、最初はレビュー済みのseed lecture idを開発用定数または限定的なRPC経由で扱う想定にします。コメント投稿テストには、そのlectureに紐づく匿名participant 1件が必要です。
