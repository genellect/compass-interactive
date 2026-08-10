# Phase 7.31–7.33 コンテスト公開・審査員実環境・商用化準備計画

Status: Planned
Approval: requirements approved; implementation not started
Scope: GitHub ガバナンス、公開リポジトリ化、審査員向け実環境、商用 EdTech 品質、統合 Production Gate
Last verified: 2026-08-10

## 1. この計画の位置付け

本書は、Phase 7.30 の Google Admin Identity / AAL2 / RBAC 実装後に、
COMPASS Interactive をプログラミングコンテストへ安全に出品し、その後も
複数大学で継続運用できる商用 EdTech プロダクトへ移行するための確定契約で
ある。

Phase 7.29B の dormant 本番配置とは目的も合格判定も異なる。Phase 7.29B は
PowerPoint Presenter 関連の additive schema / Edge / frontend を三重の flag OFF
で配置する互換性作業であり、本書の公開、審査員招待、商用運用または正式
Production Gate の合格を意味しない。

次の正式な Production Gate は Phase 7.33 とする。Phase 7.29 の残存 activation
要件、Phase 7.30、Phase 7.31、Phase 7.32 の全要件と Human / Hosted Gate が
完了するまで、正式な Production Gate PASS を宣言しない。

## 2. 不変条件

- GitHub と Codex Cloud を開発の正本とし、ローカル環境固有の未公開差分、秘密、
  手作業だけで再現できる状態を残さない。
- Phase 0–7.29 の認証、RLS、所有権、90 分ライフサイクル、Poll、コメント、PDF、
  Display、AI、Archive、CI / E2E 契約を弱めない。
- 審査員のための特別な強権限ロール、認証バイパス、固定共用アカウント、モック
  専用コードパスを作らない。
- 審査員は既存の `[2] AI機能利用可能 Admin`、すなわち `role=instructor` かつ
  `can_use_ai=true` として扱う。これは新しい `judge` ロールではない。
- Google ログインは本人確認の入口であり、それだけでは Admin 権限を与えない。
  明示招待、有効な Admin principal、TOTP による AAL2、未失効 Admin session、
  講義所有権、機能・予算・同時実行・課金意図の各サーバー側検証を通過させる。
- MFA はGoogle Authenticator互換のSupabase Authenticator App TOTPだけを用い、email
  MFAや独自MFAを追加しない。Google→TOTP login後のAdmin sessionは
  `auth.sessions.created_at + 8時間`まで継続し、30分idle失効や周期的TOTP promptを
  設けない。
- 審査員、教員、owner のいずれにも秘密値を表示する機能を作らない。owner が扱う
  のは secret の存在状態、用途、更新時刻、ローテーション操作であり、値の閲覧では
  ない。
- 本番利用者の identity、講義、コメント、AI 入出力、PDF、R2 object、監査ログを
  コンテスト環境へ複製しない。
- 破壊的変更ではなく expand-first、後方互換、既定 OFF、段階的 canary、復旧可能な
  rollback を維持する。

## 3. 全体依存関係

```text
Phase 7.29B dormant placement
  -> Phase 7.29C activation blockers resolved
  -> Phase 7.30 Google Admin + TOTP AAL2 + RBAC
  -> Phase 7.31A GitHub governance
  -> Phase 7.31B public-source readiness
  -> Phase 7.31C isolated real contest environment
  -> Phase 7.32 commercial EdTech readiness
  -> Phase 7.33 unified Production Gate
```

並行作業は可能だが、後段の公開・招待・商用 canary は依存する前段の Gate を
省略しない。特に GitHub リポジトリの可視性変更と実審査員の招待は、テスト用
flag の有効化と同じ操作としてまとめない。

Phase 7.29B の dormant 配置や Phase 7.30F の限定 identity migration canary は、
それぞれの独立 Gate と直前承認の範囲では Phase 7.33 より前に実施できる。ただし
それらは public visibility、実審査員招待、コンテスト公開、商用運用または統合
Production Gate の承認ではない。

## 4. Phase 7.31A — GitHub ガバナンスと供給網防御

GitHub Education の必要機能が利用可能になった後、`main` を技術的に保護する。
それまでは PR-only、exact-head green CI、force push 禁止を手順上の暫定統制とし、
「保護済み」とは記録しない。

### 実装内容

