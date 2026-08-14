# COMPASS Interactive Cloud Development

Status: Operationally verified
Scope: canonical GitHub, cloud workspaces, safe execution levels and handoff
Last verified: 2026-08-14

`https://github.com/genellect/compass-interactive`を正本とし、日常開発はクラウドを優先する。Production Supabase、Cloudflare、R2、OpenAI live API、既存PCのcheckoutやenv fileへ依存しない。

## C0 Cloud Canonicalization Gate

編集前に最新`origin/main`をfetchし、正確なSHA、そのSHAの最新CI結果、
専用branch、実行環境、変更surface、外部影響レベルを記録する。ローカル
だけに存在する変更は復旧inputであり、古いbranchを正本へ昇格させない。
現行mainから作成した隔離branchへ論理単位で移植し、現行gateを再実行する。

詳細な受入・復旧契約は
[`CLOUD_CANONICALIZATION_GATE.md`](CLOUD_CANONICALIZATION_GATE.md)に従う。
`npm run cloud:doctor`はcanonical origin、lockfile、Node最小version、必要fileと
locked binaryを外部接続なしで検査する。Docker、Hosted、paid API、Windows
COMの検査を代替しない。

## 推奨する実行経路

| 優先度 | 経路                     | 主な用途                                               | 環境の正本                        |
| ------ | ------------------------ | ------------------------------------------------------ | --------------------------------- |
| 1      | GitHub Codespaces        | ブラウザ実装、local Supabase、E2E、commit、PR          | `.devcontainer/devcontainer.json` |
| 1      | Codex Cloud              | Codexによる非同期実装、non-live test、review、Draft PR | Codex環境設定 + `AGENTS.md`       |
| 2      | VS Code + Docker Desktop | ローカルDocker上でCodespacesと同一環境を再現           | `.devcontainer/devcontainer.json` |
| 2      | Dev Container CLI        | GUIなしのDocker起動、CI相当検証                        | `.devcontainer/devcontainer.json` |
| 3      | DevPod等の互換サービス   | 別クラウド／SSH host上のDev Container                  | `.devcontainer/devcontainer.json` |

Dev Container Specificationを唯一の環境正本とする。Dev Container CLIはfeatures、VS Code設定、`postCreateCommand`まで適用するため、別のDockerfileや素の`docker build` / `docker run`を標準経路にしない。

## 自動プロビジョニング契約

新PCや新メンバーは、選んだ経路のhost前提だけを用意する。言語runtimeやglobal packageを手作業で揃えない。

| 層                | 人が用意するもの                                              | repositoryが自動で揃えるもの                                                                                                                      |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codespaces        | GitHub access、repository access、Codespaces利用権            | Linux、Node 22.22.0、独立Docker daemon、Compose、GitHub CLI、Copilot CLI、VS Code extensions、npm、Playwright Chromium/WebKit、Supabase CLI、Vite |
| VS Code + Docker  | Git、Docker Desktop/Engine、VS Code、Dev Containers extension | Codespacesと同じDev Container内容                                                                                                                 |
| Dev Container CLI | Git、Docker Desktop/Engine、Node.js（固定CLI起動用）          | Codespacesと同じDev Container内容                                                                                                                 |
| Codex Cloud       | GitHub接続とCodex environment                                 | Node/npm依存、Playwright、repository instructions、非Docker cloud doctor。Docker/Supabase作業はCodespacesへhandoff                                |

環境定義は`.devcontainer/devcontainer.json`、Feature digestは`.devcontainer/devcontainer-lock.json`、JavaScript/Supabase CLI依存は`package-lock.json`、Codex setupは`.codex/setup.sh`が正本である。`.gitattributes`はWindows checkoutでもshell scriptをLFに固定する。

`postCreateCommand`は依存導入後に環境doctorを実行する。doctorはNode、GitHub CLI、Copilot CLI、Docker daemon、Compose、Playwright、Supabase CLI、Viteをfail-closedで検査する。初回作成後、Dev Container変更後、別PCでの初回利用時は次を受入証跡にする。

```bash
npm run dev:doctor
npm run cloud:doctor
npm run cloud:check
npm run test:e2e:demo
```

不足を個人PCへのglobal installで回避しない。必要packageはDev Container Featureまたは`package-lock.json`へ追加し、再buildとdoctorを通す。これにより次の参加者にも自動適用される。

### 新PC／新メンバーの受入チェック

