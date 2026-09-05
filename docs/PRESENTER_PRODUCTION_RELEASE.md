# Presenter production release candidate

Decision date: 2026-09-06. This record was opened from source baseline
`c0f62fa491f0c01691dbe680c1fa7f49ddd0fbb7`. The release input is the final
reviewed merge on `main`, frozen and reverified under the exact-SHA contract
below.

The production decision is Microsoft Store distribution of a packaged x64
MSIX. The old Direct Velopack EXE and anonymous R2 update feed are not a
production distribution path for this release. Source preparation has
advanced, but the general PowerPoint feature remains **HOLD** until the Store,
device, Office and rendered-latency gates in this record pass.

The teacher outcome remains fixed: after one installation and the existing
COMPASS educator sign-in, PowerPoint slide operations drive the lecture without
a CLI, a Bridge-specific account, repeated recovery codes or routine use of a
complex settings panel. Store acquisition must also pass on supported clean
devices without requiring the teacher to add or sign in to another Microsoft
account.

## Fixed release decisions

| Field                    | Version 1 decision                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Publisher                | Yuto Matsui / 松井優知; manifest identity must use the exact Partner Center values |
| Distribution             | Microsoft Store packaged MSIX; no public Direct EXE or anonymous update feed       |
| Product                  | COMPASS Presenter Bridge, subject to Partner Center reservation                    |
| Package version          | `1.0.0.0`                                                                          |
| Architecture             | x64                                                                                |
| Minimum OS               | Windows 11 version 24H2, build 26100 or later                                      |
| Package language         | `ja-JP`                                                                            |
| Initial market           | Japan only                                                                         |
| Price                    | Free                                                                               |
| Audience                 | Public audience                                                                    |
| Discoverability          | Available but not discoverable; Direct link only                                   |
| Customer license         | Microsoft Standard Application License Terms                                       |
| Additional license terms | Blank; no custom terms or additional-terms file                                    |
| Privacy URL              | `https://compass-interactive.pages.dev/presenter-bridge/privacy/`                  |
| Web install setting      | Exact Store URL in `VITE_PRESENTER_STORE_URL` after reservation and publication    |
| Certification/canary web | Presenter ON; `VITE_PRESENTER_CERTIFICATION_MODE=true`; Store URL empty            |
| General web              | Presenter ON; `VITE_PRESENTER_CERTIFICATION_MODE=false`; exact Store URL           |

Public audience is an intentional initial choice. Microsoft documents that a
submission first published to a Public audience cannot later be changed to a
Private audience. Direct-link-only discoverability still lets anyone who has
the link view and acquire the listing, while keeping it out of Store search and
browse surfaces. Do not substitute a Private audience, because that path binds
acquisition to listed Microsoft accounts and conflicts with the no-added-auth
acceptance target.

The owner selected an **Individual** developer account in the current Partner
Center onboarding flow. The flow is now at **Identity verification**. This
records the selected account path; it does not prove completed onboarding or
Microsoft acceptance. Registration remains HOLD until the owner personally
completes identity verification, the required agreements and the remaining
onboarding steps.

## Implemented source and verified scope

The following source exists on the release line:

- a Store-specific build that removes Velopack code and feed access while
  preserving the Direct build only as a legacy, non-production development lane;
- an x64 self-contained MSIX manifest with `ja-JP`, build 26100 minimum,
  `uap17:UpdateWhileInUse=defer`, packaged classic-app medium integrity, a
  startup task and only the `runFullTrust` restricted capability;
- a clean-source package builder and unpacking preflight that records source,
  package, notice, runtime and tool hashes, while routing NuGet packages and all
  SDK `obj`, `bin` and publish outputs below a new external `OutputRoot` instead
  of trusting ignored checkout outputs;
- a main-only manual GitHub Actions preflight that requires the exact source SHA
  and Partner Center identity inputs, then records only a build/preflight/hash
  summary without uploading any package artifact from the public repository;
- mandatory Microsoft Standard Application License Terms with no additional
  terms for production inputs; development-only receipts keep license terms at
  `NOT_SELECTED_UNSIGNED_DEVELOPMENT_ONLY`;
- a bilingual privacy notice at
  `public/presenter-bridge/privacy/index.html`;
- browser-side first-use privacy consent before local inspection or hosted
  pairing; and
