# Microsoft Store MSIX lane

This directory packages the existing WinForms, PowerPoint COM, loopback and
per-user CNG P-256 bridge as an x64 self-contained MSIX. It does not reserve a
Store product, invent a Product ID or identity, access Partner Center, submit a
package, or publish one.

The initial v1 listing and manifest are Japan-only (`ja-JP`). The native tray,
confirmation, recovery and error UI is Japanese and is not represented as an
English-localized product. Add another Store language only after every native
user-facing string and listing asset has been localized and device-tested.

`PresenterDistribution=Store` removes the Velopack package reference, startup
bootstrap, feed client, update menu and update coordinator at compile time.
The ordinary `Direct` build remains the compile-time default only to preserve
historical development and regression coverage. Its EXE and anonymous update
feed are not public release channels and must not be published, linked or
distributed. This Store README and
[`../../docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md`](../../docs/PRESENTER_BRIDGE_MICROSOFT_STORE_SUBMISSION.md)
are authoritative for version 1 distribution.

## Partner Center submission input

Reserve the product first, then copy the exact package `Identity/Name`,
`Identity/Publisher` and publisher display name shown by Partner Center. A
Partner Center Product ID is a separate value and is intentionally not an input
to this MakeAppx script. Never infer or fabricate any of these values.

### Required public-CI preflight

After the frozen release SHA has landed on reviewed `main`, run **Presenter
Store submission preflight** from the repository's Actions page with branch
`main`. Enter that exact lowercase 40-character SHA as `source_commit`, then
copy the exact Partner Center values into `version`, `identity_name`, `publisher`
and `publisher_display_name`. These are public package-identity fields; never
enter a credential or secret as a workflow input.

`.github/workflows/presenter-store-package.yml` rejects every ref except
`refs/heads/main` and requires `source_commit`, the dispatched `github.sha` and
the checked-out HEAD to match exactly. It installs the pinned .NET SDK feature
band, selects a Microsoft-signed x64 MakeAppx from Windows SDK 26100 or later,
runs the Store static policy, and builds and preflights an ephemeral production
unsigned MSIX. The builder routes NuGet packages and the SDK's project-separated
`obj`, `bin` and publish artifacts below the new external `OutputRoot`; existing
ignored checkout outputs are never build inputs. Because the repository is
public, it uploads no MSIX, `ready/`
directory, receipt or other package artifact. The step summary records only the
source commit, package basename, package SHA-256, status and the instruction to
reproduce the package on the owner-controlled release host. It does not access
Partner Center, run WACK, submit, sign or publish the package.

Record the successful workflow run ID, exact source SHA and summary. This CI
result proves the reviewed source can pass the production builder/preflight on
the runner; it is not a downloadable or submittable package.

### Owner-controlled production submission build

On an owner-controlled Windows release host, check out that same reviewed SHA
with a clean worktree. Use PowerShell 7.4+, the pinned .NET 10.0.302 SDK and a
Microsoft-signed Windows SDK 26100-or-later MakeAppx to run the same builder and
preflight locally with the same version and Partner Center identity values.
Version 1 is fixed to the Microsoft Standard Application License Terms: use the
Standard terms switch and leave Partner Center's **Additional license terms**
field blank. `OutputRoot` must be a new directory outside the source checkout so
package output cannot change the clean exact-commit evidence. Restore packages,
SDK artifacts/intermediates and publish output are all generated below that new
root, so a clean Git status cannot mask reuse of ignored checkout `bin/obj`.
Use a normal local drive path. The builder rejects device and network aliases,
mapped network drives and network reparse targets,
resolves the checkout and nearest existing output parent through Windows file
handles before creation, then verifies the created root and every isolated build
root resolve physically outside the checkout. A junction, short-name alias or
other reparse path therefore cannot turn an apparently external root into a
checkout path. If the root's physical identity changes during creation, the
builder stops before restore and leaves that untrusted path untouched for manual
inspection instead of deleting through it.
Keep the absolute root short (for example,
`C:\COMPASS\presenter-1.0.0.0`); the builder fails before restore when the
longest known SDK intermediate would approach the legacy Windows path limit.

```powershell
presenter-bridge/store/Build-PresenterStorePackage.ps1 `
  -Version 1.0.0.0 `
  -OutputRoot C:\new\presenter-store-stage `
  -SourceCommit <clean-reviewed-40-character-sha> `
  -IdentityName <exact-partner-center-package-name> `
  -Publisher '<exact-partner-center-publisher-DN>' `
  -PublisherDisplayName '<exact-partner-center-display-name>' `
  -UseMicrosoftStandardApplicationLicenseTerms `
  -MakeAppxPath C:\WindowsSdk\x64\makeappx.exe `
  -DotnetPath C:\dotnet\dotnet.exe `
  -PartnerCenterIdentityConfirmed
```

