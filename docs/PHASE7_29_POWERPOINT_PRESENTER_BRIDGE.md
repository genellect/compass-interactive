# Phase 7.29 - PowerPoint Presenter Bridge

Status: Implemented, verification pending; historical 7.29A/B rollout evidence
is retained, and Hosted, Store, Device and Human gates remain HOLD
Scope: optional Windows PowerPoint-to-PDF Presenter Bridge contract
Last reconciled with the Store release decision: 2026-09-06

This document remains the technical contract for reconciliation, trust,
authorization, failure and load boundaries. It is not the current publication
runbook. Microsoft Store MSIX is the only production native distribution path
for version 1. Follow
[`PRESENTER_PRODUCTION_RELEASE.md`](PRESENTER_PRODUCTION_RELEASE.md) and
[`PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md`](PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md)
for the current release order. The Direct Velopack EXE and anonymous update
feed are historical/development material and must not be published for this
release.

The 2026-08-01 automated web/database result is historical evidence from the
former local branch. The rescued GitHub implementation must pass its current
Cloud/CI/DB gates independently. All flags default OFF. Store certification and
signing, Device, Human and activation Production gates remain HOLD.

## 1. Outcome and boundary

Phase 7.29 lets a teacher advance a normal PowerPoint slide show and commit the
matching absolute PDF page to the existing COMPASS live state. It deliberately
does not reproduce PowerPoint animation, builds, notes or slide content.

- The classroom Display keeps its existing private Phase 7.28 Broadcast and
  authoritative snapshot refresh. It receives a committed PDF page promptly.
- Students keep the Phase 1 five-second snapshot protocol. No Presenter table,
  polling call, Realtime channel or payload field is added to the student path.
- PowerPoint and PPTX/PDF bytes stay on the teacher PC. PostgreSQL stores only
  bounded hashes, counts, lifecycle times and the last accepted absolute page.
- Local Publisher remains independent on port `43123`. Presenter Bridge uses
  the fixed loopback port `43124`.
- The integration is an optional native operating boundary, not a required
  condition for ordinary PDF navigation.

## 2. Initial supported operating mode

The first release accepts only the following configuration:

1. PowerPoint for Windows with one unambiguous active slideshow.
2. Normal all-slide show; no hidden slides and no Custom Slide Show.
3. Normal full-screen (`Speaker`) or windowed slideshow; Presenter View is off.
4. PPTX slide count equals the currently published PDF page count.
5. The teacher sees the PowerPoint name/count, PDF name/count and PDF first
   page, then explicitly confirms the binding.
6. Ordered PowerPoint Slide IDs and the PPTX file digest remain unchanged for
   the connection. Add, delete, reorder, hide or save-change stops sync.

Hidden-slide and Custom Show behavior are not approximated. They require a
later explicitly designed mapping contract.

The September release candidate extends the original windowed-only contract
to a normal full-screen show. Its source and device evidence are tracked in
`PRESENTER_PRODUCTION_RELEASE.md` and
`../presenter-bridge/DEVICE_MODE_VERIFICATION.md`. Kiosk and unknown modes are
rejected. A one-monitor test with the Presenter View setting on does not
establish two-monitor Presenter View acceptance; that restriction remains.

## 3. Source of truth and convergence

`SlideShowNextSlide` and related COM events are acceleration signals only. They
never carry the canonical page.

1. A COM event requests reconciliation.
2. The Bridge observes `View.Slide.SlideID` and the absolute `SlideIndex` after
   a short post-event delay.
3. A 200 ms monitor performs the same observation when events are missing.
4. The Core commits only a stable latest observation. Its outbound queue has
   one in-flight item and one replaceable latest-desired item.
5. The server accepts at most five page attempts per second, rejects stale or
   reordered sequence numbers, and maps PDF page to the absolute SlideIndex.
6. `admin_update_pdf_display_v3` remains the final live-state transition. Its
   tuple comparison means the same page does not increment display, PDF or
   state versions and therefore emits no redundant Display Broadcast.

COM access is isolated to one STA thread. Callback, HTTP and timer threads may
request reconciliation but must not use Office COM objects directly.

## 4. State model

```text
OFF
  -> pairing (Admin issues a 55-second automatic ticket and a separate
     five-minute manual recovery code)
  -> inspected (Bridge binds installation and deck metadata)
  -> confirmed (teacher confirms the shown PowerPoint/PDF pair)
  -> active (Bridge atomically consumes the ticket and receives capability)
  -> revoked (manual handover, expiry, close, Admin revoke, document/deck
              change, disconnect, replacement or runtime kill switch)
```

