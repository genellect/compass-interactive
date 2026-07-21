# Phase 7.27 Journal Club運用統合

## 1. 目的と境界

Phase 7.27は、2026年7月23日のJournal Clubを安全に準備・リハーサル・実施し、実施後の記録を継続公開するための薄い運用プリセットである。新しい講義状態機械、Poll配信方式、PDF配信方式、AI起動方式は作らない。Phase 0〜7.26の認証、RLS、90分終了、Poll、コメント、Private R2、AI利用量、Archive、CI/E2E契約をそのまま正本として再利用する。

本Phaseが自動化するのは、次の2点だけである。

1. 本番またはリハーサル用の独立したdraft講義を1件作る。
2. その講義へ順序付きの6件のdraft Pollを原子的に作る。

作成だけでは、講義開始、Poll開始、PDF公開、Realtime、AI、外部課金は一切起動しない。各操作は既存Admin UIから教員が明示して行う。

## 2. 確定資料

正本PDFは、利用者が最終承認した `260723 JournalClub Presentation.pdf` を無加工で使用する。

| 項目 | 固定値 |
| --- | --- |
| document ID | `journal-club-2026-07-23-v1` |
| SHA-256 | `8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842` |
| byte数 | `5,816,208` |
| page数 | `34` |
| PDF version | `1.6` |

PDF本体や開発者PC上の絶対パスはGitまたはSupabaseへ保存しない。公開時にはPhase 7.26のブラウザ完結Publisherを使い、WorkerとPostgresの双方が上記descriptorを検証する。Local Publisherは互換・復旧経路のままとする。

## 3. ライフサイクル

### 3.1 runの分離

- `rehearsal`: 何回でも作成できる。毎回、新しいlecture UUID、新しい6桁コード、新しい6 Poll、新しいPDF binding、独立したコメント・回答・AI利用量を持つ。
- `production`: event全体で1件だけ作成できる。新しいlecture UUIDと6桁コードを持ち、本番終了後は同じコードが継続公開Archiveへの入口になる。
- productionとrehearsalを同時にopenにはできない。DB triggerとadvisory transaction lockで競合を直列化する。
- 前回runのコメント、Poll回答、AI出力、resume token、PDF状態は次回runへ複製しない。

### 3.2 状態遷移

```text
Adminが準備
  -> lecture=draft + Poll 6件=draft
  -> PDFを選択・検証・非公開upload・commit・active
  -> Adminが講義開始（既存90分hard stop）
  -> AdminがPollを1件ずつ明示開始・終了
  -> Admin手動終了 または DB時刻による90分終了
  -> 既存Archive outboxがsanitized snapshotをPrivate R2へexport
  -> productionだけexact policyで継続公開
```

ブラウザ終了、Cron遅延、二Admin競合が起きても、講義開始・終了、書き込み拒否、AI停止、PDF公開状態は既存DB/RPC契約が収束させる。Phase 7.27 UIはこの契約を迂回しない。

## 4. 固定Poll

全Pollはsingle choiceかつdraftで作成し、次の順序をDBのslot tableで保持する。

1. `QUIZ1: C9orf72リピートはどの方向に転写される？`
2. `QUIZ2: CasRxが直接切断する分子はどれ？`
3. `QUIZ3: gRNAをリピート隣接領域に設計する利点は？`
4. `FINAL QUIZ: この研究から直接結論できないものはどれ？`
5. `今回の発表を通して、説明・文献の内容をどの程度理解できましたか？`
6. `COMPASS Interactiveは、今回の発表内容の理解や議論への参加に役立ちましたか？`

選択肢はmigration内の固定blueprintを正本とする。作成途中に1件でも失敗した場合、lecture、run binding、Poll、options、slotsは同一transactionで全rollbackする。

## 5. 認可・脅威モデル

### 5.1 Admin作成経路

- UI flagとEdge flagは別々に既定OFF。
- Edgeは署名済みAdmin tokenから`sid`を取得し、Bearer JWTをSupabase Authで再検証する。
- DB RPCは`SECURITY INVOKER`、固定空`search_path`、`service_role`だけにEXECUTEを許可する。
- DBはAdmin session IDとAuth user IDのbinding、失効、absolute expiry、idle expiryを再検証する。
- `client_request_id`とadvisory lockにより再試行を冪等化し、同じ要求は同じlectureを返す。
- code衝突時だけ新しい6桁コードで再試行し、二つ目のproductionは孤立lectureを残さず拒否する。

### 5.2 データ公開境界

- run/slot tableはRLSを有効化し、`public`、`anon`、`authenticated`から全権限を剥奪する。
- run/slot tableをRealtime publicationへ追加しない。
- service role key、R2 credential、archive ingest secretはブラウザbundleへ含めない。
- PDF descriptorはDB triggerでも照合し、誤資料、旧資料、byte/page偽装を拒否する。
- permanent markerはブラウザ入力を受けず、DB上のproduction bindingからのみ生成する。
- Worker/Edgeはexact 2-key policyだけを受理し、未知mode、未知policy ID、余分なkeyを拒否する。

