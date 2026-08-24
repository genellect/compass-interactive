# Gate Routing

Status: Operationally verified
Scope: which gate answers for which change surface
Last verified: 2026-08-12

`AGENTS.md` is authoritative for the boundary. `docs/CLOUD_DEVELOPMENT.md` is authoritative for environments and safe execution levels. This file answers only one question: **I changed X, which gate is responsible?**

Everything below is derived from the implementation — the job composition in `.github/workflows/ci.yml`, the `safeTestScripts` allowlist in `scripts/ci/run-nonlive-suite.mjs`, the path filters in `.github/workflows/devcontainer-contract.yml`, and the `include` sets of the four `tsconfig*.json` files. When this file and those disagree, they are correct and this file is stale.

## 1. What `cloud:check` does and does not cover

`npm run cloud:check` is the default gate, but it is **not** the same as CI's `quality` job.

| Step                                               | `cloud:check`                   | CI `quality` job                                            |
| -------------------------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `security:secrets`                                 | yes                             | yes                                                         |
| `security:audit`                                   | **no**                          | yes                                                         |
| `typecheck` / `typecheck:phase3` / `typecheck:e2e` | yes                             | yes                                                         |
| `lint`                                             | yes                             | yes                                                         |
| `test:ci:nonlive` (75 groups)                      | yes                             | yes                                                         |
| `build`                                            | yes, with the local environment | yes, with the full production feature-topology `VITE_*` set |
| `test:phase6-9-bundle`                             | **no**                          | yes                                                         |
| `git diff --check`                                 | **no**                          | yes                                                         |

Consequences worth knowing before you push:

- A green `cloud:check` does **not** prove `security:audit` is green. A newly published advisory turns CI red without any change on your side. Run `npm run security:audit` yourself whenever you touch `package.json` or `package-lock.json`, and after a long gap since the last CI run.
- A green `cloud:check` does **not** prove the bundle topology gate. `test:phase6-9-bundle` inspects the built output and only runs after CI's `build`, which sets every `VITE_PHASE*` flag. If you change lazy-loading, chunking, or feature-flag gating, run `npm run build && npm run test:phase6-9-bundle` locally.

Both browser jobs (`demo-e2e`, `local-supabase`) declare `needs: quality`, so a `quality` failure means the browser gates never ran at all — their absence in a CI run is not evidence they would pass.

## 2. Change surface to gate

