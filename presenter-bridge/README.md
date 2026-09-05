# COMPASS Presenter Bridge (Phase 7.29)

This directory is the Windows-only, per-user native boundary for PowerPoint
page synchronization. It is feature-flagged OFF and is not a production
release artifact yet.

## Runtime contract

- Attaches only to an already-running PowerPoint process; it never launches or
  closes PowerPoint.
- Treats the observed `View.Slide` state as authoritative. COM events only
  accelerate a 200 ms reconciliation loop.
- Accepts one ordinary Speaker full-screen or windowed all-slides show,
  Presenter View OFF, no hidden slides, and an exact PowerPoint/PDF page-count
  match. Kiosk, unknown modes and multiple shows are rejected.
- Freezes the PPTX SHA-256 and ordered Slide ID SHA-256 for the connection.
  Reordering, adding, deleting, hiding, or replacing slides stops updates.
- Checks the live COM presentation identity and saved file metadata on every
  observation. Switching equally sized decks cannot reuse a cached binding.
- Checks the displayed slide's parent IUnknown against the observed show
  presentation on every observation. A foreign or ambiguous parent cannot
  contribute a page under the bound deck identity.
- Resolves the observed show window's process identity when Office exposes its
  HWND. On Office COM surfaces that omit this member, accepts only one POWERPNT
  process in the current Windows session and binds its PID/start time to the
  already attached ROT application and retained presentation IUnknown. Zero or
  multiple candidates, unavailable start time, and ordinary COM/RPC errors stop
  observation. It never guesses a process using foreground windows or titles.
- Exposes only `http://127.0.0.1:43124`, with exact Host and Origin checks,
  bounded JSON, Private Network Access preflight handling, and an in-memory
  browser-session token.
- Sends the signed pairing ticket and short-lived bearer capability only in
  HTTPS request bodies. Every request also carries a per-user P-256 proof bound
  to the exact raw body, method, fixed path, timestamp and random nonce. They
  are never placed in a URL, command line, browser storage, or log.
- Uses a five-second remote timeout, no redirects, no cookies, and fails closed
  when Hosted validation or heartbeat rejects the connection.
- Pins the remote session endpoint to the dedicated COMPASS Presenter Gateway.
  The owner-delegated release host is `presenter-api.yuto-matsui.com`, selected
  on 2026-09-05 after the existing Cloudflare zone was verified. This source pin
  does not prove Gateway deployment or clear the activation gates.
- Faults the session after bounded slideshow loss or COM observation timeout,
  allowing the coordinator to revoke the hosted fence.
- Stores a signing-only, user-scoped, non-exportable P-256 key in the Windows
  CNG user key store; the server receives only its public SPKI and SHA-256
  fingerprint.
- Uses a per-Windows-user mutex and releases COM objects during safe shutdown.

## Non-secret runtime configuration

The signed release compiles the exact selected Presenter Gateway host.
Release builds do not accept an environment override for that endpoint. Debug
builds may read `COMPASS_PRESENTER_SESSION_ENDPOINT`, but it remains subject to
the same exact HTTPS host/default-port/path validator.

Debug builds may set:

- `COMPASS_PRESENTER_ALLOWED_ORIGINS` to a semicolon-separated exact Origin
  allowlist. If omitted, only `https://compass-interactive.pages.dev` is used.

Signed Release builds always pin the canonical production Origin and ignore
this environment variable. A staging or contest build must use a separately
reviewed compile-time channel rather than a teacher-machine override.

Do not put a pairing ticket, capability, Admin token, API key, or service-role
key in either value.

The complete Gateway, signing, update-feed, five-minute manual recovery-code TTL
and activation gate is documented in
`../docs/PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md`.

## Gate status