- an Owner-only **Microsoft Store審査用アクセスを発行** action. It fixes the
  invitation to `role=instructor`, `can_use_ai=false`, a seven-day invitation
  and membership expiry fourteen days after issuance.

These are source or local-development results. They do not prove Partner Center
acceptance, Store signing, production deployment or classroom behavior.

The canonical privacy URL is fixed at
`https://compass-interactive.pages.dev/presenter-bridge/privacy/`. On
2026-09-06, an external GET returned HTTP 200 but served the main SPA shell,
not the bilingual privacy document. The source page is implemented; its exact
production route is not yet published and verified. Deploy it while Presenter
admission remains OFF, then verify the title/body, English and Japanese
sections, contact link, response headers and absence of console/network errors
before using the URL in Partner Center.

The inspected development receipt records source commit
`1beea714b1f79089c2c1f78cf694c37307d565d9` and development identity
`CompassPresenterBridge.Development`. Its package passed independent unpacking
preflight with 413 published files and no Velopack/update-feed payload. A
locally signed development copy was installed only for bounded device probing.
On the current Windows/Office device, the Store-compiled native binary returned
PowerPoint readiness in **539 ms**. This is one local readiness observation. It
is not Store-signed, was not acquired from Microsoft Store, and does not cover
clean installation, both Office architectures, browser pairing, hosted
delivery, Display rendering or student rendering.

The earlier 500-transition evidence has a separate and narrower scope: an x64
unsigned harness, Office 16 32-bit, one monitor, a synthetic 12-page deck,
Speaker full-screen with Presenter View off, native COM observation and the
100 ms stable tracker. It completed 500/500 transitions with zero wrong-page
commits, median 152 ms, p95 170 ms and maximum 206 ms. It excludes MSIX package
identity, Store signing/acquisition, HTTPS/Gateway/Supabase transit, Display and
student canvas rendering, 64-bit Office, a second monitor, Store update and
uninstall behavior. Neither native result closes a remaining gate.

## Distribution boundary

The earlier `presenter-updates.yuto-matsui.com` domain, R2 bucket, Velopack
installer and signing-environment design are retained only as historical or
dormant infrastructure. Do not upload an EXE, publish an update index, expose an
anonymous feed, or place that URL in the educator UI for this release. A future
outside-Store distribution decision would require its own authorization,
public-trust signing and device acceptance.

After Partner Center creates the product URL, copy its exact
`https://apps.microsoft.com/...` value into the Production build setting
`VITE_PRESENTER_STORE_URL`. The frontend must reject any other scheme or host
and hide the installation CTA while the value is absent or invalid. Never put
credentials, product secrets, signing material or account identifiers in a
`VITE_` setting. Verify the rendered CTA against the frozen production build;
do not infer the link from a Product ID or retain the old EXE as a fallback.

## Classroom acceptance

The normal path is:

```text
Store install -> Bridge starts -> existing COMPASS educator session
  -> one privacy consent -> PowerPoint/PDF match confirmation when required
  -> PowerPoint-only slide progression -> safe automatic convergence
```

An unchanged, freshly inspected PDF/PPT binding may reuse its nonsecret local
material-consent digest. A changed presentation, order, saved content,
slideshow mode or PDF version requires a new match. Equal page counts alone are
not a match. Tabs and reloads must rediscover ownership without creating a
competing connection. Manual controls remain available after a safe handover.

The release fails if the normal path requires complex UI work, another product
login or MFA challenge, teacher CLI use, a certificate trust action,
`CheckNetIsolation`, repeated recovery-code entry, or a transition delay that
can interrupt a lecture.

The current release keeps the existing **five-second** foreground student
snapshot/delta polling, including its initial phase spread and no recurring
jitter. It does not claim that every student canvas renders within five
seconds, because polling, network and drawing time can exceed one interval. The
current 300-student model of 60 requests/second and 324,000 requests per
90-minute lecture is arithmetic, not capacity evidence.

Measure real PPT action to rendered Display and rendered student canvas,
including cold and cached neighboring pages, distant jumps, rapid A-B-A and
the worst polling phase. Record p50, p95, p99, maximum, wrong pages and failure
to converge against a same-topology pre-Presenter baseline. Any one of the
following is a stop threshold for certification activation or general release:

- Display: zero wrong-page renders, zero failures to converge, p95 at most one
  second, p99 at most two seconds and maximum at most three seconds;
