# Presenter production release candidate

Decision date: 2026-09-05. This record extends the signed activation contract
with the owner's current product requirements and delegated infrastructure
selection. It does not claim that a release, signature or device test passed.

On 2026-09-06 the owner selected Microsoft Store MSIX as the preferred
distribution path so the Store can sign the certified package without an
annual public-trust certificate purchase. The MSIX engineering candidate is
implemented; Partner Center identity injection, packaging preflight, onboarding
and Store review are not complete. Version 1 is fixed at package version
`1.0.0.0` with Windows 11 24H2/build 26100 as its minimum because safe
update-in-use deferral depends on `uap17:UpdateWhileInUse=defer`. The release
documents are:

- `docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md` — packaging, listing,
  `runFullTrust`, reviewer and submission gate;
- `docs/PRESENTER_BRIDGE_BINARY_LICENSE_DRAFT.md` — optional custom Store-binary
  terms, used only if selected after owner/legal review; and
- `docs/PRESENTER_BRIDGE_PRIVACY_NOTICE_DRAFT.md` — Bridge-specific privacy
  notice draft based on current code and migrations.

## Owner decisions and deployment identity

The owner requested autonomous completion of the PowerPoint production
release, accepted the proposed implementation, and identified the publisher as
**Yuto Matsui / 松井優知**. Under the former certificate-dependent fallback, the
certificate subject would have to use the actual CA-validated spelling; a
locally self-signed certificate would not be a substitute. The Store package
must instead use the exact Partner Center identity assigned after the owner's
verification.

| Resource                  | Selected value                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| Cloudflare account        | `f60a242ad3132b1a7ba11839c23d76f7`                                            |
| Zone                      | `yuto-matsui.com`, `68e9bb3faf02379bfcce2ee019e28326`                         |
| Gateway                   | `compass-presenter-gateway-production`                                        |
| Machine endpoint          | `https://presenter-api.yuto-matsui.com/functions/v1/presenter-bridge-session` |
| Anonymous update feed     | `https://presenter-updates.yuto-matsui.com`                                   |
| Production release bucket | `compass-presenter-updates-production`                                        |
| Signing environment       | `presenter-production-signing`                                                |
| Product                   | COMPASS Presenter Bridge                                                      |

The active Full zone and all eight DNS records were inspected on 2026-09-05;
neither proposed Presenter hostname conflicted with an existing record. The
three existing Workers were inventoried. The asset Worker used only rate
namespaces `6601` and `6602`; the two older application Workers had no
bindings. The Presenter namespaces `72931` and `72932` were unused in that
inventory. Recheck immediately before a delayed deployment.

Local `wrangler.jsonc` stays unrouted. The separate production config is
selected explicitly; ordinary development does not deploy it. The existing
apex website, email routes and private PDF bucket are separate resources.

The dedicated Standard R2 bucket was created in APAC on 2026-09-05. Its
update custom domain has active ownership and TLS, with minimum TLS 1.2;
the `r2.dev` public endpoint remains disabled. The bucket is empty. This is
distribution infrastructure readiness, not a published installer or feed.
The selected signing environment is a reserved name, not a created or
credentialed signing service. No public-trust certificate has been issued.
That certificate-dependent Velopack/EXE route is retained only as a historical
fallback design. The preferred Store MSIX route instead requires the owner's
Partner Center onboarding and identity verification, followed by package
certification and Store re-signing.

## Classroom acceptance

After installing the signed per-user application and preparing the lecture,
the teacher advances the lecture using PowerPoint. The happy path has no
CLI, recovery-code entry or fresh MFA challenge. The existing bounded Google
Admin session supplies authority; live session, membership, ownership,
factor-set, document and lecture validity are still checked on the server.

One initial confirmation binds the exact PDF version to the inspected PPT
content/order/settings. An unchanged binding may reuse a bounded nonsecret
consent marker after fresh inspection. A changed file requires a new match
confirmation; equal page counts alone never prove matching content. Tabs and
browser reload must preserve or rediscover the active connection without
silently issuing a competing connection. Routine operation must not require
the teacher to revisit a settings panel.

The release fails acceptance if it requires complex UI work, extra
authentication, teacher CLI use, or transitions slow enough to interrupt a
lecture. A mock test does not establish classroom latency or reliable Office
behavior.