- `main` への直接 push、force push、削除を拒否する ruleset を構成する。
- PR、最新 base との整合、必須レビュー、会話解決、必須 status checks、直前の
  exact-head green CI を merge 条件にする。
- 必須 check 名を固定し、Linux quality / DB / Chromium / WebKit / Windows native
  build-test を、該当差分に応じて skip ではなく明示判定できる構成にする。
- CodeQL、dependency review、secret scanning / push protection、Dependabot、
  lockfile 検証、最小権限 `GITHUB_TOKEN`、第三者 Action の commit SHA pinning を
  導入する。
- CODEOWNERS または同等の責任者境界を、認証、migration / RLS、Edge、Cloudflare、
  AI 課金、native bridge、公開文書へ設定する。
- release / deploy は承認済み immutable commit SHA と環境保護を用い、build と
  production deploy の権限を分離する。
- Cloud doctor が repository / environment / required-check の drift を検出し、
  読み取り可能な証跡を残す。

### Phase 7.31A 合格基準

- 非管理者・管理者を含め、直接 push、force push、branch deletion が実際に拒否
  される。
- stale または failed commit は merge / deploy できず、承認済み exact SHA のみが
  release 対象になる。
- Action 権限、外部 Action pin、依存関係、CodeQL、secret scan に未処理の Critical / High
  がない。
- ruleset の所有者、緊急 bypass 条件、利用後の監査と失効手順が明文化されている。

## 5. Phase 7.31B — 公開リポジトリ化の事前監査

公開化は Git 履歴の複製・検索エンジン収集を招く不可逆性の高い変更である。
一度公開した値は、後から private に戻しても回収できたとはみなさない。実際の
visibility 変更直前に、対象 SHA、公開物、既知リスクを提示し、ユーザーから明示的な
最終承認を得る。

### 実装内容

- 全 branch、tag、Git history、LFS、release、artifact、issue / PR 添付を対象に、
  secret、API key、token、PIN、OAuth client secret、service-role、個人メール、学生情報、
  講義コメント、内部 URL / path、端末名、組織内限定資料を検査する。
- 過去に含まれた可能性がある資格情報は、削除だけに依存せず公開前に失効・
  ローテーションする。新しい値を履歴書換えツールや監査ログへ出力しない。
- 実講義データ、私有 PDF、R2 object、データベース dump、`.env*`、crash log、生成物、
  local backup が Git または public artifact に含まれないことを検証する。
- 依存ライセンス、フォント、画像、PDF、ブランド素材、PowerPoint / native 配布物の
  再配布権を確認する。リポジトリ本体の license は権利と商用方針を整理し、ユーザーの
  明示承認後に決定する。ライセンス未決定を黙って permissive license へ置換しない。
- `SECURITY.md`、`CONTRIBUTING.md`、行動規範、脆弱性報告窓口、issue / PR template、
  architecture / threat model / setup / test / release docs、SBOM / provenance を整備する。
- README とデモ表現が、実装済み、default OFF、Hosted 未検証、将来計画を正確に区別
  し、非公開機能や実運用実績を誇張しないことを確認する。
- 公開 clone から秘密なしで依存取得、型検査、lint、non-live tests、build、Demo E2E を
  再現できるようにする。Hosted / paid E2E は安全な fixture と手動 gate に分離する。

### Phase 7.31B 合格基準

- 全履歴・全公開 surface の secret / PII / private IP 監査が PASS し、検出済み資格情報は
  失効・ローテーション済みである。
- ライセンスと第三者素材の公開可否について、所有者の明示判断が記録されている。
- clean clone CI と supply-chain checks が PASS し、実データなしで審査可能である。
- 公開直前の immutable archive、rollback owner、incident 手順が保存されている。
- visibility 変更直前の別個の明示承認がある。承認前は private のまま HOLD とする。

## 6. Phase 7.31C — 審査員向け実講義環境

### 権限契約

各審査員は自分が通常利用する Google アカウントのメールアドレスを招待される。
運営が共用 Gmail、password、TOTP seed、recovery code を配布してはならない。招待を
受けた本人が Google 認証を行い、初回に自分の TOTP を登録して AAL2 を成立させる。

審査員 principal の唯一の通常形は次の通りである。

```text
status = active
role = instructor
can_use_ai = true
environment = contest
expires_at = bounded contest deadline
```

