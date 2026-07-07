# Journal Club Admin Gate

JC-3では、`/admin` に最小限のAdmin Gateを追加します。

## 目的

参加者が誤ってAdmin画面を操作しないように、Admin PINを要求します。PIN実値はReact frontendに置かず、Supabase Edge FunctionのSecretとして管理します。

## 認証フロー

1. `/admin` にアクセスする。
2. 未認証の場合、PIN入力画面を表示する。
3. React frontendはPINを `verify-admin-pin` Edge Functionへ送信する。
4. Edge Functionは `Deno.env.get("ADMIN_PIN")` を読み、送信されたPINと照合する。
5. 一致すれば `{ "ok": true }` を返す。
6. frontendは成功時のみ `sessionStorage` に認証状態を保存する。
7. logoutで `sessionStorage` の認証状態を削除する。

## frontendに置かないもの

- PIN実値
- `VITE_ADMIN_PIN`
- `ADMIN_PIN`
- `ADMIN_SESSION_SECRET`

`.env.local.example` にfrontend用PINは追加しません。

## Supabaseに手動設定するSecret

Supabase DashboardのEdge Functions Secretsに以下を設定します。

```env
ADMIN_PIN=人間が決めたPIN
```

将来、署名付きsession tokenを使う場合は以下を追加で使えます。

```env
ADMIN_SESSION_SECRET=長いランダム文字列
```

JC-3では `ADMIN_SESSION_SECRET` は未使用です。

## Edge Function

Function path:

```text
supabase/functions/verify-admin-pin/index.ts
```

Function name:

```text
verify-admin-pin
```

Supabase CLIを使う場合の例:

```bash
supabase functions deploy verify-admin-pin
```

CLIを使わない場合は、Supabase DashboardまたはCLI導入後に同等のdeployを行ってください。

## 手動確認

1. Supabaseに `ADMIN_PIN` secretを設定する。
2. `verify-admin-pin` Edge Functionをdeployする。
3. `/admin` を開く。
4. 間違ったPINでerrorになることを確認する。
5. 正しいPINでAdmin dashboardが表示されることを確認する。
6. reloadしても同じタブではsessionStorageによりAdmin表示が維持されることを確認する。
7. `Logout` でPIN入力画面へ戻ることを確認する。
8. 別ブラウザでは再度PIN入力が必要なことを確認する。

## 制限

- Supabase Auth本格導入ではありません。
- RLSは変更しません。
- Admin操作のbackend化は未実装です。
- sessionStorage保存は簡易gateであり、production向けの強い認証ではありません。
- Journal Club MVPでの誤操作防止を目的にしています。
