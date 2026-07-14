# Phase 1 同期プロトコル実装・運用ガイド

- 実装日: 2026-07-14
- 対象: Phase 1（P1-01〜P1-06）
- ローカル判定: PASS
- 本番DB／Cloudflare: 未適用

## 1. 実装結果

Phase 1は旧snapshotを残したexpand-first migrationとして実装した。既定のfrontend feature flagはOFFであり、Phase 1 migrationより先にfrontendが配信されてもv2 RPCは呼ばれない。

主要な変更は次のとおり。

- 共有5秒snapshotを`get_lecture_public_snapshot_v2`へ分離した。
- 本人専用stateを`get_lecture_participant_state_v2`へ分離した。
- コメント履歴を`get_lecture_comment_history_v2`のcursor pageへ分離した。
- `lecture/caption/comments/likes/polls/summaries/pdf`の7 section versionを導入した。
- 旧`get_lecture_live_snapshot`、`state_version`、`display_version`は移行期間中そのまま維持した。
- コメントRealtimeはPhase 0でpublicationから除外済みで、Phase 1でも0接続を維持する。
- 自分のコメントは即時に楽観表示し、保存成功時に正式IDへ置換、失敗時に取り消す。
- 初回コメントは最大100件、古い履歴はユーザー操作時だけ50件ずつ取得する。
- visible中は無操作でも5秒同期を継続する。hidden後30秒で1回同期し、その後は停止する。visible復帰時は即時同期する。
- foregroundの失敗再試行は指数backoff（最大30秒）と0〜1秒jitterを使用する。

## 2. 固定contract

共有snapshotのroot contractは次の形とする。

```json
{
  "contract_version": 2,
  "server_time": "2026-07-14T00:00:00Z",
  "versions": {
    "lecture": 1,
    "caption": 0,
    "comments": 4,
    "likes": 2,
    "polls": 1,
    "summaries": 0,
    "pdf": 3
  },
  "changed": {}
}
```

`changed`にはversionが変わったsectionだけを含める。共有payloadでは、コメント投稿者ID、本人のいいね状態、本人のPoll回答、participant IDを返さない。

本人専用RPCは`auth.uid()`から講義内participantを導出し、次だけを返す。

- 自分のparticipant IDとmembership時刻
- 自分がいいねしたcomment ID
- 自分のPoll回答
- コメント可否、文字数上限、次回投稿可能時刻

クライアント指定participant IDは本人判定に使用しない。本人専用stateは初回join／hydrateと、自分のコメント、いいね、Poll操作後だけ再取得し、5秒snapshotには混在させない。

## 3. feature flag

```dotenv
VITE_PHASE1_SYNC_PROTOCOL=false
```

- `false`または未設定: 旧`get_lecture_live_snapshot`を使用する。
- `true`: v2共有snapshot、本人専用state、履歴cursorを使用する。
- flagはVite build時に確定するため、切替にはfrontend再deployが必要である。

## 4. migration順序

本番変更は別作業として明示承認を得てから行う。安全な順序は以下である。

1. 本番backup／migration history／Phase 0 gateを再確認する。
2. `20260714021129_phase1_sync_protocol_v2.sql`だけを適用する。
3. schema diff、Security Advisor、Performance Advisor、関数EXECUTE権限を確認する。
4. 本番の認証済み2ユーザーで、共有payload一致・本人state分離・他人state非開示を確認する。
5. frontendを`VITE_PHASE1_SYNC_PROTOCOL=false`でdeployし、旧contractの回帰smoke testを行う。
6. `VITE_PHASE1_SYNC_PROTOCOL=true`でdeployする。
7. 20人相当の講義でsnapshot error、p95、コメント／Poll／PDF追従を監視する。
8. 問題がなければPhase 1 production gateを記録する。

## 5. rollback

Phase 1 migrationはexpand-onlyである。障害時はDBを巻き戻さず、まずfrontendを`VITE_PHASE1_SYNC_PROTOCOL=false`で再deployする。

- 旧RPCと旧version列は残っているため、コメント、いいね、Poll、PDF同期を継続できる。
- v2関数や追加列は、参照がなくなっても直ちにDROPしない。
- DB contractの削除は、全frontendが旧版を使用していないことを確認した将来のcontract migrationでのみ行う。
- v2有効化前にmigrationがない場合はRPCエラーとなるため、flagをOFFへ戻す。
- v2有効化後に異常が出た場合は、error率／対象lecture／browser versionを記録してからflagをOFFへ戻す。

## 6. 検証結果

### Database

- Docker上の空DBから全migrationを再適用: PASS
- Phase 0既存dataからPhase 1へのupgrade: PASS
- 旧`state_version=11`から`lecture_version=11`へのbackfill: PASS
- 旧`display_version=7`から`pdf_version=7`へのbackfill: PASS
- 旧snapshotとv2 snapshotの同時呼び出し: PASS
- pgTAP: 6 files、179 assertions、失敗0
- Phase 1追加pgTAP: 46 assertions
- Supabase DB lint（public/private）: error／warning 0
- 2ユーザーのparticipant／いいね／Poll回答分離: PASS
- captionだけのversion更新で他sectionが返らない: PASS

### Frontend／failure

- TypeScript typecheck: PASS
- oxlint: PASS
- live-state unit／static test: PASS
- Supabase baseline static test: PASS
- optimistic commentのsnapshot中保持、正式ID置換、失敗rollback: PASS
- hidden 30秒sync、60秒停止判定、visible即時syncのlogic test: PASS
- 公式Supabase CLIで生成したローカル型と追加列／3 RPCのsignatureを照合: PASS

### 90分負荷モデル

| Scenario | Shared snapshot calls | Initial participant calls | Comment Realtime | 変更なしpayload概算 |
|---|---:|---:|---:|---:|
| 20 students | 21,600 | 20 | 0 | 3.48 MiB |
| 300 students | 324,000 | 300 | 0 | 52.22 MiB |

- 変更なしpayload: 169 bytes
- caption単独差分payload: 207 bytes
- caption単独更新時に再送するsection: captionだけ

### ローカルDB rate test

| Scenario | Rate | Samples | Avg latency | 500ms超過 | Error |
|---|---:|---:|---:|---:|---:|
| 20 students相当 | 4 req/s | 78 | 5.203 ms | 0 | 0% |
| 300 students相当 | 60 req/s | 1,155 | 3.313 ms | 0 | 0% |

60 req/sは300 clients ÷ 5秒として算出した。500ms超過が0件のため、今回のDB function sampleではp95 500ms未満のgateを満たす。これはローカルPostgres functionの測定であり、本番のPostgREST、network、同時授業、他workloadは含まない。本番有効化後にendpoint p95とerror率を再確認する。

## 7. 監視項目

- `get_lecture_public_snapshot_v2`のp50／p95／p99とerror率
- 5秒間隔に対する実効request数とbackoff発生数
- `changed`のsection数とresponse bytes
- participant state RPCが定期pollに混入していないこと
- コメントRealtime connectionが0であること
- hidden後60秒を越えたclientから定期requestが来ないこと
- lecture closed後にsnapshot loopと学生mutationが停止すること
- comments versionが不変のときコメント配列を返していないこと

## 8. 既知の境界

- archive画面はPhase 2で実装するため、Phase 1時点ではopen lecture以外のpollingを開始しないことでone-shot要件を先取りしている。
- captionとsummariesのDB内容は将来Phase用placeholderであり、Phase 1はversionとcontractだけを予約する。
- 本番endpointのp95／error率、Advisor再検査、本番2ユーザー試験は、本番適用作業まで未完了である。
