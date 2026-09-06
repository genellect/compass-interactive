# Teacher UX: minimal-change reassessment

Date: 2026-09-06
Baseline: `origin/main` `e56c052aaa18a43445565af81819358b5dba32c9`
Status: bounded correction implemented and locally verified; PR and production
evidence remain separate.

## Owner direction and precedence

The owner requires a reassessment before further implementation. Existing
lecture behavior has repeatedly passed real-classroom E2E. Preserve that
investment: improve teacher interaction with the smallest demonstrable change,
without redesigning working lecture logic or degrading Student or Display UX.
This amendment supersedes proposals in this task to add automatic native PDF
publication, native lecture authority, or a mandatory background teacher tab.
It does not authorize weakening any existing release gate.

The product target remains comfortable operation from either Web or PowerPoint.
Neither should become a newly imposed prerequisite for the other. That target
must not be reported as achieved merely by simplifying copy or hiding a window.
No new teacher authentication, CLI, pairing-code prerequisite, or required
sequence of dashboard tabs is acceptable in ordinary lecture operation.

## Integrated findings

| Stage | Existing capability to preserve | Finding and disposition |
| --- | --- | --- |
| Teacher sign-in | Google, existing TOTP boundary, bounded application session | Preserve auth, session lifetime and membership checks. No native credential duplication. |
| Material preparation | PDF selection supplies the title; one CTA creates a draft and publishes; existing upload/finalize/readback recovery | Do not add a second preparation pipeline. Keep existing error recovery and download choice. |
| Lecture start/end | Existing lifecycle handlers, timestamps, hard stop, close confirmation | Display only the applicable row action; keep loading guards and handlers. Keep schedule fields visible because they affect lecture limits. |
| Teaching from Web | Persistent page transport, four retained panels, automatic initial view choice | Remove numbered step badges; retain labels, descriptions, panel identity, mount behavior, availability and keyboard controls. |
| Material selection | `setDocument` also resets page to 1 and resolves the latest registered version | Label the action `1ページ目から表示`. Do not disable it solely because the document ID matches; that could remove version-refresh/recovery behavior. |
| Teaching from PowerPoint | COM observation, exact material binding, proof, lease, latest-only dispatch, automatic reconnect and manual handover | Preserve all of these. The current native capability synchronizes pages; it does not create/publish/start lectures. |
| Native recovery | Explicit recovery, three session states, existing tray | Fix cancellation falsely replacing Faulted with Idle text; explain that an active slideshow is required. No new reconnect behavior. |
| Native ordinary interaction | Double-click currently opens recovery-code entry | Candidate: expose the existing status menu instead. Accept only after native focus/dismissal/DPI checks; do not introduce a new Form or automatic launch in this batch. |
| Display/student delivery | Existing Display Realtime/ACK/render pipeline and student 5-second snapshot polling | No timing, transport, subscription or backend changes. Selective Realtime and Pro remain a later release. |

Three independent read-only reviews covered teacher UI, native behavior and
regression/release evidence. One initially attractive change was rejected:
disabling same-document selection would alter real recovery behavior.

## Immediate change boundary

The first candidate is limited to teacher presentation components/CSS, native
tray presentation, and relevant verification/documentation. No changes to
AdminPage mutation handlers, hooks, repositories, database, Edge Functions,
Cloudflare Workers, auth, PDF publication, lecture lifecycle, COM observation,
native protocol, lease/dispatcher, Student or Display runtime are planned.

1. Remove the teacher navigation's numbered step badges.
2. Render Start only for a draft and End only for an open lecture; preserve
   all current selection/history/duplicate/close-confirmation behavior.
3. Clarify the existing document action's page-reset effect.
4. Restore the actual native session status when recovery is cancelled, and
   correct the slideshow prerequisite message.
5. Evaluate the default tray action separately against device evidence.

The default tray action is deferred. This candidate changes only cancellation
status text and the slideshow instruction; it adds no menu behavior or window.

