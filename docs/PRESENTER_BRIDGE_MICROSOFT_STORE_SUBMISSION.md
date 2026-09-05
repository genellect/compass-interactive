# COMPASS Presenter Bridge Microsoft Store submission runbook

Decision date: 2026-09-06. Source baseline:
`c0f62fa491f0c01691dbe680c1fa7f49ddd0fbb7`.

COMPASS Presenter Bridge version 1 uses Microsoft Store ingestion, signing,
delivery and update of a packaged MSIX. It is not distributed through the old
Direct Velopack EXE or anonymous update feed. The Store engineering source is
implemented, but Partner Center identity, WACK, Store certification, Store
signature and final device acceptance remain **HOLD**.

The owner personally controls Microsoft-account sign-in, developer-account
verification, agreement acceptance and transmission of identity documents.
Never copy credentials, government-ID images, selfie material, recovery data or
session tokens into source, logs, screenshots, evidence or agent prompts.

## Fixed Partner Center values

Enter these values exactly for the initial submission:

| Partner Center field | Required value |
| --- | --- |
| Product name | COMPASS Presenter Bridge, after exact reservation |
| Package version | `1.0.0.0` |
| Architecture | x64 |
| Device family | Windows Desktop |
| Minimum OS | Windows 11 version 24H2 / `10.0.26100.0` |
| Package/listing language | `ja-JP` |
| Market | Japan only |
| Base price | Free |
| Audience | Public audience |
| Discoverability | Make this product available but not discoverable in the Store |
| Acquisition | Direct link only |
| License | Microsoft Standard Application License Terms |
| Additional license terms | Leave blank |
| Privacy policy URL | `https://compass-interactive.pages.dev/presenter-bridge/privacy/` |
| Restricted capability | `runFullTrust` only |

Public audience plus Direct-link-only discoverability is intentional. It keeps
the listing out of search and browse while allowing a teacher with the exact
link to acquire it. Microsoft documents that Public audience cannot be changed
to Private audience after the first public submission. Check the values again
immediately before Submit; do not accept Partner Center defaults for all
markets or discoverable distribution.

No custom customer terms are used for version 1. Leave **Additional license
terms** blank so the Microsoft Standard Application License Terms apply. Do not
upload, package or link a separate terms document. The repository's source
evaluation `LICENSE` continues to govern source access; it is not entered as
Store customer terms.

## Source-backed Microsoft requirements

- Register through Microsoft's current developer onboarding and reserve the
  product before generating a submission package. See
  [Open a developer account](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account)
  and
  [Create an MSIX app submission](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission).
- As of 2026-09-06, Microsoft's new onboarding flow states that neither account
  type has a registration fee. Recheck the displayed amount before completing
  registration; Store certification, rather than a separately purchased public
  code-signing certificate, signs the customer-distributed package.
- Account type remains unresolved. [Store policy 10.14](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1014-account-type)
  requires a Company account for an organization, business, or a person acting
  in relation to a trade or profession; an Individual account is usually for
  one developer working on their own. `Yuto Matsui` as a personal publisher
  name does not by itself settle the classification.
