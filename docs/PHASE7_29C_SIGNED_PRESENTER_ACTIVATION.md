# Phase 7.29C - Store Presenter activation contract

Status: **General Production HOLD; Store certification requires a separately
accepted, reversible global activation interval**

Approved contract date: 2026-08-09
Store revision date: 2026-09-06

Scope: the machine Gateway, per-install request proof, signed Windows delivery,
bounded recovery and the evidence required before Presenter activation

This document is the authoritative Phase 7.29C activation contract. It extends
the dormant Phase 7.29B placement without changing the existing Admin manual
PDF controls, Phase 7.28 Display transport or student five-second snapshot.
Source availability and automated local tests do not authorize a route,
installer release, secret change or feature activation.

## 1. Approved topology

```text
signed per-user Presenter Bridge
  -> https://presenter-api.yuto-matsui.com/functions/v1/presenter-bridge-session
  -> dedicated Cloudflare Presenter Gateway
  -> fixed Supabase Edge presenter-bridge-session URL
  -> server-only RPC and Presenter tables
```

The owner-approved production hostname is
`presenter-api.yuto-matsui.com`. Store release builds pin that HTTPS origin,
default port and fixed path. Debug overrides remain subject to the same exact
host, scheme, port and path validator. The corresponding production Worker is
`compass-presenter-gateway-production`; `workers.dev` and preview URLs remain
disabled.

The Gateway is a separate least-privilege Worker. It receives no R2, Durable
Object, Admin, AI, PDF or service-role binding. Its only upstream is the
source-pinned Supabase Edge URL. It exposes the same fixed path used in the
native signature canonical form; redirects, query strings, browser `Origin`
and `OPTIONS` requests are rejected.

## 2. Gateway request and trust contract

The Gateway must:

- read at most 16 KiB from the request stream and forward those exact bytes;
- reject encoded, empty, non-JSON and oversized bodies;
- accept only the five bounded Presenter proof headers;
- discard caller Cookie, Authorization, gateway-secret, network and forwarding
  headers;
- derive a bounded network digest from Cloudflare's connection address;
- inject `X-Compass-Presenter-Gateway` from the Worker secret and inject the
  derived network digest, never the raw address;
- use `redirect: manual`, a 4.25-second upstream timeout and a 64 KiB response
  limit;
- return only bounded JSON, `no-store`, `nosniff` and a numeric `Retry-After`;
- fail closed when the secret, rate binding, Cloudflare network identity or
  upstream is unavailable.

The Edge function independently verifies the gateway secret and the complete
P-256 proof. Gateway header-shape checks and Cloudflare rate limits are
defence-in-depth; they never replace Edge cryptography, database nonce reuse
prevention, lifecycle checks or actor/document binding.

The timeout ladder is deliberate:

```text
database wrapper statement_timeout 3 s (lock_timeout 750 ms)
  < Edge RPC client abort 3.5 s
  < Gateway upstream abort 4.25 s
  < native per-attempt request timeout 5 s
  < browser-to-loopback logical-operation envelope 12 s
```

The native client permits at most one exact-envelope transport retry, so the
12-second browser envelope covers two bounded native attempts plus local
serialization and loopback overhead. The margins require Hosted latency
evidence. A timeout must not cause a second billed operation; Presenter page
and heartbeat operations remain free and idempotent.

## 3. Proof of possession and replay control

Each Windows user gets a P-256 CNG signing key in the Microsoft Software Key
Storage Provider. It is signing-only, user-scoped and non-exportable. The key
identifier is the SHA-256 digest of the public SPKI.

Every native request signs a canonical value containing version, method,
fixed path, Unix timestamp, random nonce and SHA-256 of the exact raw body. Edge
allows at most 120 seconds of clock skew, verifies the key identifier and
signature, and atomically records the proof-key/nonce receipt. A replay, stale
proof, body mutation, key substitution or connection/key mismatch is rejected
before the requested lifecycle mutation.

The automatic pairing ticket and active capability remain short-lived
server-signed capabilities. The ticket is issued for 55 seconds and is bounded
server-side to at most 60 seconds. Possession of a copied capability alone is
insufficient because the request proof key is also checked. Private-key bytes,
pairing material and capabilities must never enter a URL, browser storage,
command line, log or database.

## 4. Rate and load contract

The current local Gateway model reserves:

