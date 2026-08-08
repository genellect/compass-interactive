# Phase 7.29 Cloud Rescue and Dormant Rollout

Status: Implemented, verification pending
Scope: Phase 7.29A canonical rescue and Phase 7.29B default-OFF hosted placement
Last verified: 2026-08-08

## Release meaning

Phase 7.29 is split so source publication cannot be mistaken for classroom
activation.

| Stage                   | Included                                                                                                                             | Explicitly excluded                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 7.29A rescue            | Current-main port of database, Edge, browser, native source, tests and docs; Windows CI compile/test                                 | Installer, signing, real PowerPoint, Hosted state                                                         |
| 7.29B dormant placement | Additive migration with DB gate OFF, JWT Admin and legacy-compatible Edge revisions with admission OFF, frontend build with flag OFF | Public machine endpoint, Presenter UI, Bridge admission, active connections, native artifact distribution |
| 7.29C activation        | Future signed/device/hosted/human canary                                                                                             | Not authorized by 7.29A/B                                                                                 |

The dormant release must leave the existing Admin PDF controls, private Display
fallback and student five-second snapshot behavior unchanged. It adds no
student polling, student Realtime subscription or OpenAI call.

## 7.29A rescue contract

Source commit `65b56d55` is recovery input from the pre-cloud local branch. It
is reapplied onto the exact current `origin/main`, not merged as a release base.

The rescued implementation keeps these boundaries:

- actual stable `View.Slide` state is authoritative; COM events only accelerate
  reconciliation;
- no hidden slides, Custom Show or Presenter View in the first supported mode;
- equal PPTX slide/PDF page counts and explicit teacher binding confirmation;
- local file digest and ordered Slide IDs remain fixed for a connection;
- loopback uses fixed port `43124`, exact Host/Origin, bounded bodies, PNA
  preflight handling and memory-only session material;
- server pairing and bearer capabilities are short-lived, lecture/deck bound,
  replay-fenced and never placed in a URL or browser storage; the installation
  digest is mismatch metadata, not proof of possession;
- the native remote endpoint is pinned to the canonical Supabase host, and
  slideshow/COM observation loss faults and revokes within a bounded grace;
- public Presenter tables have RLS, no anon/authenticated grants and no Realtime
  publication; service RPCs are invoker-security and service-role only;
- one active connection per lecture, server-time expiry, sequence/idempotency,
  same-page no-op, manual handover and lifecycle-triggered revocation converge;
- database, Edge and frontend gates are independently fail-closed.

The recovered schema-derived TypeScript database type is only a candidate. It
is accepted when a clean current-main database applies every migration and the
CI `db:types:check` proves it byte-equivalent to fresh generation. The old
branch's prior gate is not accepted as evidence.

## Automated gate

7.29A requires:

- Cloud doctor, secrets scan, audit, all TypeScript checks, lint, non-live suite
  and production build;
- Chromium and WebKit Presenter flag-OFF and flag-ON demo E2E plus existing demo
  regression;
- clean migration, populated Phase 7.28 upgrade, full pgTAP, DB types, DB lint,
  concurrency, lock-order and local Edge checks;
- Windows CI restore/build for x64 and x86, deterministic Core/loopback tests on
  x64, with no unsigned binary uploaded as an artifact;
- no Critical finding in the dormant path, every activation-only High finding
  recorded as a blocking 7.29C gate, and `git diff --check` PASS.

CI compilation does not prove Office COM interoperability, SmartScreen,
installation or venue behavior. Those remain Device/Human gates.

## 7.29B deployment order

Before the first mutation, record the current Production web deployment, hosted
migration list, deployed Edge versions, Advisor state and rollback owner. Verify
that the misconfigured Workers Builds Git connection remains disconnected, no
merge can auto-deploy a PR branch, and the production build input has
`VITE_PHASE7_29_POWERPOINT_SYNC=false` or omitted.

1. Merge the exact green PR SHA through the PR workflow.
2. Apply only the additive Phase 7.29 migration and verify
   `private.presenter_runtime_gate.enabled = false`.
3. Deploy only the JWT-protected `manage-presenter-connection` and compatible
   `update-display-state` revisions with
   `PHASE729_POWERPOINT_SYNC_ENABLED=false`.
   Use function-name-scoped deploy commands only; an unscoped all-function
   deploy is prohibited.
4. Do not deploy `presenter-bridge-session` in 7.29B. Its source and tests may
   be merged, but its `verify_jwt=false` machine endpoint would create a public
   invocation, cost and abuse surface even while the feature handler returns
   `503`. Deployment is deferred until 7.29C adds application-level and WAF
   rate protection and passes the enabled-handler integration gate.
5. Do not provision `PRESENTER_BRIDGE_TOKEN_SECRET` for 7.29B. When 7.29C is
   separately authorized, keep it server-only and inspect presence by
   name/status only, never by printing its value.
6. From the exact merged main SHA, build and explicitly Direct Upload the
   frontend with `VITE_PHASE7_29_POWERPOINT_SYNC=false` or omitted. Record the
   previous and new immutable Pages deployment IDs. Do not reconnect Workers
   Builds or broaden its old token during this rollout.
7. Confirm the PowerPoint panel is absent, the machine endpoint is not deployed,
   the JWT Admin endpoint fails closed, manual PDF navigation still works,
   Display fallback still works and student snapshots remain at the existing
   cadence.
8. Run hosted Advisor/RLS/grant checks and save exact deployment evidence.

The `supabase/config.toml` entry for `presenter-bridge-session` documents its
future JWT policy; it does not authorize or prove Hosted deployment. The Hosted
function inventory must prove that the route is absent. If it already exists,
stop the rollout, record its current version and obtain explicit rollback or
deletion authorization instead of removing it implicitly.

No installer or native executable is uploaded in 7.29B.

## Rollback

Rollback is operational and non-destructive:

1. set the database runtime gate to OFF, atomically revoking active connections;
2. set Edge admission OFF;
3. deploy the prior frontend or keep the frontend flag OFF;
4. stop any test Bridge process;
5. retain the additive schema for later contract cleanup.

Dropping tables or down-migrating during an incident is prohibited. The old
manual PDF path is the recovery path.

## Activation HOLD

Actual feature activation remains HOLD until a signed per-user installer,
safe update/rollback/uninstall, SmartScreen, Office x86/x64/build coverage, at
least 500 real next/back/jump transitions, restart/COM-release behavior,
Edge/Chrome production HTTPS-to-loopback/PNA, hostile-origin rejection, usable
manual recovery, venue Extend display and teacher UX approval are recorded.

The same HOLD also requires asymmetric per-install proof of possession,
application/WAF rate protection for the machine Edge endpoint, least-privilege
cleanup Cron with monitoring, and enabled-handler integration tests against a
real local database.

The `presenter-bridge-session` machine endpoint remains undeployed throughout
7.29B. It can enter Hosted scope only as part of the separately authorized
7.29C activation sequence after the rate, proof-of-possession and abuse gates
above are satisfied.

The current recovery-code copy does not have a native input surface. It must be
completed or removed before 7.29C; dormant placement is safe because the UI and
server admission remain OFF.
