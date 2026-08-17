# Phase 6.8 Security, Sessions and Timeout Design

Date: 2026-07-18
Status: locally implemented; default-OFF; production HOLD

## 1. Objective and non-goals

Phase 6.8 hardens the existing Phase 0-6.6 product without changing the
five-second student synchronization contract or granting a browser any new
authority. It covers Admin PIN abuse resistance, server-tracked Admin sessions,
closed-lecture resume, CSP, bounded Edge input, explicit deadlines and paid
provider ambiguity.

It does not deploy to Hosted Supabase or Cloudflare, enable a production flag,
rotate a production secret, run a paid OpenAI request, redesign the classroom
UI, add a student subscription or replace code plus Turnstile entry.

## 2. Requirements traceability

| Requirement                                | Implementation                                                                                           | Verification                                           | Status                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| User/network/global PIN limiting           | `admin_pin_rate_limits`, advisory-locked admission RPC, `verify-admin-pin`                               | pgTAP plus concurrent local Edge test                  | Implemented                 |
| Hash-at-rest Admin sessions                | `admin_sessions`, `_shared/adminToken.ts`                                                                | pgTAP, static secret scan, local Edge replay test      | Implemented                 |
| Individual/logout/all-session invalidation | `manage-admin-sessions`; PIN fingerprint rotation invalidates all old sessions                           | pgTAP and local Edge two-session tests                 | Implemented                 |
| Absolute/inactivity expiry                 | 8-hour absolute and 30-minute sliding idle deadlines, server time                                        | pgTAP boundary tests                                   | Implemented                 |
| Lecture resume token                       | ownership-safe claim RPC, issuer Edge Function, bounded browser storage                                  | pgTAP, Worker tests and local Playwright               | Implemented                 |
| Resume fallback and revocation             | code plus Turnstile fallback; lecture version invalidation                                               | Worker/pgTAP wrong-lecture, expiry and version tests   | Implemented                 |
| CSP                                        | enforced baseline plus stricter report-only policy in `public/_headers`                                  | static header test; hosted route inspection pending    | Partial production evidence |
| RPC and provider deadlines                 | snapshot/join/Admin/AI/WebRTC/OpenAI deadlines                                                           | static tests and local E2E                             | Implemented                 |
| Ambiguous paid-provider outcome            | durable request correlation, uncertain ledger state, conservative accounting, no automatic create replay | pgTAP and mocked provider tests                        | Implemented                 |
| Bounded Edge input                         | shared streamed byte limit and JSON content-type enforcement                                             | static scan/runtime tests and local Edge 413/415 tests | Implemented                 |
| No added student periodic load             | resume issuance occurs once after join; normal snapshots remain five seconds                             | code/load regression                                   | Implemented                 |

## 3. Admin PIN and session flow

1. Anonymous Auth supplies an authenticated user ID; role membership alone is
   never treated as Admin authority.
2. `verify-admin-pin` derives HMAC bucket identifiers for the Auth user, a
   trusted network only when the hosted proxy boundary is known, and a global
   bucket. Raw PIN and IP address are not persisted.
3. Admission is serialized with PostgreSQL advisory locks and consumes:
   user 8 attempts/10 minutes then 15-minute block; network 30/10 minutes then
   15-minute block; global 120/minute then one-minute block.
4. A successful PIN check creates an eight-hour signed token and stores only its
   SHA-256 hash with the Auth user, keyed PIN-version fingerprint and deadlines.
5. Every protected Admin call verifies the signature, user binding, PIN
   fingerprint, revocation and server-time deadlines, then updates activity no
   more than once per five minutes.
6. Logout revokes the server row before clearing browser state. Local state is
   cleared even when the revoke request times out. The session panel can revoke
   a selected device. PIN rotation makes every older fingerprint invalid.

Only `service_role` can access the two security tables and their admission/
verification functions. RLS is enabled and `public`, `anon` and `authenticated`
receive no table access. Admin tokens remain in `sessionStorage` and are never
logged or stored in plaintext by PostgreSQL.

## 4. Lecture resume flow

After a successful owned join, the frontend starts one best-effort call to
`issue-lecture-resume-token` without delaying navigation into the lecture. The
Edge Function revalidates the Auth user and calls a service-only ownership
helper; it cannot use browser-supplied ownership claims. The seven-day HMAC
token contains only audience, issued/expiry time, random JTI, opaque lecture
public ID and integer revocation version.

The browser stores at most ten valid entries in local storage. Archive entry
prefers a resume-token POST body. Failure is indistinguishable from an unknown
archive and falls back to lecture code plus Turnstile. The Worker looks up a
private `archives/by-public-id` index, compares version and expiry, then issues
the existing short-lived archive/PDF credentials. It never echoes the resume
token and cleanup removes the secondary index before the canonical object.