1. repository accessを確認し、最新`origin/main` SHAとそのCIを記録して専用branchを作る。
2. container作成が自動完了し、doctorが`READY`を返すことを確認する。
3. `npm run dev:cloud`でprivate port `5173`の`/demo`を開く。
4. `npm run cloud:check`と`npm run test:e2e:demo`を実行する。
5. 小さな非本番変更でcommit、push、Draft PRを実行し、PR checksとreview権限を確認する。
6. database担当者はlocal Supabaseだけを起動し、Hosted ProjectやProduction資格情報なしでmigration、pgTAP、lintが完了することを記録する。

## 5分で開始する

### GitHub Codespaces

1. GitHub repositoryで **Code** → **Codespaces** → **Create codespace on main** を選ぶ。
2. Container作成後、専用branchを作る。`main`へ直接commitしない。
3. **Tasks: Run Task** → **Interactive: start browser development** を実行する。
4. private port `5173`のpreviewで`/demo`を開く。
5. 変更後に **Interactive: run non-live regression** を実行する。
6. database/RLS/Edge Function作業だけ **Interactive: start isolated local Supabase** を実行する。
7. commit、pushし、Draft Pull Requestを作成する。

同じCodespaceは別PCのブラウザまたはVS Codeから再開でき、filesystemとbranch状態が保持される。公開COMPASS repositoryには別Codespaceを使用する。

### VS Code + Docker Desktop

1. Docker DesktopをWSL2 backendで起動する。
2. VS Codeへ **Dev Containers** extensionを導入する。
3. repositoryを開き、**Dev Containers: Reopen in Container** を選ぶ。
4. Codespacesと同じVS Code task、port、検証コマンドを使用する。

### Docker / Dev Container CLI

Dev Container CLI `0.88.0`を固定して使用する。必要なのはDocker EngineまたはDocker Desktopと、CLI起動用のNode.jsだけである。

PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action config
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action up
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action shell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/devcontainer.ps1 -Action check
```

Bash:

```bash
./scripts/devcontainer.sh config
./scripts/devcontainer.sh up
./scripts/devcontainer.sh setup
./scripts/devcontainer.sh doctor
./scripts/devcontainer.sh shell
./scripts/devcontainer.sh check
```

| Action   | 内容                                                                        |
| -------- | --------------------------------------------------------------------------- |
| `config` | Docker daemonへ接続し、containerを作成せずDev Container定義を解決・検査する |
| `up`     | lock済みfeaturesでcontainerを作成し、setupを完了する                        |
| `setup`  | 依存導入を再実行し、doctorまで完了する。初回setup中断時の回復にも使う       |
| `doctor` | 起動済みcontainerのruntime、CLI、独立Docker、依存をfail-closedで検査する    |
| `shell`  | 起動済みcontainerへ入る                                                     |
| `check`  | container内で`npm run cloud:check`を実行する                                |

`.devcontainer/devcontainer-lock.json`はfeature digestを固定する。feature更新は意図したPRでのみ行い、`devcontainer upgrade`後にcontainerを再構築して検証する。

## Safe execution levels

| Level                             | 通常のcloud利用 | 外部影響                                   |
| --------------------------------- | --------------- | ------------------------------------------ |
| Independent demo                  | Yes             | なし                                       |
| Non-live regression               | Yes             | なし                                       |
| Local Supabase                    | Yes             | repository専用Docker内のみ                 |
| Windows Presenter source CI       | Yes             | 署名artifactを配布しないWindows runnerのみ |
| Windows Presenter Device/Human    | No              | PowerPoint、COM、PNA、installer、会場運用  |
| Live OpenAI checks                | No              | 有料外部API                                |
| Hosted Supabase / R2 / Cloudflare | No              | Hosted / Production state                  |

通常作業はDemo、non-live regression、local Supabaseまでに限定する。

## 共通コマンド

```bash
npm run cloud:doctor
npm run cloud:handoff
npm run dev:cloud
npm run cloud:check
```

Demo browser gate:

```bash
npm run test:e2e:demo
```

`cloud:check`はcloud doctor、secret scan、3種類のTypeScript検査、lint、全non-live suite、Production-equivalent frontend buildを実行する。有料APIやHosted serviceへ接続しない。

`cloud:handoff`は通常の開発中に繰り返すcommandではなく、ローカルPCを切断する直前の境界である。`cloud:doctor`に加え、専用non-main branch、clean worktree、canonical origin、`origin/main` ancestry、upstreamへのexact push、private evidence／non-example `.env`／runtime artifactの非追跡をfail-closedで検証する。成功語`READY_FOR_DISCONNECTED_CLOUD_EXECUTION`はsource/test継続だけを認め、Hosted、paid、Human、Productionの承認にはならない。

## Local Supabase

```bash
bash .devcontainer/start-local-supabase.sh
```

このscriptは次をfail-closedで実行する。

- Dev Container専用Docker daemon上でSupabase CLI stackを起動する。
- 空のlocal databaseへ全migrationを適用する。
- pgTAPとdatabase lintを実行する。
- frontend URLが`127.0.0.1`または`localhost`であることを検査する。
- browser公開前提のlocal publishable valueだけをignored `.env.local`へ生成する。
- script所有markerのない既存`.env.local`を上書きしない。

Hosted Projectへの`supabase link`、`db push`、remote migration、Production data copyは行わない。Supabase CLI local developmentはself-hosted Docker Composeとは別の経路であり、2026年のself-hosted PostgreSQL 17／Envoy移行の破壊的変更対象ではない。ただしCLI更新時は[Supabase breaking changes](https://supabase.com/changelog?types=breaking-change)とmigration/lint/E2Eを再確認する。

## Secrets

既存PCのenv fileをcloudへcopyしない。server-only secret、service-role、OpenAI key、PIN、signing key、private R2 credential、Turnstile secretを`VITE_`変数にしない。

通常開発にはOpenAI keyを必要としない。本人がlive検証を明示的に行う場合だけ、repository-scopedなCodespaces Secretを使用し、値をGit、devcontainer、task、terminal log、issue、PR、promptへ出さない。Codex Cloud secretはsetup phaseでのみ利用可能なため、agent phaseのlive AI testを標準経路にしない。

## Codexを主要開発環境にする

### Codex Desktop

新規Codex chatの実行先で **Cloud** を選ぶ。Codex Desktopの現行仕様では実行先は`Local / Worktree / Cloud`からchat開始時に選択するため、repository側からアカウント全体の既定値を強制しない。

repositoryでは次を共有する。

- `AGENTS.md`: scope、security、Supabase boundary、検証、Git運用の正本
- `.codex/config.toml`: project単位の複数agent設定
- `.codex/agents/`: read-onlyの探索、品質review、security review
- `.vscode/settings.json`: VS Code起動時にCodexを開き、実行中follow-upをsteerする

Codex Cloud environmentのsetup script:

```bash
bash .codex/setup.sh
```

推奨maintenance script:

```bash
bash .codex/maintenance.sh
```

setupとmaintenanceは`npm ci`後に`npm run cloud:doctor`をfail-closedで実行する。
Git fetchや依存downloadはsetup/maintenance段階に限定し、agent実装中に個人PCの
global packageへ逃げない。

Codex CloudはDocker daemonを保証するDev Container経路ではないため、通常はDemo/non-live workに使用する。RLS、migration、Edge Function、local integrationはCodespacesまたはDocker Dev Containerへhandoffする。

## 複数エージェント運用

| Agent / IDE    | 読む指示                                        | 標準コマンド                               |
| -------------- | ----------------------------------------------- | ------------------------------------------ |
| Codex          | `AGENTS.md`, `.codex/config.toml`               | `npm run dev:cloud`, `npm run cloud:check` |
| Claude Code    | `CLAUDE.md` → `AGENTS.md`                       | 同上                                       |
| GitHub Copilot | `.github/copilot-instructions.md` → `AGENTS.md` | 同上                                       |
| VS Code agent  | workspace recommendations + `AGENTS.md`         | VS Code tasks                              |

複数のwrite-capable agentを同じbranchまたはworktreeで同時実行しない。並列実装はagentごとにbranch/worktreeを分離し、main agentがdiff、test、commitを統合する。並列reviewは`.codex/agents/`のread-only agentを使用できる。

各agentの個人認証はGitへ保存しない。Codex、Claude Code、GitHub Copilotのsubscription loginは各サービスの安全な認証UIで行う。

## スマートフォンから監督する

### Codex Cloud task

ChatGPT mobileからCodex taskを開き、指示、follow-up、進捗、diff、test結果を確認する。GitHub Mobileまたはmobile browserでDraft PR、checks、review commentを確認する。

Codex Cloud taskはpushed private branchから開始し、environment setupに
`bash .codex/setup.sh`を指定する。通常のenvironment variables/secretsは0件のままとし、agent internet accessはOFFを既定とする。依存取得が必要なsetup phaseと、sourceを扱うagent phaseを分離する。Hosted値やProduction `.env`を登録して通常taskにlive権限を与えない。

### Codex Remote

PC、Codespaceへ接続したVS Code、またはSSH host上の作業を監督する場合は、ChatGPT Desktopで **Settings → Connections → Control this Mac or PC** を設定し、ChatGPT mobileの **Remote** からQR pairingする。Remoteでは指示、承認、diff、test、terminal、screenshotを確認できる。

QR、MFA、SSO、passkeyは本人だけが扱う。pairing情報、認証code、credentialをpromptやrepositoryへ貼らない。Remote hostをpublic internetへ直接公開せず、公式Remote relayまたはSSH/VPNを使用する。

### ローカルPC切断時の実行境界

| Surface                            | PC切断後                                        | 切断前の条件                                      |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Codex Cloud                        | 継続可能                                        | task開始済み、private branch push済み、setup PASS |
| GitHub Actions                     | 継続可能                                        | exact SHAのworkflowがqueue済み                    |
| Codespaces                         | filesystemは保持、active processはsuspendし得る | branch push済み、同じCodespaceを後で再開          |
| このPCのDocker／browser／terminal  | 停止                                            | ActionsまたはCodespaceへ必要gateを委譲            |
| Codex Remote                       | 停止                                            | host online/awakeが必須                           |
| OAuth/TOTP/Human/Hosted/Production | 自律継続しない                                  | operator、認証UI、exact separate approvalが必須   |

切断前の順序:

1. dedicated branchへcommitしprivate originへpushする。
2. `npm run cloud:check`または変更surfaceに対応するgateを完了する。
3. `npm run cloud:handoff`を実行し、exact HEAD/upstreamを記録する。
4. Docker/browser gateをGitHub Actionsまたは既に起動したCodespaceへ委譲する。
5. 未実行のHosted/Human/Production項目を`HOLD`としてhandoffへ残す。

詳細な50時間計画とcopy-ready agent promptsは
[`LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md`](LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md)
および
[`LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md`](LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md)
を正本とする。

## Isolation rules

- 一つのCodespace、container、branchへ複数repositoryを混在させない。
- `main`へ直接commitしない。
- 他repositoryからの再利用は先にread-only inventoryを行い、source/configの
  適用可否を分類する。secret、OAuth client、service account、data、migration
  history、deploy stateを暗黙にcopyしない。
- `.env*`、credential、lecture code、個人情報、database dump、Production dataをcopyまたはcommitしない。
- Codespacesの転送portはprivateを既定とする。
- Demo pathからSupabase、OpenAI、Cloudflare R2、その他paid/Production serviceへ接続しない。
- 通常taskからlive OpenAI test、Hosted migration、R2 upload、Cloudflare deploy、secret変更を行わない。
- Local、CI、Hosted、Device、Human、Production acceptanceを相互に代替しない。

このprivate repositoryはmain rulesetでPR-only integration、required checks、conversation resolution、force-push/deletion denialを実施する。live rulesetはhigh-risk merge前にread-onlyで再監査し、source submissionのためにvisibilityや保護を弱めない。

## 完了基準

cloud taskは次を満たしてからhandoffする。

1. exact `origin/main` SHAとgreen CIを記録し、そこから専用branchを使用している。
2. 変更範囲が明確で、Hosted/Productionへの不要な影響がない。
3. `npm run cloud:doctor`と`npm run cloud:check`が完了している。
4. UI変更では該当Demo E2E、database変更ではlocal Supabase gateが完了している。
5. secret scanと`git diff`を確認している。
6. commitとpushが完了し、Draft PRでreview可能である。
7. 実施していないHosted、Device、Human、Production確認をPASSと表現していない。

## Troubleshooting

- Dev Container変更後: **Rebuild Container**を実行する。
- feature lock mismatch: 意図した更新であることを確認後、固定CLIの`upgrade`でlockfileを更新する。
- Dockerが起動しない: Docker Desktop/Engineの状態を確認し、Demo/non-live作業はCodespacesまたはCodex Cloudで継続する。
- Supabase起動失敗: `npx supabase --help`と`npx supabase status`で現行CLI状態を確認し、同じ失敗を反復しない。
- `.env.local`上書き拒否: 既存fileを削除・上書きせず、所有者と用途を確認する。
- Codex Cloud cacheが古い: environment設定でcacheをresetする。
- GitHub Actionsが外部障害中: Codespaces gateを保持し、公式status回復後に失敗jobだけを再実行する。
