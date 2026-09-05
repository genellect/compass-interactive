# Final Lecture UX Requirements and Fast Production Release Plan

Status: Planned — requirements approved; implementation and Production evidence pending
Scope: Educator authentication, lecture preparation and control, classroom Display, PDF delivery, optional Presenter UX, verification, and direct Production release
Approval: Final requirements and the three-stage execution model approved by the product owner on 2026-08-25
Baseline: `origin/main` at `ff5c11c57674fef57ff360adebe57a2ffcd96491`
Last verified: 2026-08-25

## 1. Authority and intended outcome

This document is the canonical contract for the approved lecture UX correction
and Production-completion lane. Every agent that plans, implements, reviews,
tests, integrates, or releases any part of this lane must read it before acting.

For this bounded lane, this document supersedes contrary older design text about:

- a two-minute Display link, pairing code, CLI, PWA, native launcher, automatic
  cross-browser launch, or a second Admin login for Display;
- a personal four-digit AI PIN or repeated TOTP prompt during ordinary lecture
  AI activation;
- hiding valid pre-start Poll and AI preparation behind an open-lecture-only UI;
- treating the later Phase 7.33 commercial certification as a prerequisite for
  deploying these bounded corrections to the existing Production environment;
- creating a separate review-only Production-equivalent environment for this
  release; and
- running full or paid CI once per small correction.

The target outcome is a simple teacher flow:

```text
Google sign-in and one TOTP challenge when required
  -> upload and publish lecture material
  -> prepare Polls and arm AI before class
  -> start lecture
  -> operate slides from a persistent transport bar
  -> copy one Display URL into a different browser
  -> see slides, comments, Polls, captions and summaries update in real time
  -> close lecture and revoke all lecture-scoped authority immediately
```

Passing this lane proves the corrected core lecture UX on one exact Production
SHA. It does not claim multi-tenant, commercial SLA, legal, signed Presenter
installer, or unified Phase 7.33 certification.

## 2. Three execution stages

### Stage 1 — requirements and execution documentation

Stage 1 is complete only when:

- this document is present and linked from `AGENTS.md`, `PROJECT_GUIDE.md`,
  `docs/README.md`, `docs/ROADMAP.md`, and
  `docs/AGENT_EXECUTION_ROUTING.md`;
- the approved requirements, implementation order, agent ownership, test
  routing, complexity boundary, release sequence, and completion states are
  unambiguous;
- the exact source baseline and current repository visibility are recorded;
- documentation validation passes locally; and
- no application, database, Hosted, paid-provider, or Production mutation has
  been performed as part of Stage 1.

### Stage 2 — code implementation

Implement the work packages in Sections 7 through 14 on one integration branch.
Use existing components, tables, Edge adapters, lifecycle timestamps, snapshot
versions, and deployment topology wherever possible. Do not introduce a new
service or parallel protocol merely to avoid editing an existing boundary.

### Stage 3 — fastest safe Production release

After source and exact-head acceptance, release in dependency order:

1. additive database expansion;
2. backward-compatible Edge Functions;
3. the Cloudflare Pages frontend;
4. one short Production canary covering the complete browser path; and
5. immediate rollback or repair-forward if a stop condition occurs.

No separate review environment is required for this bounded release. Production
deployment is in scope after the gates in this document pass. A new charge,
budget-ceiling change, destructive operation, secret exposure, or material
complexity expansion still requires separate explicit approval.

## 3. Global implementation rules

1. **Use the simplest implementation.** Reuse the current lifecycle, session
   ledger, Display session table, private Realtime topic, snapshot RPC, PDF
   protocol, and deployment targets.
2. **Do not run unnecessary paid or long CI.** Complete focused local checks,
   batch the corrections, freeze one candidate head, and request the required
   full workflow once.
3. **Do not use push-per-fix iteration.** A source failure is corrected and
   revalidated locally before the next push. A same-head rerun is allowed only
   once for a classified runner transient.
4. **Do not weaken authorization for UX convenience.** Remove false lockouts and
   redundant prompts while keeping server-authoritative membership, ownership,
   AAL2, lifecycle, policy, budget, concurrency, and idempotency checks.
