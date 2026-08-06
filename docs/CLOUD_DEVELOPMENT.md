# COMPASS Interactive Cloud Development

Status: Development environment

GitHubを正本とし、通常の開発はGitHub CodespacesまたはCodex Cloudから開始する。Production Supabase、Cloudflare、R2、OpenAIのlive呼び出し、既存PCのcheckoutには依存しない。

## GitHub Codespaces

1. GitHubのrepository pageで **Code** → **Codespaces** → **Create codespace on main** を選ぶ。
2. Container作成後、locked npm dependencies、Playwright Chromium/WebKit、Docker-in-Docker、GitHub CLIが準備される。
3. Command Paletteから **Tasks: Run Task** → **Interactive: start browser development** を実行する。
4. private port `5173`のpreviewで`/demo`を開く。
5. 変更を専用branchへcommitし、Draft Pull Requestを作成する。

同じCodespaceは別PCのbrowserから再開できる。COMPASS公式repositoryとは別のCodespaceを使用する。

## Safe execution levels

| Level | Default cloud use | External effects |
|---|---|---|
| Independent demo | Yes | None |
| Non-live regression | Yes | None |
| Local Supabase | Yes | Codespace内Dockerのみ |
| Live OpenAI checks | No | Paid external API |
| Hosted Supabase / R2 / Cloudflare | No | Hosted or Production state |

通常の作業ではdemo、non-live regression、local Supabaseまでに限定する。

## Local Supabase in Codespaces

Command Paletteで **Interactive: start isolated local Supabase** を実行する。このtaskは次を行う。

- Codespace専用Docker上でSupabaseを起動する。
- 全migrationを空のlocal databaseへ適用する。
- pgTAPとdatabase lintを実行する。
- URLが`127.0.0.1`または`localhost`であることを検査する。
- local frontend valuesだけをignored `.env.local`へ生成する。

既存の`.env.local`は上書きしない。Hosted Projectへの`link`、`db push`、migration applyは行わない。

## Secrets

`OPENAI_API_KEY`は、必要な本人がGitHubの個人Codespaces Secretとして登録し、このprivate repositoryだけへaccessを許可する。値はGit、devcontainer file、task、logへ置かない。

既存PCの次のファイルはcloudへcopyしない。

- `.env.production.local`
- `.env.supabase.production.local`
- `.env.publisher.local`
- `.dev.vars`

Frontendへ渡してよいのはbrowser公開前提の値だけである。service-role key、OpenAI key、PIN、private JWK、R2 credential、Turnstile secretを`VITE_`変数にしない。

## Verification

Default non-live gate:

```bash
npm run security:secrets
npm run typecheck
npm run typecheck:phase3
npm run typecheck:e2e
npm run lint
npm run test:ci:nonlive
npm run build
```

Demo browser gate:

```bash
npm run test:e2e:demo
```

Local Supabaseのfull gateは`.github/workflows/ci.yml`の`local-supabase` jobを正本とする。有料OpenAI testとProduction deployは通常のcloud taskへ含めない。

## Codex Cloud

Codex環境でNode.jsを`.node-version`へ固定し、setup commandを次のようにする。

```bash
npm ci
npx playwright install --with-deps chromium webkit
```

Codex Cloudは`AGENTS.md`を読み、non-live testとfail-closed boundaryに従う。Codexのencrypted Secretはsetup phaseだけで除去されるため、通常taskではlive OpenAI testを実行しない。AI機能の開発はmock/non-live testを先に完了し、live validationを独立した人間承認gateとして扱う。

## Mobile workflow

- ChatGPT mobileからCodex Cloud taskへ指示し、進捗、diff、test結果を確認する。
- GitHub Mobileまたはmobile browserでDraft PR、checks、review commentを確認する。
- merge、Production deploy、hosted migration、secret変更はスマートフォンからでも通常の承認gateを省略しない。
