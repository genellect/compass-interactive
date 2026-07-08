# Journal Club Realtime Check

このチェックリストは、20人規模の研究室 Journal Club 前に、comments Realtime と、likes / polls / display state の5秒同期を複数端末で確認するためのものです。

## 前提

- Supabase SQL Editorで `create_join_lecture_by_code_rpc.sql` が実行済み
- Supabase SQL Editorで `003_seed_journal_club_mvp.sql` が実行済み
- Supabase Realtimeで `comments` が有効
- `comment_likes` の限定SELECT policyが実行済み
- poll results RPC `get_open_poll_results` が実行済み
- 不要なRealtime publicationを止める場合は `disable_non_comment_realtime.sql` を実行済み
- 参加コードは `JC2026`

## 単一ブラウザ確認

1. `http://localhost:5173/join` を開く。
2. `JC2026` を入力して参加する。
3. `/lecture` に遷移し、`Session` が表示されることを確認する。
4. seed commentが表示されることを確認する。
5. コメントを投稿し、先頭に追加されることを確認する。
6. 同じコメントが二重表示されないことを確認する。
7. likeボタンを押し、like数が1回だけ増えることを確認する。
8. 同じparticipantではlike済み表示になり、unlikeできないことを確認する。
9. single choice pollに回答し、回答済み表示と数秒後の結果更新を確認する。
10. multiple choice pollに回答し、選択肢ごとの結果更新を確認する。

## 複数ブラウザ確認

1. Chromeで `/join` を開き、`JC2026` で参加する。
2. Edgeで `/join` を開き、`JC2026` で参加する。
3. 両方の `/lecture` に同じ `Session` が表示されることを確認する。
4. Chromeでコメントを投稿する。
5. Edgeにリロードなしでコメントが表示されることを確認する。
6. Edgeで別コメントを投稿する。
7. Chromeにリロードなしでコメントが表示されることを確認する。
8. Chromeで任意のコメントにlikeする。
9. Edgeでlike数が最大5秒程度で増えることを確認する。
10. Edgeで別participantとしてlikeし、Chrome側でもlike数が最大5秒程度で増えることを確認する。
11. 同じlikeが二重加算されないことを確認する。

## スマホ確認

1. PCとスマホが同じネットワークにいることを確認する。
2. Vite dev serverをhost公開している場合、スマホからPCのLAN IPでアクセスする。
3. スマホで `/join` から `JC2026` 参加する。
4. スマホ投稿がPCにRealtime反映されることを確認する。
5. PC投稿がスマホにRealtime反映されることを確認する。
6. スマホでlikeし、PC側のlike数が最大5秒程度で増えることを確認する。

## Poll確認

poll responsesのRealtimeは意図的に使いません。

- 回答直後、自分の画面ではlocal stateとRPC再取得で結果更新される。
- 他ブラウザのpoll resultsは最大5秒程度で更新される。
- Journal Club MVPでは、poll resultsは5秒同期で成立とする。

## Display同期確認

1. Chromeで `/admin` を開く。
2. Edgeで `/display` を開く。
3. AdminでPDFページを次へ進める。
4. Display側が最大5秒程度で追従することを確認する。
5. Display modeを変更し、最大5秒程度で追従することを確認する。

## トラブル時

- コメントが表示されない: `comments` SELECT policy、lecture status、`ends_at` を確認する。
- 投稿できない: participant INSERT policy、lectureがopenか、localStorageのsessionを確認する。
- Realtimeが届かない: Supabase Realtime publicationで `comments` が有効か確認する。
- like数が読めない: `enable_comment_likes_select_policy.sql` が実行済みか確認する。
- poll結果が出ない: `create_poll_results_rpc.sql` が実行済みか確認する。
- likes / poll / displayが遅い: タブがバックグラウンドにある場合は30秒同期になる。
- 別sessionのデータが混ざる: `/join` から再参加し、localStorageのsession idを確認する。