この権限では、自分の講義について、作成・開始・終了、履歴、PDF 公開、ページ操作、
Display、Poll、コメント、AI 要約、学術的参考回答、許可された字幕・Archive という
実際の教員 UX を体験できる。AI は本物の API 経路を通すが、既存の paid-operation
intent、予算、同時実行、冪等性、講義終了時の結果破棄を迂回しない。

審査員は `BILLING_PIN` を入力、受領または閲覧せず、owner の講義ごとの事前操作も
待たない。Google＋TOTP AAL2後、本人専用4桁AI PINを初回登録し、自分の講義で
`字幕を除くAI` または `字幕を含むAI` のmaster CTAを一度だけ有効化する。PIN確認後に
発行された取消可能なブラウザプロファイル拘束credentialは本人が明示的に選んだ
ブラウザへ保存できるが、raw PINは保存しない。これはハードウェア拘束ではなく、専用AI
Passkeyは後続WebAuthn Gate通過後に4桁PINの代替として追加する。
master有効化後は講義終了または90分hard stopまで選択scopeが一律activeとなり、個別API
開始でPINを再入力しない。ownerは事前に`can_use_ai`と費用・回数・Realtime分・scopeの
上限を設定するだけで、審査員はそのpolicyを変更できない。

personal AI PINは新しい講義masterごとに一度だけ確認し、明示的なscope/cost拡張時にだけ
新しいAI-unlock proofを求める。どちらもfresh TOTPを追加要求しない。5分fresh TOTPは
owner/principal、role/status、確認済みTOTP factor set、environment AI policy、global
revokeという稀なcontrol-plane変更に限定し、通常講義、緊急停止、AI master/child callでは
要求しない。`ADMIN_PIN`と`BILLING_PIN`はProduction前に完全撤去する。

審査員には次を認めない。

- `owner` または global-admin 権限への昇格;
- 他 instructor / 審査員の principal、session、講義、コメント、PDF、AI 出力の閲覧;
- Admin 台帳、全講義台帳、グローバル監査、他者の停止・失効・権限変更;
- OAuth / Supabase / Cloudflare / R2 / OpenAI / API / signing / service-role の秘密値閲覧;
- 組織全体の予算、rate limit、feature flag、retention、cleanup、deploy の変更。

### 環境分離

審査環境は production と同じ審査対象 commit とサーバー側認可契約を使用する一方、
データと課金境界を完全に分離し、本番同等コードパスを通す isolated review
environment とする。最低限、次を production と共有しない。

- Supabase project、Google OAuth client / callback、Admin principals、講義データ;
- Cloudflare environment / domain、専用 Private R2 bucket、R2 binding / credential、
  Worker secret;
- OpenAI project / API key / budget、AI usage ledger;
- audit、cleanup queue、archive、email notification の送信先と権限。

R2 prefix や namespace だけをセキュリティ境界として使うことは禁止する。contest
Worker は production bucket への binding や credential を持たず、production object
への読み書き拒否をE2Eで証明する。各Supabase projectは固有の environment identity
を持ち、Phase 7.30 の `admin_environments` は defense in depth であって project共有を
許可する仕組みではない。principal、membership、invitation、session、AI policy、factor、
browser credential、master authorizationはprojectを跨いで共有、複製または継承しない。

単なる frontend Demo や in-memory mock ではなく、認証、RLS、Edge、R2、AI、終了・
Archive が本番同等のコードを通る。ただし審査環境から production host / project ref /
bucket / OpenAI project への通信は allowlist と E2E で拒否する。

### 招待、owner bootstrap、AI policyとAI Unlock

Phase 7.31C は Phase 7.30 の principal / environment membership / invitation / session /
audit / AI policy / unlock factor / browser credential / rate limit / lecture master schemaを
再利用し、
contest project内でのみ次のpolicyと運用を有効にする。

- Production membershipを継承せず、contest projectへcreate-only手順で最低1つの
  `owner` membershipをbootstrapする。このownerだけが審査員招待、AI entitlement /
  policy設定、個別失効、cleanup監督を行い、last-owner保護を受ける。
- invitationは対象email、server-side Google identity binding、contest environment、
  `instructor + can_use_ai`、期限、一回限りdigest、招待者へ拘束し、受諾または失効を
  原子的に記録する。
- `private.admin_ai_policies`はreviewer membership、許可action/model scope、講義/日ごとの
  最大call/token/費用、Realtime分、最大同時実行、validityとversionを保持する。ownerの
  変更は5分fresh TOTP、idempotency key、append-only auditを必須とする。
