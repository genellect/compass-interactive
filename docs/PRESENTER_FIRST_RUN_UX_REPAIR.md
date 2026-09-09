# Presenter first-run UX repair

Date: 2026-09-09. Base: `fd4691f876765f417a8752da766af42324c59b4f`.
Branch: `fix/presenter-first-run-ux`. Certification and general publication remain HOLD.

The Store review stopped at account access (10.3.1 App Is Testable — Test Account).
It did not establish whether native page synchronization works. The reviewer needs
a usable account and an explicit acquisition path; saving protected credential rows
alone did not demonstrate a successful first login.

## Narrow correction

- Explicit app launch and tray double-click open the existing teacher portal after
  Bridge startup. Windows startup passes `--background` and normally opens no browser.
  Existing error dialogs remain available. The destination is a fixed HTTPS URL.
- The portal offers an account invitation/application guide in a separate tab.
  Keeping the original tab preserves an invitation awaiting Google login. The guide
  never receives invitation tokens, credentials or application-session values.
- The existing slide workspace also exposes the connection setup entry. Consent
  shows material data handling beside its action; detailed information and consent
  withdrawal remain available in expandable sections.
- The guide follows the existing flow: select a PDF and create/publish the lecture,
  start the lecture and saved PowerPoint slideshow, confirm the material pair, then
  advance pages. Presenter View is disabled. Ending the lecture remains a Web action.

No authentication, authorization, lecture lifecycle, hook, database, student polling,
Display synchronization or paid-service behavior changes. No new native credential
store or arbitrary URL launch is introduced. The ordinary five-second student
snapshot interval is unchanged. This does not implement full PPT-only start/end,
guarantee cross-browser authentication reuse or certify rendering latency.

## Validation and remaining gates

Local Release native tests: 36/36. Store configuration compile: zero errors/warnings.
Type checks, lint (four pre-existing hook warnings), build, secret scan and the
Presenter contract, Admin identity, lecture lifecycle and PDF-sync checks passed.
Chromium/WebKit identity and invitation regression: 4/4. Existing PDF preparation
regression: 4/4. These use synthetic authentication/network fixtures.

The full Presenter browser run passed 103/106: two new test selectors did not match
the tabs' complete accessible names, and an unchanged WebKit storage-denial harness
reported a storage error once. The selector was corrected; both affected scenarios
then passed three consecutive runs per browser (12/12). The transient harness result
is retained in evidence and is not represented as a clean full-suite run.

The complete non-live suite stops at the Publisher PDF test because Windows
Application Control blocks the installed native canvas binding. The same failure
occurs outside the sandbox. Do not disable that policy or change application logic
to mask it; the exact-source CI gate must complete on its normal test environment.

The initial PR CI also found the newly indexed sharp advisory
[GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
The existing development-tool override is patched from 0.35.3 to 0.35.4 and only
sharp's distribution dependencies change. The regenerated lockfile audit reports
zero findings; this is independent of the earlier runtime shutdown.

Before resubmission, require green exact-source CI, a newly built package and its
preflight/WACK, then a permitted Windows test window covering real Google login,
lecture/PDF preparation, native launch/relaunch, PPT connection, actual student and
Display rendering, handover and lecture end. Record additional authentication and
operation counts, not only successful API responses. Mocked login and deterministic
page traces do not replace this evidence.

The review account must remain usable after testing: enrolling its first TOTP factor
can prevent a reviewer from enrolling their own. Resolve its final admission/factor
state through normal authorized account controls; do not share a factor seed or
bypass authentication. Reconfirm usable review instructions before resubmission.