The resulting unsigned MSIX is only a Partner Center submission input.
`ready/store-build-receipt.json` records
`PARTNER_CENTER_SUBMISSION_INPUT_UNSIGNED`, package/source/notice hashes, the
license-terms selection, exact identity and `NEW_OUTPUT_ROOT_ONLY` provenance
with `NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT` and relative isolated
build roots. The receipt does not retain the absolute host path. Microsoft Store ingestion,
certification and signing must finish before distribution. Do not sideload or
host this unsigned input. Preserve the local receipt and use its package
SHA-256—not the ephemeral CI package hash—for WACK and the exact Partner Center
upload.

Do not pass `-AdditionalLicenseTermsPath` and do not upload or link a custom
terms document. The version 1 builder rejects that parameter in every mode.
Every Partner Center submission input requires
`-UseMicrosoftStandardApplicationLicenseTerms`; development-only builds reject
that attestation and record `NOT_SELECTED_UNSIGNED_DEVELOPMENT_ONLY` instead.
The build always copies and hash-verifies `COMPASS-BINARY-NOTICE.txt`, the
repository's exact `THIRD_PARTY_NOTICES.md`, and the .NET distribution's exact
`LICENSE.txt` and `ThirdPartyNotices.txt` next to the selected `dotnet.exe`.
The repository source `LICENSE` is not edited or presented as the Store binary
license.

## Development-only package

`-UnsignedDevelopmentOnly` creates an inspection artifact whose file name,
embedded metadata and receipt all say `UNSIGNED_DEVELOPMENT_ONLY`. It may use
explicit development identity values and must omit both license-terms options.
`-AllowDirtyDevelopmentCheckout` is accepted only with this switch. This output
is never a Store submission or general-distribution artifact.

```powershell
presenter-bridge/store/Build-PresenterStorePackage.ps1 `
  -Version 1.0.0.0 `
  -OutputRoot C:\new\presenter-store-development `
  -SourceCommit <current-40-character-sha> `
  -IdentityName CompassPresenterBridge.Development `
  -Publisher 'CN=COMPASS Presenter Bridge Development' `
  -PublisherDisplayName 'COMPASS Development' `
  -MakeAppxPath C:\WindowsSdk\x64\makeappx.exe `
  -DotnetPath C:\dotnet\dotnet.exe `
  -UnsignedDevelopmentOnly `
  -AllowDirtyDevelopmentCheckout
```

### Controlled local-device signed copy

Windows requires a trusted package signature for normal MSIX installation.
`New-PresenterStoreLocalDeviceTestPackage.ps1` can create a separately marked
`SIGNED_LOCAL_DEVICE_TEST_ONLY` copy strictly for an intended local test
device. Its source must be a preflight-valid
`*_UNSIGNED_DEVELOPMENT_ONLY.msix`; a Partner Center submission input or an
already signed package is rejected.

```powershell
presenter-bridge/store/New-PresenterStoreLocalDeviceTestPackage.ps1 `
  -SourcePackagePath C:\outside\COMPASS.PresenterBridge_1.0.0.0_x64_UNSIGNED_DEVELOPMENT_ONLY.msix `
  -OutputRoot C:\new\presenter-store-local-device-test `
  -CertificateThumbprint <current-user-test-code-signing-certificate-thumbprint> `
  -MakeAppxPath C:\WindowsSdk\x64\makeappx.exe `
  -SignToolPath C:\WindowsSdk\x64\signtool.exe