- 各reviewerは有効なTOTP AAL2 sessionで本人専用4桁AI PINを登録する。AI PIN factorの
  enrollment/rotation/revoke/resetは5分fresh TOTP境界を使うが、login直後の初回登録はlogin時TOTPが
  既にfreshなので追加promptを出さない。通常利用は追加のTOTP入力を求めない。
  serverはsaltedかつserver-peppered verifier、
  factor version、rotation/revoke metadataだけを保持する。raw PINはtrusted formと限定TLS
  bodyにだけ一時存在し、応答後に
  clearし、browser/server persistence、URL、log、audit、analytics、error traceへ残さない。
- environment+membershipを正規keyとする5回/15分の原子的失敗counterで、全session、factor
  version、browserにまたがってAI unlockだけを15分以上lockする。factor rotation/resetでは
  解除しない。pepper-hashed coarse networkは30回/15分、environment circuit breakerは
  300回/分で60秒以上fail closedとし、raw IPを保存せず、generic errorと`Retry-After`を返す。
- `このブラウザで記憶` はdefault OFFとする。browserが生成したnon-extractable WebCrypto鍵と、
  principal/membership/environmentへ拘束した最長30日・個別失効可能なcredentialだけを保存
  する。登録時は短命一回限りnonceを`auth.uid()`、environment/membership、tracked Admin
  session、verified TOTP factor-set version、AI-factor version、exact Origin、public-key
  fingerprintへ拘束し、PIN検証・nonce消費・credential作成を同一transactionで行う。同一
  idempotency retryだけ収束し、replay、期限切れ、cross-principal/session/environment/Origin、
  key差替えを拒否する。利用時はlecture/scope/session/policy versionを含むfresh server
  challengeへ署名し、current AAL2 sessionを再検証する。同一origin XSS、dependency compromise、
  full-profile copyは未解決の脅威としてCSP/supply-chain監査とChrome/Edge/WebKitの
  Hosted/Human Gateで検証し、WebAuthn前にhardware/device bindingを主張しない。
- master CTAはAAL2、tracked session、active membership、`can_use_ai`、reviewer所有のopen
  lecture、AI factor/browser proof、policy scope/allowanceを1transactionで検証し、既存
  `lecture_ai_master_authorizations`へ収束する。同scope retryは冪等で、scope変更は明示操作
  とする。personal AI PINは新しい講義masterごとに一度だけ確認する。
  `all_except_captions`から`all_including_captions`への拡張は新しいAI PIN/browser
  proof（後続AI Passkey）を有効なAAL2 session内で再検証し、新versionへ原子的に
  置換するがfresh TOTPは要求しない。downgradeとstopは無償・proof不要。有効期限は
  講義終了/90分/session・membership・policy失効の最早時刻とする。
- master作成自体はproviderを呼ばない。master下のpaid startはPIN再入力なしでlive policy、
  budget、同時実行、lifecycle、冪等性を再検証し、短命single-use child reservationを原子的に
  確保する。caption-inclusiveでもRealtimeは専用CTAとmic permissionなしに起動しない。
- session失効、backing `auth.sessions`消失またはverified TOTP factor-set変更はそのsession由来
  master/childをdrainするがbrowser credential自体は残し、新しいAAL2 sessionなしには利用
  できない。AI-factor rotate/reset/revokeは旧version由来browser credentialとmaster/childを
  失効するがAdmin sessionは維持し、個別browser credential revokeはそのproof由来だけを
  drainする。membership/principal/environment invalidationはAdmin sessionと派生権限を失効する。
  role変更はsessionを維持してlive適用し、`can_use_ai=false`はAdmin sessionを維持したまま
  factor/browser/master/childのAI authorityをdrainする。policy expiry/revokeはmasterをdrainし、scope
  縮小は可能なら`all_except_captions`へ原子的にnarrowしてactive字幕を停止し、不可能なら
  revokeする。講義終了/90分/stopもdrainする。予算枯渇だけではactivated scopeを解除せず、
  child provider startを説明可能な状態でfail closedとする。開始済み結果は既存AI lifecycle
  に従って停止または破棄する。
- auditは主体、factor種別、membership、lecture、scope、policy version、費用単位、結果、
  失効理由、request IDのみを保持し、PIN、credential、token、prompt、講義本文を保持しない。

