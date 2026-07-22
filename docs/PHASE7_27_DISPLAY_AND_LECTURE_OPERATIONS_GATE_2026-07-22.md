# Phase 7.27 Display and Lecture Operations Gate — 2026-07-22

## Decision

- Local application, database and browser gate: **PASS**.
- Public Pages rollout: **PENDING** until the candidate commit is published and
  the deployed routes are checked.
- Real microphone and paid OpenAI provider quality: **HUMAN GATE**. No paid
  canary was executed during this repair.
- Journal Club production run: **not created by this gate**.

## Repair scope

- `/display` no longer depends on a student join session. A fresh classroom
  browser can consume an Admin-issued, lecture-bound display token directly.
  Missing, expired or invalid tokens remain fail-closed on `/display`.
- Display captions render as a compact, maximum two-line strip immediately
  below the PDF and disappear when no completed caption is available.
- The Admin PDF panel exposes persistent one-click previous/next controls and a
  page-number jump using the authoritative live-state page count.
- Starting a lecture selects that lecture in the conventional Admin workspace
  and refreshes all six bound Journal Club Polls.
- Teacher-facing PDF wording is consistently `講義資料`; canonical document and
  storage identifiers are unchanged.
- No migration, RLS policy, Edge Function, Worker or R2 object change is needed
  for this repair.

## Backend and regression evidence

- Clean migration from zero through `20260722012313`: PASS.
- Full pgTAP: **24 files / 1,171 assertions / 0 failures**.
- Phase 7.27 two-connection idempotency, production uniqueness, rehearsal
  isolation, single-open-run and Poll-open races: PASS on a clean database.
- The concurrency harness now reports the required clean-database precondition
  instead of presenting a dirty-fixture rejection as a product race failure.
- Journal Club real-DB browser integration: all six Polls opened, accepted one
  participant-owned response and closed in sequence; at most one Poll remained
  open and the production run count stayed zero.
- Fresh-browser Display lifecycle: PASS in Chromium, WebKit and mobile Chromium.
- Phase 7.27 flag-on browser suite: **28 PASS / 4 intentional skips** across
  Chromium, WebKit and mobile configurations.
- Full demo browser suite: **40 PASS / 52 flag-specific intentional skips**.
- Non-live Phase 0–7.27 suite: **55/55 groups PASS**.
- TypeScript application and E2E checks, production build, generated DB type
  drift, production static/CORS checks, secret scan and `git diff --check`: PASS.
- Lint: zero errors and two pre-existing Admin hook dependency warnings.
- DB lint: zero errors and four compatibility-signature unused-parameter
  warnings.

## AI and caption operation

- Material analysis and Poll proposals, five-minute summaries, comment dynamics
  and evidence-grounded academic answers remain implemented behind the existing
  lecture, budget, concurrency, idempotency and API-PIN controls.
- Five-minute summaries require one API-PIN authorization at start; each later
  five-minute window does not ask again.
- Realtime captions remain a dedicated explicit start. Selecting
  `講義終了まで` requires one API-PIN authorization for the lecture instead of
  the ten-minute default being restarted repeatedly.
- The mic-to-OpenAI-WebRTC-to-completed-caption-to-five-second-snapshot path is
  present. Audio is not persisted; only completed text is published. Real
  microphone permission, acoustic quality and provider latency remain the human
  gate.
- The Admin browser that starts summaries must stay signed in and open during
  the lecture. A changed Admin session cannot take ownership of the old run;
  audited recovery-stop-and-restart is tracked as a separate P0 hardening task.

## Approved master authorization UX

The future master CTA has exactly two choices:

1. `字幕を除くAI機能を講義終了まで許可`
2. `字幕を含むすべてのAI機能を講義終了まで許可`

This is authorization, not execution. It must not retain the PIN in the browser,
start a provider call, reserve budget or request microphone access. A server-side
authorization must be bound to the lecture, Admin actor, exact feature set and
hard stop. Every actual action must still mint a short-lived, single-use child
grant and pass the existing lifecycle, budget, concurrency and idempotency
checks. Even the second choice keeps caption duration, language, start CTA and
browser microphone permission explicit. Because this requires a new audited
authorization model, it is intentionally not mixed into the day-before Display
repair.

## 40–50 device / 60-minute capacity decision

- Supabase and Cloudflare Free remain **GO**; an immediate Pro upgrade is not
  justified by the measured database latency or estimated request volume.
- Conservative 50-device estimate: about 37,450 student API requests, about
  45,000 with 20% headroom, averaging 10.4 requests/second; about 2,700 Edge
  calls, 900 PDF Worker requests and 277–291 MiB of PDF transfer.
- The operational risk is anonymous Auth, not database capacity. Supabase's
  same-IP anonymous sign-in burst can reject a cold 40–50-device join. Pre-warm
  the primary 20 devices, stagger the remaining sessions and distribute phones
  to cellular data where possible. A participant should vote from one device.
- Changing to Pro does not by itself remove the anonymous same-IP burst limit.

## Rollback

1. Restore the previous Pages deployment recorded in
   `PHASE7_27_PRODUCTION_GATE_2026-07-22.md`.
2. Revert only the frontend repair commit; do not drop additive database schema.
3. Existing Admin-issued display tokens remain short-lived and may simply be
   allowed to expire.
4. No R2 object or hosted database rollback is required for this frontend-only
   release.
