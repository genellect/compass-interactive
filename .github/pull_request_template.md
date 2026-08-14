# Summary

<!-- What changed and why. One paragraph. -->

## C0 source admission

| Evidence | Value |
| --- | --- |
| Exact `origin/main` base SHA | |
| Latest completed CI for that SHA | |
| Dedicated branch / environment | |
| Recovery-source commit, if any | none / SHA |

- [ ] `origin` is `genellect/compass-interactive`
- [ ] No local-only branch, generated database type or old README was treated as canonical

# Change surface

<!-- Tick every surface this PR touches. docs/GATE_ROUTING.md maps each one to its responsible gate. -->

- [ ] `src/` — components, routes, hooks
- [ ] `supabase/migrations/` — schema, RLS
- [ ] `supabase/functions/` — Edge Functions
- [ ] `supabase/tests/` — pgTAP
- [ ] `cloudflare/` — asset Worker
- [ ] `publisher/`
- [ ] `e2e/`
- [ ] `scripts/`, `.github/workflows/`
- [ ] `package.json` / `package-lock.json`
- [ ] `.devcontainer/`, `.node-version`, `.nvmrc`, `.gitattributes`
- [ ] `.codex/`, `AGENTS.md`, Cloud/Gate contract
- [ ] `presenter-bridge/` Windows native boundary
- [ ] Google OAuth / Supabase Auth / Admin RBAC / MFA
- [ ] `docs/` or agent instructions only

# Verification

Record the actual outcome of each gate. Every row must be one of **PASS**, **FAIL**, or **not executed** — with a reason for anything that is not PASS. A gate that was skipped, blocked, unavailable in this environment, or assumed from an earlier run is **not executed**. Never leave a row blank and never write "should pass".

## Non-live gate

| Gate                                             | Result | Notes                                                                                  |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------- |
| `npm run cloud:check`                            |        |                                                                                        |
| `npm run cloud:doctor`                           |        | required for cloud/environment or canonicalization changes                            |
| `npm run security:audit`                         |        | required when `package.json` or `package-lock.json` changed; not part of `cloud:check` |
| `npm run build` + `npm run test:phase6-9-bundle` |        | required when bundling, lazy-loading or feature-flag gating changed                    |

## Browser gate

| Gate                                       | Result | Notes                          |
| ------------------------------------------ | ------ | ------------------------------ |
| `npm run test:e2e:demo`                    |        | required for any `src/` change |
| `npm run test:e2e:phase7-26` / `:flag-off` |        | browser PDF publication        |
| `npm run test:e2e:phase7-27` / `:flag-off` |        | Journal Club preset            |
| `npm run test:e2e:phase7-29` / `:flag-off` |        | Presenter browser boundary     |

## Local Supabase gate

Required for any change to `supabase/migrations/`, `supabase/functions/`, or `supabase/tests/`. Needs a Docker daemon; not runnable in Codex Cloud.

| Gate                                                                                | Result | Notes                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash .devcontainer/start-local-supabase.sh` (migrations from zero, pgTAP, db lint) |        |                                                                                                                                                         |
| `npm run db:types:check`                                                            |        |                                                                                                                                                         |
| concurrency and lock-order suites                                                   |        | `test:phase4-1-concurrency`, `test:phase7-26-concurrency`, `test:phase7-27-concurrency`, `test:phase7-28b-lock-order`, `test:phase7-28c-ai-concurrency` |
| data upgrade suites                                                                 |        | `test:phase7-26-upgrade`, `test:phase7-27-upgrade`, `test:phase7-28-upgrade`                                                                            |
| `npm run test:production-local-edge`                                                |        |                                                                                                                                                         |
| local browser integration                                                           |        | `test:e2e:phase7-27:local`, `test:e2e:phase7-28b:local`, `test:e2e:phase7-28c:local`, `test:e2e:local:triple`                                           |

## Windows Presenter gate

| Gate | Result | Notes |
| --- | --- | --- |
| CI x64/x86 solution build | | no unsigned artifact uploaded |
| CI deterministic Core/loopback tests | | x64 |
| Signed installer / SmartScreen / update / rollback | | Device Gate; dormant PR may record `not executed` |
| Real Office, 500 transitions, Edge/Chrome PNA, venue | | Device/Human Gate; dormant PR may record `not executed` |

## Dev Container gate

Required for `.devcontainer/`, `.node-version`, `.nvmrc`, `.gitattributes`, `scripts/devcontainer.*`, or a dependency change.

| Gate                                          | Result | Notes |
| --------------------------------------------- | ------ | ----- |
| `npm run dev:doctor` inside the Dev Container |        |       |

# Safe execution levels

Confirm the boundary in `docs/CLOUD_DEVELOPMENT.md` held.

- [ ] Independent demo — used, no external effect
- [ ] Non-live regression — used, no external effect
- [ ] Local Supabase — used, repository-owned Docker only
- [ ] Live OpenAI checks — **not performed** (`test:phase5-openai-live`, `test:phase6-openai-live`)
- [ ] Hosted Supabase / R2 / Cloudflare — **not performed** (`supabase link`, `supabase db push`, R2 upload, `wrangler deploy`, `deploy:cloudflare*`)

If any level in the last two groups _was_ performed, say so explicitly here and state which task authorized it:

<!-- leave empty if none -->

# Not executed

List every gate that did not run and why. This section is not optional — if it is empty, that is a claim that every gate above ran.

| Gate | Why it did not run |
| ---- | ------------------ |
|      |                    |

# Secrets and isolation

- [ ] `npm run security:secrets` passed
- [ ] `git diff` reviewed; no `.env*`, `.dev.vars*`, credential, lecture code, personal data, database dump or Production data added
- [ ] No server-only secret placed behind a `VITE_` prefix
- [ ] No secret value printed in output, logs, screenshots, issues, or this PR
- [ ] Reused external-repository assets are listed below; no OAuth client, service account, secret, data or deploy state was copied

External asset reuse: <!-- none, or source repository + non-secret asset + review result -->

# Feature admission and rollback

- [ ] New browser, Edge and DB gates are independently default OFF
- [ ] Flag-OFF path was tested against the existing UX/backend contract
- [ ] Rollback order and retained additive schema are documented
- [ ] This PR does not label dormant source/deployment as feature activation

# Completion criteria

From 完了基準 in `docs/CLOUD_DEVELOPMENT.md`.

- [ ] Working on a dedicated branch from the latest `origin/main`; nothing committed directly to `main`
- [ ] Change scope is clear, with no unnecessary effect on Hosted or Production
- [ ] `npm run cloud:check` completed
- [ ] Demo E2E completed for UI changes; local Supabase gate completed for database changes
- [ ] Secret scan and `git diff` reviewed
- [ ] Committed, pushed, and reviewable as a Draft PR
- [ ] **No Hosted, Device, Human or Production check that was not performed is described as PASS**
