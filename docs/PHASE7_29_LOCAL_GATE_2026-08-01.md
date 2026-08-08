# Phase 7.29 Local Gate - 2026-08-01

Status: Historical
Scope: former local-branch automated web/database gate evidence
Last verified: 2026-08-01

This record predates GitHub canonicalization. Its PASS applies only to the old
local commit and does not transfer to the rescued branch or any hosted release.

## Decision

| Gate                               | Decision |
| ---------------------------------- | -------- |
| Automated web/database Local Gate  | **PASS** |
| Native build and execution subgate | **HOLD** |
| Human, Hosted and Production gates | **HOLD** |

Phase 7.29 is committed only as a default-OFF, additive implementation. No
hosted Supabase setting, Cloudflare resource, public web deployment, production
feature flag, external credential or paid API was changed by this gate.

The native subgate is intentionally not represented as PASS. Windows
Application Control rejected the local .NET execution boundary with exception
`0xe0434352`. The security policy was not weakened, and no `dotnet`, `testhost`,
generated DLL or generated EXE was executed during the resumed gate. Native
source received static review and fail-closed fixes, but it still requires a
trusted signed build and physical PowerPoint tests.

## Scope delivered

- Optional per-user Windows Presenter Bridge on loopback port `43124`.
- Actual PowerPoint `View.Slide` reconciliation as the source of truth; COM
  events only accelerate a 200 ms local observation loop.
- Explicit PowerPoint/PDF review before activation, with normal all-slide,
  windowed, no-hidden-slide and no-Custom-Show constraints.
- Short-lived, Origin-bound pairing and installation/deck/lecture-bound active
  capabilities; no Admin token, API PIN, service-role key, PDF or PPTX content
  crosses the browser-to-loopback boundary.
- Server-side one-unrevoked-connection fence, sequence/idempotency protection,
  same-page no-op and reuse of the established PDF live-state transition.
- Same-`auth.uid()` replacement Admin session status/revoke recovery without
  expanding confirm, claim or page-update authority.
- A 45-second server-time active heartbeat lease so an abandoned Bridge cannot
  fence manual PDF controls until the longer hard stop.
- Bounded, retryable cleanup which first revokes abandoned pairing/active rows,
  records content-free audit events, then removes terminal data after 30 days.
- Best-effort browser unmount disconnect/revoke plus authoritative server
  expiry if the browser or local process disappears.
- Native fail-closed propagation from runtime failure to loopback status,
  hidden-slide membership in the frozen binding digest, and cached PPTX hashing
  keyed by path, byte length and last-write time.
- Presenter metadata excluded from Supabase Realtime and all student payloads.
  Students retain the Phase 1 five-second snapshot protocol.

## State and failure convergence

```text
OFF -> pairing -> inspected -> confirmed -> active -> revoked
```

`revoked` is terminal. Reissue always uses new pairing material. Unknown Edge
actions return HTTP 400 and cannot fall through to revoke. A same-owner new
Admin session may see and stop an old connection, while another Supabase user
receives no connection metadata. At 44 seconds without heartbeat the manual
fence remains active; at the server-time 45-second boundary it revokes the
stale connection and permits the legacy manual update. Repeated cleanup,
revoke, heartbeat failure and handover calls converge without duplicate active
state.

## Migration and rollback

Migration:
`supabase/migrations/20260801075917_phase7_29_powerpoint_presenter_bridge.sql`

- Expand-first only; Phase 7.28 RPC definitions and private Broadcast policy
  remain byte-fingerprint-equivalent through the upgrade probe.
- New public tables have RLS enabled, no browser policies, no anon or
  authenticated grants and no Realtime publication membership.
- Public Presenter RPCs are SECURITY INVOKER and service-role-only. Private
  SECURITY DEFINER trigger helpers use a fixed empty search path and only
  revoke an already-bound connection.