`revoked` is terminal. A new connection always uses new pairing material. The
one unrevoked connection per lecture constraint and row locks make retries and
two-browser races converge to one state.

## 5. Authentication and secret flow

### Browser to Supabase Edge

`manage-presenter-connection` requires:

- an allowed exact Origin;
- a valid Supabase bearer identity;
- a tracked, unexpired and non-revoked Admin session token;
- the matching lecture and published PDF.

Its actions are `issue`, `confirm`, `status` and `revoke`. The pairing ticket
and eight-character Base32 recovery code exist only in memory and are never
written to URL, browser storage or logs.

### Browser to loopback

The Bridge binds only `127.0.0.1:43124`. It requires exact Host and Origin
allowlists, bounded JSON, explicit preflight handling and Local/Private Network
Access acknowledgement. The browser never sends an Admin token, API PIN,
service role or long-lived credential to loopback.

### Bridge to Supabase Edge

`presenter-bridge-session` rejects `Origin` and `OPTIONS`. Pairing and active
authorization continue to use two dedicated HMAC capabilities:

- pairing: exact scope/audience/origin, maximum 60 seconds, one database nonce;
- active bearer capability: connection, lecture and declared-installation
  metadata bound, ending no later than the lecture/Admin hard stop and 95
  minutes after claim.

Every machine request is additionally signed by a per-Windows-user P-256 CNG
key that is signing-only and non-exportable. The proof binds the method, fixed
path, timestamp, random nonce and SHA-256 of the exact raw body. Edge verifies
the public-key fingerprint, at most 120 seconds of clock skew and the signature,
then atomically consumes the proof-key/nonce receipt. A copied capability alone
cannot authorize a request, and replay or body/key substitution is rejected.

A dedicated Cloudflare Presenter Gateway is the only allowed network path to
the machine Edge function. It forwards the signed raw bytes to one fixed
Supabase upstream, applies coarse location/network rate protection and injects
a separate server-only gateway secret. Direct Edge calls without that secret
are rejected. The Gateway has no R2, Admin, AI, PDF or service-role binding.

The signing secret is `PRESENTER_BRIDGE_TOKEN_SECRET`, a server-only value of
at least 32 bytes and independent of Admin, Billing, Display and PDF secrets.
`PRESENTER_BRIDGE_GATEWAY_SECRET` is an independent Worker-to-Edge secret and
never enters the native app. Only public proof-key material, HMAC/SHA-256
digests and bounded replay metadata are stored at rest.

The historical Gateway, proof-of-possession and five-minute manual
recovery-code design is recorded in
[`PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md`](PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md).
Its Direct/Velopack delivery and publication sections are superseded by the
Store release documents above and are not operator instructions for version 1.

## 6. Database and authorization

The migration is expand-only and creates:

- `private.presenter_runtime_gate`, initially `false`;
- `public.presenter_connections` for bounded session/binding metadata;
- `public.presenter_connection_events` for low-frequency content-free audit;
- service-role-only SECURITY INVOKER RPCs;
- lecture close, Admin revoke and PDF-binding-change revocation triggers.

Both public tables have RLS enabled, no browser policies, browser grants
revoked, and no Supabase Realtime publication membership. Public RPC EXECUTE is
revoked from PUBLIC, anon and authenticated. SECURITY DEFINER is limited to
fixed-search-path trigger functions that only revoke an already bound session.

All write and heartbeat RPCs recheck server time, runtime gate, Admin session,
lecture lifecycle, PDF binding, installation, deck hashes and capability even
if Cron or a trigger is unavailable.

Status and manual revoke may recover an older connection from a replacement
Admin session only when both sessions belong to the same verified Supabase
`auth.uid()`. Confirm, claim and page updates remain bound to the issuing
session. Another user receives no connection metadata. A server-time 45-second
heartbeat lease prevents an abandoned native process from fencing manual PDF
controls until the longer capability hard stop.

Lock order is fixed:

```text
runtime gate -> Admin session -> lecture -> live/PDF row -> Presenter row
```

The manual PDF update Edge uses a new wrapper only while the server feature is
enabled. An active Presenter connection returns a structured conflict. An
explicit `revoke` restores the legacy manual controls without requiring a paid
feature PIN.

## 7. Failure behavior

