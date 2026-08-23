# Phase 7.28 Production Gate evidence (2026-08-01 JST)

## Decision

**Provisional Production Gate PASS authorized by the user on 2026-08-01.
Automated and hosted gates PASS; Human/paid-canary acceptance is deferred.**

Phase 7.28A remains recovery-only and OFF. Phase 7.28B was enabled in the
required DB runtime -> Edge -> frontend order. Phase 7.28C was enabled in the
required server admission -> frontend order. At the end of the change window
there were zero active lectures, Display bindings and AI master authorizations,
so activation itself started no student Realtime load, provider call or charge.

The user explicitly authorized the candidate to fast-forward into `main` under
this provisional decision. The deferred checks below remain mandatory evidence
for a later final, non-provisional Production Gate decision.

## Release identity and recovery points

- Candidate source: `690a68c9c64ce22d01cbd18e6a6693f112255e5f`
- Feature commit: `de549efde774e5765956f998fad8833348d252c4`
- Pre-release production commit: `429dfb11d58514332fc4340cce0499a3bd342f32`
- Annotated rollback tag: `production-pre-phase7-28-20260801`
- Previous immutable Pages deployment:
  `https://55a55828.compass-interactive.pages.dev`
- Pre-change DB backup directory (outside Git):
  `<private-backup-directory>\compass-interactive\phase7-28-20260801-003857`
- Backup SHA-256:
  - `schema.sql`: `8970f1b73803c96e7b939f4a51d08e3545440631cce9747b1f67cb371f339178`
  - `roles.sql`: `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd`
  - `data.sql`: `a48a9a867ebaf46b3dff99b81473f5dd601170f1fbddc8a510d1ebd606af7c1a`

`pg_dump` reported circular foreign-key relationships for a data-only restore.
Recovery must therefore restore schema first and use the documented
trigger-aware restore procedure; the dumps must not be treated as a one-command
data-only rollback.

## Pre-deploy verification

- Final CI run: `30649246895` - SUCCESS.
- CI covered production environment validation, production feature topology,
  58 non-live groups, clean migrations, populated upgrades, generated DB types,
  pgTAP, all concurrency/lock-order probes, DB lint, the Journal Club
  browser-to-Edge-to-DB flow, Chromium/WebKit/390px Display E2E, three-browser AI
  master E2E, lifecycle regression and Demo regression.
- Hosted DB transaction canary for 7.28B: PASS. The first UID claimed the
  private topic, retry was idempotent, a second UID was rejected, and unrelated
  private-Realtime access failed.
- Hosted DB transaction canary for 7.28C: PASS. One Admin held the authorization,
  a second Admin was rejected, master authorization created zero billing grants
  and zero usage rows, and free revoke succeeded.
- Both hosted canaries rolled back and left zero fixture lectures.
- Old immutable `/join/` and `/admin/` clients still rendered against the
  expanded production schema without horizontal overflow.

## Database rollout

The following additive migrations were applied with all Phase 7.28 flags OFF:

1. `20260731110507_phase7_28b_authorized_display_realtime.sql`
2. `20260731110753_phase7_28_ai_master_authorization.sql`

The production migration ledger contains all 30 migrations through Phase 7.28.
The new tables have RLS, no browser table grants, and are not added to the
student Realtime publication. Public control RPCs are `SECURITY INVOKER`; the
private Display access helper is `SECURITY DEFINER` with an empty fixed
`search_path`, explicit `auth.uid()` binding and a minimal grant.

The hourly cleanup job `compass-display-realtime-cleanup` is active at
`17 * * * *` and invokes `public.cleanup_display_realtime_sessions_v1()`.

## Hosted rollout sequence

| Stage                                | State | Immutable Pages deployment                       |
| ------------------------------------ | ----- | ------------------------------------------------ |
| Additive DB/Edge/frontend, A/B/C OFF | PASS  | `https://57f0cc5d.compass-interactive.pages.dev` |
| 7.28B DB runtime -> Edge -> frontend | PASS  | `https://f034bdc9.compass-interactive.pages.dev` |
| 7.28C server admission -> frontend   | PASS  | `https://f8d3d323.compass-interactive.pages.dev` |