5. **Use expand-first database changes.** Do not down-migrate Production during
   an incident. Leave additive columns/functions in place and repair forward or
   roll back the frontend/Edge revision.
6. **Do not add a long-lived OFF state for a required lecture function.** Any
   temporary rollout gate must be enabled in the same approved release after its
   dependency is present. A required feature may not silently remain OFF.
7. **Preserve basic lecture operation during AI failure.** PDF, comments, Polls,
   slides, Display fallback, stop, close, revoke, and downgrade remain usable.
8. **Keep secrets and content out of evidence.** Do not record tokens, OAuth
   values, TOTP codes, PINs, lecture codes, PDF content, comments, prompts, or
   private URLs in logs, screenshots, CI artifacts, or documentation.
9. **One writer owns shared code.** Parallel agents use separate worktrees or are
   read-only. The controller alone integrates shared migrations, commits, PRs,
   merge, Hosted changes, and release decisions.
10. **Refresh current Supabase guidance before Supabase edits.** Check the
    changelog and the relevant Auth, MFA, RLS, Realtime, and Edge documentation.

## 4. Complexity approval boundary

The approved work packages below may proceed without another design approval
when they stay inside the existing architecture and use additive changes.

Stop with `COMPLEXITY_APPROVAL_REQUIRED` before any of the following:

- a new hosted service, message broker, database, identity provider, or browser
  extension;
- a second Display pairing/token protocol instead of extending the existing
  Display session and claim flow;
- destructive migration, table rewrite, inferred ownership backfill, downtime,
  or a contract migration that cannot be kept backward-compatible;
- storing a long-lived Admin bearer in ordinary `localStorage`;
- replacing the Cloudflare PDF delivery protocol rather than adding bounded
  recovery around it;
- signed native installer distribution, code-signing purchase, PowerPoint
  device activation, or a new Presenter gateway;
- weakening the main ruleset, required checks, RLS, ownership, AAL2, lifecycle,
  paid-operation limits, or audit boundary;
- a new CI or cloud charge, or a budget-ceiling increase; or
- work outside COMPASS Interactive source, its existing Supabase/Cloudflare
  deployment, GitHub integration, or the approved test authentication path.

Before stopping, the agent must first show why the existing architecture cannot
meet the requirement, the smallest unavoidable expansion, affected surfaces,
cost/time impact, rollback, and a simpler rejected alternative.

## 5. Agent reasoning and ownership policy

Only two execution profiles are allowed for this lane.

| Profile            | Use                                                                                                 | Ownership                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `xhigh`            | Bounded implementation or deterministic tests in one established component                          | One write-capable agent on an isolated branch/worktree               |
| `ultra + subagent` | Cross-cutting Auth/RLS/lifecycle/Realtime, concurrency, Production integration, or final acceptance | One Ultra controller; independent subagents are read-only by default |

Do not use a lower reasoning profile merely to save tokens. Do not use Ultra as
only a stronger single-agent slider: its purpose here is to reconcile genuinely
independent evidence and reviews.

### Recommended roles

| Role                                       | Profile                    | Responsibility                                                                                                             |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Integration and release controller         | `ultra + subagent`         | Requirements, dependency order, shared schema, integration, exact-head acceptance, PR/merge, deployment and final decision |
| Admin identity implementer                 | `xhigh` under Ultra review | Login admission, session restoration, OAuth routing, rate-limit UI and tests                                               |
| Display authorization/Realtime implementer | `xhigh` under Ultra review | Capability lifetime, claim/recovery, event coverage, ACK/heartbeat and fallback                                            |
| Teacher UX implementer                     | `xhigh`                    | Pre-start Poll/AI state, stable navigation, persistent transport and concise UI                                            |
| PDF/Display rendering implementer          | `xhigh`                    | Delivery recovery, render quality, responsive projector layout and tests                                                   |
| Independent security reviewer              | Ultra subagent, read-only  | Auth/RLS/token replay/cross-lecture/session/lifecycle negative review                                                      |
| Independent UX/reliability reviewer        | Ultra subagent, read-only  | Complete browser flow, timing, recovery, viewport and regression review                                                    |

