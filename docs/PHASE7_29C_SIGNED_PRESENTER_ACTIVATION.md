# Phase 7.29C - Signed Presenter activation contract

Status: **Local source implementation; Hosted, Device, Human and activation
Production gates HOLD**

Approved contract date: 2026-08-09

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
  -> https://<owner-approved-fqdn>/functions/v1/presenter-bridge-session
  -> dedicated Cloudflare Presenter Gateway
  -> fixed Supabase Edge presenter-bridge-session URL
  -> server-only RPC and Presenter tables
```

`<owner-approved-fqdn>` is a documentation placeholder, not a deployable
hostname. Release builds currently pin `presenter-api.invalid` and therefore
fail closed during startup. Debug overrides remain subject to the same exact
host, HTTPS, default-port and path validator. The placeholder must not be
replaced until the owner records the exact FQDN and Cloudflare zone.

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

## 5. Dormant Cloudflare configuration

Until the exact hostname is approved, the checked-in Gateway configuration
must retain all of the following:

- `workers_dev: false`;
- `preview_urls: false`;
- no `route`, `routes` or `custom_domain`;
- no configurable upstream URL;
- `PRESENTER_BRIDGE_GATEWAY_SECRET` in `secrets.required`;
- Gateway and capability-token secrets are independently generated and must
  not have the same value;
- distinct location and network Rate Limiting bindings.

There is no Gateway deploy script in the normal release path. Local
`wrangler dev --local` is permitted with a synthetic secret. A deployed Worker,
`workers.dev` preview or guessed hostname is not an acceptable substitute for
the missing owner-approved Custom Domain.

## 6. Velopack delivery contract

The Presenter SDK and local `vpk` tool are pinned to stable version `1.2.0`.
NuGet source mapping, exact package constraints, committed tool manifest and
locked restore are required. Prerelease Velopack builds and unpinned global
tools are prohibited.

`VelopackApp.Build().SetAutoApplyOnStartup(false).Run()` executes before OS,
single-instance, COM or loopback initialization. Automatic apply is disabled:
an update must never terminate a Presenter process during an active lecture.

The first release is a signed, one-click, per-user Setup executable with a
self-contained Windows payload. MSI/per-machine installation is outside the
initial activation scope. If more than one architecture is distributed, each
RID gets a non-colliding channel and its own install/update evidence.

Release requires:

1. an owner-approved signing identity and profile;
2. short-lived CI authentication, preferably Azure Artifact Signing through
   GitHub OIDC rather than a repository PFX/password;
3. Authenticode, SHA-256 file digest and RFC 3161 timestamp verification for
   every shipped PE and Setup executable;
4. fresh install, update, uninstall and known-good rollback tests;
5. immutable versioned assets, with the release index published last;
6. retention of the previous signed full package and Setup executable.

The update feed is unresolved. A private GitHub token must not be embedded in
the application. The owner must choose an anonymous owner-controlled HTTPS/R2
feed, a dedicated public release repository or Velopack Flow before update
checking can be enabled.

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

Native rollback remains a separate Device/Human exercise. Use a retained
signed full package or Setup executable, prefer a tested higher-version
known-good roll-forward, and never run a destructive database down migration
as classroom recovery.

## 8. Gate matrix

| Gate                  | Required evidence                                                                                                                                         | Current decision                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cloud/local           | Gateway raw-byte, header, rate, error, dormant-config tests; strict TypeScript; native deterministic tests; clean/upgrade DB and Edge proof tests         | Implemented evidence must be rerun on the final candidate |
| Hosted                | Exact FQDN/zone, unique rate namespaces, matching gateway secret, direct-Edge rejection, Gateway success, replay/rate/cleanup and timeout telemetry       | **HOLD**                                                  |
| Device                | Signed installer, SmartScreen, x64/x86 and supported Office builds, install/update/uninstall/rollback, 500 real transitions and restart/COM-loss recovery | **HOLD**                                                  |
| Human                 | Edge and Chrome HTTPS-to-loopback, hostile-Origin denial, PowerPoint/PDF confirmation, manual-code UX and Extend-display venue drill                      | **HOLD**                                                  |
| Activation Production | All preceding evidence on the same signed release candidate, owner approval and controlled canary                                                         | **HOLD**                                                  |

An exact FQDN, signing identity or update feed must not be inferred by an agent.
They require an explicit owner decision. Until all three are recorded, the
`.invalid` endpoint, absent Cloudflare route and default-OFF server/database/UI
gates are the required safe state.

## 9. Rollout and rollback order

After the HOLD items are resolved, rollout remains expand-first:

1. record the production baseline and rollback owner;
2. configure the exact Custom Domain, unique rate namespaces and matching
   Worker/Edge gateway secret while all Presenter flags remain OFF;
3. deploy only the dedicated Gateway and machine Edge function and prove that
   direct Edge access is rejected;
4. publish the signed canary installer and complete Device/Human evidence;
5. enable machine admission, then the database runtime gate, then one frontend
   cohort;
6. verify page convergence, Display behavior, manual handover and telemetry;
7. expand only after automatic-ticket expiry, five-minute manual-code expiry,
   one-time positive/negative receipts and rollback behavior pass.

Rollback starts with the database runtime gate, then machine admission and the
frontend flag. The additive schema is retained. Existing manual Admin PDF
controls, Display snapshot fallback and the student five-second path remain the
recovery path.

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
- [Velopack integration](https://docs.velopack.io/integrating/overview)
- [Velopack packaging and release assets](https://docs.velopack.io/packaging/overview)
- [Velopack code signing](https://docs.velopack.io/packaging/signing)
- [Velopack release channels](https://docs.velopack.io/packaging/channels)
- [Microsoft Artifact Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [GitHub Actions to Azure through OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