### ライフサイクル、費用、悪用防止

- 招待ごとに issuer、principal、招待者、権限、開始・満了、受諾、最終利用、失効理由を
  監査する。未受諾招待と期限切れ principal は自動失効する。
- owner は対象を明示して個別失効できる。失効は Admin session、AI browser credential、
  AI master / child grant、Display / Presenter binding、未消費 ticket を冪等に drain する。
- 審査員ごと・講義ごと・日ごとの AI 上限、同時実行枠、Realtime 分上限、PDF 容量、
  講義数、90 分終了をサーバーで強制する。予算枯渇時は paid 機能だけを fail closed とし、
  基本 UX と説明可能なエラーを維持する。
- WAF / application rate limit、Origin、AAL2、所有権、nonce、idempotency、server time を
  すべて検証し、複数タブや再試行で二重課金させない。
- 審査講義と生成物には期限を設定し、保留期間後に archive、export、論理削除、物理削除を
  段階実行する。cleanup は冪等、再実行可能、途中失敗から収束可能にする。
- 監査は秘密・講義本文・コメント本文を含めず、request ID、主体、対象、結果、費用単位、
  失敗理由の最小情報を保持する。

### Phase 7.31C 合格基準

- 自分の Google アカウントを招待された審査員だけが TOTP AAL2 後に
  `instructor + can_use_ai` へ到達する。未招待、AAL1、失効、期限切れは拒否される。
- 審査員が実講義開始から終了・Archive まで、PDF、Poll、Display、コメント、AI を
  Chromium / WebKit / mobile で完走できる。
- cross-principal、cross-lecture、cross-environment、owner-only 操作、secret read の全
  negative test が PASS する。
- 二審査員競合、複数タブ、AI 再試行、講義終了競合、予算超過、個別失効、期限 cleanup が
  冪等に収束する。
- TOTP AAL2、active `can_use_ai`、own lecture、live policy、登録済み4桁AI PINまたは有効な
  remembered-browser proofが揃った時だけmasterを作成できる。owner介入や`BILLING_PIN`は
  不要で、`BILLING_PIN`自体もProduction前に撤去される。personal AI PINは新lecture master
  または明示的scope/cost拡張時だけ確認し、master後のchild startはPIN/TOTP再入力なしに
  収束する。PIN brute-force、membership / network / environment lockout競合、raw PINの
  永続化・log・URL・trace混入、enrollment nonce replay、cross-environment、cross-principal、
  cross-session、cross-Origin、key差替え、expiry、上限超過のnegative testがPASSする。
- raw PINはtrusted formと限定TLS requestにのみ一時存在して応答後にclearされる。ブラウザ
  証明はprofile/origin-boundであり、hardware-boundとは主張しない。同一origin XSS / CSP /
  supply-chain、通常storage copy、full-profile copy、Chrome / Edge / WebKitの保存・失効を
  Hosted/Human Gateで確認する。
- `all_except_captions`から`all_including_captions`への拡張は新しいAI unlock proofと
  有効なAAL2 sessionを要求するがfresh TOTPは要求しない。同scope retryは冪等、downgrade /
  stopはproof不要で、session / factor / browser / membership / entitlement / policyの各失効・
  縮小が定義済みmatrixどおりmaster / childへ収束する。
- master有効化はprovider callを発生させず、2scopeと終了/90分drainが正しく動作し、字幕を
  自動起動しない。将来の専用AI Passkeyは同じchallenge/scope/policy契約を満たす。
- 30分idleや周期的TOTP promptが発生しない。logout、backing `auth.sessions`消失、principal/
  environment/membership無効化、verified TOTP factor-set変更、8時間capだけが再loginを要求し、
  role/AI-PIN変更はsessionを維持し、`can_use_ai=false`はAI authorityだけをdrainする。
- production の identity、data、R2、OpenAI budget、audit に読み書きが一切発生しない。
- Admin / reviewer UIは`講義資料`だけを表示し、R2 bucket、binding、credential、namespace、
  secretを表示または説明しない。
- 審査員の人間 E2E と owner の失効・復旧演習が PASS する。

## 7. Phase 7.32 — 商用 EdTech 継続運用品質

コンテスト終了後の継続運用は、審査環境をそのまま production へ昇格させるのではなく、
次の商用基盤を production / staging の分離された環境へ実装する。

### 組織・認可・データ