- The database runtime singleton starts `false`; Edge
  `PHASE729_POWERPOINT_SYNC_ENABLED` and frontend
  `VITE_PHASE7_29_POWERPOINT_SYNC` also default OFF.

Rollback is operational rather than destructive: disable the database runtime
gate first to drain active rows, then disable Edge admission and the frontend
flag. Manual Admin PDF controls, the private Display fallback and student
five-second snapshots remain available. The additive schema is retained for a
later controlled contract migration.

## Automated evidence

Environment: Windows, Node.js 24.18.0, Supabase CLI 2.109.1, local Supabase
PostgreSQL 17.6, Vite 8.1.3. Database checks used an isolated project id and
port `55322`; the pre-existing default local database was not reset.

| Check                                               | Result                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Clean migration from an empty isolated DB           | PASS; Phase 0 through 7.29 applied                                                |
| Populated Phase 7.28 upgrade                        | PASS; 20 fixture assertions plus RPC/policy fingerprints                          |
| Full pgTAP                                          | PASS; 28 files, 1,375 assertions                                                  |
| Phase 7.29 concurrency                              | PASS; kill-switch, two-claim, ordering and handover races                         |
| DB lint                                             | PASS with no Phase 7.29 issue; four pre-existing unused-parameter warnings remain |
| Phase 0-7.29 non-live regression                    | PASS; 63 groups                                                                   |
| Phase 7.29 Edge/token tests                         | PASS; 4 tests                                                                     |
| Presenter browser contract tests                    | PASS; 8 runtime and 5 static tests                                                |
| Targeted Presenter E2E flag ON                      | PASS; Chromium and WebKit, 2 tests                                                |
| Targeted Presenter E2E flag OFF                     | PASS; Chromium and WebKit, 2 tests                                                |
| Full Demo browser regression                        | PASS; 40 passed, 60 mode-gated skips across desktop/mobile Chromium/WebKit        |
| Accessibility and visual contract within Demo suite | PASS                                                                              |
| TypeScript app and E2E type checks                  | PASS                                                                              |
| Production build                                    | PASS                                                                              |
| Generated database type drift                       | PASS; deterministic and current                                                   |
| npm dependency audit                                | PASS; zero vulnerabilities at audit time                                          |
| Secret scan                                         | PASS; all tracked and untracked non-ignored paths considered                      |
| `git diff --check`                                  | PASS                                                                              |

`oxlint` exits successfully. It reports two existing `AdminPage` exhaustive-deps
warnings for `refreshLectures` and `refreshAdminPolls`; neither is introduced by
Phase 7.29 and neither is an error-level gate failure.

## Load result

The 60-minute representative envelope uses 120 stable page changes, 240
15-second Bridge heartbeats and 720 five-second Admin status checks: 1,080
Presenter Edge calls total. The server caps logical page commits at five per
second. The model adds zero student requests, zero student Realtime
subscriptions and zero OpenAI calls; it is invariant between 20 and 300
participants. Same-page observations do not increment live-state versions.

## Remaining blocking gates

- Build and test a code-signed per-user artifact without weakening Windows
  Application Control; verify SmartScreen, update, rollback and uninstall.
- Test Office x86/x64 and supported builds, COM release, PowerPoint restart and
  at least 500 physical next/back/jump transitions.
- Verify Edge and Chrome production HTTPS Origin to `127.0.0.1`, PNA preflight,
  hostile-site rejection and manual recovery on the real machine.
- Measure native STA shutdown, retry/backoff, CPU/I/O and crash-dump behavior.
- Run the venue Extend-display layout with windowed PowerPoint and Presenter
  View disabled, followed by teacher UX approval.
- Apply migration and Edge code only in a hosted change window with all gates
  OFF; then run Advisor, real cleanup scheduling, two-Admin separation and
  monitored rollback before any cohort activation.

Until those items pass, Phase 7.29 must remain excluded from production
activation even though its automated web/database Local Gate is PASS.