| Failure                                          | Safe convergence                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Bridge absent or Local Network permission denied | Pairing has a bounded timeout; manual PDF controls remain available.                                 |
| Browser closes or changes lecture during pairing | Best-effort local disconnect and server revoke run; server expiry remains authoritative.             |
| Bridge process disappears while active           | A fresh heartbeat lease fences writes; after 45 seconds manual navigation recovers safely.           |
| PowerPoint or slideshow disappears               | A bounded observation grace faults the Bridge, performs best-effort revoke and releases the fence.   |
| COM dispatcher stops or blocks                   | A bounded observation timeout faults the Bridge; heartbeat cannot keep a false-active session alive. |
| Event early, duplicate or missing                | Stable actual-state polling decides; events only accelerate observation.                             |
| Rapid jump                                       | Intermediate desired pages are replaced; only the latest stable absolute page remains queued.        |
| Network timeout                                  | Retry uses the same event ID; database replay is idempotent.                                         |
| Stale/reordered update                           | Rejected without advancing sequence or live-state versions.                                          |
| PowerPoint/PDF/deck mutation                     | Connection is revoked; no guessed page is sent.                                                      |
| Lecture/Admin expiry or revoke                   | Trigger and every RPC independently reject further commits.                                          |
| Runtime flag disabled                            | Database kill switch atomically revokes all unrevoked connections.                                   |
| Cleanup scheduler absent                         | Expired connections are never treated as active; bounded cleanup can be rerun later.                 |

## 8. Load and cost envelope

Local 200 ms observation produces no Supabase request. The Bridge sends only a
stable changed page, at most five attempts/second, plus a 15-second heartbeat.
For a representative 60-minute lecture with 120 page changes:

- 240 heartbeat calls;
- about 120 accepted page calls plus bounded retry overhead;
- 720 Admin status checks at the existing five-second operator interval;
- 1,080 total Presenter Edge calls in the representative envelope;
- zero additional student requests or Realtime subscriptions;
- one existing Display Realtime connection;
- zero live-state writes and Broadcasts for same-page observations.

Presenter metadata is a few bounded rows per lecture. Revoked connections and
their audit events are eligible for idempotent bounded deletion after 30 days.
The feature makes no OpenAI request and has no OpenAI cost.

## 9. Historical rollout and current Store handoff

Phase 7.29B established an additive, fail-closed dormant baseline: the database
runtime gate stayed OFF, only the named JWT-protected browser functions were in
scope, the public machine endpoint and its secret were excluded, and the
frontend flag stayed OFF. That sequence is historical evidence, not the
version 1 activation procedure.

Current source pins the native client to the fixed Presenter Gateway hostname
and contains production Worker route/upstream configuration. Source presence
does not prove that the schema, named Edge functions, secrets, DNS or Worker are
deployed or correct in Hosted production. The Store runbooks above define the
required expand-first placement, certification interval, Store publication
hold, device acceptance and final activation order. Certification
uses the separately accepted global eligible-educator interval because reviewer
timing is unpredictable; the later classroom canary remains bounded. An
unscoped all-function deployment remains prohibited.

Rollback starts by disabling the DB runtime gate, which drains active sessions.
Then disable Edge admission and frontend. Manual controls and student five-
second snapshots remain the established fallback. The additive schema remains
in place; no emergency destructive down migration is used.

## 10. Gate separation

The former local branch recorded an automated web/database Local Gate with clean
and populated upgrade migrations, 1,375 pgTAP assertions across 28 files,
concurrency and cleanup checks, Edge/token tests, static native-contract checks,
Chromium/WebKit flag-OFF/ON behavior, the full demo regression, deterministic DB
types, secret scan and production build. It is historical and cannot clear the
rescued branch. The exact former evidence is recorded in
[`PHASE7_29_LOCAL_GATE_2026-08-01.md`](PHASE7_29_LOCAL_GATE_2026-08-01.md).

It cannot approve the following external boundaries:

- exact Partner Center identity, WACK, `runFullTrust` approval, Store
  certification/signing and Store acquisition without added authentication;
- Office x86/x64 and multiple supported Office build matrix;
- real HTTPS production Origin Local Network permission in Edge and Chrome;
- 500 physical PowerPoint transitions, restart and venue Extend-display drill;
- Hosted Supabase/Cloudflare rollout, Advisor and cleanup scheduling;
- teacher human confirmation of the PowerPoint/PDF binding UX.

Those remain Store/Device/Human/Hosted/Production Gate HOLD until recorded
separately. The current release source uses the fixed
`presenter-api.yuto-matsui.com` Gateway endpoint and includes a production route
configuration. Hosted DNS, Worker, Edge, secret and end-to-end evidence remain
separate HOLD items; the old `.invalid` endpoint and update-feed decision were
the historical 7.29B/C state, not the current Store distribution contract.
