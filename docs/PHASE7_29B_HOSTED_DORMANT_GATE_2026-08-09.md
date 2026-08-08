# Phase 7.29B Hosted Dormant Gate evidence (2026-08-09 JST)

Status: Historical
Scope: Phase 7.29A source integration and Phase 7.29B default-OFF Hosted placement
Last verified: 2026-08-09

## Decision

**Phase 7.29A and Phase 7.29B PASS. Phase 7.29C activation remains HOLD.**

The PowerPoint Presenter implementation is present on canonical `main`, and
its additive database and compatible server/browser revisions are deployed in
a fail-closed state. No Presenter connection can be issued, no loopback client
is exposed in the Admin UI, no machine endpoint or native artifact is
published, and the existing manual PDF, classroom Display and student
five-second snapshot paths remain the active behavior.

This record does not authorize Presenter activation or claim that PowerPoint,
Office COM, installer, venue or device acceptance has passed.

## Release identity and recovery points

- Canonical repository: `genellect/compass-interactive`
- Source PR: [#26](https://github.com/genellect/compass-interactive/pull/26)
- Reviewed PR head: `bb35120cd13797b440e50571cd51791969ae7104`
- Main merge commit: `52e78ed74e253fe5a1265c8b8b0bd4f0bf3afc1f`
- Exact-head CI run: `31270355455`, attempt 2 — SUCCESS
- New immutable Pages deployment:
  `https://a53b026f.compass-interactive.pages.dev`
- New Pages deployment ID: `a53b026f-2c50-4fbb-b4a7-49dbbff71085`
- Previous immutable Pages rollback deployment:
  `https://7e935317.compass-interactive.pages.dev`
- Previous Pages deployment ID: `7e935317-b479-4e91-a143-3903032310a8`
- Pre-change public/private schema backup: protected operator-local copy,
  SHA-256 `C76536239A33491E72517EB01DE44A6754A17CD2F8011A842E1AF2D56D748CBF`

The Direct Upload deployment metadata does not carry a Git source field. The
operator built it from a clean worktree at the merge commit above, and the
canonical site was verified to serve the exact generated asset
`index-BdfsMRVN.js` on every public route listed below.

## CI and Local Gate evidence

The exact reviewed head passed:

- quality, secret scan, dependency audit, TypeScript, lint, production build,
  SBOM and 63 non-live groups;
- clean migration from zero, generated database type drift, 28 pgTAP files and
  1,375 assertions;
- populated Phase 7.2 -> 7.26 -> 7.27 -> 7.28 -> 7.29 upgrades;
- AI, Display, PDF, Journal Club and Presenter concurrency/lock-order suites;
- Local Supabase Journal Club, Display Realtime, AI authorization and three
  consecutive teacher/student lifecycle runs;
- Windows x64 build and deterministic tests, Windows x86 build;
- Chromium and WebKit Demo, Phase 7.26, Phase 7.27 and Phase 7.29 flag-OFF and
  mocked flag-ON E2E.

One first-attempt Mobile WebKit status-message timeout retried successfully.
The failed Demo job was rerun once at the same source SHA. Attempt 2 passed with
zero flaky tests: Phase 7.27 ON 28 passed, OFF 4 passed, Phase 7.29 OFF 2
passed, and Phase 7.29 ON 2 passed. The earlier local Edge
`WorkerAlreadyRetired` event did not recur; the complete Local Supabase job was
clean on the final head.

## Hosted database placement

Migration `20260801075917_phase7_29_powerpoint_presenter_bridge.sql` was the
only pending migration in the linked dry run and became migration 31.

Read-only Hosted checks all returned true:

- migration recorded exactly once;
- `private.presenter_runtime_gate` contains one row and is OFF;
- Presenter connection and event tables contain zero rows;
- RLS is enabled on all three Presenter tables with no client policies;
- `anon` and `authenticated` have no direct table or RPC authority;
- Presenter tables are absent from `supabase_realtime`;
- all required indexes are valid and ready;
- public control RPCs are `SECURITY INVOKER`, private lifecycle triggers use a
  fixed empty `search_path`, and only the intended service role can execute
  them;
- all three lifecycle revocation triggers are attached and enabled.

Linked Hosted DB lint returned zero errors after migration.

## Hosted Edge placement

Only explicitly named functions were deployed:

| Function                      | Version | JWT      | State                      |
| ----------------------------- | ------: | -------- | -------------------------- |
| `manage-presenter-connection` |       1 | required | ACTIVE, admission OFF      |
| `update-display-state`        |      22 | required | ACTIVE, legacy v3 fallback |

Final inventory confirms:

- `presenter-bridge-session` is not deployed; its unauthenticated route returns
  404;
- `manage-presenter-connection` rejects an unauthenticated request with 401;
- `PHASE729_POWERPOINT_SYNC_ENABLED` is absent;
- `PRESENTER_BRIDGE_TOKEN_SECRET` is absent and was not created;
- DB runtime remains OFF and Presenter rows remain zero after Edge deployment.

No unscoped or all-functions deployment was run. R2, the asset Worker, OpenAI,
existing AI flags and existing Realtime topology were not changed.

## Hosted Pages and browser verification

The production build passed environment validation with Phase 0-7.28 current
features preserved. `VITE_PHASE7_29_POWERPOINT_SYNC=false`; one-off Journal
Club preset creation also remains OFF.

The canonical routes `/`, `/join/`, `/admin/`, `/display/`, `/lecture/` and
`/lecture/archive/` each returned HTTP 200 and served the exact release asset.
Real-browser DOM and console inspection found:

- no PowerPoint or Presenter UI on any inspected route;
- no console error on any inspected route;
- the Admin login surface remains available;
- the Display route remains protected by the existing Display-session flow;
- lecture and archive compatibility routes still render.

The final browser build contains the dormant Presenter module for later
activation, but the compound frontend gate prevents render and effect
execution. Exact-head flag-OFF E2E separately proves zero loopback and Presenter
Edge requests and leaves manual controls enabled.

## Advisor comparison

- Security Advisor before: 50 INFO, 7 WARN.
- Security Advisor after: 53 INFO, 7 WARN.
- The three new INFO notices are intentional RLS-with-no-policy notices for
  service-only Presenter tables. No WARN was added.
- Performance Advisor before: 62 INFO; after: 71 INFO.
- The nine new INFO notices are unused-index observations on empty dormant
  tables. No warning or error was added.

The existing anonymous-auth and leaked-password-protection warnings are not
Phase 7.29 regressions. They remain tracked by the broader Auth roadmap.

Advisor references:

- <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>
- <https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index>
- <https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection>

## Rollback

Because all Presenter gates remain OFF and the machine endpoint was never
deployed, the incident path is:

1. keep `private.presenter_runtime_gate.enabled=false` and verify active rows
   remain zero;
2. keep `PHASE729_POWERPOINT_SYNC_ENABLED` absent or false;
3. restore `update-display-state` v21 and remove or restore the JWT Admin
   function revision only if a server regression is confirmed;
4. restore Pages deployment `7e935317-b479-4e91-a143-3903032310a8`;
5. retain the additive schema. Do not run a destructive down migration during
   incident response.

Manual Admin PDF controls, the Phase 7.28 classroom Display path and student
five-second snapshots are the recovery paths.

## Phase 7.29C activation HOLD

Activation remains blocked until all of the following pass on the same release
candidate:

- asymmetric per-install proof of possession, not a copied bearer claim;
- application and WAF rate protection for the machine endpoint;
- scheduled and monitored cleanup Cron;
- functional native recovery-code input;
- signed per-user installer, update, rollback and uninstall;
- Office x86/x64 and supported build matrix;
- 500 real next/back/jump transitions, PowerPoint restart and COM-loss recovery;
- Edge and Chrome HTTPS-to-loopback PNA plus hostile-Origin tests;
- real Extend-display venue and human acceptance.

Until then, Phase 7.29 is source-complete and safely dormant in Production, not
an available classroom feature.
