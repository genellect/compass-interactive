# Phase 7.27 Local Gate — 2026-07-22

## 判定

- Automated Local Gate: **PASS**
- Human UI Gate: **HOLD（ローカルプレビューで教員確認待ち）**
- Hosted / Production Gate: **HOLD**
- Hosted Supabase、Cloudflare Worker/R2、公開Web、OpenAI、feature flag、`main`、push、deploy: **変更なし**
- production Journal Club run: **未作成**

この判定は、Phase 7.27のローカル実装と自動検証だけを承認する。本番反映、PDF公開、実R2、実Turnstile、実スマートフォンおよび人間目視を承認するものではない。

## 対象

Phase 7.27は既存の講義状態機械を増やさず、次の薄い運用プリセットだけを追加する。

1. 毎回独立したリハーサルdraft、または一回限りの本番draftを作る。
2. 各runへ順序付き6件のsingle-choice Pollをdraftで作る。
3. 本番終了後だけ、既存Archive exportへ厳密な恒久保持policyを付与する。

準備操作だけでは、講義、Poll、PDF、Realtime、AI、外部通信または課金処理を開始しない。開始と終了はPhase 0〜7.26の認証、RLS、Admin session、90分hard stop、API PINおよび利用上限をそのまま通る。

## 確定PDF binding

利用者が承認した外部ファイルを無加工で使用する。PDF本体とPC上の絶対パスはGitまたはSupabaseへ保存していない。

| 項目 | 値 |
| --- | --- |
| document ID | `journal-club-2026-07-23-v1` |
| SHA-256 | `8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842` |
| byte数 | `5,816,208` |
| page数 | `34` |
| PDF version | `1.6` |

本番runをopenへ遷移させるDB guardは、同じlectureにexact document ID、SHA-256、byte数、page数を持つvisible/non-retired PDFがactiveでない限り、server-sideで拒否する。UIや運用手順だけには依存しない。

## 状態遷移と障害時動作

```text
Admin prepare
  -> fresh lecture=draft
  -> fresh run binding
  -> six Polls=draft + 24 options + six ordered slots
  -> exact PDF upload/commit/activate（既存Phase 7.26）
  -> Admin explicit lecture open（productionはactive PDF必須）
  -> Admin explicit Poll open/close
  -> manual close または server time 90分close
  -> existing archive outbox/export
  -> rehearsal=standard 30日 / production=exact permanent policy
```

- 同一request UUIDの再送は同じrunへ収束する。
- 二Adminのproduction作成、同一run open、手動/自動終了はadvisory lock、unique constraint、既存冪等RPCで直列化する。
- production PDF未公開、descriptor不一致、retired documentはopenを拒否する。
- rehearsal間、rehearsal/production間でlecture UUIDを共有せず、コメント、Poll回答、AI台帳、resume token、PDF publicationを複製しない。
- Cron停止時も既存read/write RPCが期限切れlectureをactive扱いせず、終了済み書き込みを拒否する。
- Archive permanent policyはexact 2-key objectだけを認める。未知/余分なkeyはstandard扱いになり、既に確定したpermanent archiveを後続standard payloadでdowngradeできない。
- canonical key-order SHAと旧insertion-order SHAの双方を読み取り互換として検証し、今後の書き込みはcanonical JSON hashへ統一する。
- React StrictModeのArchive resume cleanup後も同じcodeを再試行でき、pending状態へ固定されない。

## Migrationとrollback

- migrationは`20260721210000_phase7_27_journal_club_integration.sql`一件のexpand-first追加である。
- 既存table/RPCを削除・renameせず、旧clientとfeature flag OFF経路を維持する。
- run/slot tableはRLS有効、public/anon/authenticated grantなし、Realtime publication未登録である。
- 公開prepare RPCは作らず、service-role限定`SECURITY INVOKER` RPCがtracked Admin sessionとAuth user bindingをDB内でも再検証する。
- rollbackはfrontend flag OFF、次にEdge flag OFFで新規prepareを停止する。作成済みdraftとadditive schemaは保持し、contract migrationでの物理削除は行わない。
- permanent archive作成後はpermanent-aware Workerより古い版へ直接戻さない。先にcleanupを停止し、互換patchを維持する。

## 負荷・費用

- prepare一回は1 Edge requestと1 DB transaction（lecture 1、run 1、Poll 6、option 24、slot 6）だけである。
- 学生ごとの追加polling、Realtime subscription、snapshot requestは0。
- 20人/300人・90分モデルでPhase 7.27追加負荷はparticipant count invariant。
- preset準備によるAI request、Realtime Whisper、R2 upload、課金予約は0。
- permanent Archiveの閲覧はWorker/R2側で完結し、Supabase live loopを再開しない。