Do not hide dates, merge server-send and Display-render status, restructure
forms, change automatic panel transitions, remove material confirmation, or
store additional credentials as part of this candidate.

## Deferred architecture, not assumed implementation

PPT-only automatic lecture preparation is not supported by the current narrow
page-sync capability. Native export/publication/start would need additional
authorization and a new orchestration path. An embedded WebView also introduces
an engine, independent authentication storage and lifecycle behavior; it is not
a proven zero-risk reuse of the existing browser login. Both are excluded from
the immediate correction. Revisit only with measured remaining teacher burden
and a separately demonstrated minimal solution. No background-tab requirement
is introduced as a substitute.

## Verification and publication order

1. Review the exact diff against this boundary. Run secret scan, TypeScript,
   E2E typecheck, lint and the non-live suite. React review checks accessibility,
   retained component state and absence of new requests/effects/dependencies.
2. Use the existing `demo-pdf` teacher fixture for create/publish/recovery and
   `demo-presenter` for ownership, tab changes, manual lock and handover. Check
   desktop/mobile teacher rendering and overflow, not just student demo pages.
3. If native source changes, run the existing x64/x86 native build and 35
   deterministic tests, plus focused state/cancel regression verification.
   Native UI/device acceptance is additional to those tests.
4. Freeze one head and run the eight required PR contexts once. Preserve strict
   main protection, no unresolved review threads and no head/base drift.
5. Squash only after all gates pass, inspect automatic post-merge workflows,
   then publish the same verified frontend with all current production flags.
   With no backend diff, do not redeploy migrations, Edge or Workers.
6. Verify the canonical teacher/student/Display paths and existing lecture
   interactions. Roll back the frontend if new errors or regressions appear.
7. Native Store publication remains separate: signed acquisition, WACK, clean
   device/Office and classroom timing evidence are still required. A saved
   Partner Center draft is not a released app.

## Existing evidence limitations

- Main CI run `33993139991` failed the first WebKit Display-render attempt and
  passed on retry. This is not classified as a runner transient.
- The synthetic PDF contains three pages, but the test declared 34. Correct
  the fixture and retain first-failure trace without changing the 2,000-ms
  rendering criterion or 3,000-ms observation limit. This does not prove the
  timing failure's cause or its resolution.
- Local Docker failed repeatedly on Windows AF_UNIX runtime sockets. No further
  restarts/reset/prune are planned. Local Supabase integration is unavailable
  until the host is repaired; report that omission explicitly.
- No new production canary, native device acceptance or Store submission has
  been performed as part of this reassessment. Do not reuse older acceptance
  as proof for changed UI or for unsupported PPT-only preparation.

## Local candidate verification

- Secret scan, application and E2E typechecks, lint, build and all 77 non-live
  groups passed. Lint retains four existing hook-dependency warnings; build
  retains the existing chunk-size advisory.
- Existing teacher PDF publication/recovery E2E: 76/76 passed across desktop
  and mobile Chromium/WebKit, with retries disabled. Synthetic desktop/mobile
  screenshots were inspected and retained locally. Temporary screenshot-only
  instrumentation was removed before freezing the source candidate.
- Existing Presenter first-use, confirmation/handover, tab ownership, exact
  material reuse, pre-start readiness and late startup checks: 12/12 passed
  across desktop Chromium/WebKit, with retries disabled.
- Presenter flag-off browser checks: 2/2 passed, with retries disabled.
- Native x64 and x86 builds passed with zero warnings; existing deterministic
  tests passed 35/35 for each architecture. Two CNG tests first failed inside
  the sandbox, then passed in the ordinary Windows user context using their
  unique test keys and existing cleanup. No product identity was removed.
- Two independent reviewers found no actionable regression in the final Web
  and native presentation diffs. The menu change and all architecture changes
  remain excluded. Native UI/device and live lecture acceptance are not
  replaced by these deterministic results.