Subagents do not deploy, change budgets, read secret values, merge, or approve
their own work. The controller records each handoff as files changed, tests run,
omissions, risks, and exact commit SHA.

## 6. Fixed architectural decisions

### 6.1 Display URL lifetime

The Display URL and claimed Display session are valid only while all are true:

```text
lecture.status = open
lecture.closed_at is null
server_now < lecture.hard_stop_at
Display session is not revoked or replaced
```

`hard_stop_at` is the existing lecture end contract and is no later than 90
minutes after `started_at`. Closing the lecture revokes the Display immediately.
There is no separate 2-, 60-, or 90-minute Display timer.

### 6.2 Display launch UX

The educator sees:

1. `画面共有を開始`
2. `教員画面とは別のブラウザでDisplayを開き、ウィンドウを拡張画面へ移動してください。`
3. `URLをコピー`
4. `コピーしました。ChromeまたはEdgeのアドレスバーに貼り付けて開いてください。`

The first action issues and caches one URL. Repeated copy uses the same URL.
Only an explicit `新しいURLを発行` replaces and revokes the prior session.
The raw URL is hidden by default.

Opening the link in a different browser performs anonymous Display Auth, claim,
private Realtime subscription, initial snapshot, first render, and ready ACK.
It then removes the secret fragment with `history.replaceState`. No CLI, pairing
code, PWA, native launcher, automatic cross-browser opening, or Admin login is
used.

After claim, the server binds the session to that anonymous Display UID. The
same browser profile may reload and recover. A different UID cannot steal the
claimed session. Loss of the browser profile requires `新しいURLを発行`.

### 6.3 Synchronization policy

- Display low-latency target: p95 at or below one second.
- Display fallback: authoritative snapshot at five seconds; recovery is
  automatic and does not require a new URL.
- Student-to-student comment visibility: p95 at or below five seconds using the
  existing efficient snapshot/delta path.
- Realtime messages carry identifiers, kind, and monotonic version, not comment
  bodies, tokens, PDF text, or AI content.
- The Display fetches the authoritative snapshot after a version event.
- A server send ACK is not a render ACK. `表示同期済み` requires the Display's
  applied version/page to match the educator's authoritative state.

## 7. Work package A — Admin authentication correctness

Profile: `ultra + subagent`

Primary files include `src/pages/AdminRoute.tsx`,
`src/lib/adminAuth/adminAuthStorage.ts`,
`src/lib/adminAuth/adminSupabaseClient.ts`,
`supabase/functions/admin-identity-session/index.ts`, and the current Admin
identity migrations/tests.

Implementation steps:

1. Give one Google-to-TOTP login one logical login/request identity.
2. Charge the admission budget once. Begin/complete membership and factor checks
   are read-only revalidation, not new successful admissions.
3. Count failed or abusive attempts rather than accepted internal steps. Preserve
   a bounded failure limit and server-side `Retry-After`.
4. Classify Supabase Auth `429` separately from an invalid six-digit code. Disable
   resubmission until the stated retry time.
5. Add a server-bound restore action tied to the same live Supabase `session_id`,
   principal, membership, verified factor-set version, origin, and eight-hour
   absolute cap. It may reissue the opaque application session but may not store
   a long-lived bearer in ordinary local storage.
6. If restoration authoritatively rejects the identity/session or only stale
   Supabase state remains, clear the partial state and show the Google CTA.
   Temporary network/relay failures and HTTP 408/429/5xx must retain the
   server-bound recovery proof and offer connection retry, honoring Retry-After,
   without another Google or TOTP challenge. Do not show a bare TOTP screen.
7. Start OAuth with account selection (`prompt=select_account`).
8. Ordinary lecture and AI actions use the valid AAL2 application session and
   do not request a PIN or another TOTP.
9. OAuth error returns at the canonical site root must reach the educator
   portal, not the student Join page. Show a fixed, concise expiration/cancel
   message, retain the bounded invitation/return context, and remove raw error
   details from the URL. Never treat an expired provider state as a successful
   login or automatically start another OAuth flow.