Source is retained in the canonical GitHub repository for cross-platform review
and Windows CI compile/testing. Windows Application Control blocked an unsigned
generated test assembly on the former development workstation on 2026-08-01;
do not disable or bypass that control. CI does not distribute its unsigned
outputs. Exact Gateway FQDN/route, code signing, per-user installer/update
behavior, SmartScreen reputation, PowerPoint 32/64-bit Office-build coverage,
500-transition real-PowerPoint testing, and Edge/Chrome HTTPS-to-loopback
device testing remain Device/Human/Hosted Gate requirements.

An unsigned Office 16 / 32-bit Office, x64 bridge, single-monitor probe on
2026-09-05 verified raw slide identity in windowed and ordinary Speaker shows.
The scoped Speaker eligibility extension and remaining mode acceptance are
recorded in `DEVICE_MODE_VERIFICATION.md`. A one-monitor probe with the
Presenter View setting ON is not evidence of an actual two-monitor Presenter
View session; that mode is still rejected. Signed installation, browser and
hosted synchronization acceptance remain separate gates.

## Installation and updates

### Microsoft Store MSIX lane

The free-certificate distribution lane packages the same bridge as a
Microsoft Store x64 MSIX. Build with `PresenterDistribution=Store` to remove
Velopack, its startup bootstrap, anonymous feed, update coordinator and tray
update UI at compile time. WinForms, PowerPoint COM observation, HTTPS-to-
loopback pairing, server authority checks and the per-user non-exportable CNG
P-256 installation proof remain unchanged. `Direct` is still the default build
and retains the behavior below.

The Store manifest uses a packaged classic app at `mediumIL` and declares only
the restricted `runFullTrust` capability needed by that desktop process. It
enables the packaged desktop startup task; after the app's first launch,
Windows sign-in starts the tray without a teacher CLI step. The Store build
script requires the exact reserved Partner Center identity, publisher,
publisher display name and clean source commit. The release operator must
explicitly select the Microsoft Standard Application License Terms or supply
separately approved additional terms; the build does not claim legal approval.
Its new output directory must be outside the source checkout. The build and
preflight require a Microsoft-signed Windows SDK 26100-or-later MakeAppx and
record its exact version and SHA-256. It does not accept or fabricate a Partner
Center Product ID. See
[`store/README.md`](store/README.md) for packaging and preflight commands.

The initial Store package requires Windows 11 24H2, build 26100 or later. Its
v1 Store language and native UI acceptance matrix is Japan-only (`ja-JP`).
Update-in-use deferral is declared through `uap17:UpdateWhileInUse=defer`, which
starts at the same build. Windows builds 19041 through 26099 are outside the v1
Store eligibility matrix and may be added only after real update-in-use device
testing proves safe behavior. Publication also remains blocked until a Store-installed exact
candidate proves PowerPoint COM/loopback/CNG behavior and that a teacher can
install and use it without an additional account login.

An unsigned development package is always marked
`UNSIGNED_DEVELOPMENT_ONLY` in its file name, embedded metadata and receipt.
It is not a Store submission and must never be generally distributed.
For installation testing only, the Store helper can create a
`SIGNED_LOCAL_DEVICE_TEST_ONLY` copy from that exact preflight-valid development
package using a matching current-user Code Signing certificate. The signed copy
and its receipt remain prohibited from distribution and Partner Center upload.

Because package uninstall may retain a per-user CNG key, the tray exposes
`ローカル接続IDを削除` only while idle. It requires an explicit confirmation,
then shuts down and deletes the local identity after disconnecting. The next
launch creates a fresh identity and requires fresh pairing.

### Direct signed lane

The signed per-user Velopack installer starts the bridge after installation and
creates `Startup,StartMenuRoot` shortcuts. Windows sign-in then starts the tray
without a terminal or additional account. Browser pairing and current deck
inspection remain required; a bridge restart never restores an old capability
from disk. Reopened PowerPoint decks require a fresh current inspection, while
an unchanged deck's material-consent digest remains stable across restarts.
The exact-Origin-protected health response adds only `powerpointReady` and a
safe `powerpointIssue` code (or null); it exposes no material identity. A
coalesced probe caches readiness for two seconds and bounds observation to one
second. Browsers can wait for late bridge/PowerPoint startup using local health
without issuing repeated hosted tickets. Health readiness never substitutes for
the fresh PDF-specific inspect/confirm/claim sequence.