- 1,200 requests/minute per hashed network;
- 9,000 requests/minute per Cloudflare location.

One Presenter can emit at most about 300 page attempts/minute from the 200 ms
latest-only dispatcher, plus four 15-second heartbeats. The network limit
therefore keeps roughly four-times burst headroom. These counters are
Cloudflare-location-local and permissive, not billing or exact global
accounting. The database proof-key, network and global buckets remain
authoritative. The production namespace identifiers must be verified unique in
the owner account before any deployment.

## 5. Production Cloudflare configuration

The checked-in Gateway production configuration must retain all of the
following:

- `workers_dev: false`;
- `preview_urls: false`;
- the exact Custom Domain `presenter-api.yuto-matsui.com`;
- no configurable upstream URL;
- `PRESENTER_BRIDGE_GATEWAY_SECRET` in `secrets.required`;
- Gateway and capability-token secrets are independently generated and must
  not have the same value;
- distinct location and network Rate Limiting bindings.

The Worker secret must exactly match the Supabase Edge
`PRESENTER_BRIDGE_GATEWAY_SECRET`; only presence/version evidence is recorded.
The separate Supabase Edge `PRESENTER_BRIDGE_TOKEN_SECRET` signs Presenter
capabilities and must be a different random value. Both values must be at least
32 bytes. Local `wrangler dev --local` remains permitted only with synthetic
secrets. No `workers.dev`, preview or guessed hostname is an acceptable
production substitute.

## 6. Microsoft Store delivery contract

Version 1 is an x64, self-contained packaged MSIX submitted to Microsoft Store.
The Store build excludes Velopack code and feed assets. The former Direct
Velopack EXE, R2/update-feed domain and private signing design are historical
development material only; they must not be uploaded, advertised or retained
as an educator fallback for this release.

Release requires:

1. exact Partner Center product and manifest identity owned by Yuto Matsui /
   松井優知;
2. package version `1.0.0.0`, `ja-JP`, Windows 11 24H2 build 26100 minimum,
   medium-integrity packaged classic app, startup task, and only the justified
   `runFullTrust` restricted capability;
3. clean-source package build with restored packages and project-separated SDK
   `obj`, `bin` and publish roots confined below a new external `OutputRoot`,
   after Windows handle canonicalization proves a normal local path physically
   outside the checkout across reparse and short-name aliases, plus unpacking
   preflight, provenance/hash receipt and WACK on the exact
   unsigned Partner Center ingestion input;
4. Microsoft Standard Application License Terms with no additional terms;
5. Japan, Free, Public audience, available-but-not-discoverable Direct link
   only, with the verified privacy URL and accurate Office dependency; and
6. Store acquisition, install, update, repair, uninstall and reinstall evidence
   on supported clean local-account and school-account profiles without adding
   or signing in to another Microsoft account.

The initial `1.0.0.0` submission must select **Don't publish this submission
until I select Publish now**. Microsoft Store package flights are available only after a
non-flight submission has been published, so a flight cannot provide the
initial pre-publication canary. After certification passes, the owner selects
**Publish now** while general Presenter runtime and the canonical web CTA remain
OFF. Microsoft then signs/publishes the direct-link-only listing. The exact
Store-delivered package is acquired by named operators through the unadvertised
link for clean-device canary evidence. Only after that canary passes may the
exact `https://apps.microsoft.com/...` URL be exposed in the general CTA.

## 7. Pairing and manual-recovery lifetimes

The two teacher connection paths have deliberately different lifetimes:

- the automatic signed pairing ticket is issued for 55 seconds and must never
  exceed the server-side 60-second ceiling;
- the separately entered eight-character manual recovery code may remain valid
  for at most five minutes.

The five-minute value is only the manual recovery code TTL. It is not a
classroom recovery-time objective, does not extend the automatic ticket and
does not weaken the existing 45-second stale-Bridge fence.

The manual code is generated in memory, displayed only to the teacher and sent
to the Bridge only when the teacher explicitly enters it. The database stores
only a domain-separated HMAC and expiry; the raw code must not enter a URL,
browser storage, command line, telemetry or log, and the UI must not copy it to
the clipboard automatically. Inspection and claim attempts are charged to the
Gateway and database rate limits. Each
cryptographically signed logical request atomically consumes a nonce receipt
and records its bounded positive or negative result. An exact transport retry
with the same nonce and body receives the cached result; a changed body or
nonce reuse is rejected. This preserves idempotent recovery without making
wrong-code attempts free or reusable.

