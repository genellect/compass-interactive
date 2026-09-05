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
The ordinary `Direct` build remains the default and keeps the existing signed
Velopack behavior.

## Partner Center submission input

Reserve the product first, then copy the exact package `Identity/Name`,
`Identity/Publisher` and publisher display name shown by Partner Center. A
Partner Center Product ID is a separate value and is intentionally not an input
to this MakeAppx script. Never infer or fabricate any of these values.

Run from the repository root with PowerShell 7.4+ and the pinned .NET 10.0.302
SDK. Choose the Microsoft Standard Application License Terms, which correspond
to leaving Partner Center's additional-terms field blank, or supply separately
approved additional terms. The switch records the operator's selection; it is
not legal approval. `OutputRoot` must be a new directory outside the source
checkout so package output cannot change the clean exact-commit evidence.

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
license-terms selection and exact identity. Microsoft Store ingestion,
certification and signing must finish before distribution. Do not sideload or
host this unsigned input.

Use `-AdditionalLicenseTermsPath C:\approved\terms.txt` instead of the Standard
Terms switch only when those additional terms have been separately approved.
The file is copied byte-for-byte into the MSIX and hash-bound to the receipt.
The build always copies and hash-verifies `COMPASS-BINARY-NOTICE.txt`, the
repository's exact `THIRD_PARTY_NOTICES.md`, and the .NET distribution's exact
`LICENSE.txt` and `ThirdPartyNotices.txt` next to the selected `dotnet.exe`.
The repository source `LICENSE` is not edited or presented as the Store binary
license.

## Development-only package

`-UnsignedDevelopmentOnly` creates an inspection artifact whose file name,
embedded metadata and receipt all say `UNSIGNED_DEVELOPMENT_ONLY`. It may use
explicit development identity values and may omit both license-terms options.
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

`Test-PresenterStorePackage.ps1` unpacks the package through MakeAppx and
checks the exact identity, source and notice/license hashes, x64 self-contained
runtime, Japan-only `ja-JP` resource declaration, `StartupTask Enabled=true`,
the sole `runFullTrust` capability and the absence of Velopack/feed/update
payloads. The build recursively preserves every
published file, including localized satellite-resource directories, and embeds
an exact relative-path/size/SHA-256 manifest. Preflight verifies every entry and
rejects missing or unexpected runtime payload files. Build and preflight also
require a valid Microsoft Corporation Authenticode signature on MakeAppx from
Windows SDK build 26100 or later, and record its exact SHA-256 and file version.

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