The bridge quietly checks the fixed anonymous HTTPS feed
`https://presenter-updates.yuto-matsui.com` once, 30 seconds after startup. It
does not automatically download, apply or restart. The tray first offers
`更新を確認`, then `更新して再起動` after an update is available. Both actions
are refused during inspection, manual recovery, pending browser confirmation,
or an active session. Admission and coordinator locks cover the complete action,
so activation cannot race installation. No-update or feed failures leave the
bridge usable. Startup auto-apply remains disabled.

Only the `CompassPresenterBridge` full-package `win-x64` channel is accepted.
The feed host, TLS/default port, package identity, SHA-256, size and time limits
are enforced; redirects and credentials are rejected. Each full package must
have an adjacent `<full-package-name>.p7s` detached CMS signature over its exact
bytes. The native client validates it against the trusted installed executable's
publisher Subject and a currently valid, online-revocation-checked code-signing
chain before Velopack can extract `Update.exe`. It also checks cached packages
before reuse and immediately before apply, and binds the signed NuGet metadata
to the feed's package ID/version. A changed publisher requires a separately
reviewed installer migration. Unsigned installations cannot establish update
trust. Certificates are never added to a trust store by the bridge.

Detached CMS timestamps are not implemented. The signer must be valid at update
time; the PE Authenticode timestamp does not extend CMS validity. Publish a new
package signed by the renewed certificate with the same approved Subject before
the current certificate expires, and retain an available trusted installer.
This contract supports an existing CSP-backed certificate without private-key
export. It is not proof that a signing provider, certificate or feed exists.

## Release operator contract

Initial package ID/version/channel are `CompassPresenterBridge` / `0.1.0` /
`win-x64`. The initial installer URL is
`https://presenter-updates.yuto-matsui.com/versions/0.1.0/CompassPresenterBridge-0.1.0-win-x64-Setup.exe`.
Do not expose that link until its signed artifact is published and verified.

Run `scripts/Build-PresenterRelease.ps1` in PowerShell 7.4+ on the Windows release
operator machine with the existing approved CSP certificate in `CurrentUser/My`,
its CSP already authenticated, the Windows SDK SignTool, .NET SDK 10.0.302 and
the local manifest's vpk 1.2.0. Supply `-Version`, a new absolute `-StagingRoot`,
the exact clean reviewed `-SourceCommit`, public `-CertificateThumbprint`, exact
approved `-ExpectedPublisherSubject`, `-SignToolPath`, the provider's RFC 3161
`-TimestampServer`, and optionally `-DotnetPath`. Do not substitute a test signer.
These are release-operator inputs, never teacher setup steps.

The script performs locked self-contained publishing, packs the per-user
installer with Startup/Start Menu shortcuts, signs through the existing CSP,
and verifies trusted SHA-256/RFC 3161 Authenticode signatures for Setup, the
extracted bridge/updater, and every shipped PE. COMPASS, Velopack and updater
payloads must have the approved publisher; other runtime payloads may retain
their original trusted publisher. It signs the complete package using detached
SHA-256 CMS with the same certificate, without generating or exporting keys.
No `ready/` output is created until these checks pass. If verification or the
provider fails, do not upload the intermediate `work/` files.

The staging result is `ready/feed/` (original versioned full package, `.p7s`,
`releases.win-x64.json`), `ready/versions/<version>/` (immutable installer,
package and `.p7s`) and `ready/release-manifest.json` (source SHA, publisher,
signature expiry, file hashes and verification evidence). The script does not
upload anything. Publish immutable files, package and `.p7s` first, verify their
public hashes, then publish `releases.win-x64.json` last. Preserve prior signed
versions; never rewrite an existing immutable version path. An unsigned CI
self-contained payload is only an operator input and cannot clear this gate.