10. For rare Owner ledger and AI-policy mutations, preparing the exact intent
    and displaying the code input must not start the five-minute control proof.
    Begin that proof only after the user submits a six-digit code, immediately
    before fresh TOTP verification. Preserve the same intent, request ID and
    nonce through transport recovery; do not restart an already verified or
    authorized mutation. The server's five-minute, fresh-AMR, single-use and
    Owner-only checks remain unchanged. An idle confirmation screen, including
    a reload after ten minutes within a valid Admin session, must still complete
    with one submitted code.

Acceptance:

- one successful login creates one admission charge;
- ten consecutive successful login/restoration scenarios do not self-lock;
- invalid codes and genuine abuse remain bounded;
- `429` displays the correct wait state and does not encourage retries;
- valid under-eight-hour restart restores without TOTP;
- logout, backing Auth-session removal, membership invalidation, factor-set
  change, or eight-hour expiry requires Google plus TOTP again; and
- no remembered-browser or AI credential authenticates an Admin.

## 8. Work package B — pre-start lecture preparation and stable workflow

Profile: `xhigh`

Primary files include `src/pages/admin/adminPageViewModel.ts`,
`src/components/AdminWorkspace/TeacherWorkspaceNav.tsx`,
`src/pages/AdminPage.tsx`, and
`src/components/AdminWorkspace/AdminPollControl.tsx`.

Implementation steps:

1. Replace live-only `canShow` decisions with separate visibility and mutation
   capabilities.
2. Keep the four workflow steps visible: `準備`, `スライド`, `参加`, `AI`.
3. Permit Poll draft creation for a selected draft/open lecture. Keep Poll open
   disabled until the lecture is open.
4. Add a durable, non-billable `AI有効化予約` intent in draft state, reusing an
   existing configuration row if possible.
5. After lecture start succeeds, consume the armed intent idempotently through
   the existing AAL2 master-admission path. Arming itself makes zero provider
   calls and incurs zero provider cost.
6. If automatic admission fails, keep the lecture open, show an actionable AI
   retry CTA, and preserve all non-AI controls.
7. Remove stale end-of-lecture narration and other explanatory copy that does
   not change the next action.

Acceptance:

- Poll draft is creatable before start but not student-visible;
- AI can be armed before start with zero provider calls;
- starting the lecture activates the armed master once, without PIN/TOTP;
- all four steps remain understandable without hiding the workflow; and
- closed lectures do not become the default preparation surface.

## 9. Work package C — persistent lecture transport

Profile: `xhigh`

Extract one `LectureTransportBar` from the Slides-only panel and mount it above
the workflow panels.

It contains previous/current/next/direct-page controls, keyboard shortcuts,
`送信中`/`同期済み`, Display status/version, and Presenter handover. It remains
visible in Slides, Participation, and AI on desktop and mobile, respects safe
areas, and has no horizontal overflow.

Use one in-flight mutation with replace-latest behavior. Confirm success from
the server-returned version, not optimistic UI alone. Lift Presenter ownership
and manual-navigation lock to the stable parent so a tab unmount cannot revoke
or duplicate a Presenter connection.

Acceptance covers rapid page changes, all tabs, desktop/mobile sticky behavior,
keyboard access, server readback, Display applied-version ACK, Presenter lock,
and manual handover recovery.

## 10. Work package D — Display capability, recovery, Realtime, and status

Profile: `ultra + subagent`

Primary files include `src/pages/admin/useAdminDisplayLauncher.ts`,
`src/pages/DisplayPage.tsx`, `src/display/displayRealtime.ts`, existing
`display_realtime_sessions` migrations/tests, and the current Display Edge
Functions.

Use the simplest extension of the existing protocol:

1. Keep one active Display session per lecture.
2. Use the current `hard_stop_at`; do not add an independent expiry clock.
3. Cache the issued URL in the educator hook and replace it only explicitly.
4. Keep the existing token digest/JTI and anonymous UID binding.
5. Persist only recovery-safe Display metadata in a Display-specific client
   storage namespace; never share the Student or Admin client storage key.
6. Extend the existing Display session row with only the status needed for
   readiness and liveness, such as `connected_at`, `last_heartbeat_at`,
   `last_applied_display_version`, `last_rendered_page`, and
   `connection_generation`.