| You changed                                                                   | Responsible gate                                                                                                                                                                                                                                                                 | Cloud-runnable?                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/` components, routes, hooks                                              | `cloud:check`, then `npm run test:e2e:demo`                                                                                                                                                                                                                                      | Yes, if the Playwright browsers can be downloaded                                                                                                                                                                             |
| `src/` visual layout, brand copy, accessibility                               | the above, plus `e2e/demo/visual-contract.spec.ts` and `accessibility.spec.ts` (both inside `test:e2e:demo`)                                                                                                                                                                     | Yes, browsers required                                                                                                                                                                                                        |
| `supabase/migrations/`                                                        | `cloud:check`, then the full local Supabase gate (§3)                                                                                                                                                                                                                            | **No** — needs a Docker daemon                                                                                                                                                                                                |
| `supabase/functions/`                                                         | `cloud:check` (the `test:phase*-edge` groups run non-live), then `test:production-local-edge` on the local stack                                                                                                                                                                 | Partly — static and shape checks are cloud-runnable, Auth/CORS/fail-closed checks are not                                                                                                                                     |
| `supabase/tests/` (pgTAP)                                                     | `npx supabase test db --local`                                                                                                                                                                                                                                                   | **No**                                                                                                                                                                                                                        |
| `cloudflare/asset-worker/`                                                    | `cloud:check` — covered by `typecheck:phase3` and `test:phase3-worker`                                                                                                                                                                                                           | Yes                                                                                                                                                                                                                           |
| `publisher/`                                                                  | `cloud:check` — covered by `typecheck:phase3` and `test:phase3-publisher`                                                                                                                                                                                                        | Yes                                                                                                                                                                                                                           |
| `presenter-bridge/` source                                                    | `cloud:check`, then CI `presenter-native` x64/x86 build and deterministic x64 tests                                                                                                                                                                                              | Partly; compile/test needs a Windows runner                                                                                                                                                                                   |
| `presenter-bridge/` installer, signing, COM or PowerPoint behavior            | signed release workflow plus Windows Device/Human gate; real Office, 500 transitions, restart, PNA and venue drill                                                                                                                                                               | **No**                                                                                                                                                                                                                        |
| `e2e/demo/`                                                                   | `npm run typecheck:e2e`, then the matching demo spec                                                                                                                                                                                                                             | Yes, browsers required                                                                                                                                                                                                        |
| `e2e/local/`                                                                  | `npm run typecheck:e2e`, then the matching local spec on the local stack                                                                                                                                                                                                         | **No**                                                                                                                                                                                                                        |
| `scripts/` test or CI scripts                                                 | `cloud:check`. If you touched the allowlist or a forbidden-command list, `test:ci:nonlive` and `test:production-gate:static` are the ones that answer                                                                                                                            | Yes                                                                                                                                                                                                                           |
| `.github/workflows/`                                                          | `cloud:check` — `run-nonlive-suite.mjs` asserts that `ci.yml` contains no live or hosted command                                                                                                                                                                                 | Yes                                                                                                                                                                                                                           |
| Approved documentation surfaces only                                          | `security:secrets`, `test:phase6-7-docs` and the committed-diff whitespace check; CI reports the remaining required contexts without starting browser, database, native, CodeQL or Dev Container work                                                                            | Yes                                                                                                                                                                                                                           |
| `package.json` / `package-lock.json`                                          | `cloud:check` **plus** `npm run security:audit`, plus the Dev Container Contract workflow (§4)                                                                                                                                                                                   | Yes                                                                                                                                                                                                                           |
| `.devcontainer/`, `.node-version`, `.gitattributes`, `scripts/devcontainer.*` | `npm run dev:doctor` inside the container, plus the Dev Container Contract workflow                                                                                                                                                                                              | **No** — needs the Dev Container                                                                                                                                                                                              |
| `.codex/`, `AGENTS.md`, `CLAUDE.md`, Cloud/Gate docs                          | `npm run cloud:doctor`, `cloud:check`, then the Dev Container Contract workflow because these paths define agent admission                                                                                                                                                       | Yes for cloud doctor; Dev Container job remains separate                                                                                                                                                                      |
| Google OAuth, Supabase Auth provider, Admin identity/RBAC or MFA              | Cloud static gate, full local Supabase/RLS gate, then separate Hosted IAM, AAL2, two-Admin, recovery and Human gates                                                                                                                                                             | Partly; provider and MFA evidence are Hosted/Human                                                                                                                                                                            |
| Phase 7.30B2 AI-unlock migration, policy/PIN/rate/receipt/browser DB state    | `test:phase7-30b2-static`, then from-zero migration/all pgTAP, `test:phase7-30b2-concurrency`, `test:phase7-30-upgrade`, generated types and DB lint; raw-PIN Edge/UI/browser cryptography are routed separately through the B2.2b row                                           | Static only; runtime database evidence needs Docker and exact-head CI                                                                                                                                                         |
| Phase 7.30B2.2a factor-set and rare-control identity hardening                | `test:phase7-30b22a-static`, from-zero/populated upgrade, all pgTAP, B2 concurrency, generated types and DB lint; Local Edge must prove AAL2-to-AAL2 `challengeAndVerify` yields a new TOTP AMR timestamp before activation                                                      | Source/static only; Local Edge, exact-head CI and Hosted/Human activation remain HOLD                                                                                                                                         |
| Phase 7.30B2.2b AI-unlock Edge/browser and TOTP factor transitions            | `test:phase7-30b22b-static`, Chromium/WebKit `test:e2e:phase7-30b22b-browser`, from-zero/all pgTAP, deterministic B2 concurrency, populated B2.2a-head upgrade, generated types, Local Edge and exact-head CI; authority/master activation remains C/E                           | Browser/static are cloud-runnable; database, Local Edge, Hosted and Human evidence remain HOLD                                                                                                                                |
| Phase 7.30C1 private lecture ownership and atomic Google AI-master admission  | `test:phase7-30c1-static`, from-zero/all pgTAP, populated B2.2b-head upgrade, generated types, Local Edge `admin-ai-unlock` source-OFF/fail-closed transport check and exact-head CI; real PIN/browser proof rollback and child/provider authority remain fenced/HOLD through C2 | Source/static only; database, proof rollback, Local Edge runtime, Hosted and Human evidence remain HOLD                                                                                                                       |
| Phase 7.30C2 unified Google Admin authorization and provider authority        | `test:phase7-30c2-static`, `test:phase7-30c2-ai-provider-static`, from-zero/all pgTAP, populated C1-head no-backfill/provider upgrade, generated types/DB lint and exact-head CI; paid provider calls remain excluded from this gate                                             | Exact-head source/DB/Edge/browser evidence passes; Hosted/Human and activation remain HOLD                                                                                                                                    |
| Phase 7.30D owner Admin ledger, invitations and authority revocation          | `test:phase7-30d-static`, from-zero/all pgTAP, `test:phase7-30d-concurrency`, populated B1/C2-head invitation upgrade, generated types/DB lint, Local Edge and `test:e2e:phase7-30d-browser`; raw invitation token remains Edge-only and all gates default OFF                   | Exact-head source/DB/Edge/browser evidence passes; Hosted/Human and activation remain HOLD                                                                                                                                    |
| Phase 7.30E Google-only transport, explicit ownership and identity cutover    | `test:phase7-30e-static`, from-zero/all pgTAP, `test:phase7-30e-concurrency`, populated C2-head Display and D-head ownership upgrades, generated types/DB lint, Google-only Local Edge and full demo/local browser regression; operator cutover is never invoked by CI           | Static/mock browser pass locally; DB/Local Edge exact-head pending; Hosted attestation/cutover is Human HOLD                                                                                                                  |
| Phase 7.30F source/local Hosted/Human readiness contract                      | `test:phase7-30f-static`, `test:production-env`, strict evidence schema/example, pure-local default-HOLD validator, reviewed read-only SQL text and `test:phase6-7-docs`; exact-head CI plus independent redacted review before any external request                             | Source-only input stays `HOLD`; after separately collected complete staging evidence, the offline validator may emit `READY_FOR_SEPARATE_HOSTED_EXECUTION` without querying/proving Hosted state or authorizing the next step |
| Lecture Cycle Production Candidate and private source submission              | `cloud:doctor`, `cloud:handoff`, `cloud:check`, complete local Supabase gate, Demo/local browser matrix, Phase 7.30F staging/Human dossier, private exact-SHA archive/checksum review and independent release review; Production canary remains separately approved              | Partly; Cloud/Actions can prepare source and tests after disconnect, while Hosted/Human/canary evidence requires the matching live surface and approval                                                                       |
| GitHub rulesets, repository visibility, license or public artifacts           | Phase 7.31A/B supply-chain, full-history secret/PII/rights audit and a separate user approval immediately before visibility change                                                                                                                                               | Partly; current-plan inventory is read-only, enforcement and publication are Hosted/Human                                                                                                                                     |
| Contest reviewer identity, environment or paid-AI access                      | Phase 7.30 identity/TOTP AAL2, AI PIN/browser enrollment, atomic abuse-limit, scope-escalation and revoke-matrix gates plus Phase 7.31C lecture-master, dedicated R2, cross-principal/environment, budget/expiry/cleanup and Human reviewer gates                                | Partly; real OAuth, Supabase, R2 and AI require isolated Hosted evidence                                                                                                                                                      |
| Tenant, commercial billing, retention/privacy, SLO or support operations      | Phase 7.32 DB/Edge/UI/load/accessibility/restore/incident gates, followed only by the unified Phase 7.33 Production Gate                                                                                                                                                         | Partly; commercial Hosted/Human/legal evidence cannot be proved by Cloud tests                                                                                                                                                |

The `.nvmrc` compatibility pin follows the `.node-version` row and must stay
identical to the package engine minimum; either pin changing routes through the
same Dev Container Contract.

`cloudflare/presenter-gateway/` is locally covered by `typecheck:phase3` and
`test:phase7-29-gateway`, both included in `cloud:check`. A Custom Domain,
secret, route or deployment is not cleared by those tests and remains a
separately authorized Phase 7.29C Hosted Gate.

Feature-flag work spans surfaces: a `VITE_PHASE*` flag has a matching server-side `PHASE*_ENABLED` variable in the Edge Function environment, and the `:flag-off` demo specs exist because both states must hold. Changing one without the other is the failure this pairing catches.

## 3. The local Supabase gate, in CI order

Run `bash .devcontainer/start-local-supabase.sh` first. It performs the stack start, the from-zero migration apply, pgTAP, and the database lint. The remaining steps below are what CI's `local-supabase` job runs on top of that, in this order:

```bash
npm run db:types:check                  # generated database type drift
npm run test:phase4-1-concurrency       # AI concurrency lanes, real database
npm run test:phase7-28c-ai-concurrency  # lecture-wide AI authorization
npm run test:phase7-28b-lock-order      # Display issue versus Admin revoke
npm run test:phase7-26-concurrency      # PDF publication
npm run test:phase7-27-concurrency      # Journal Club
npm run test:phase7-29-concurrency      # Presenter lifecycle and fencing
npm run test:phase7-30b2-concurrency    # Admin AI unlock replay, rate and lock order
npm run test:phase7-26-upgrade          # Phase 7.2 data through 7.26
npm run test:phase7-27-upgrade          # Phase 7.26 data through 7.27
npm run test:phase7-28-upgrade          # populated 7.27 data through 7.28
npm run test:phase7-29-upgrade          # populated 7.28 data through 7.29
npm run test:phase7-30d-concurrency      # owner last-owner and invitation terminal races; next upgrade resets its fixture
npm run test:phase7-30-upgrade          # populated legacy through D-head state through current G schema; full reset on exit
npm run test:phase7-30e-concurrency     # approval/claim/session/cutover serialization, NOWAIT rollback and exact replay; full reset on exit
npm run test:e2e:phase7-30b22b-browser  # IndexedDB/CryptoKey scope and response-loss convergence
npm run test:production-local-edge      # local Auth, CORS, fail-closed paid features
npm run test:phase7-30b1-local-edge     # real local TOTP AAL2 identity path
npm run test:phase7-29c-local-edge      # Presenter proof path
npm run test:e2e:phase7-27:local        # browser to Edge to database
npm run test:e2e:phase7-28b:local       # cross-browser Display Realtime
npm run test:e2e:phase7-28c:local       # lecture-wide AI authorization, browser
npm run test:e2e:local:triple           # teacher-student lifecycle, three repeats
```

Two ordering facts from `ci.yml` that are easy to get wrong locally:

- `test:e2e:local:triple` runs **after** a second `supabase db reset --local --no-seed`. The concurrency and upgrade suites leave state behind, and the lifecycle E2E assumes a clean database.
- The Edge Functions are served with synthetic test secrets from a generated env file, including a freshly generated `PDF_ACCESS_PRIVATE_JWK`. Never substitute a real key here.

A migration change is not cleared by `cloud:check`. `supabase/migrations/` is only covered once this gate runs.

## 4. Dev Container Contract

`.github/workflows/devcontainer-contract.yml` starts on every Pull Request so its required context is always reported. It builds the locked Dev Container and runs `npm run dev:doctor` inside it only when at least one of these paths changed:

```
.devcontainer/**
.codex/**
AGENTS.md
CLAUDE.md
.gitattributes
.node-version
.nvmrc
package.json
package-lock.json
scripts/devcontainer.*
scripts/cloud-workspace-doctor.mjs
scripts/cloud-handoff-doctor.mjs
docs/CLOUD_DEVELOPMENT.md
docs/GATE_ROUTING.md
docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md
docs/LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md
.github/workflows/devcontainer-contract.yml
```

Note that `package.json` and `package-lock.json` are in that list. A dependency change fires both the CI workflow and this one.

The `main` push trigger remains restricted to the same paths, and a manual
dispatch always runs the complete contract. A Pull Request confined to the
explicitly approved root, `docs/`, `.github/`, `.claude/` and nested README
documentation surfaces still receives the required context. It avoids Dev
Container construction only when none of the contract paths listed above
changed; changes to Cloud/Gate or Lecture Cycle contract documents deliberately
run the complete container gate. The main CI workflow uses the broader approved
documentation classification and limits its quality job to the secret,
documentation and committed-diff whitespace checks; browser, local Supabase,
Dependency Review and CodeQL jobs are skipped successfully, while the two
Presenter contexts complete as lightweight Ubuntu jobs without native work.

## 5. What the 116 `test:*` scripts actually divide into

| Count | Kind                               | Where it runs                                                                                                                                                                                         |
| ----: | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    75 | in `safeTestScripts`               | automatically inside `npm run test:ci:nonlive`; no need to invoke individually                                                                                                                        |
|    21 | needs the local Supabase stack     | invoked directly by CI's `local-supabase` job: 9 concurrency / lock-order suites, 5 `*-upgrade` suites, 3 local Edge suites and 4 local E2E entries                                                   |
|    11 | demo browser                       | CI's `demo-e2e` job: `test:e2e:demo:triple`, Phase 7.26/7.27/7.29/7.30 flag-ON/OFF suites and the bounded Phase 7.30D Chromium/WebKit recovery gate                                                   |
|     1 | post-build                         | `test:phase6-9-bundle`, after the production-topology `build`                                                                                                                                         |
|     2 | **forbidden**                      | `test:phase5-openai-live`, `test:phase6-openai-live`. `scripts/test-pdf-sync-hosted.mjs` has no npm script and is forbidden for the same reason                                                       |
|     6 | entrypoint variants and duplicates | `test:ci:nonlive` (the aggregator), `test:e2e:demo`, `test:e2e:demo:direct`, `test:e2e:local`, `test:e2e:local:direct`, and `test:phase6-6-operator-edge` (already invoked by `test:phase6-6-static`) |

The phase-numbered names describe _when a suite was written_, not what it covers today. Route by the surface you changed, using the table in §2, not by matching a phase number to a directory.

## 6. Safe execution levels

Repeated from `docs/CLOUD_DEVELOPMENT.md` because gate routing is meaningless without it.

| Level                             | Ordinary cloud work | External effect              |
| --------------------------------- | ------------------- | ---------------------------- |
| Independent demo                  | Yes                 | None                         |
| Non-live regression               | Yes                 | None                         |
| Local Supabase                    | Yes                 | Repository-owned Docker only |
| Live OpenAI checks                | No                  | Paid external API            |
| Hosted Supabase / R2 / Cloudflare | No                  | Hosted / Production state    |

Local, CI, hosted, device, human and Production acceptance are separate gates and never substitute for one another. A gate you could not run is **not executed**, never "passed".

`npm run cloud:handoff` is a repository-side disconnected-handoff gate, not a
product gate. It requires a pushed clean non-main branch whose HEAD descends
from the current remote main, proves the remote branch and private GitHub
visibility, and rejects tracked private Phase 7.30F evidence at any depth,
non-example `.env`/`.dev.vars` files and generated runtime artifacts.
`BRANCH_HANDOFF_READY` still requires separately observed running exact-SHA
Codex Cloud task or GitHub Actions evidence before disconnect; it does not
authorize a Hosted query, paid call, secret mutation or Production action.

## Cross-cutting lecture UX gate

Every Phase 7.30 C2-F authorization change must test both denial and the usable
success path. Local and browser evidence must prove one Google+TOTP login can
carry an instructor through lecture open, material access, permitted feature
activation and safe stop without periodic reauthentication. Student join and
authorized PDF access must remain intact. Runtime/source gate OFF must reject
new authority while preserving exact replay, status, close, stop, revoke and
downgrade. Desktop/Mobile Chromium/WebKit must also remain free of authentication
loops, console errors and horizontal overflow. Before public enablement, Human
review must reject developer/experimental/placeholder wording and verify the
existing COMPASS color, typography, spacing, state and copy system across Admin,
Student, Display and Review.