The owner's subsequent scope decision keeps the existing **five-second**
foreground student snapshot/delta loop for this release, including its
initial phase spread and no recurring jitter. The proposed three-second
Presenter-specific interval was withdrawn before release. At 300 foreground
students the existing model is 60 requests/second and 324,000 requests per
90 minutes; this calculation is not a measured capacity or a guarantee of
five-second rendered latency.

Measure from a real PPT change to **rendered** Display and student page,
including worst polling phase, cold/neighbor page loading and a full 300
student fixture. Record p50/p95/p99/max and each missed or incorrect page.
Record visible/following student latency without claiming a bound that the
unchanged five-second polling period cannot establish.
Hidden tabs, offline clients and deliberate student unfollow are separate
states; restoring visibility/follow must converge without a teacher action.
The Display target is p95 at most one second, with every outlier reviewed for
classroom impact. Do not label the candidate accepted on a calculated budget.

## Release order

1. Freeze one reviewed candidate after native, UI, authority/lease, clean and
   upgrade DB, concurrency and browser tests pass. Observe all five required
   checks and preserve the exact merge/deployment revisions.
2. Place additive DB fixes, the dedicated machine Edge and Gateway with
   Presenter admission and the database runtime gate disabled. Inject
   separately generated Gateway and capability secrets without displaying
   them. Verify placement, disabled admission, and the Gateway's independent
   method/Origin/proof-shape rejection. An admission-OFF Edge returns 503
   before authentication; this does not prove Gateway-secret, cryptographic
   proof or nonce-replay enforcement.
3. Build a packaged MSIX using the exact Partner Center identity, package
   version `1.0.0.0`, `TargetDeviceFamily MinVersion="10.0.26100.0"` and
   `uap17:UpdateWhileInUse=defer`. Submit only through the Microsoft
   Store path described in the Store runbook; do not publish the existing
   Velopack EXE/update feed as the preferred public channel. Microsoft Store
   certification, rather than an owner-purchased public-trust certificate, must
   establish the distributed package signature. Outside-Store distribution
   remains a separate signing decision.
   For Store customer licensing, explicitly choose Microsoft Standard
   Application License Terms by leaving **Additional license terms** blank, or
   use only custom terms approved by owner/legal review.
4. Complete Store-delivered fresh install/update/uninstall/rollback, real
   Office architecture
   coverage, Chrome/Edge local-network access and 500 native transitions,
   document switching, rapid A–B–A, lost replies, COM loss, browser/native
   restart and safe manual handover on that signed candidate.
   Prove on real hardware that a Store update during an active lecture is
   deferred without closing the Bridge. Keep Windows 10 and older Windows 11
   outside the v1 support matrix until an equally safe update path passes real
   update-in-use tests.
5. Enable machine admission with the DB runtime gate still disabled. Verify
   direct-Edge denial and Gateway-secret and cryptographic-proof enforcement.
   Then enable the DB runtime gate and a bounded frontend canary. Verify
   nonce replay, revoked authority and terminal lease behavior on synthetic
   canary connections. Run the real teacher–Display–student path and record latency/load evidence.
   Expand only after these pass. Roll back the DB gate, machine admission and
   frontend flag in that order if they fail; retain the additive schema.

Current authorization covers the production work described here, subject to
its release gates. The owner must personally control Microsoft-account sign-in,
Partner Center identity verification, acceptance of Microsoft agreements and
the transmission of identity documents or other sensitive personal data.
Neither authorization nor submission alone constitutes evidence that Store
certification, active-update safety or real-device acceptance passed.

## Follow-up after the PPT release

The owner wants a separate, minimal classroom UX and synchronization release
after this PPT integration reaches production. Evaluate a three-second or
faster rendered transition using selective Realtime notifications for slide
changes, live polls and comments. Keep snapshot/delta as the authoritative
recovery path and retain load controls; do not subscribe every feature or
send each student's state as high-frequency broadcast traffic.

Assess a 300-student lecture on Supabase Pro, including measured concurrent
connections, messages, database load, network use and cost. Pro and necessary
paid expansion are acceptable in principle within an agreed budget. The
exact budget, billing change and rollout belong to that follow-up; this
release does not change the Supabase plan or student polling policy.