- visible student terminals actively following the lecture: zero wrong-page
  renders, zero failures to converge, no regression from the pre-Presenter
  baseline, and automatic convergence within at most two five-second polling
  windows plus the separately measured communication and drawing budget; and
- no teacher action is required to obtain that convergence.

Hidden, offline and intentionally unfollowed students are reported as separate
populations. They must converge without a teacher action when visibility,
connectivity or following returns, but they are not mixed into the visible
following-terminal stop-threshold sample.

## Microsoft Store certification access

Only an Owner may issue Store-review access. Create an isolated,
publisher-controlled Google test account only for Microsoft Store
certification. It contains no mail, Drive, personal data or real lecture access.
Invite its email address through **教員管理** and **Microsoft
Store審査用アクセスを発行**, and seed only a synthetic 12-page lecture with a
matching synthetic PPTX/PDF pair. Enter that account's temporary username and
password directly in protected Partner Center **Notes for certification**;
never copy them into Git, ordinary email, screenshots, logs or agent prompts.
The reviewer enrolls the app's normal TOTP factor on first use, so the Owner
does not receive or share a TOTP seed, recovery code or active session. If
Google challenges prevent Microsoft from using the isolated account, keep the
submission on HOLD and resolve the path with Microsoft rather than weakening
authentication.

The signed Store-review contract binds the request, environment and normalized
email. The invitation expires seven days after issuance. If accepted in time,
the `instructor` membership with AI disabled expires fourteen days after the
same issuance time. It is not an Owner or operator role. Supply only the
temporary test-account username/password and minimum test steps through Partner
Center. Never place an Owner password, TOTP seed, recovery code, Presenter
capability, Gateway secret, pairing secret, application token or active session
in Partner Center notes, email, screenshots, files or logs. The fourteen-day
absolute membership expiry is a backstop, not a reason to leave review access
active after certification.

After certification, the Owner immediately cancels a pending invitation or
uses **教員権限を抹消** for an accepted membership and verifies that its Admin
sessions are inactive. The fixed expiry is a backstop. A delayed review receives
a newly issued bounded invitation; the old one is never extended or promoted.

The Owner-only UI and server contract are implemented in this candidate and
locally covered. Hosted deployment, a real isolated certification account,
invitation delivery, onboarding, expiry and post-review revocation are still
unverified.

The current Presenter implementation has no reviewer-only runtime cohort.
`PHASE729_POWERPOINT_SYNC_ENABLED`, the singleton database runtime gate and the
compiled frontend flag apply to every otherwise eligible production educator.
Microsoft does not provide a predictable certification test time, and dependent
services must remain available throughout review. Before submission, the owner
and release operator must therefore make an explicit go/no-go decision on
keeping Presenter globally ON for eligible educators for the whole unknown
certification interval. Record the decision, start, review-state monitor,
operator and rollback owner; notify affected educators; monitor continuously;
and close all three gates as soon as certification finishes, is canceled or a
stop threshold fires. If that global exposure is not acceptable, keep
activation and submission on HOLD until a reviewer-only admission cohort is
implemented and verified. Certification never clears the general Production
HOLD by itself.

## Release and verification order

### A. Dormant backend and Store submission foundation

1. Before any Presenter deployment, verify the existing Google Admin identity,
   operations and ledger foundation in Hosted production. Record the exact
   deployed versions of `admin-identity-session` and `manage-admin-ledger`, the
   applied Phase 7.30 migrations and database gate state, and presence/version
   only for `ADMIN_SESSION_SECRET`, `ADMIN_IDENTITY_PEPPER`,
   `ADMIN_IDENTITY_PEPPER_VERSION`, `ADMIN_INVITATION_SECRET` and
   `PHASE730_ADMIN_ENVIRONMENT_ID`. Confirm the matching frontend/server identity,
   operations and ledger flags and complete an Owner Google/TOTP AAL2 sign-in,
   ledger snapshot and safe Owner control smoke. If any dependency is absent,
   mismatched or still dormant, keep Presenter on HOLD and complete the
   authoritative Phase 7.30 deployment/activation sequence; never deploy
   `manage-admin-ledger` alone as a Presenter shortcut.
2. Freeze one source SHA and record the current Pages deployment, Supabase Edge
   versions, Cloudflare Worker version, applied migrations, gate states and
   rollback owner. Confirm `VITE_PHASE7_28_DISPLAY_REALTIME=true` and
   `PHASE728_DISPLAY_REALTIME_ENABLED=true` on the exact frontend/server
   candidates because Presenter admission is rejected without them. Pass
   focused tests, secret/static checks and exact-head CI.