- 大学 / 学部 / 講義組織を tenant とし、principal、講義、PDF、コメント、AI ledger、監査、
  archive の全キーに tenant 境界を設ける。
- owner、組織管理者、instructor、必要最小限の support 権限を capability として定義し、
  RLS / Edge / transaction で二重検証する。support の恒常的な本文閲覧を禁止する。
- テナント間、講義間、教員間の isolation、招待、異動、退職、権限棚卸し、session revoke、
  account deletion / export を自動検証する。

### 可用性・運用・費用

- staging / production / contest を IaC と cloud doctor で再現し、環境固有値と secret を
  repository から分離する。
- SLO / SLI、構造化ログ、trace / request ID、エラー率、同期遅延、Realtime 接続、AI 成功率、
  cleanup lag、R2 / DB / Edge 使用量、費用 anomaly に alert と on-call runbook を設ける。
- backup、point-in-time recovery、R2 version / retention、暗号化、復元演習、RTO / RPO、
  incident response、vendor outage / exit を検証する。
- Free 20 人 / 90 分、Pro 約 300 人 / 90 分、複数大学・同時講義条件で load / soak / failure
  test を行い、Supabase、Cloudflare、OpenAI の単位原価と追加課金閾値を予算化する。
- entitlement、契約プラン、usage cap、請求前確認、invoice / refund / suspension と paid API の
  二重課金防止を分離して実装する。価格情報は実装時の公式情報で更新する。

### プロダクト・法務・支援

- 教員 onboarding、取扱説明書、講義前診断、会場 Extend / audio / PDF rehearsal、障害時の
  manual fallback、管理台帳、support escalation を整備する。
- 学生の匿名性、nickname、コメント、AI 入出力、録音非保存、PDF、30 日 / 永続 archive の
  目的、同意、保持、削除、export を privacy policy、terms、DPA と整合させる。
- WCAG 2.2 AA、keyboard / screen reader、reduced motion、contrast、Japanese / English、
  Chromium / WebKit、主要 smartphone、弱回線で UX / visual regression を通す。
- abuse / moderation、著作権侵害、prompt injection、学術回答の claim-source、AI 開示、
  教員承認 / 訂正 / 非表示、利用者問い合わせと脆弱性報告の運用を備える。
- analytics は教育目的と privacy を優先し、本文・秘密・不要な個人識別子を収集しない。

### Phase 7.32 合格基準

- tenant isolation、RBAC、AAL2、個別失効、audit、retention / export / delete が DB、Edge、UI、
  E2E の全層で PASS する。
- backup からの復元、provider 障害、cleanup 停止、予算枯渇、AI timeout、Realtime 劣化時に
  データ関係と基本講義 UXを壊さず収束する。
- 定義した load 条件、SLO、accessibility、browser / device、security、privacy / legal、
  support / incident の各 owner と証跡が揃う。
- Critical / High の未解決、権限漏洩、無制限課金、復元不能、既存 UX 回帰がない。

## 8. Phase 7.33 — 次回統合 Production Gate

Phase 7.33 は新機能を急いで追加する段階ではなく、全契約を独立に再検証する唯一の
正式 Production Gate である。部分合格、過去 Gate、文書上の予定、flag OFF 配置を
全体 PASS の代替にしない。

このGateは統合されたコンテスト公開・Production拡張・商用releaseの判定である。
各独立Gateを通過して別途承認された7.29B dormant配置や7.30F限定identity canaryを
無効化するものではないが、それらを本GateのPASS証拠として数えない。

### 必須証跡

- Phase 7.29C の installer / signing / PowerPoint / loopback / device / venue / rate protection
  を含む activation blockers が解消済みである。
- Phase 7.30 の Google identity、TOTP AAL2、principal / capability、全 Edge / RPC 認可、
  operator owner recovery、`ADMIN_PIN`/`BILLING_PIN`完全撤去が Hosted / Human Gate を通過している。
- Phase 7.31A–C の main protection、public-source audit、明示的公開承認、独立 contest tenant、
  審査員 E2E、失効 / cleanup / cost gate が PASS している。
- Phase 7.32 の multi-tenant、商用運用、法務 / privacy、accessibility、load、backup / restore、
  observability、support が PASS している。
- clean migration と populated upgrade、全 pgTAP、DB generated types、lint / Advisor、
  supply-chain、full regression、Chromium / WebKit / mobile / visual / accessibility、実 R2 / Edge /
  AI、二 Admin / 二審査員競合、実ブラウザ / device / human の証跡が exact SHA に紐づく。

