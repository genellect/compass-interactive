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
- `test:teacher-ai-controls:browser`: ten cases mount the real AI panel and handlers in a fresh Vite server on an allocated localhost port. Repository transport and microphone responses are synthetic; all non-local browser traffic is rejected. This runs in the existing Demo browser E2E job after its existing Chromium install.
- The browser cases cover separate caption consent, partial failure, double-click exclusion, lecture/session changes during admission, pending admission cancellation, cancellation surviving lecture change, and captions-only availability.
- Existing local Supabase AI-master E2E opens `AIの詳細` before its unchanged permission-only assertions. Static master and draft reservation checks retain their guards with the new scoped-result predicate.

Before release, address the two UX limitations above or obtain an explicitly reviewed staged scope, then run local Supabase integration and authorized real microphone/provider E2E. No production deployment, app distribution, or Store submission is performed by this candidate.
