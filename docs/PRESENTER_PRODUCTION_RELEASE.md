# Presenter production release candidate

Decision date: 2026-09-06. Baseline for this record:
`fa99e4e9d822f2bbf75e08194c19bb0eb3a37931`.

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

| Field | Version 1 decision |
| --- | --- |
| Publisher | Yuto Matsui / 松井優知; manifest identity must use the exact Partner Center values |
| Distribution | Microsoft Store packaged MSIX; no public Direct EXE or anonymous update feed |
| Product | COMPASS Presenter Bridge, subject to Partner Center reservation |
| Package version | `1.0.0.0` |
| Architecture | x64 |
| Minimum OS | Windows 11 version 24H2, build 26100 or later |
| Package language | `ja-JP` |
| Initial market | Japan only |
| Price | Free |
| Audience | Public audience |
| Discoverability | Available but not discoverable; Direct link only |
| Customer license | Microsoft Standard Application License Terms |
| Additional license terms | Blank; no custom terms or additional-terms file |
| Privacy URL | `https://compass-interactive.pages.dev/presenter-bridge/privacy/` |
| Web install setting | Exact Store URL in `VITE_PRESENTER_STORE_URL` after reservation and publication |

Public audience is an intentional initial choice. Microsoft documents that a
submission first published to a Public audience cannot later be changed to a
Private audience. Direct-link-only discoverability still lets anyone who has
the link view and acquire the listing, while keeping it out of Store search and
browse surfaces. Do not substitute a Private audience, because that path binds
acquisition to listed Microsoft accounts and conflicts with the no-added-auth
acceptance target.

The publisher account type is not decided. Microsoft Store policy 10.14 says a
Company account is required for an organization, business, or person acting in
relation to a trade or profession, while an Individual account is usually
appropriate for one developer working on their own. The personal publisher
name alone does not decide this classification. Registration remains HOLD
until the owner checks the actual publishing purpose and identity against the
current policy and completes the appropriate Microsoft verification personally.

## Implemented source and verified scope

The following source exists on the release line:

- a Store-specific build that removes Velopack code and feed access while
  preserving the Direct build only as a legacy, non-production development lane;
- an x64 self-contained MSIX manifest with `ja-JP`, build 26100 minimum,
  `uap17:UpdateWhileInUse=defer`, packaged classic-app medium integrity, a
  startup task and only the `runFullTrust` restricted capability;
- a clean-source package builder and unpacking preflight that records source,
  package, notice, runtime and tool hashes;
- Microsoft Standard Application License Terms selection with no additional
  terms in the inspected development receipt;
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
including cold and cached neighboring pages, distant jumps and worst polling
phase. Record p50, p95, p99, maximum, wrong pages and failure to converge. The
Display target is p95 at most one second. Hidden, offline and intentionally
unfollowed students are separate populations and must converge without a
teacher action when visibility/following returns.

## Microsoft Store certification access

Only an Owner may issue Store-review access. The reviewer controls a new Google account used only by the Microsoft Store certification.
Seed it only with a synthetic 12-page lecture and a matching synthetic PPTX/PDF
pair. The owner invites its email address through **教員管理** and
**Microsoft Store審査用アクセスを発行**. The owner must not create, receive or
share the reviewer's Google password, TOTP seed, recovery codes or active
session. If certification cannot be exercised with reviewer-controlled
credentials, keep submission on HOLD instead of sharing an account or adding an
authentication bypass.

The signed Store-review contract binds the request, environment and normalized
email. The invitation expires seven days after issuance. If accepted in time,
the `instructor` membership with AI disabled expires fourteen days after the
same issuance time. It is not an Owner or operator role. Supply only the
invitation link and minimum test steps. Never place an owner password, TOTP seed, recovery code, Presenter capability, Gateway secret, pairing secret,
application token or active session in Partner Center notes, email, screenshots,
files or logs. The fourteen-day absolute membership expiry is a backstop, not a
reason to leave review access active after certification.

After certification, the Owner immediately cancels a pending invitation or
uses **教員権限を抹消** for an accepted membership and verifies that its Admin
sessions are inactive. The fixed expiry is a backstop. A delayed review receives
a newly issued bounded invitation; the old one is never extended or promoted.

The Owner-only UI and server contract are implemented and locally covered at
the source baseline. Hosted deployment, a real reviewer-owned account,
invitation delivery, onboarding, expiry and post-review revocation are still
unverified.

## Release and verification order

1. Integrate the reviewed Store, privacy and consent fixes on one clean source
   SHA. Pass focused tests, secret/static checks and the required exact-head CI.
2. Publish and verify the canonical privacy route with all Presenter runtime
   and frontend admission gates still OFF.
3. Resolve Store policy 10.14 account type, complete owner-controlled Partner
   Center registration, reserve the product, and copy the exact package
   identity and Store URL without exposing personal verification data.
4. Build the clean `1.0.0.0` Partner Center submission input with Microsoft
   Standard Application License Terms and no additional terms. Run preflight
   and WACK against that exact hash.
5. Configure Japan, `ja-JP`, x64, Windows 11 24H2+, Free, Public audience and
   available-but-not-discoverable Direct link only. Add the canonical privacy
   URL, accurate Office dependency, `runFullTrust` justification and bounded
   reviewer steps. Submit the unsigned ingestion input only to the matching
   Partner Center product.
6. Complete certification and obtain the Store-signed package/listing. Inject
   its exact `https://apps.microsoft.com/...` URL through
   `VITE_PRESENTER_STORE_URL`, rebuild with the feature still OFF and verify the
   canonical CTA.
7. On clean supported local-account and school-account profiles, verify Store
   and Web Installer acquisition, install, first launch, sign-in startup,
   disable/re-enable startup, update deferral during a lecture, update after
   exit, repair, uninstall and reinstall. Both profiles must complete without
   adding or signing in to another Microsoft account.
8. On the Store-delivered exact package, verify real 32-bit and 64-bit desktop
   PowerPoint, Chrome and Edge loopback, single and extended displays, document
   changes, 500 transitions, rapid A-B-A, lost replies, COM loss, browser and
   Bridge restart, consent withdrawal, CNG deletion and manual handover.
9. With machine admission ON and the DB runtime gate OFF, verify direct-Edge,
   Gateway-secret, signature and nonce rejection separately. Then enable a
   bounded synthetic canary and measure teacher-to-Display/student rendering.
   Expand only after every gate passes. Roll back DB gate, machine admission
   and frontend flag in that order if acceptance fails.

## Current HOLD

- Store policy 10.14 account type, Partner Center onboarding, product
  reservation and exact package identity are unresolved.
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

General publication and the Presenter frontend/runtime gates remain OFF while
any item above is unresolved.

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