```

The certificate Publisher must exactly match the package Publisher and the
certificate must be currently valid, contain the Code Signing EKU and expose
its private key to the current user. The scripts use SHA-256, verify the signed
package and prove that signing changed no payload file. The receipt stores only
package basenames and hashes, the public certificate thumbprint, Publisher,
expiry, SHA-256 policy and `LocalDeviceTestOnly=true`; it stores no private key
or absolute user path. Both the package and receipt prohibit distribution and
Partner Center upload. Remove the local test certificate/trust separately when
device testing is complete.

`Test-PresenterStorePackage.ps1` unpacks the package through MakeAppx and
checks the exact identity, source and notice/license hashes, x64 self-contained
runtime, Japan-only `ja-JP` resource declaration, `StartupTask Enabled=true`,
the sole `runFullTrust` capability and the absence of Velopack/feed/update
payloads. It also requires the embedded `NEW_OUTPUT_ROOT_ONLY` provenance.
Normal native CI poisons existing ignored checkout `obj/project.assets.json`
and the prior checkout `bin` executable before invoking the Store builder, then
proves both sentinels remained untouched and absent from the Store payload. The
build recursively preserves every
published file, including localized satellite-resource directories, and embeds
an exact relative-path/size/SHA-256 manifest. Preflight verifies every entry and
rejects missing or unexpected runtime payload files. Build and preflight also
require a valid Microsoft Corporation Authenticode signature on MakeAppx from
Windows SDK build 26100 or later, and record its exact SHA-256 and file version.
`Test-PresenterStoreStaticPolicy.ps1` fixes the local-signing prohibition and
receipt privacy markers in CI without requiring a private test certificate.

Store package versions use four numeric parts. Major must be 1 through 65535,
Minor and Build must be 0 through 65535, and Revision must be exactly 0. Both
build and preflight reject any other value before producing a ready artifact.

Windows Store uninstall may leave the per-user CNG connection identity in the
user key store. A teacher who intends to remove it can choose
`ローカル接続IDを削除` from the tray while the bridge is idle. The app shows a
Yes/No confirmation with No as the default, rechecks that no inspection,
pairing or active lecture owns the bridge, then stops loopback intake,
disconnects, disposes the key handle, deletes the persisted identity and exits.
Canceling or losing the idle race performs no deletion. The next launch creates
a fresh non-exportable P-256 identity and requires fresh pairing.

## Publishing, canary and rollback

For the first Partner Center submission, select the manual Publishing hold
**Don't publish this submission until I select Publish now**. Microsoft does not
provide a predictable reviewer test time. Before submission, the owner and
release operator must accept or reject keeping Presenter globally ON for all
eligible educators throughout certification, with continuous monitoring and
immediate rollback. If that exposure is not acceptable, keep submission HOLD
until a reviewer-only cohort exists. If accepted, build, verify, hash and deploy
the exact Presenter-ON frontend with
`VITE_PRESENTER_CERTIFICATION_MODE=true` and no Store URL before submission.
Certification must complete while the manual hold remains in place and does not
imply general availability.

After certification, retain the hold until the release operator explicitly
selects **Publish now**. The resulting listing must remain **Public audience**,
**available but not discoverable**, and **Direct link only**. Keep advertising
and the general educator installation CTA off. Re-promote and reverify the exact
frontend built with Presenter ON, `VITE_PRESENTER_CERTIFICATION_MODE=true` and
no Store URL for the classroom canary, then turn server admission ON with DB OFF
and DB admission ON last. Give the Partner Center Direct link only to named
acquisition operators, complete the canary, and close DB, server and frontend
afterward. Use that listing to prove Store acquisition, Store signing and the
clean-device canary. A Store flight is only for testing an
update to a product that is already published; it does not prove the first
public acquisition path and must not replace this initial canary. Before the
canary stage ends, build, verify and hash the same-SHA general artifact with
Presenter ON, `VITE_PRESENTER_CERTIFICATION_MODE=false` and the exact Store URL.
Enable the general CTA only by promoting that artifact after every Store, device,
Office, browser, hosted and classroom gate passes.

If certification, acquisition, install, update, authentication, PowerPoint,
loopback, CNG, latency or classroom acceptance fails, keep or restore the CTA
to off, stop Presenter admission, and use Partner Center **Stop acquisition**
or **Make unavailable** as applicable. Treat every release gate as rolled back
to HOLD until the corrected exact package passes the complete sequence again.

## OS and device acceptance

The initial manifest sets `MinVersion=10.0.26100.0`, so the accepted v1 matrix
is Windows 11 24H2 or later. That matches the first build which supports
`uap17:UpdateWhileInUse=defer`. Builds 19041 through 26099 are not eligible for
the initial Store package. Add them only in a later compatibility expansion
after install/update-in-use device tests prove classroom-safe behavior without
that deferral contract.

Before publication, test the Store-installed and Store-signed exact package on
the supported Windows/Office matrix. The gate includes fresh install, first
launch, sign-in restart, Store update while idle and during a lecture,
uninstall/reinstall, PowerPoint COM attachment for 32-bit and 64-bit Office,
Chrome and Edge HTTPS-to-loopback pairing, CNG P-256 continuity, and the real
teacher/Admin/Display/student flow. Confirm on a clean teacher device that
install and routine use require no additional Microsoft or COMPASS login beyond
the already approved educator session. Current authorization covers the release
operations, including reservation, submission and publication, once their
inputs and device gates are ready. Microsoft sign-in, identity verification,
agreement acceptance and entry of sensitive identity data remain
owner-controlled steps.
