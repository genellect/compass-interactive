# Full-screen / Presenter View acceptance probe

The COM reader already observes `SlideShowWindows(1).View.Slide` and its
`SlideID`/`SlideIndex`, independently of `SlideShowSettings.ShowType`. Microsoft
documents the same SlideShowWindows collection for full-screen shows:
https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slideshowwindows
and https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slideshowwindow.view.
Window-only and Presenter-View-OFF restrictions originally came from the
conservative native eligibility contract, not a demonstrated COM API
limitation. `ShowPresenterView` is a saved setting; it does not by itself prove
that two independent slide shows or two different current slides exist.

The native evaluator now also accepts ordinary `Speaker` full-screen shows,
with Presenter View OFF. Kiosk/unknown modes and multiple shows remain rejected.
The hosted inspect payload contains count, order and binding hashes, not a
window-mode field; no hosted payload change accompanies this extension.
Do not extend support to Presenter View based only on these API descriptions.
This operator procedure does not clear the signed-installation or end-to-end
Device Gate.

## Observed compatibility and process identity

The 2026-09-05 unsigned synthetic probe used Windows 10.0.26200, Office 16.0
(32-bit installation), an x64 bridge and one monitor. All 27 next/back/jump
observations matched the direct show slide ID/index and the synthetic deck's
ordered IDs across windowed, Speaker, and Speaker with the Presenter View
setting ON. The last mode is only a saved setting on one monitor, not an actual
two-monitor Presenter View acceptance result.

A subsequent ordinary Speaker / Presenter View OFF run used the real adapter
and `StablePresentationTracker` (100 ms minimum stability) for 500 synthetic
transitions. All 500 targets differed from the preceding page; the sequence
covered all 12 pages with next/back/jump/A-B-A changes. All 500 source IDs,
indices, slide parents and stable commits matched. Wrong-page commits: 0.
From the start of the direct COM `GotoSlide` command to local stable commit,
median was 152 ms, p95 170 ms and maximum 206 ms. These are local COM/tracker
measurements, not Display/student end-to-end latency. The fixture closed its
own presentation, called Quit only when no other presentation existed, and
waited without killing processes; the final PowerPoint process count was 0.
This unsigned synthetic run does not replace signed installation, animations,
real keyboard/preview navigation, lifecycle or hosted client acceptance.

This Office COM surface omitted HWND on both Application and SlideShowWindow,
including the type-library DISPID (`DISP_E_MEMBERNOTFOUND`). The adapter first
uses the observed show window's HWND when available. Only a missing member may
fall back to the sole POWERPNT process in the current Windows session. PID plus
process start time differentiates process reuse; the attached ROT application,
retained presentation IUnknown and saved-file identity retain the deck binding.
Every observation separately compares `View.Slide.Parent` IUnknown with
`Window.Presentation`. Zero/multiple process candidates, an unavailable start
time, COM/RPC faults or an unequal parent fail closed. No foreground-window or
document-title guess is permitted.

## Remaining signed and multi-monitor acceptance

1. Use a dedicated Windows test user/device with supported Office. Close no
   existing user deck. If any user PowerPoint process is open, use a separate
   test user/device. Create a new local `COMPASS-mode-probe-<unique>.pptx` with
   12 synthetic slides marked 1–12, and a matching 12-page PDF. Include a few
   animations on slides 3 and 8; no private media, hidden slides, custom show or
   partial range. Save before the first observation.
2. Record Windows build, Office build/bitness, bridge architecture, monitor
   count/DPI and browser version. Do not record lecture codes, tickets or tokens.
3. For each mode (window / ordinary F5 full screen with Presenter View OFF /
   F5 full screen with Presenter View ON and two monitors), observe the sole
   `SlideShowWindows(1)`. Capture current `View.Slide.SlideID`, `SlideIndex`,
   the ordered deck Slide IDs, `SlideShowWindows.Count`, `ShowType`,
   `ShowPresenterView`, monotonic timestamps and observation failures. Verify
   the slide's parent is the same presentation as the show window, especially
   when following hyperlinks; embedded presentations remain unsupported until
   that ownership is established.
4. Exercise native next/previous keys, animation-only builds, number+Enter,
   Presenter View next-slide preview, A→B→A, and rapid skipping. Compare the
   observed current slide against the slide visible to the audience, not the
   preview. Animations and preview changes must not commit a new page. Repeat
   at least 500 transitions with zero wrong-page commits and final convergence.
5. Test show exit/re-entry, replacing the deck with an equally sized fixture,
   saving/reopening, PowerPoint restart and temporary COM/RPC rejection. The
   bridge must revoke/fault the prior binding and require a fresh inspection;
   it must never publish a page using the previous deck's identity.
6. Only after raw COM/adapter results pass, review the native eligibility
   contract and its proof semantics for any further mode extension. Run the signed
   bridge through canonical HTTPS Admin → Gateway → database → Display/student
   clients. Measure near-real-time Display behavior and actual convergence for
   visible students following the presenter, including reconnect. Student polling
   remains five seconds; an end-to-end five-second guarantee is not claimed.
   Automated tracker traces, direct
   COM observations, and a passing native build are separate evidence.

Until the two-monitor procedure is completed, Presenter View remains unsupported
and health returns `presenter_view_must_be_disabled`. Ordinary Speaker mode no
longer requires switching to a windowed show. The remaining Presenter View setup
burden and signed end-to-end acceptance are unresolved UX acceptance conditions.