A successful claim consumes the pairing or manual credential itself. Only the
exact cached transport envelope may receive the same success again; any fresh
logical claim or inspect, including a manual-code inspect carrying another
connection ID, fails closed.

Native rollback remains a separate Device/Human exercise. Store-installed
clients cannot be remotely uninstalled. Stop their authority with the backend
gates, stop new acquisition in Partner Center when required, and service a fix
as a tested higher Store version. Never use the old Direct Setup/feed as a
fallback and never run a destructive database down migration as classroom
recovery.

## 8. Gate matrix

| Gate                     | Required evidence                                                                                                                                                                   | Current decision                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cloud/local              | Gateway raw-byte, header, rate, error and config tests; strict TypeScript; native deterministic tests; clean/upgrade DB and Edge proof tests                                        | Implemented evidence must be rerun on the final candidate |
| Hosted                   | Exact Custom Domain, unique rate namespaces, matching Gateway secret, direct-Edge rejection, Gateway success, replay/rate/cleanup and timeout telemetry                             | **HOLD**                                                  |
| Store/Device             | Partner Center certification and Store signing; clean no-added-auth acquisition; Office 32/64 bit; install/update/repair/uninstall; 500 real transitions; restart/COM-loss recovery | **HOLD**                                                  |
| Human                    | Edge and Chrome HTTPS-to-loopback, hostile-Origin denial, PowerPoint/PDF confirmation, manual-code UX and extended-display venue drill                                              | **HOLD**                                                  |
| Certification activation | Global admission for all eligible educators throughout the unpredictably timed Microsoft review, after explicit go/no-go, continuous monitoring and immediate rollback              | Separate interval acceptance; evidence not yet complete   |
| General Production       | All preceding evidence on the same Store candidate and every rendered-latency stop threshold                                                                                        | **HOLD**                                                  |

Measure PPT action to the rendered page, not only receipt or state-write time.
For Display, any wrong-page render, any failure to converge, p95 above one
second, p99 above two seconds or maximum above three seconds stops activation.
Student delivery keeps the current five-second snapshot/delta polling. Visible
terminals actively following the lecture must have zero wrong-page renders,
zero failures to converge, no regression from the same-topology pre-Presenter
baseline, and automatic convergence within at most two polling windows plus the
separately measured communication and drawing budget. Hidden, offline and
unfollowed terminals are measured separately and must converge automatically
when they return.

The runtime controls are global. `PHASE729_POWERPOINT_SYNC_ENABLED`, the
singleton database gate and the compiled frontend flag have no reviewer-only
cohort check and affect every otherwise eligible educator. Microsoft does not
offer a predictable certification test time, so the dependent services must be
available throughout its review. Before submission, the owner and release
operator must explicitly accept or reject that global exposure, name continuous
monitoring and rollback ownership, and notify affected educators. If it is not
acceptable, activation and submission remain OFF until a reviewer-only cohort
is implemented. Passing certification does not clear the general Production
HOLD.

## 9. Rollout and rollback order

Rollout remains expand-first and starts dormant. Before step 1, verify the
existing Hosted Google Admin identity/operations/ledger foundation at its exact
deployed versions, required secret-presence metadata, database gates and Owner
Google/TOTP AAL2 smoke. If it is absent or dormant, stop and complete the
authoritative Phase 7.30 sequence; do not deploy `manage-admin-ledger` as an
isolated Presenter shortcut. Presenter ON also requires the existing
`VITE_PHASE7_28_DISPLAY_REALTIME=true` and
`PHASE728_DISPLAY_REALTIME_ENABLED=true` frontend/server state.

1. record the exact source SHA, Pages deployment, Edge versions, Worker version,
   migration state, gate states and rollback owner;
2. with the database runtime gate OFF, apply or verify the additive migrations
   in this order:
   `20260801075917_phase7_29_powerpoint_presenter_bridge.sql`,
   `20260809133000_phase7_29c_presenter_proof_and_cleanup.sql`, and
   `20260905074220_presenter_bound_authority_and_terminal_lease.sql`; verify
   service-role grants, RLS, one cleanup schedule and zero active connections;