7. Add a small authenticated Display heartbeat/ACK Edge operation that rechecks
   the bound anonymous UID, active lecture, hard stop, and unreplaced session.
8. ACK after private subscription, initial snapshot, and first PDF/view render.
   Send coalesced ACKs after applied version/page changes and a low-frequency
   heartbeat while connected.
9. Expose a read-only Admin status operation. Poll it at a modest cadence; do
   not create a second Admin Realtime subscription solely for the badge.
10. Replace the educator-browser in-memory caption-topic registry with a server
    lookup of the active Display session, so an Admin reload does not stop
    caption delivery.
11. Emit one private `live_state_changed` event when the authoritative lecture
    live version changes. Include only lecture/session/version/change-kind/time.
12. On `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED`, dispose the channel, refresh
    anonymous Auth/claim as allowed, resubscribe with bounded backoff, and keep
    five-second snapshot fallback active.
13. Revoke and notify on lecture close, hard stop, session replacement, Admin
    session revocation, or applicable membership invalidation.

Admin status vocabulary is limited to `接続待ち`, `Realtime接続済み`,
`表示同期済み`, `再接続中`, and `終了`.

Acceptance:

- Edge educator copies a URL and an Admin-free Chrome Display claims it;
- the link remains claimable at minute 80 while the lecture remains open;
- close and minute 90 reject new claim and terminate the claimed Display;
- repeat copy does not replace the session; explicit reissue does;
- same-profile hard reload recovers; a different UID is rejected after claim;
- slide, comment hide/restore, Poll, caption, and summary update through the
  Realtime path with fallback available;
- Admin reload does not stop captions;
- socket interruption falls back and reconnects automatically; and
- `表示同期済み` is never shown before the first render or for a stale version.

## 11. Work package E — classroom Display layout and PDF rendering

Profile: `xhigh`

Primary files include `src/components/DisplayView/DisplayView.tsx`,
`src/components/DisplayView/SyncedPdfViewer.tsx`, and `src/App.css`.

Final layout:

- fullscreen root contains the persistent QR code and six-digit lecture code;
- remove projector-irrelevant badges, metrics, toolbars, eyebrows, and copy;
- slide uses approximately 75–80% of the canvas without an active Poll and
  65–70% with an active Poll;
- without a Poll, the rail prioritizes recent visible comments;
- with a Poll, Poll state/results are primary and recent comments remain
  secondary;
- captions use a high-contrast bottom safe area, at most two lines, with a
  responsive starting range of 28–52 CSS pixels;
- comments are sorted before limiting and only one active Poll is rendered; and
- QR/code stay visible in fullscreen.

Add `ResizeObserver`-driven PDF rerendering at actual CSS pixel size times DPR,
with a memory/pixel cap. Rerender on external-monitor movement, fullscreen, and
resize. Cache the `PDFDocumentProxy` and pre-render neighboring pages.

Validate 1920x1080, 1366x768, 1280x720, and 1024x768 with no overflow, clipped
controls, low-resolution canvas, unreadable captions, or QR disappearance.

## 12. Work package F — PDF delivery and publication recovery

Profile: `xhigh`; upgrade to `ultra + subagent` only if the existing protocol
cannot be preserved.

Primary files include `src/pdf/pdfDelivery.ts`,
`src/hooks/useBrowserPdfPublication.ts`, and `SyncedPdfViewer.tsx`.

Implement a bounded `PdfDeliverySession` around the current manifest, access
ticket, and Range protocol:

1. use `AbortController` and explicit timeouts;
2. retry network, 408, 429, and 5xx failures with capped jitter;
3. on a mid-document 401/403, refresh the access session/ticket and retry the
   failed chunk once;
4. cancel stale document/page requests after lecture or version change;
5. preserve the PDF document and neighbor renders across page movement;
6. show compact progress and automatic recovery before a manual retry CTA;
7. resume publication finalization with the same request ID and capped 30–60
   second backoff on online, pageshow, or reload; and
8. emit privacy-safe stage/status/document-version-hash telemetry only.

Separate delivery eligibility from AI extraction eligibility. A valid textless
or text-heavy PDF may be delivered while AI analysis is unavailable or
truncated. Corrupt, encrypted, over-15-MiB, or over-75-page documents remain
rejected.

