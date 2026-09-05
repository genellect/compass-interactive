# COMPASS Presenter Bridge Microsoft Store submission runbook

Decision date: 2026-09-06. The preferred distribution path is a packaged MSIX
submitted to Microsoft Store. This avoids purchasing a public-trust code-signing
certificate for the Store package: Microsoft documents that Store-submitted
MSIX/AppX packages are re-signed after certification, while MSI/EXE submissions
are not. The MSIX engineering candidate is implemented; Store-identity
injection, package preflight, certification and publication remain HOLD. The
initial Store package version is `1.0.0.0`.

This runbook governs the authorized production work. The owner must still
personally handle Microsoft-account sign-in, identity verification, agreement
acceptance and any transmission of identity documents or other sensitive
personal data. Submission and publication remain subject to the evidence gates
below.

## Source-backed Microsoft requirements

- Start a new individual developer registration at
  [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com/). The
  current Microsoft onboarding page describes that entry path as free and
  requires the individual to sign in with a personal Microsoft account and
  complete government-ID/selfie verification. The owner must perform those
  steps personally. See [Open a developer account](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account?tabs=individual).
- Reserve the product name, then complete pricing/availability, properties,
  age rating, package, Store listing and submission options. See
  [Create an app submission](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission).
- Upload a genuine MSIX-family package and use the Partner Center identity
  values exactly; they are case-sensitive. Run the Windows App Certification
  Kit before submission. See [App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
  and [Upload MSIX packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages).
- `runFullTrust` is a restricted capability and requires a complete explanation
  in Submission options. See [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations).
- Version 1 requires `<uap17:UpdateWhileInUse>defer</uap17:UpdateWhileInUse>`
  so a Store update cannot close the Bridge during a lecture. Microsoft lists
  Windows 11 version 24H2 (build 26100) as the minimum OS for that manifest
  element. Therefore set `TargetDeviceFamily MinVersion="10.0.26100.0"` and do
  not advertise Windows 10 or an older Windows 11 release for v1. See
  [uap17:UpdateWhileInUse](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap17-updatewhileinuse).
- Because the Bridge transmits identifiers and security metadata, supply the
  final privacy notice text or its stable public URL. Microsoft does not provide
  a privacy notice on the publisher's behalf. See [Support info and privacy](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info).
- For the lowest-friction licensing default, leave **Additional license terms**
  blank so Microsoft's Standard Application License Terms apply. Use custom
  terms only after owner/legal review approves them. See
  [Add additional information](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information).
- Certification notes should explain external dependencies and provide a usable
  test path. Microsoft states that online services must be available during
  review and that login-dependent products need reviewer access information.
  See [Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options).
- The Microsoft Store Web Installer is an acquisition front end for Store
  content: Microsoft states that it installs through the same API as the Store
  app and can open the Store app when prerequisites are not met. Its
  documentation does not promise anonymous acquisition and lists specific
  school-account limitations. Treat Store or Microsoft-account prompts as an
  acceptance risk, not as behavior the Web Installer bypasses. See
  [Microsoft Store Web Installer](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-use-store-web-installer-for-distribution).

## Store-channel engineering checklist

The Store MSIX engineering candidate is implemented alongside the existing
per-user Velopack EXE channel. It has not yet completed exact Partner Center
identity injection, local package preflight, WACK or Store ingestion. Complete
and review each item before creating a Partner Center submission:

- [ ] Inject the exact reserved Store identity and publisher into the dedicated
  Store packaging candidate for the reviewed `win-x64` self-contained binary.
  Target only `Windows.Desktop` and use package version `1.0.0.0`; do not guess
  Partner Center identity values.
- [ ] Set `TargetDeviceFamily MinVersion="10.0.26100.0"`, declare the `uap17`
  namespace and set `uap17:UpdateWhileInUse` to `defer`. Confirm the generated
  manifest retains those values before signing or upload.
- [ ] Include only reviewed binaries, required third-party notices and a
  link/copy of the final privacy notice. Confirm every bundled dependency
  permits Store binary redistribution. Do not require a custom binary-license
  file merely because the source repository has a separate evaluation license.
- [ ] Declare only capabilities actually required. Declare `runFullTrust`; do
  not add broad file-system, elevation, microphone, camera or account
  capabilities for convenience.
- [ ] Replace the Velopack installer/update/startup assumptions in the Store
  channel. Store-installed files live in a protected package location; the
  Store channel must use Store-managed updates and must not download/apply the
  external Velopack feed. Define a reviewed packaged startup task or a simple
  user launch path and verify opt-in/disable behavior.
- [ ] Preserve the exact canonical HTTPS Gateway and Admin Origin pins. A Store
  package must not introduce teacher-controlled endpoint overrides, embedded
  secrets or a Production bypass.
- [ ] Verify package install, first launch, Windows sign-in startup behavior,
  Store update while a lecture is active, rollback/previous-version recovery
  where supported, repair and uninstall on a clean standard-user Windows 11
  24H2 device. Confirm an update is deferred until the Bridge exits or Windows
  restarts and does not interrupt the active lecture.
- [ ] Defer Windows 10 and older Windows 11 expansion until real update-in-use
  tests establish an equally safe package/update design without relying on the
  `uap17` element.
- [ ] Verify that package virtualization does not break the per-user CNG proof
  key, loopback server on `127.0.0.1:43124`, PowerPoint COM attachment, process
  identity checks, tray behavior or clean shutdown.
- [ ] Run the Windows App Certification Kit and retain its report for the exact
  package hash. Resolve failures before public release; a package flight does
  not waive general-release requirements.
- [ ] Record package SHA-256, version, architecture, source commit, Partner
  Center identity values and WACK result without recording credentials.

## Proposed `runFullTrust` justification

Use this as a factual draft, then update it to match the final manifest and
package exactly:

> COMPASS Presenter Bridge is a Windows desktop companion for educators who use
> Microsoft PowerPoint with an authorized COMPASS Interactive lecture. The
> package contains a medium-integrity Win32/.NET Windows Forms process. It uses
> PowerPoint's desktop COM automation surface to attach to an already-running
> POWERPNT process, inspect the saved presentation's slide IDs and current
> slideshow state, and compute local SHA-256 binding hashes. It also hosts an
> exact-Origin-protected loopback endpoint on 127.0.0.1 so the educator's
> COMPASS web session can pair the local Bridge, and it sends signed,
> content-free page metadata to the fixed COMPASS Presenter HTTPS endpoint.
> These Win32 COM, local process and loopback operations require the desktop
> app to run at medium integrity and cannot be implemented by an AppContainer
> package without removing the product's PowerPoint integration. The app does
> not request elevation, launch or close PowerPoint, read slide text or notes,
> upload presentation files, or access another Windows user's processes. It
> declares no restricted capability other than runFullTrust.

Before submission, compare the final sentence with the generated manifest. If
another restricted capability is present, remove it or provide its own accurate
justification and approval evidence.

## License terms decision

Make and record exactly one choice immediately before submission:

- **Recommended initial default — Microsoft Standard Application License
  Terms:** leave Partner Center's **Additional license terms** field blank.
  Do not upload, package or link the custom binary-license draft as customer
  terms. Confirm the owner accepts this choice in the context of the App
  Developer Agreement; this runbook is not legal advice.
- **Optional custom terms:** use
  `docs/PRESENTER_BRIDGE_BINARY_LICENSE_DRAFT.md` only after owner/legal review
  approves final wording. Enter the approved text or its stable public URL in
  **Additional license terms**, and ensure the package/listing do not present a
  conflicting version.

The root source-evaluation `LICENSE` continues to govern repository source. It
is not changed by either Store-listing choice and does not itself need to be
presented as the Store binary's customer license.

## Synthetic certification reviewer flow

Certification must not use private lecture content, an owner account, shared
Google credentials, a TOTP seed, a recovery code, Production data or a bypass
of server authorization.

1. Prepare a dedicated non-Production review environment at the same security
   level as Production, with Presenter flags enabled only for the review window.
   Create a synthetic 12-page PDF and matching saved 12-slide PPTX containing
   large page numbers and no personal or third-party material.
2. Provide concise certification notes: supported Windows/Office versions,
   `win-x64`, PowerPoint required, exact review URL, service availability window,
   the privacy URL, and the `runFullTrust` justification.
3. Define a reviewer-access mechanism that is practical for asynchronous Store
   certification and remains consistent with the Google/TOTP and own-lecture
   authorization contract. This mechanism does not exist in the current source.
   Do not submit until it has been implemented and security-reviewed. Never
   send the owner's password, shared Gmail credentials, TOTP seed, recovery
   codes, application-session tokens or Presenter secrets in certification
   notes.
4. Reviewer installs from the Store certification channel, launches the Bridge
   from Start, opens the synthetic PPTX in desktop PowerPoint, saves it locally,
   and starts one ordinary all-slides windowed or Speaker slideshow with
   Presenter View OFF.
5. Reviewer opens the synthetic COMPASS lecture, pairs the Bridge, confirms the
   exact 12-page match, advances/returns/jumps between slides, and observes the
   Display/student test clients follow the PDF page. Changing the PPTX order or
   bound document must stop synchronization and require a fresh inspection.
6. Reviewer disconnects, exits the slideshow and closes the Bridge. The web app
   must fall back to manual page controls. Record no credentials or content in
   screenshots or logs.

The current five-minute manual code cannot serve as an asynchronous reviewer
credential by itself. A reviewer flow that cannot be exercised without live
owner intervention is not ready for submission.

## Product requirements and listing draft

**Product name:** COMPASS Presenter Bridge (subject to name reservation)

**Short description:** PowerPoint page synchronization for authorized COMPASS
Interactive lectures.

**Customer description:**

> COMPASS Presenter Bridge connects a saved Microsoft PowerPoint presentation
> on your Windows PC to an authorized COMPASS Interactive lecture. After you
> pair the Bridge from the educator workspace and confirm the matching lecture
> PDF, changing the current PowerPoint slide updates the shared COMPASS page.
> The Bridge sends hashes and page metadata, not the presentation file or slide
> text. It is intended for educators who already have access to a COMPASS
> Interactive environment.

**Japanese listing draft:**

> COMPASS Presenter Bridgeは、Windows PC上の保存済みMicrosoft PowerPoint
> プレゼンテーションを、権限のあるCOMPASS Interactive講義に接続します。
> 教員ワークスペースからBridgeをペアリングし、講義PDFとの一致を確認すると、
> PowerPointの表示スライド変更がCOMPASSの共有ページへ反映されます。Bridgeが
> 送信するのはハッシュとページ同期用メタデータで、プレゼンテーションファイル
> やスライド本文は送信しません。既にCOMPASS Interactiveの利用権限を持つ教員
> 向けの補助アプリです。

**Required disclosure near the listing:**

- Version 1 requires Windows 11 version 24H2 (build 26100) or later and a local
  installation of desktop Microsoft PowerPoint; PowerPoint and Microsoft 365
  are not included.
- An authorized COMPASS Interactive educator session, a prepared open lecture
  and its published matching PDF are required.
- Supported shows are one ordinary all-slides windowed show or Speaker
  full-screen show with Presenter View OFF. Hidden slides, custom/partial shows,
  kiosk/unknown modes, multiple slide shows and unsaved files are unsupported.
- The Store price is planned as **Free**. This does not include PowerPoint,
  Microsoft 365, network or institutional-service costs.
- The Bridge itself does not include a Microsoft-account sign-in. Microsoft
  Store acquisition, including Web Installer acquisition, may still ask the
  educator to sign in or add a Microsoft account. No-additional-auth behavior
  is a P1 pending acceptance test and must not be advertised as verified.

Do not claim universal Office compatibility, Presenter View support,
five-second end-to-end latency, offline operation, automatic content matching,
Store certification or Production availability until the corresponding gate
has passed.

## Partner Center submission checklist

- [ ] Owner chooses Individual versus Company before registration; Microsoft
  documents that an Individual account cannot later be converted to Company.
- [ ] Owner personally completes free-entry onboarding, Microsoft-account sign
  in, identity verification and all required agreement/contract acceptance.
- [ ] Product name and publisher display name are reserved and approved.
- [ ] Base price is Free; markets, audience, discoverability and schedule are
  intentionally selected. Use a publication hold until all gates pass.
- [ ] Category, age rating, system requirements and product declarations match
  the actual binary and service.
- [ ] Final privacy notice has owner/legal approval and a stable public URL;
  support contact and website are owner-approved and reachable.
- [ ] Explicitly select one license path: leave **Additional license terms**
  blank for Microsoft Standard Application License Terms, or enter only the
  owner/legal-approved custom terms or stable URL. Record the choice.
- [ ] Owner/legal review approves consistent Japanese and English versions of
  the privacy notice and customer-facing disclosures. If custom license terms
  are selected, review their language versions as well.
- [ ] Store logo, icons and screenshots contain only approved synthetic content
  and pass the asset-provenance review.
- [ ] Exact MSIX package passes local install tests and WACK; package identity
  matches Partner Center, version is `1.0.0.0`, minimum OS is
  `10.0.26100.0`, and hashes and test evidence are frozen.
- [ ] `runFullTrust` is the only restricted capability and its justification
  matches the package.
- [ ] Synthetic reviewer environment and asynchronous access mechanism are
  online, bounded and tested without shared secrets or Production data.
- [ ] Certification notes contain dependencies, supported flow and safe test
  instructions, with no credentials beyond a separately approved reviewer
  mechanism.
- [ ] **P1:** On a clean Windows 11 24H2 local-account profile with no Microsoft
  account added to Windows or the Store, test acquisition through the selected
  public Store link and the Web Installer path, installation, first launch and
  pairing. Record every account prompt and resulting account state.
- [ ] **P1:** Repeat the same acquisition/install/launch/pairing flow on a clean
  supported school-account profile under representative school policy. Record
  Store/Web Installer eligibility, policy blocks and every account prompt.
- [ ] Both P1 profiles complete the teacher flow without a request to sign in
  to or add another Microsoft account. If either profile requires an added
  Microsoft account, the no-additional-auth requirement fails and the public
  Store-only rollout remains HOLD.
- [ ] On the accepted profiles, COMPASS authentication remains the only product
  login and the Bridge never introduces a separate Microsoft sign-in.
- [ ] Device/Human/Hosted gates in `docs/PRESENTER_PRODUCTION_RELEASE.md` pass on
  the Store-delivered exact package.
- [ ] Owner reviews the final listing, selected license path, privacy notice,
  price, markets, audience and publication hold immediately before pressing
  Submit.

## Current HOLD items

- Partner Center developer account, account type, identity verification,
  agreements and product-name reservation are not confirmed.
- The Store MSIX engineering candidate is implemented. Exact Partner Center
  identity injection, clean package generation, WACK, Store ingestion and
  Store-delivered startup/update acceptance remain pending.
- Version 1 is fixed at package version `1.0.0.0`, Windows 11 24H2/build 26100
  minimum and `uap17:UpdateWhileInUse=defer`. Real active-lecture update tests
  are pending. Windows 10 and older Windows 11 expansion remains deferred.
- The license path has not been selected. The recommended initial option is
  Microsoft Standard Application License Terms with **Additional license
  terms** blank. Custom terms remain optional and require owner/legal review.
- Privacy legal review, support/privacy contact and public privacy URL are not
  complete.
- Cloudflare/Supabase hosted log, backup, region and processor details remain to
  be verified for the final privacy notice.
- An asynchronous synthetic certification access flow has not been designed or
  accepted within the current authentication contract.
- WACK, Store ingestion, restricted-capability approval, certification and
  Store-delivered device tests have not run.
- Free pricing is selected as the intended Store setting; it is not a submitted
  or accepted Partner Center result. Clean local-account and school-account P1
  acquisition tests have not established no-additional-auth behavior. The Web
  Installer does not remove this evidence requirement. If either path prompts
  for an added Microsoft account, public Store-only rollout remains HOLD.