### 5.3 想定攻撃と防御

| 脅威 | 防御 |
| --- | --- |
| 準備ボタンの二重押下・通信再試行 | request UUID、advisory lock、unique constraint |
| 二Adminが同時に本番を作成 | event lock、production partial unique index |
| 本番と練習の同時open | event lock付きDB trigger |
| run間のコメント・Poll・AI混入 | 毎回別lecture UUID、全FKのlecture binding |
| 誤PDFまたは改ざんPDF | ticket binding、実byte、magic、SHA-256、page数、immutable upload、DB trigger |
| rehearsalを永久化 | production DB binding由来のexact policyのみ許可 |
| 永久tokenの漏洩 | Archive tokenは最大15分、PDF ticketは最大5分のまま |
| cleanupによる本番記録喪失 | exact permanent policyをcleanup対象外、PDF manifestをCAS自己修復 |

## 6. Archiveと保持

通常講義とrehearsalは既存契約を変更しない。

- `lecture_sessions.archive_expires_at = closed_at + 30 days`
- R2 read-only Archiveは30日、cleanup recovery windowは7日
- PDFは30日閲覧＋7日回復猶予
- DBの段階的論理archiveを維持する

productionだけ、サニタイズ済みR2 snapshotと最終PDFを継続公開対象にする。

- public payloadへexact `archive_policy`を付与する。
- 90分の全18個の5分要約windowを保持できる。
- コメント最大500件、Poll最大100件、学術回答最大3件という既存公開payload上限は維持する。
- production最終PDFの`archive_expires_at`と`delete_after`をNULLにし、Worker ingest時にもmanifestをCASで自己修復する。
- access tokenやasset ticketは短寿命のままである。
- production codeを入力する `/join?code=<6桁>` が、live終了後は既存のarchive-first解決により同じ記録へ収束する。

30人運用では500コメント上限を超えない想定だが、本番終了時にDB visible件数とR2 snapshot件数を照合する。超過または不一致ならProduction GateはHOLDとし、正本化しない。

## 7. 負荷とコスト

- preset作成はAdminによる一回のEdge呼び出しと、1 lecture＋6 Poll＋24 options＋6 slotsの単一DB transactionだけである。
- 学生の5秒snapshot、コメント、Poll回答、PDF取得回数はPhase 7.26以前から増えない。
- run metadataとslot取得はAdmin一覧時だけで、flag OFF時は追加query自体を行わない。
- permanent Archiveの閲覧はCloudflare Worker/R2で完結し、Supabase Realtime、DB polling、Storage egressを消費しない。
- preset作成はAIを起動せず、OpenAI費用は0。Realtime Whisper、要約、学術回答は既存API PINと利用上限を通る明示操作だけで開始する。

## 8. Rollback

1. UI flagをOFFにし、新規preset作成を止める。
2. Edge flagをOFFにし、作成actionとmetadata queryをfail closedにする。
3. 作成済みdraftは既存Admin UIから開始せず保持または通常どおり終了する。
4. additive table、RPC、trigger、既存runはDBに残し、旧clientとの互換を維持する。
5. production Archiveを一度作成した後は、permanent-aware Workerより古い版へ直接rollbackしない。先にArchive cleanup Cronを止めるか、互換patchを維持する。
6. PDF公開に問題があればbrowser publisherをOFFにし、R2 write credentialを分離したLocal Publisher復旧経路へ戻す。

## 9. Gate

### Local Gate

- clean migrationとPhase 7.26からのupgrade migration
- 全pgTAP、DB lint、型生成drift
- 同一request、二production、並列rehearsal、単一openの二接続競合
- Edge/Worker unit、18/12 summary境界、365日time travel、cleanup
- 20人Free／300人Proの追加負荷ゼロ確認
- Chromium/WebKit、desktop/mobile、flag ON/OFF E2E
- Phase 6.6〜7.26 UXと全non-live回帰、typecheck、lint、build、secret scan、diff check

### Hosted/Human Gate

- Hosted migrationをexpand-firstで適用し、flags OFFのままAdvisorと旧client互換を確認
- Private R2実E2E、15MiB canary、manifest CAS、cleanup Cron二周期
- 二Admin競合、Turnstile、WAF/rate protection、archive code推測耐性
- 実スマートフォンでjoin、PDF、Poll、コメント、終了、Archive再入場
- 教員による全34ページ、6 Poll、文言、投影画面の目視確認
- production終了後にoutbox、payload/object SHA、18要約、全コメント/Poll、PDF期限NULL、固定共有URLを照合

Human/Hosted Gateの明示承認までは、main統合、push、deploy、flag有効化、本番run作成、PDF公開を行わない。