- Copy the exact, case-sensitive Package/Identity values from the reserved
  Partner Center product. Run WACK before upload. See
  [App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
  and
  [Upload MSIX packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages).
- `runFullTrust` is restricted and needs an accurate explanation in Submission
  options. See
  [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations).
- `uap17:UpdateWhileInUse=defer` requires build 26100 or later. Keep older
  Windows releases outside version 1 until an equally safe update design passes
  its own device gate. See
  [uap17:UpdateWhileInUse](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap17-updatewhileinuse).
- Microsoft requires a stable privacy policy URL when an app collects or
  transmits personal information. See
  [Support info and privacy](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info).
- Leaving **Additional license terms** blank selects Microsoft's Standard
  Application License Terms. See
  [Add additional information](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information).
- A login-dependent product must be testable and its online service must remain
  available during review. See Store policies 10.3.1 and 10.3.2 and
  [Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options).
- The Store Web Installer uses Store acquisition APIs and may fall back to the
  Store app. It does not promise anonymous acquisition on every device. See
  [Microsoft Store Web Installer](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-use-store-web-installer-for-distribution).
- [Visibility options](https://learn.microsoft.com/en-us/windows/apps/publish/beta-testing-and-targeted-distribution)
  distinguish Public audience from Direct-link-only discoverability. Record
  both selections rather than calling the product private.

## Account and identity gate

Before registration, the owner must resolve policy 10.14 against the actual
publishing purpose. If Microsoft requires a Company account, complete its
business verification and public support-contact requirements; do not select
Individual merely to simplify onboarding. If Individual is appropriate, the
owner completes its personal verification. Record the resulting account type
without storing verification documents.

Reserve the product and copy these exact values from Partner Center:

- Package/Identity/Name;
- Package/Identity/Publisher; and
- publisher display name.

Do not invent a Product ID, publisher DN, Store URL or package identity. The
manifest publisher must match Partner Center exactly. A local development
identity and self-signed certificate are never uploaded as the production
submission.

## Package engineering and preflight

Implemented source includes:

- `presenter-bridge/store/AppxManifest.template.xml`;
- `presenter-bridge/store/Build-PresenterStorePackage.ps1`;
- `presenter-bridge/store/Test-PresenterStorePackage.ps1`;
- the Store compile boundary that removes Velopack dependency, boot hook,
  update UI and external feed access; and
- license and third-party notice inventory in the package receipt.

The Store manifest fixes x64, `ja-JP`, Windows Desktop build 26100 minimum,
packaged classic-app medium integrity, enabled startup task,
`uap17:UpdateWhileInUse=defer` and only `runFullTrust`. The inspected receipt
records source commit `1beea714b1f79089c2c1f78cf694c37307d565d9` and identity
`CompassPresenterBridge.Development`; its unpacking preflight passed with 413
published files and no Velopack/update-feed payload. That result does not replace
the clean Partner Center package or WACK.

The builder generates the three manifest tile assets referenced by the package:
`StoreLogo.png` at 50 px, `Square150x150Logo.png` at 150 px and
`Square44x44Logo.png` at 44 px. Preflight confirms the files are confined to the
expected package inventory. This is structural evidence only. Review those tiles
for final branding and licensing, prepare the separate Partner Center listing
artwork/screenshots with synthetic data, and pass WACK and Store ingestion before
treating any asset as accepted.

Build the final ingestion input only from the frozen clean source SHA. Use the
exact reserved identity and the Standard terms switch:

```powershell
pwsh ./presenter-bridge/store/Build-PresenterStorePackage.ps1 `
  -Version '1.0.0.0' `
  -OutputRoot '<new-empty-staging-directory>' `
  -SourceCommit '<frozen-reviewed-40-character-sha>' `
  -IdentityName '<exact-Partner-Center-identity-name>' `
  -Publisher '<exact-Partner-Center-publisher-DN>' `
  -PublisherDisplayName '<exact-Partner-Center-display-name>' `
  -UseMicrosoftStandardApplicationLicenseTerms `
  -MakeAppxPath '<Microsoft-signed-SDK-26100+-makeappx.exe>' `
  -DotnetPath '<pinned-dotnet-10-path>' `
  -PartnerCenterIdentityConfirmed
```

Do not pass `AdditionalLicenseTermsPath`. Preserve the package and receipt
hashes, source SHA, SDK/MakeAppx identity, notices and preflight result. Never
publish an artifact marked development-only or local-device-test-only. Upload
only the unsigned Partner Center submission input to the matching reserved
product; Microsoft Store certification supplies the customer-distributed
signature.

## `runFullTrust` justification

Update this text only if the final package behavior changes:

> COMPASS Presenter Bridge is a Windows desktop companion for educators who use
> Microsoft PowerPoint with an authorized COMPASS Interactive lecture. The
> package contains a medium-integrity Win32/.NET Windows Forms process. It uses
> PowerPoint desktop COM automation to attach to an already-running POWERPNT
> process, inspect the saved presentation's slide IDs and current slideshow
> state, and compute local SHA-256 binding hashes. It hosts an
> exact-Origin-protected loopback endpoint on 127.0.0.1 so the educator's
> authenticated COMPASS web session can pair the local Bridge, and sends signed,
> content-free page metadata to the fixed COMPASS Presenter HTTPS endpoint.
> These Win32 COM, local process and loopback operations require medium-integrity
> desktop execution. The app does not request elevation, launch or close
> PowerPoint, read slide text or notes, upload presentation files, or access
> another Windows user's processes. It declares no restricted capability other
> than runFullTrust.

Compare the last sentence with the generated manifest and WACK input. Remove
any unnecessary capability; do not add elevation, broad file-system, camera,
microphone or account capabilities.

## Privacy publication gate

The bilingual source notice is
`public/presenter-bridge/privacy/index.html`, and the only Partner Center URL is
`https://compass-interactive.pages.dev/presenter-bridge/privacy/`. The two former
draft Markdown notices are not release artifacts and are removed.

The 2026-09-06 external check received HTTP 200 at the canonical URL but the
body was the COMPASS Interactive SPA shell, not the Presenter privacy notice.
Therefore the public privacy gate is still failing. Deploy the static notice
with the Presenter feature OFF and verify the exact title and bilingual body,
headers, contact target, responsive layout, console state and direct navigation
before submission. A 200 SPA fallback does not pass this gate.

## Certification reviewer access

The source now implements a bounded reviewer path. Only an authenticated Owner
may select **Microsoft Store審査用アクセスを発行** in **教員管理**. The server
fixes the result to:

- one normalized Google email bound to the request and environment;
- `role=instructor`;
- `can_use_ai=false`;
- invitation expiry seven days after issuance; and
- membership expiry fourteen days after the same issuance time.

The reviewer must use a new Google account dedicated to this review and
controlled by that reviewer. The owner invites the address but does not create,
receive or share its password, TOTP seed, recovery code or session. Do not put
any owner/reviewer credential, Admin token, invitation secret, Presenter
capability, Gateway secret or pairing material in certification notes. If the
certification team cannot use reviewer-controlled credentials, keep the
submission on HOLD and resolve the test path with Microsoft; do not create a
shared account or authentication bypass.

Use a synthetic 12-page PDF and matching saved PPTX. It may contain generated
text, shapes, charts, one sample poll and one sample comment prompt. Include no
real student, patient, research, institution or unpublished content. The review
steps cover install, first launch, normal Google/TOTP onboarding, one privacy
consent, PDF/PPT match, sequential and rapid back/forward slide changes,
Display/student following, poll/comment display, reconnect, handover and close.
Routine lecture progress must not request another login, TOTP code, recovery
code or CLI action.

At review completion, the Owner immediately cancels a pending invitation or
uses **教員権限を抹消**, then verifies its Admin sessions are inactive. Fixed
expiry is only a backstop. Issue a fresh bounded invitation if review exceeds a
deadline; never extend or promote the old membership.

The UI and signed server contract are implemented and locally tested in source.
Hosted deployment and real reviewer issuance, onboarding, expiry and revocation
are not verified.

## Listing and dependency disclosure

**Product name:** COMPASS Presenter Bridge, subject to reservation.

**Short description:** PowerPoint page synchronization for authorized COMPASS
Interactive lectures.

**Japanese description:**

> COMPASS Presenter Bridgeは、Windows PC上の保存済みMicrosoft PowerPoint
> プレゼンテーションを、権限のあるCOMPASS Interactive講義に接続します。
> 教員ワークスペースで講義PDFとの一致を確認すると、PowerPointの表示スライド
> 変更がCOMPASSの共有画面へ反映されます。送信するのは資料と順序のハッシュ、
> ページ番号、枚数、接続・安全性メタデータで、PPTX本体、本文、ノート、画像、
> 動画は送信しません。

Place the required dependency at the beginning of the Store description:

- Windows 11 version 24H2/build 26100 or later;
- x64 Windows device;
- installed desktop Microsoft PowerPoint, which is not included;
- an authorized COMPASS Interactive educator session;
- an open lecture with its matching published PDF; and
- one ordinary all-slides windowed or Speaker full-screen slideshow with
  Presenter View off.

Hidden slides, custom/partial shows, kiosk/unknown modes, multiple simultaneous
shows and unsaved files are unsupported. Do not claim universal Office support,
Presenter View support, five-second end-to-end student rendering, offline
operation, Store approval or general production availability before their gates
pass.

## Store URL injection

After the product listing exists, copy the exact Partner Center web URL. It must
be an HTTPS URL on `apps.microsoft.com`. Set that full value as
`VITE_PRESENTER_STORE_URL` only in the reviewed Production build environment.
The frontend must hide the installation CTA if the value is missing or invalid
and must reject every other scheme or host.

Do not derive a URL from a guessed Product ID, use an `ms-windows-store:` URI,
host a downloaded Web Installer stub, or fall back to
`presenter-updates.yuto-matsui.com`. Verify the final static bundle and the
rendered educator CTA both contain the exact reviewed Store link and contain no
old EXE/feed URL. A `VITE_` value is public configuration, so it may contain the
Store URL only and never any secret or credential.

## Device and classroom gate

Use the exact Store-signed package acquired from the final listing or approved
Store flight. Test on clean supported profiles:

1. local Windows account with no Microsoft account added to Windows or Store;
2. representative school account under school policy;
3. Office 32-bit; and
4. Office 64-bit.

For both account profiles, test the direct Store link and Store Web Installer,
record every prompt and resulting account state, and require completion without
adding or signing in to another Microsoft account. The Bridge introduces no
separate login or entitlement screen. If either profile needs another account,
the no-added-auth requirement fails and the public Store-only rollout stays on
HOLD.

On the accepted package, verify install, automatic first launch where promised,
startup after Windows sign-in, user disable/re-enable behavior, no UAC/admin
requirement, loopback in unmodified Chrome and Edge, CNG identity, tray, repair,
uninstall/reinstall, update during and after a lecture, and clean removal
instructions. Any requirement for PowerShell, winget, certificate trust,
`CheckNetIsolation` or other teacher CLI fails acceptance.

Then run PowerPoint with single/extended displays, document replacement,
rapid A-B-A, lost replies, COM loss, browser/native restart, consent withdrawal,
manual handover and at least 500 transitions. Measure PPT action through final
Display/student canvas render, not only COM observation or server receipt.

## Existing evidence and its limit

- The receipt-backed Store-compiled development binary from source commit
  `1beea714b1f79089c2c1f78cf694c37307d565d9` returned
  `powerpointReady=true` in 539 ms on one current Windows/Office device. The
  package was a bounded locally signed development copy, not Store-signed or
  Store-acquired.
- The earlier native harness completed 500/500 synthetic transitions with zero
  wrong-page commits, median 152 ms, p95 170 ms and maximum 206 ms. It covered
  x64 unsigned harness, Office 16 32-bit, one monitor, Speaker full-screen with
  Presenter View off, COM observation and a 100 ms stable tracker.
- Neither result covers the final Partner identity, Store signature/acquisition,
  64-bit Office, extended display, Store servicing, browser/Gateway/Supabase,
  Display render or student render.

## Submission checklist

- [ ] Owner resolves Individual versus Company under Store policy 10.14 and
  completes the matching verification and agreements.
- [ ] Product name and exact package/publisher identity are reserved.
- [ ] Market is Japan; language is `ja-JP`; version is `1.0.0.0`; architecture
  is x64; minimum OS is build 26100.
- [ ] Base price is Free; Audience is Public; Discoverability is available but
  not discoverable; acquisition is Direct link only.
- [ ] Microsoft Standard Application License Terms are selected by leaving
  Additional license terms blank; no custom terms file or URL is supplied.
- [ ] Canonical privacy URL serves the actual bilingual notice, not the SPA.
- [ ] Final listing and assets use only approved synthetic/licensed content and
  disclose PowerPoint and COMPASS dependencies; package tiles and Partner Center
  artwork/screenshots are visually reviewed and accepted.
- [ ] Frozen clean package uses exact Partner Center identity and passes package
  preflight and WACK; source/package/tool/notice hashes are retained.
- [ ] `runFullTrust` is the sole restricted capability and its explanation
  matches the exact binary.
- [ ] Owner-only bounded reviewer access is deployed and tested with a
  reviewer-controlled dedicated Google account and no shared credentials.
- [ ] Store certification succeeds and the distributed artifact is Store-signed.
- [ ] Exact `https://apps.microsoft.com/...` URL is injected as
  `VITE_PRESENTER_STORE_URL`; no Direct EXE/feed URL remains in the build or UI.
- [ ] Clean local-account and school-account acquisition completes without an
  added Microsoft login or teacher CLI action.
- [ ] Store-signed package passes x86/x64 Office, startup/update/uninstall,
  loopback, extended-display and 500-transition gates.
- [ ] Real Display and student rendered-latency/load evidence passes the release
  contract before Presenter admission is expanded.

## Current HOLD items

- Store policy 10.14 account type and Partner Center registration are unresolved.
- Product reservation, exact package identity and exact Store URL do not exist.
- The canonical privacy URL serves the main SPA shell rather than the notice.
- The final `VITE_PRESENTER_STORE_URL` build and UI proof are incomplete.
- Exact Partner package preflight, WACK, ingestion, `runFullTrust` approval,
  certification and Store signing are incomplete.
- Final package-tile review and Partner Center listing-asset preparation and
  acceptance are incomplete.
- Hosted/human reviewer issuance and post-review revocation are unverified.
- Clean-device no-added-auth acquisition is unverified.
- Store-signed Office x86/x64, startup/update/uninstall, extended-display and
  final 500-transition acceptance are unverified.
- Display and student rendered latency, including staged 300-student load, is
  unverified.

Keep the Presenter browser, machine and database runtime gates OFF while any
item remains unresolved. The separate later phase may evaluate three-second
transitions, selective Realtime and Supabase Pro; this submission does not
change the current five-second student polling or Supabase plan.