3. with `PHASE729_POWERPOINT_SYNC_ENABLED=false`, deploy the compatible named
   Edge functions `manage-presenter-connection`, `update-display-state` and
   `presenter-bridge-session`; use the prerequisite exact `manage-admin-ledger`
   version already verified above and never use an unrelated bulk Edge deploy;
4. deploy the frontend/privacy release with
   `VITE_PHASE7_29_POWERPOINT_SYNC=false` and no advertised Store URL;
5. set distinct 32-byte-or-longer secrets: Edge-only
   `PRESENTER_BRIDGE_TOKEN_SECRET`, and one matching
   `PRESENTER_BRIDGE_GATEWAY_SECRET` in Edge and Worker;
6. deploy the pinned Gateway Worker and exact Custom Domain with unique rate
   namespaces while server and DB admission remain OFF;
7. prove the dormant boundary. Server flag OFF must return feature-disabled.
   Then, with DB still OFF, turn the server flag ON briefly and separately prove
   direct-Edge/gateway-secret rejection, malformed/stale/replayed proof denial,
   valid Gateway passage and DB-gate mutation denial; return server OFF;
8. prepare the exact MSIX under Partner Center manual publishing hold. Before
   selecting **Submit for certification**, record the explicit go/no-go for
   global eligible-educator exposure, build, verify, hash and deploy the
   frontend-ON certification artifact with
   `VITE_PRESENTER_CERTIFICATION_MODE=true` and no Store URL, turn server machine
   admission ON with DB OFF, rerun the negative tests, then turn DB runtime ON
   last. Record the artifact hash and keep all dependent services ON and
   continuously monitored throughout the unpredictable certification interval.
   Close DB, server and frontend in that order immediately after certification
   succeeds, fails or is canceled;
9. after certification passes, select **Publish now** with runtime and CTA OFF.
   Acquire the Store-signed package from the unadvertised direct listing and
   re-promote/reverify the exact certification artifact with Presenter ON,
   `VITE_PRESENTER_CERTIFICATION_MODE=true` and no Store URL. With DB OFF, turn
   server admission ON and rerun hosted evidence, turn DB ON last, complete the
   Device/Human and rendered-latency canary evidence. After every canary gate
   passes and before ending this stage, build, verify and hash from the same
   frozen SHA a separate general artifact with the exact Store URL, Presenter
   ON and `VITE_PRESENTER_CERTIFICATION_MODE=false`; do not deploy it during the
   canary. Then close DB, server and frontend in that order; and
10. only when every gate passes, deploy the same-SHA frontend-OFF production
    candidate with the exact Store URL and
    `VITE_PRESENTER_CERTIFICATION_MODE=false`. With DB OFF, turn server admission
    ON and rerun hosted evidence. Recheck the recorded source SHA and immutable
    hash of the frozen ON+Store-URL artifact from step 9, turn DB ON, then
    promote that exact artifact without rebuilding it.

Rollback always starts by turning the database runtime gate OFF and verifying
terminal revocation/manual-control recovery. Then set
`PHASE729_POWERPOINT_SYNC_ENABLED=false`, promote the frontend-OFF deployment,
revoke Store-review invitation/membership/sessions, and stop canary Bridges.
Retain the additive schema and named Edge deployments dormant. Withdraw the
Gateway Custom Domain only after DB and server admission are OFF.

There is no dual-key rotation period. For secret compromise or planned
rotation, complete the same DB-OFF, server-OFF and frontend-OFF sequence and
verify zero active connections. Rotate `PRESENTER_BRIDGE_TOKEN_SECRET` in Edge,
then rotate `PRESENTER_BRIDGE_GATEWAY_SECRET` to one new matching value in Edge
and Worker. Redeploy/verify the pinned machine Edge and Worker, repeat the
server-ON/DB-OFF negative tests, and return server OFF before any later
activation. Never rotate an active lecture in place and never down-migrate.

## 10. Local verification commands

The Gateway portion is covered by:

```bash
npm run typecheck:phase3
npm run test:phase7-29-gateway
```

The complete 7.29C candidate additionally requires the established Phase 7.29
Edge/static/load/concurrency/upgrade tests, deterministic native tests and the
full non-live regression. Local PASS never clears Hosted, Device or Human HOLD.

## 11. Primary references

- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workers Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Microsoft Store package flights](https://learn.microsoft.com/en-us/windows/apps/publish/package-flights)
- [Microsoft Store submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)
- [Microsoft Store certification process](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)