## 自動検証結果

### Database / security

- clean migration from zero: PASS
- Phase 7.27 pgTAP: **54/54**
- full pgTAP: **1,169/1,169、24 files**
- Phase 7.2 data upgrade through Phase 7.27: **6/6**
- Phase 7.26 data upgrade through Phase 7.27: **9/9**
- two-connection races: request replay、single production、parallel rehearsals、single openすべてPASS
- Phase 4.1 AI laneおよびPhase 7.26 PDF concurrency回帰: PASS
- DB lint `--fail-on error`: PASS。既存private snapshot関数のunused parameter warningだけを確認
- generated DB types drift: なし
- production-local Edge: Auth、bounded input、tracked Admin session、PIN throttle、paid feature fail-closedすべてPASS
- secret scan: PASS
- `npm audit --audit-level=high`: **0 vulnerabilities**

### Unit / static / load / build

- non-live regression: **55/55 groups**
- Asset Worker: **49/49**
- Phase 7.27 Edge: **4/4**
- Phase 7.27 load: PASS（20/300とも追加student periodic request=0）
- main / Phase 3 / E2E TypeScript: PASS
- oxlint: error 0。既存`AdminPage.tsx` exhaustive-deps warning 1件のみ
- production build: PASS
- bundle ceilings: PASS
  - Admin JS `88,352 / 92,109` bytes
  - app CSS `86,145 / 88,449` bytes
  - index JS `288,937 / 529,742` bytes
  - PDF JS `460,791 / 479,617` bytes

### Browser / integration

- Phase 7.26 ON three repeats: **24/24**
- Phase 7.26 OFF three repeats: **6/6**
- Phase 7.27 ON three repeats: **36 PASS / 12 intentionally skipped**
- Phase 7.27 OFF three repeats: **12 PASS / 36 intentionally skipped**
- real browser -> local Edge -> real Postgres Journal Club: **1/1**
- existing lecture browser -> local Edge -> real Postgres, Chromium/WebKit/mobile three repeats: **9/9**
- full Demo Chromium/WebKit desktop/mobile three-repeat matrix: **108 PASS / 96 intentionally skipped**
- Admin/Archive axe serious/critical violations: 0
- exact permanent/extra-key standard Archive display、keyboard、confirm cancel、external-network guard: PASS
- DB reset後に旧講義IDがブラウザへ残る条件で、講義未選択へ収束しAdmin認証を維持: **Chromium/WebKit desktop/mobile 4/4**

## 検証中に修正した欠陥

1. production PDFが未公開でもrunをopen可能だったため、DB triggerにexact active PDF guardを追加した。
2. permanent archiveが新しいstandard payloadでdowngrade可能だったため、Workerをmonotonic fail-closedへ変更した。
3. Edge canonical JSON hashとWorker insertion-order hashが不一致だったため、canonical hashingを正本化し旧hash read互換を残した。
4. React StrictMode cleanup後にArchive resumeがpending固定し得たため、所有するattempt refをcleanupした。
5. light themeの補助文字/badgeにWCAG contrast不足があり、色だけを調整した。
6. 一般local E2EがJournal Club専用specをflag OFFで誤収集したため、runnerの`local`と`local-jc`責務を分離した。
7. 10秒デモ更新とMobile WebKitの自動pointer scrollが競合したため、E2Eをforce clickではなくfocus/Space/Enterのアクセシブル操作へ修正した。
8. DB reset後の保存済み講義IDが404になった際、旧live状態と未処理Promiseが残り得たため、Admin認証を保持したまま講義選択状態だけを初期化し、未選択表示へ収束させた。

## Human / Hosted / Production Gateの未完了事項

次の項目はLocal Gate対象外であり、いずれか未達なら本番公開しない。

- 教員によるローカルAdmin、学生、Display、Archiveの最終目視承認
- 実スマートフォンと実マイク（マイクは後続human testとして保留）
- Hosted Supabase expand-first migration、Advisor、旧client、二user/二Admin分離
- Private R2/Worker/Edgeをflags OFFで段階反映
- 正本PDF 34ページ目視、実R2 upload/download、15 MiB canary、immutable/retry/reuse failure
- Turnstile hostname/action、二段rate limit、Durable Object、WAF/rate protection
- cleanup Cron二周期、失敗監視、標準30日とproduction permanentの実環境照合
- 本番終了後の全コメント/Poll/AI/PDF/archive hash照合と独立offline recovery copy
- exact candidate commitのHosted CI

Human UI Gate承認後も、段階的本番公開は別turnで推論レベルUltraによる再監査と明示承認を経て開始する。