Incrementing `lecture_sessions.resume_token_version` invalidates old tokens and
requeues the sanitized archive export. The migration is compatible with older
archive payloads because the new fields are optional until exporter and Worker
capability are deployed.

## 5. Communication and provider failure states

| Boundary                               |                                 Deadline | Failure behavior                                                                                         |
| -------------------------------------- | ---------------------------------------: | -------------------------------------------------------------------------------------------------------- |
| Archive lookup before a live join      |                                5 seconds | abort challenge/fetch and continue to live join                                                          |
| Anonymous Auth session check           |                                6 seconds | bounded retryable error; no endless spinner                                                              |
| Anonymous Auth creation                |                               12 seconds | physically abort signup, reuse one in-flight request, allow a clean retry and reject late session writes |
| Live snapshot, terminal and join RPC   |                               12 seconds | client error/backoff; DB remains authoritative                                                           |
| Resume-token Edge call after join      |                   15 seconds, background | lecture navigation is never delayed                                                                      |
| Ordinary Admin/Operator Edge call      |                               15 seconds | bounded UI error; no endless spinner                                                                     |
| AI Edge call                           |                               65 seconds | Edge/provider ledger decides final accounting                                                            |
| Realtime start Edge call               |                               30 seconds | no browser-side automatic paid retry                                                                     |
| WebRTC offer/local/remote/data channel |                          12 seconds each | close peer/media resources and surface failure                                                           |
| OpenAI Realtime create/hangup          |                            20/10 seconds | correlate create; hangup stays idempotent                                                                |
| Batch provider work                    | existing 45/55 second provider deadlines | conservative failure accounting                                                                          |

Before a paid create, a UUID client request ID is persisted and sent in the
provider header. A timeout after transmission is an ambiguous result, not proof
that no work started. Realtime records `creation_outcome_uncertain`; Batch
records a correlated `provider_timeout_ambiguous` failure and retains the
conservative reservation. Automatic provider-create retry is prohibited.

## 6. CSP and input boundary

The enforced CSP denies unlisted sources, objects, embedding and foreign form
actions while allowing only the current application, Supabase HTTPS/WSS,
Cloudflare Turnstile/Worker and loopback Publisher boundaries. The stricter
report-only policy additionally rejects inline script attributes and requests
Trusted Types. Current React inline style use requires `style-src 'unsafe-inline'`
until a later scoped refactor. No reporting endpoint is configured, avoiding a
new token-bearing report sink.

All exposed Edge Functions use the shared bounded JSON reader. It rejects a
non-JSON content type with 415 and enforces the actual streamed byte count even
if `Content-Length` is absent or false. Each function retains its feature-
appropriate limit and generic external error handling.

## 7. Migration, compatibility and rollback

The migration is expand-first: it adds tables, columns, indexes and new RPCs;
it does not remove or change a Phase 0-6.6 RPC signature. New columns have
compatible defaults. Existing lecture/archive rows are upgraded to resume
version 1, and an archive reexport is triggered only by a later version change.

Production order, when separately authorized, is migration; Edge/Worker
capability and secrets with flags OFF; frontend with flag OFF; hosted lint,
Advisor, two-user and CSP route checks; then controlled canary. Rollback first
turns off `VITE_PHASE6_8_SECURITY`, `PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED`
and `PHASE68_RESUME_TOKENS_ENABLED`, restores the previous frontend/Edge/Worker,
and leaves additive schema/audit rows intact. No destructive down migration is
required.

## 8. Load and cost

Student polling cadence and snapshot shape are unchanged. Resume issuance adds
one Edge/RPC exchange per successful join, not a periodic request. Resume
archive access moves repeated re-entry away from code/Turnstile but still uses
the existing bounded Worker/R2 path. Admin session verification adds one
service RPC per Admin operation and amortizes the session-row write to at most
once every five minutes. PIN tables are bounded by fixed windows and cleanup.

No new OpenAI call exists. Client request correlation and no-auto-retry reduce
duplicate-charge risk; uncertain work is conservatively charged rather than
silently replayed.

## 9. Remaining production gates

- inspect real Pages response headers on every Join/Admin/Display/Archive/PDF
  route and confirm CSP/Turnstile/Publisher behavior;
- human review of Admin login, session revocation, live join, browser restart,
  archive resume/fallback and failure copy;
- deploy-time secrets, owners, monitoring and rollback thresholds;
- Hosted Supabase Advisor and two-user separation after expand-first migration.

These are blocking production evidence. They do not authorize a hosted change
from this local implementation task.