3. Apply or verify these additive Presenter migrations in order while the
   Presenter database runtime gate remains OFF:
   `20260801075917_phase7_29_powerpoint_presenter_bridge.sql`,
   `20260809133000_phase7_29c_presenter_proof_and_cleanup.sql`, then
   `20260905074220_presenter_bound_authority_and_terminal_lease.sql`. Verify
   service-role-only grants, RLS, one cleanup schedule and zero active Presenter
   connections. Never use a down migration for rollback.
4. With `PHASE729_POWERPOINT_SYNC_ENABLED=false`, deploy compatible named Edge
   functions rather than a bulk deploy: `manage-presenter-connection`,
   `update-display-state`, and `presenter-bridge-session`. The prerequisite
   `manage-admin-ledger` version was verified in step 1 and is not deployed as
   part of this Presenter slice. Deploying
   `update-display-state` before activation is required so the active-Presenter
   manual-write fence is handled safely.
5. Publish and verify the canonical privacy route and frontend release with
   `VITE_PHASE7_29_POWERPOINT_SYNC=false`,
   `VITE_PRESENTER_CERTIFICATION_MODE=false` and no advertised Store URL.
   Manual controls must remain functional and the browser must make no
   Presenter loopback request.
6. Generate distinct random values of at least 32 bytes. Set
   `PRESENTER_BRIDGE_TOKEN_SECRET` only in the Supabase Edge environment. Set
   the same `PRESENTER_BRIDGE_GATEWAY_SECRET` in Supabase Edge and the
   Cloudflare Worker; it must differ from the token secret. Record presence and
   version only, never values.
7. Deploy the pinned `compass-presenter-gateway-production` Worker and its exact
   Custom Domain `presenter-api.yuto-matsui.com`, retaining disabled
   `workers.dev` and preview URLs, fixed Supabase upstream, unique network and
   location rate namespaces, and no unrelated bindings.
8. Prove the dormant boundary. With the server flag OFF, Gateway and direct
   Edge requests must fail as feature-disabled. Then, only while the DB gate is
   OFF, turn the server flag ON briefly: direct Edge access without the gateway
   secret must fail, malformed/stale/replayed proofs must fail through the
   Gateway, and a valid proof must still be unable to mutate Presenter state
   because the DB gate is OFF. Return the server flag to OFF after the test.
9. Complete Partner Center identity verification, product reservation and the
   exact manifest identity. After the frozen reviewed SHA lands on `main`, run
   **Presenter Store submission preflight** on branch `main` with that exact SHA
   as `source_commit` plus the exact version, identity name, publisher DN and
   publisher display name. Record the successful run ID and hash summary; the
   public workflow uploads no package or receipt. On an owner-controlled Windows
   release host, check out the same clean SHA and run the same builder/preflight
   locally with the same inputs. Require its `NEW_OUTPUT_ROOT_ONLY` receipt and
   relative isolated NuGet/SDK/publish roots; existing ignored checkout `bin/obj`
   are never inputs. Require
   `OutputRootBoundary=NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT`: the
   builder accepts only a normal local drive path and must resolve the existing
   parent, created root and isolated build roots physically outside the checkout
   across reparse and short-name aliases. Use a short external root such as
   `C:\COMPASS\presenter-1.0.0.0`; the builder rejects paths that approach the
   legacy Windows tooling limit. Preserve that local receipt and run WACK against its exact
   unsigned MSIX hash; only this owner-controlled local file may be uploaded to
   the matching Partner Center product. Neither path signs, submits or publishes
   the package automatically.
10. Configure Japan, `ja-JP`, x64, Windows 11 24H2+, Free, Public audience and
    available-but-not-discoverable Direct link only. Add the verified privacy
    URL, Office dependency, `runFullTrust` justification and bounded reviewer
    instructions. Select **Don't publish this submission until I select Publish
    now**, but do not select **Submit for certification** until the global
    certification go/no-go and online state in Section B are ready. A package
    flight is not the initial-version mechanism; Partner Center flights are
    available only after a non-flight submission has been published.

### B. Certification-only global activation interval

1. Prepare the isolated publisher-controlled Google test identity and issue the
   fixed Owner-only seven-day invitation/fourteen-day non-AI instructor
   membership. Enter only its temporary username/password in protected Partner
   Center notes and let the reviewer enroll normal app TOTP. Keep submission on
   HOLD if Microsoft cannot use the isolated identity.