The canonical site `https://compass-interactive.pages.dev` resolved to the
final `index-CnYz1M75.js` release asset after propagation. `/join/`, `/admin/`,
`/display/`, `/lecture/`, `/lecture/archive/` and `/lecture/comments/` all
rendered with no horizontal overflow.

Final flags:

- recovery preset creation: frontend OFF / Edge OFF;
- authorized Display Realtime: DB runtime ON / Edge ON / frontend ON;
- AI master authorization: Edge ON / frontend ON.

The seven changed/new Edge Functions are ACTIVE with JWT verification enabled:
`authorize-ai-start` v17, `broadcast-display-caption` v3,
`claim-display-realtime-session` v3, `issue-display-session` v14,
`issue-pdf-access-token` v18, `manage-lectures` v20 and
`operator-live-snapshot` v14.

## Rollback drills

The hosted 7.28B drill atomically disabled the DB runtime gate, drained exactly
one active fixture binding, retained same-UID five-second snapshot fallback,
rejected a different UID, proved retry idempotency and proved that re-enabling
did not resurrect a revoked binding. The transaction was rolled back and the
production runtime was then enabled deliberately.

The hosted 7.28C drill created a pending child grant without a provider call,
drained the master to zero, revoked the child, proved retry idempotency and
rolled back. It created no usage ledger row.

Incident rollback order remains:

1. 7.28B: DB runtime OFF first; verify active bindings zero and safe fallback;
   then Edge and frontend OFF.
2. 7.28C: server admission OFF first; drain masters and stop admitted work;
   then frontend OFF. Direct-PIN compatibility resumes after masters are
   terminal.
3. Do not drop additive tables or functions during incident response.

## Final automated hosted checks

- Production state: Display runtime ON; active lectures 0; active Display
  bindings 0; active AI masters 0; hosted fixture lectures 0.
- Linked DB lint: exit 0, errors 0. Existing warnings are four unused
  compatibility parameters in snapshot functions.
- Supabase Security Advisor: 50 INFO, 7 WARN, 0 ERROR/HIGH.
  Six warnings describe the intentional anonymous-auth policy surface,
  including the private Display policy that still binds the exact
  `auth.uid()` through the private helper. The remaining warning is hosted
  leaked-password protection.
- Supabase Performance Advisor: 62 INFO-only unused-index observations,
  0 ERROR/HIGH. Newly added empty-table indexes are expected to remain unused
  before live traffic.
- Student Realtime topology remains unchanged: the student clients use the
  five-second snapshot protocol; only one claimed classroom Display may add one
  private Realtime connection per lecture.

Advisor references:

- <https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins>
- <https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection>

## Deferred human and bounded paid-canary gate

Before replacing the provisional decision with a final Production Gate PASS,
complete all of the following in the canonical production site:

1. Sign in to Admin without sharing the PIN in chat, start a disposable lecture
   and issue one Display link.
2. Open the Display in a second browser, confirm first-browser claim, real-time
   PDF page movement and bounded caption rendering; confirm students remain on
   the five-second path.
3. Confirm another browser/UID cannot reuse the same Display token, and ending
   the lecture terminates the Display and subscriptions.
4. On a real phone, verify `/join/`, lecture, archive and comments layout,
   keyboard focus and readable controls.
5. Authorize `all_except_captions`, confirm no operation starts automatically,
   start one minimum-cost summary operation, then stop without another PIN.
6. If real microphone validation is accepted in this gate, authorize
   `all_including_captions`, grant browser microphone permission, start and stop
   captions explicitly, and confirm the free stop/drain path.
7. Review Supabase Realtime connections/messages, Edge errors, AI usage ledger
   and OpenAI usage after the canary. Record the actual charge and ensure all
   active masters/bindings return to zero.

Until these checks are accepted, the deployed feature and its `main` integration
remain a reversible, provisionally accepted production release rather than a
formally completed Production Gate.