### 判定

以下の一つでも該当すれば HOLD とする。

- 所有権、tenant、environment、secret、AAL2、session の境界漏洩;
- 二重課金、上限回避、講義終了後の書き込み、cleanup 不収束、復元不能;
- public history の secret / PII / 権利不明素材、ruleset bypass、未承認 visibility 変更;
- 既存学生 / 教員 UX、5 秒 snapshot、Display、PDF、Poll、Archive、AI の回帰;
- Production と contest の identity / data / R2 / OpenAI 混線;
- 必須 Human / Hosted Gate を自動テストで代替した状態。

完全 PASS 後のみ、承認済み SHA の統合コンテスト公開・Production拡張・商用releaseを
main、Hosted Supabase、Cloudflare、R2、Edge、公開 Web へ段階反映する。各段階で
canary、観測、停止条件、直前 revision を記録する。GitHub visibility変更と実審査員
招待は、それぞれ直前の別個のユーザー承認を要する。

## 9. Rollback / incident 方針

- schema は additive のまま残し、認証・Presenter・contest・commercial capability を個別
  flag OFF にする。障害時に down migration や物理削除を急がない。
- Admin 認証は Phase 7.30 の Google-only immutable revision、個別 session revoke、
  Supabase operator owner recoveryを用い、共有PINや認可の弱い経路へ退避しない。
- contest incident は新規招待停止、対象 principal / session / grant / ticket 失効、paid AI
  停止、Edge admission OFF、immutable revision への rollback、冪等 cleanup の順で封じ込める。
- production と contest を同時に rollback しない。環境ごとの project / deployment / secret
  owner と操作記録を保持する。
- 公開リポジトリは private へ戻しても clone 済み履歴を回収できない。公開後の secret / PII
  incident は即時失効・ローテーション、履歴 remediation、利用者通知、証跡保全を行う。
- 公開直前に private mirror / bundle、release manifest、SBOM、DB / R2 復元点、Hosted revision
  を独立保存するが、秘密値を evidence 文書へ転記しない。

## 10. 推論・レビュー routing

| 作業                                                             | 主担当         | 必須レビュー                                      |
| ---------------------------------------------------------------- | -------------- | ------------------------------------------------- |
| 境界済み docs、UI 文言、小規模な非認可 UI、test fixture          | **Extra High** | 契約差分があれば Ultra                            |
| GitHub ruleset、history 公開監査、license / publication boundary | **Ultra**      | 独立した external review                          |
| Google / TOTP AAL2、RBAC / RLS、tenant isolation、全 Edge 認可   | **Ultra**      | Claude Code Opus Max 等による独立 security review |
| AI 課金、予算、同時実行、失効 / cleanup / lifecycle              | **Ultra**      | 独立 concurrency / cost review                    |
| contest 環境分離、Hosted rollout、Production Gate 判定           | **Ultra**      | external review と human owner approval           |
| accessibility / browser / visual / teacher UX の反復             | **Extra High** | 最終 Gate は Ultra が統合判断                     |

外部 reviewer には threat model、必要な exact diff、テスト結果、redacted evidence のみを
渡す。production secret、個人の TOTP、OAuth token、service-role、Cloud mutation 権限は
共有しない。外部レビューの指摘は主エージェントが現行コードと契約に照らして再検証し、
共有コードの最終統合と Production 判定は Ultra の主エージェントが担う。

## 11. 今後のエージェントへの開始条件

1. `origin/main`、open PR、Hosted deployment、flag、migration、未解決 Gate を読み取り監査する。
2. 本書と Phase 7.29 / 7.30 契約の対象 Phase を作業 plan に明示する。
3. production / contest / staging の project ref、domain、R2、OpenAI project を値を表示せず
   environment identity として照合する。
4. 独立 Phase の Local Gate を通過し、exact-head CI と外部 review を得てから Hosted へ進む。
5. secret 送信、OAuth client 作成、課金上限変更、実審査員招待、public visibility 変更、
   Production flag ON の直前では、対象と効果を提示してユーザーの承認を得る。

本書の `Approved plan` は上記実装順と安全境界への承認であり、Phase 7.31–7.33 の実装、
公開、審査員招待、商用運用または Production Gate 合格の証拠ではない。