2. Record the explicit go/no-go acceptance that the current gates affect every
   eligible educator for the complete, unpredictably timed certification
   interval. Name the continuous monitor and rollback owner and notify affected
   educators. If that exposure is not accepted, stop before submission until a
   reviewer-only cohort exists.
3. Build, verify, hash and deploy the exact certification frontend with the
   Presenter flag ON, `VITE_PRESENTER_CERTIFICATION_MODE=true` and no Store URL.
   Record the source SHA and immutable artifact hash. Certification mode must
   mechanically suppress the installation CTA. Confirm the required
   `VITE_PHASE7_28_DISPLAY_REALTIME=true` prerequisite in the compiled build.
4. Turn server machine admission ON while DB runtime remains OFF, confirm
   `PHASE728_DISPLAY_REALTIME_ENABLED=true`, rerun direct Edge, Gateway-secret,
   proof, replay and nonce negative tests, then turn the DB runtime gate ON last.
5. Complete an Owner synthetic-lecture smoke, then select **Submit for
   certification**. Keep the frontend, server, DB and dependent online services
   continuously available and monitored until Partner Center reports success,
   failure or cancellation; do not assume or promise a reviewer test time.
6. Collect any available reviewer/synthetic teacher-to-rendered Display/student
   evidence. All Display and student stop thresholds above, manual handover and
   automatic/manual credential lifetimes must pass.
7. As soon as certification finishes or is canceled, or immediately on any
   failure, turn the DB runtime gate OFF first, then server machine admission
   OFF, then promote the frontend-OFF build. Revoke reviewer
   invitation/membership and sessions and verify manual PDF control recovery.
   A successful submission remains under the Partner Center manual publishing
   hold; general publication remains HOLD.

### C. Store-signed, unadvertised acquisition canary

1. After certification passes, keep general runtime and the canonical CTA OFF.
   Select **Publish now** for the Public, available-but-not-discoverable listing.
   Microsoft signs during Store publishing; only after publication can the
   exact Store-delivered package be acquired on ordinary clean devices.
2. Withhold the direct listing URL from the production frontend and share it
   only with named canary operators. This is an operationally bounded canary,
   not an access-controlled private listing. Use a Partner Center package flight
   only for later versions after this first non-flight publication.
3. On clean supported local-account and school-account profiles, verify Store
   and Web Installer acquisition, install, first launch, startup, update while
   closed, update deferral during a lecture, repair, uninstall and reinstall.
   Both profiles must pass without adding or signing in to another Microsoft
   account.
4. On the Store-delivered exact package, verify real 32-bit and 64-bit desktop
   PowerPoint, Chrome and Edge loopback, single and extended displays, document
   changes, 500 transitions, rapid A-B-A, lost replies, COM loss, browser and
   Bridge restart, consent withdrawal, CNG deletion and manual handover.
5. Re-promote and reverify the exact certification artifact with Presenter ON,
   `VITE_PRESENTER_CERTIFICATION_MODE=true` and no Store URL for the scheduled
   classroom canary; confirm its recorded hash and mechanically hidden CTA. Use
   the Partner Center Direct link only with named Store acquisition operators.
   With the DB gate OFF, turn server machine admission ON and repeat the
   Gateway/direct-Edge checks, then turn the DB runtime gate ON last. Run the
   synthetic canary and staged 300-student evidence, then close the
   DB/server/frontend gates in that order.
6. After every canary gate passes and before ending stage C, build the separate
   general-release artifact from the same frozen source SHA with Presenter ON,
   `VITE_PRESENTER_CERTIFICATION_MODE=false` and the exact Store URL. Verify its
   complete production environment, static bundle, Presenter UI, exact CTA
   target and absence of Direct EXE/feed fallback, then record its immutable
   artifact hash. Do not deploy it during the acquisition canary.

### D. General publication

1. Freeze the exact Store product, package version, listing URL and all hosted,
   device, human and latency evidence. General publication remains HOLD if any
   gate or stop threshold is unresolved.
2. With the DB gate OFF, deploy a production frontend containing the exact
   `VITE_PRESENTER_STORE_URL` while `VITE_PHASE7_29_POWERPOINT_SYNC=false` and
   `VITE_PRESENTER_CERTIFICATION_MODE=false`; verify that the compiled candidate
   contains no Direct EXE/feed fallback. Turn server machine admission ON and
   repeat the Gateway/direct-Edge negative and positive evidence.
