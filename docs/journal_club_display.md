# Journal Club Display MVP

JC-4では、`/display` を研究室Journal Clubの共有画面向けに整理します。

## 表示内容

- active lecture sessionのvisible comments
- comment like数
- open polls
- poll results RPCの集計値
- AI transcript placeholder
- PDF slide viewer placeholder

## active session

`/display` は、`/join` で `JC2026` に参加したときにlocalStorageへ保存されるactive `lecture_session_id` を使います。

Display用PCや共有ブラウザでは、最初に `/join` でJournal Clubコードを入力してから `/display` を開きます。未参加状態で `/display` を開いた場合は、Joinから参加する案内を表示します。

## comments / likes

commentsはSupabaseからvisible commentsのみ取得します。Realtime subscriptionにより、新規commentはリロードなしで表示されます。

likesはcomment_likesの取得値を約5秒ごとに再取得して表示します。同じparticipantのlikeはDB制約で重複防止します。

## polls / poll results

open pollsとpoll_optionsをSupabaseから取得し、poll resultsは `get_open_poll_results` RPCの集計値を表示します。

poll responsesのRealtimeは使いません。Display画面では約5秒ごとにpoll resultsを再取得し、発表中の共有画面で古い結果が残り続けないようにしています。

## AI transcript placeholder

AI transcript欄は後続phase用のplaceholderです。

JC-5以降で、OpenAI Realtime transcriptionをSupabase Edge Function等のserver-side token発行経由で接続します。`OPENAI_API_KEY` はReact frontendに置きません。

## PDF slide viewer placeholder

PDF slide viewer本体は今回実装しません。

将来的には、PowerPointをPDF化したスライドをDisplay画面に読み込み、発表者またはAdminが手動でページ送りできるviewerを追加します。

想定する要素:

- PDFファイル読み込み
- current page / total pages表示
- next / previous操作
- PDF viewerとcomments / poll / transcriptの同一layout内共存

## 今回実装しないもの

- PDF upload
- PDF rendering
- OpenAI API接続
- live transcript生成
- 翻訳
- admin操作の本格追加
- poll responses Realtime
