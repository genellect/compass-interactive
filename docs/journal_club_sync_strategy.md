# Journal Club Sync Strategy

## 方針

Journal Club MVPでは、学生が即時性を最も必要とする掲示板コメントだけをSupabase Realtimeに残します。
それ以外の更新は5秒同期へ寄せ、タブがバックグラウンドにある間は30秒同期へ落として通信量を抑えます。

| 機能 | 同期方式 |
| --- | --- |
| 掲示板コメント | Realtime INSERT |
| いいね数 | 5秒同期 |
| Poll一覧・Poll結果 | 5秒同期 |
| PDFページ・表示モード | 5秒同期 |
| AIスクリプト表示 | 後続Phaseで5秒同期予定 |

## Frontend実装

- `src/hooks/useAdaptiveLiveSync.ts`  
  アクティブタブでは5秒、バックグラウンドでは30秒で同期処理を実行します。

- `src/context/CompassStateContext.tsx`  
  comment likes、open polls、poll resultsを同じ5秒同期にまとめます。commentsのINSERT Realtimeだけは維持します。

- `src/pages/DisplayPage.tsx`  
  `lecture_display_state` のRealtime購読をやめ、5秒同期でPDFページと表示モードを取得します。

- `src/pages/AdminPage.tsx`  
  Admin側も `lecture_display_state` のRealtime購読をやめ、5秒同期で表示状態を確認します。Admin操作直後は手元のstateへ即時反映し、他画面は最大5秒で追従します。

## Supabase側の任意整理

フロントエンドは不要なRealtime購読を止めています。さらにSupabase側の余分なpublicationとpoll結果イベントtriggerも止めたい場合は、以下をSQL Editorで手動実行します。

```text
supabase/manual/disable_non_comment_realtime.sql
```

このSQLはapplication tableをdropせず、既存データも削除しません。`comments` のRealtimeは残します。

## 今回まだ実装しないこと

- AI transcript backend
- Poll作成UI

講義作成・開始・終了、講義終了時の同期停止、無操作30分タイムアウトは `docs/lecture_lifecycle.md` の方針で実装しています。