3. Recheck that the frozen ON+Store-URL general artifact from stage C has the
   recorded source SHA and immutable hash and passed the required local/static
   verification. Do not rebuild or deploy a different artifact in step 4.
4. Turn the DB runtime gate ON, then promote the exact ON+Store-URL artifact and
   hash verified in step 3 last. The global UI and Store CTA are now generally
   available to eligible educators.
5. Run an Owner canary lecture immediately and monitor the same rendered
   Display/student thresholds. Revoke all Store-review access after the review.

## Failure rollback and secret rotation

For any certification, acquisition-canary or general-release failure:

1. turn the database runtime gate OFF first and verify that all active Presenter
   bindings are terminally revoked and manual PDF controls work;
2. set `PHASE729_POWERPOINT_SYNC_ENABLED=false` and verify that new machine
   requests and connection issue/confirm attempts fail closed;
3. promote the previous frontend-OFF deployment and close the Store CTA;
4. stop canary Bridge processes and revoke reviewer invitation, membership and
   sessions; and
5. retain additive schema and named Edge deployments in their dormant state.
   Withdraw the Worker Custom Domain only after DB and server admission are OFF.

There is no dual-key acceptance period. If either Presenter secret is exposed
or must rotate, use a planned outage: complete steps 1-3 above, verify zero
active connections, rotate `PRESENTER_BRIDGE_TOKEN_SECRET` in Supabase Edge,
rotate `PRESENTER_BRIDGE_GATEWAY_SECRET` to one new matching value in Supabase
Edge and Cloudflare, redeploy/verify the pinned Worker and named machine Edge,
and repeat the server-ON/DB-OFF negative tests. Return server admission to OFF
until the normal activation sequence resumes. Never rotate either secret while
an active lecture depends on the old value and never down-migrate the database.

## Current HOLD

- The final candidate SHA is not frozen and its complete focused/static plus
  exact-head CI evidence has not been rerun and reconciled.
- The prerequisite Hosted Phase 7.30 Admin identity/operations/ledger state has
  not been verified at exact deployed versions with required secret-presence
  metadata, database gates and an Owner Google/TOTP AAL2 ledger smoke.
- The exact Phase 7.28 Display Realtime frontend/server flags and Presenter
  Stage A placement remain unverified: ordered migrations, compatible named
  Edge functions, distinct Edge/Gateway secrets, the fixed Gateway DNS/Worker,
  unique rate namespaces and the complete server-OFF plus server-ON/DB-OFF
  negative/positive evidence are still pending.
- The Individual account type is selected, but Partner Center identity
  verification/onboarding, product reservation and exact package identity are
  incomplete.
- The public privacy URL currently serves the SPA shell rather than the privacy
  document.
- The final UI Store URL injection and canonical-host CTA proof are incomplete.
- WACK, Store ingestion, `runFullTrust` approval, certification and Store
  signing are incomplete.
- Clean-device no-added-auth acquisition and startup/update/uninstall behavior
  are unverified.
- Store-delivered Office x86 and x64, extended-display operation and the full
  500-transition device matrix are unverified.
- Display and student rendered latency, including a staged 300-student load,
  remains unmeasured for the Store candidate.
- The Store reviewer path is implemented in source but has not passed hosted
  and human issuance/onboarding/expiry/revocation evidence.

General publication and the canonical Store CTA remain OFF while any item above
is unresolved. After its explicit global-exposure go/no-go, the certification
interval may keep only the documented frontend/runtime gates ON throughout
Microsoft's unpredictably timed review; the post-publishing acquisition canary
may enable them for its bounded evidence run. Close those gates in the
documented order when each interval ends; neither exception clears the general
Production HOLD.

## Follow-up after the PPT release

Only after the Store Presenter release is published and accepted, start a
separate synchronization project. Evaluate three-second-or-faster rendered
transitions and selective Realtime notifications for slide changes, live polls
and comments. Keep snapshot/delta as the authoritative recovery path and do not
subscribe every feature or broadcast every student's state.

That later project may evaluate Supabase Pro and budget-approved extensions for
a 300-student lecture using measured connections, messages, database load,
network use and cost. This release does not change the Supabase plan, the
student five-second polling interval or the current Realtime publication.