Acceptance includes slow network, manifest/ticket timeout, mid-Range expiry,
429/5xx, committed-finalization recovery, reload, 15-MiB/75-page bounds, and
Chromium/WebKit behavior.

## 13. Work package G — optional PowerPoint Presenter boundary

Profile: `xhigh` for frontend hiding/onboarding; full activation is
`COMPLEXITY_APPROVAL_REQUIRED` and `ultra + subagent`.

The current native bridge is not a Production-ready user path. Until a signed,
immutable installer, real endpoint, update/rollback owner, supported Office
matrix, and device/human evidence exist, hide the dead Presenter CTA and keep
manual slide controls fully functional.

The later approved onboarding sequence is:

```text
未導入 -> Bridge起動済み -> PowerPoint確認 -> PDFとの組合せ確認 -> 同期中
```

Health-check loopback before issuing a server connection. Do not present a
pairing/recovery code when no installed bridge exists. A signed installer,
code-signing or device activation requires separate explicit approval and is
not a blocker for releasing the corrected core lecture UX.

## 14. Verification and CI economy

### Local-first rule

Run the narrowest deterministic checks while each package is being developed.
Do not run the complete matrix after every edit.

Minimum progression:

1. affected unit/static checks;
2. affected pgTAP/Edge tests for Auth or Display database changes;
3. targeted Playwright specs for the changed browser flow;
4. one integrated local lecture-cycle run across two browser contexts;
5. `security:secrets`, typecheck, lint, non-live tests, build;
6. the required exact-head CI once after all packages are locally green.

The integrated browser test must use real UI CTAs and cover educator, student,
and Display contexts. A direct API call is setup evidence, not UX acceptance.

### Required integrated browser path

```text
Google/TOTP login fixture
  -> select and publish PDF
  -> create Poll draft before start
  -> arm AI before start with zero provider calls
  -> start lecture and activate the master once
  -> copy Display URL and claim from a second browser context
  -> change slide and confirm rendered-version ACK
  -> submit a student comment and observe educator/other student/Display
  -> hide and restore the comment
  -> start/vote/close a Poll
  -> publish a synthetic/local summary and caption update
  -> interrupt Realtime, observe fallback, recover
  -> reload Admin and Display without losing the lecture
  -> close lecture and prove all scoped authority terminates
```

Provider-free fixtures are used until the final Production canary. CI must not
call paid AI, Hosted Supabase, Production R2, or Production Cloudflare.

### CI failure policy

- Inspect status first; do not watch indefinitely.
- Fetch only the first failing job log needed to classify the failure.
- Source failure: fix and validate locally, then push one new head.
- Proven runner transient: one targeted rerun at most.
- Budget/cap reached: do not change it without explicit approval.
- Do not weaken required checks or rulesets to shorten the path.

## 15. Fast Production release procedure

Profile: `ultra + subagent`

1. Freeze the exact candidate SHA and confirm the intended diff contains no
   unrelated files, secrets, artifacts, or private content.
2. Confirm local acceptance and the repository's required exact-head checks.
3. Merge through the protected PR path; do not push directly to `main`.
4. Observe automatic post-merge workflows. Do not manually rerun merely because
   squash merge produced a new main SHA.
5. Record the exact main SHA and current rollback revisions.
6. Apply only the reviewed additive Supabase migration to the existing
   Production project. Verify migration history, RLS/GRANT/function ownership,
   and advisors without displaying values.
7. Deploy only the affected backward-compatible Edge Functions.
8. Enable any required server runtime gate and verify that no required lecture
   feature remains OFF.
9. Build and deploy the same exact SHA to the canonical Cloudflare Pages
   Production project. Do not rebuild from an older checkout.
10. Run one bounded Production canary through the canonical host using separate
    educator, student, and Display browser profiles. Use a small owned PDF and,
    if required to prove AI, one capped provider operation only.
11. Verify login, PDF publication/viewing, pre-start preparation, lecture start,
    slide ACK, comment propagation, Poll, Display Realtime/fallback, AI result,
    reload recovery, close, and post-close denial.
12. End and clean up the canary lecture through normal product operations. Do
    not delete audit evidence or perform destructive database cleanup.

