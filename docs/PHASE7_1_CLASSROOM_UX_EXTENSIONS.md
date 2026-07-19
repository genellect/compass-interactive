# Phase 7.1 Classroom UX Extensions

Date: 2026-07-19
Status: locally implemented; automated local gate PASS, human gate HOLD

## 1. Objective and boundaries

Phase 7.1 adds three small classroom affordances without increasing periodic
Supabase load or multiplying paid AI work:

1. teacher-controlled or deterministic summary language;
2. ownership-safe `みんな / 自分` comment history;
3. locally generated lecture join QR in Admin and open Display.

It does not add a student profile, Realtime subscription, QR object, source
text column, external QR service, language-detection model call, OpenAI live
test, hosted migration, flag enablement, push or deployment.

## 2. Requirements traceability

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| `auto / ja / en`, default auto | additive `lecture_ai_control.summary_language`; Admin select | pgTAP defaults/checks; Admin E2E | PASS |
| Manual choice authoritative | each newly inserted window snapshots the control value | pgTAP prior/future window isolation | PASS |
| Transcript then PDF auto resolution | pure deterministic Unicode-script signal; comments excluded | ja/en/mixed/PDF/default unit tests | PASS |
| One call per window | language resolution occurs before the existing request and preserves the Phase 6 prompt idempotency key | static provider endpoint count, pgTAP idempotency | PASS |
| Resolution audit | immutable resolved language/reason/time on window | pgTAP mismatch, actor and replay tests | PASS |
| `みんな / 自分` | history-only tabs; mine loads on first selection | Demo and local browser E2E | PASS |
| Server ownership | v3 RPC derives participant from `(select auth.uid())` | two-user pgTAP and unaffiliated user denial | PASS |
| No new periodic load | no interval/subscription/profile row; cursor requests are user-driven | static/load test and 5.5-second E2E request-count check | PASS |
| Local canonical QR | same-origin `/join?code=######` SVG | independent `jsQR` decoder and browser canvas decode | PASS |
| Admin/Display lifecycle | selected open Admin lecture only; open Display only | local lifecycle E2E including close | PASS |
| Real phone camera | physical device scan | human action | HOLD |

## 3. Summary-language design

`summary_language` is future configuration. A before-insert trigger copies it
to `lecture_summary_windows.requested_language`. Serial lecture-row locking in
the existing window admission and configuration paths ensures a concurrent
change resolves to one clear order. Existing window rows are never rewritten.

For `auto`, the Edge Function examines only normalized teacher transcript text
for the target window. If it has insufficient signal, it examines the bounded
current PDF context; if both are insufficient it uses Japanese. Mixed sources
choose the greater Japanese/English signal and record that the source was
mixed. Student comments can influence the existing comment pulse but never the
summary language decision.

The resolved language and reason are recorded while the window is `running` or
`skipped`, bound to the run actor and immutable after the first successful
record. A matching retry is idempotent; a conflicting retry fails closed. The
OpenAI request then receives one explicit output-language instruction. There is
no second language-classification or bilingual request.

The Phase 6 prompt-version key is deliberately preserved. Changing that key
would make an already completed five-minute index eligible for another paid
attempt under the existing unique contract. Language metadata supplies the new
audit dimension without weakening per-window cost idempotency.

## 4. Own-comment design

`public.get_lecture_comment_history_v3` is a `SECURITY INVOKER` wrapper. Its
fixed-path private primitive requires `auth.uid()`, verifies lecture read access
and resolves the participant by `(lecture_session_id, auth_user_id)`. The
browser supplies only lecture, cursor, bounded limit and `all / mine` scope.

`mine` responses omit `participant_id`. A partial
`(lecture_session_id, participant_id, created_at desc, id desc)` index covers
visible cursor scans. The page requests the first mine page only after the user
selects `自分`; subsequent requests occur only on the explicit older-comments
button. Demo filters its in-memory comments and performs no network request.
Legacy v2 RPC behavior remains available for old clients and for the flag-OFF
frontend.

## 5. QR design

The frontend validates an exact six-digit code, constructs a URL with the
platform `URL` API and creates an SVG with the pinned local `qrcode` package.
The component uses a data image allowed by the existing CSP. It does not use
`dangerouslySetInnerHTML`, network fetch, Supabase, Worker, R2 or browser
persistence.

Admin displays the QR only for the selected open lecture. The Display fragment
carries the public lecture code beside the existing scoped Display token; the
fragment is captured before removal and the token is never encoded into the QR.
Closed state removes both QR instances. Display initialization additionally
blocks student snapshot fallback until its operator credential is ready.

## 6. Failure behavior

| Failure | Result |
| --- | --- |
| Invalid language or reason | server returns validation error; prior configuration/metadata remains |
| Closed/expired lecture | configuration and paid generation remain rejected by canonical lifecycle checks |
| Language metadata RPC fails | provider request is not started |
| Ambiguous provider result | existing Phase 6.8 conservative accounting/no automatic replay applies |
| Unauthenticated/unowned mine request | permission error or null; no rows leak |
| Invalid/partial cursor | request is rejected |
| QR library/render error | public six-digit code remains visible; no external fallback |
| Missing code from an older Display launcher | Display remains compatible and simply omits QR |
| Display credential not ready | operator sync waits; it never falls back to participant RPC |

## 7. Supabase and API cost

- Existing five-second snapshots remain 21,600 calls for 20 students and
  324,000 for 300 students over 90 minutes.
- Phase 7.1 adds zero periodic reads, writes or Realtime subscriptions.
- A student who opens `自分` adds one bounded RPC plus one per explicit older
  page. No preference or read-tracking row is written.
- QR work is local CPU only and stores zero bytes in Supabase/R2.
- Language resolution is local Edge computation and retains at most one
  existing summary provider attempt per five-minute window (18 windows).

## 8. Migration, deployment and rollback

The migration is append-only: columns, constraints, trigger, index and new RPCs
are added; legacy RPCs and browser contracts remain. Existing rows receive safe
`auto` defaults. It creates no table and therefore adds no new RLS policy;
existing protected tables keep their RLS and table grants. Admin language RPCs
are service-role only. The public history wrapper is authenticated-only and
invoker-security; the fixed-path ownership primitive has the minimum matching
grant.

Production order, when separately authorized:

1. backup and confirm no active migration incident;
2. apply the expand migration with both Phase 7.1 flags OFF;
3. deploy Edge Functions with server flag OFF;
4. run Advisor, DB lint, old-client and two-user ownership checks;
5. deploy frontend with client flag OFF;
6. enable server then client flag for a bounded canary;
7. verify Admin language, two-user mine history, Display QR and costs;
8. record hosted and human evidence.

Rollback first disables client and server flags and restores the prior
frontend/Edge version. The additive columns/index/RPCs remain dormant; dropping
them is a later contract migration only after old/new clients are retired.

## 9. Human gate

Before Phase 7.2 or production enablement, a human must scan Admin and Display
QRs with a real phone camera on the intended public origin, verify the code and
join target, confirm QR disappears after close, and review Admin/Desktop/Mobile
labels, focus and contrast in a representative classroom. This cannot be
claimed from an automated decoder alone.
