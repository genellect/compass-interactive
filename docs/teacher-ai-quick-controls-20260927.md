# Teacher AI quick controls: review candidate

This candidate changes the teacher AI panel only. It is not production or paid-provider acceptance evidence.

## Behavior

- During an open lecture, `字幕以外を一括有効化` requests the existing non-caption master permission, starts the existing summary run (including permitted automatic academic answers), and delegates initial material analysis to its existing handler. Results are reported per feature. Missing material and unavailable features are not reported as successful.
- `字幕ON` requests caption-inclusive permission and delegates microphone permission and caption start to the existing handler. Granting permission alone never requests the microphone. An existing caption-inclusive master is never downgraded by the non-caption button.
- `すべて停止` cancels pending quick-start intent. If master admission is pending, its eventual result is revoked before a child can start. Lecture and app-session changes discard old child results. A requested stop remains bound to its old lecture after a switch.
- `AIの詳細` retains permission-only admission, each original feature control, review/publication controls, and stopping. It remains mounted when collapsed. The draft lecture boolean reservation still grants permission only; it is not converted into a provider-start reservation.
- Normal Google/AAL2 operation does not add a PIN, TOTP challenge, CLI, or new authentication route. Existing ownership, policy, budget, request IDs, and server lifecycle checks remain in force. No DB or Edge Function change is included.

## Release limitations

This is a bounded implementation candidate, not completion of the requested final teacher UX. Bulk and caption start share one in-flight guard. A slow material-analysis response therefore keeps `字幕ON` unavailable until bulk settles; stopping remains available. Removing that delay safely would require separating admission serialization from feature start states and further review. This candidate intentionally does not introduce that new coordinator.

A previously running summary without automatic academic answers is preserved and reports that the answer setting still requires `AIの詳細`; it is not silently stopped and restarted. Manual academic answers still require a question. AI poll suggestions remain drafts.

Network failure can prevent confirmation of server cleanup after leaving a lecture or logging out. The client does not start another provider as recovery. Existing server session/lifecycle expiry remains the final fence. Real microphone/provider, local Supabase integration, deployed browser acceptance, and classroom timing are not covered by the mock tests.

## Continuing regression

- `test:teacher-ai-controls`: six Node-only cases load the actual master repository with mocked transport and the actual quick-start helper. This runs in the mandatory non-live suite.
- `test:teacher-ai-controls:browser`: eleven cases mount the real AI panel and handlers in a fresh Vite server on an allocated localhost port. Repository transport and microphone responses are synthetic; all non-local browser traffic is rejected. This runs in the existing Demo browser E2E job after its existing Chromium install.
- The browser cases cover separate caption consent, partial failure, double-click exclusion, lecture/session changes during admission, pending admission cancellation, cancellation surviving lecture change, and captions-only availability.
- Existing local Supabase AI-master E2E opens `AIの詳細` before its unchanged permission-only assertions. The full lecture lifecycle also opens it after lecture start before changing summary settings. A component regression covers that draft-to-open transition and visible settings interaction. Static master and draft reservation checks retain their guards with the new scoped-result predicate.

On 2026-09-28 the product owner explicitly requested Production publication of PR #86 before the integrated E2E. The bounded release keeps the two limitations above visible; it does not claim the final teacher UX is complete. PR #85 is included by updating this branch to current main before rerunning its required CI. No database migration, Edge Function deployment, new secret, or polling change is required for this PR.

Release acceptance still requires the exact integrated head's checks, protected merge, same-source Pages deployment, and canonical teacher/student/Display E2E. Verify normal AI permission without PIN or another TOTP prompt, explicit caption consent, stop, and post-close termination. Provider-free tests are not microphone/provider or Production acceptance. App distribution and Store resubmission remain separate operations.