### Production stop conditions

Stop new rollout actions and use the last immutable Pages/Edge revision or
repair-forward if any occur:

- Admin login is unavailable or loops;
- unauthorized, cross-principal, cross-lecture, or cross-environment access;
- Display link replay by a different UID, failure to terminate on close/hard
  stop, or a false `表示同期済み` state;
- PDF publication or student viewing regression;
- duplicate/unbounded provider operation or provider activity after close;
- comments, Polls, slides, captions, summaries, or five-second fallback fail in
  the canonical browser path;
- migration, RLS, function ownership, secret, or Production-target ambiguity;
  or
- an unresolved Critical/High finding.

## 16. Completion states

Use exactly these states in handoffs:

- `REQUIREMENTS_FIXED`: Stage 1 committed locally and validation passed.
- `SOURCE_IMPLEMENTATION_IN_PROGRESS`: Stage 2 has started.
- `COMPLEXITY_APPROVAL_REQUIRED`: Section 4 boundary was reached.
- `LOCAL_ACCEPTANCE`: all affected local gates pass.
- `CI_EXACT_HEAD`: the frozen candidate SHA passes the required contexts.
- `PRODUCTION_READY`: exact SHA, rollback, and release dependencies are ready.
- `PRODUCTION_DEPLOYED`: DB/Edge/Pages exact-SHA deployment is complete.
- `PRODUCTION_VERIFIED`: the complete canonical-host canary passes.
- `HOLD`: a named blocking condition remains.

`PRODUCTION_VERIFIED` is the terminal success state for this lane. It is not a
Phase 7.33, commercial-readiness, or signed-Presenter certification.

## 17. Handoff format

Every write-capable agent returns:

```text
Baseline SHA:
Branch/worktree:
Work package:
Files changed:
Migrations/functions changed:
Focused tests run and result:
Full tests intentionally omitted:
Security/privacy review:
Known risk or complexity boundary:
Next exact action:
```

Do not claim a Hosted, Human, Device, CI, merge, deployment, or Production result
that was not directly observed for the recorded exact SHA.

## 18. 2026-08-25 completion re-freeze

This lane is complete only when one coherent Production release contains every
approved requirement and its canonical browser paths have been verified. The
required release scope is:

- the authenticated, separate-browser Realtime Display flow, including
  five-second fallback, recovery, and explicit synchronization ACK;
- PDF finalization recovery and reliable student PDF rendering;
- AI activation-intent protection against stale reads and lecture-close races;
- exact selection of the lecture returned by create and duplicate operations;
- the public English-lecture Demo Display at `/demo/display`, using only local
  demo data and making no Supabase, database, authentication, Storage, or
  Realtime request;
- the shared context-menu Developer CTA with the approved copy and canonical
  founder URL; and
- every previously approved lecture-UX correction included in the candidate
  source, with no required runtime, Edge, or feature gate left OFF.

Required evidence is one focused local acceptance batch, the required checks
for the frozen PR head, post-merge validation for the exact `main` SHA, ordered
Production rollout (migration, affected Edge Function, then same-SHA Pages),
and bounded canonical-host browser verification of educator, student,
authenticated Display, public Demo Display, and narrow/mobile paths.

A local implementation, passing local tests, PR, merge, CI artifact, partial
deployment, or deployed-but-untested route is not completion. Any missing,
disabled, or unverified required path remains `HOLD`; only
`PRODUCTION_VERIFIED` is terminal success.

## 19. Pause and resume contract

A pause does not relax Section 18 or convert any partial result into success.
On resumption, the controller must:

1. verify the latest clean local commit, the PR head, and the exact workflow
   run before taking any write action;
2. never rerun an obsolete failed head; reproduce and repair a source or
   contract failure locally, then push one validated successor head;
3. preserve the minimal-CI policy and avoid any duplicate paid or long-running
   check that is not required by the release contract;
4. continue through exact-head PR CI, protected merge, exact-main post-merge
   validation, ordered Production rollout, and canonical browser verification;
   and
5. retain `HOLD` until every required path in Section 18 is directly verified
   in Production and the state can truthfully become `PRODUCTION_VERIFIED`.
