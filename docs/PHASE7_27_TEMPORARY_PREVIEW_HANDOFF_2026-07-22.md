# Phase 7.27 temporary preview handoff - 2026-07-22

## Stop decision

- Temporary hosted preview: **DEPLOYED**.
- Final operational Production Gate: **HOLD**.
- Canonical preview: `https://compass-interactive.pages.dev/`.
- Pages deployment: `2b2708ac-2cad-446b-8a03-a1e879ef1c3d`, source
  `3383265`.
- Worker version: `3bd7062a-e674-45c7-b32a-9f0f2ae2cbb6`.
- Hosted migrations match through `20260722012313` and remote DB lint has zero
  errors.
- Required Phase 6.8-7.27 preview flags are explicitly ON. Their code defaults
  remain OFF.
- No Journal Club rehearsal or production run was prepared or started.
- No paid AI call, Realtime microphone test or production archive was created.

This is a production-environment UX preview, not authorization to run the real
lecture. Stop after the final commit's GitHub Quality, Demo browser and local
Supabase jobs are green. GitHub CodeQL remains conditional because Code Scanning
is a billing-controlled capability on this private repository; do not enable it
without an explicit cost decision.

## Preserved recovery point

- Immutable tag `production-archive-20260722-pre-phase7` resolves to the former
  production commit `cc1ae93722eedf35ea4eb8f6dd89ed5f012572e7`.
- Former Pages deployment: `45fa7102-104a-423b-8920-3616ebeb2633`.
- Former Worker deployment/version:
  `972cc170-51ed-4616-969c-a72e44893248` /
  `89b39838-195d-45ae-b863-7d2f2e9ae601`.
- Pre-rollout database schema/data dumps and the eight-object R2 inventory are
  retained as ignored local recovery artifacts with hashes recorded in
  `PHASE7_27_PRODUCTION_GATE_2026-07-22.md`.
- Local Publisher is stopped. Its active writer credential file was removed
  from the runnable Publisher location and isolated in the external recovery
  area; it is not claimed revoked.

## Verified preview surface

- Production environment validation passed with all 14 Vite feature flags ON.
- Production build and direct Pages deployment passed.
- Public Admin, Join, Demo, Display and Archive routes rendered their expected
  DOM with zero captured console errors.
- Pages returns enforced CSP, report-only stricter CSP, COOP, permissions,
  referrer, MIME-sniffing and frame-denial headers.
- Worker bindings show private R2, both rate limiters, scheduled cleanup and
  `PHASE726_BROWSER_PDF_UPLOAD_ENABLED=true`.
- All 26 Edge Functions were deployed with their intended JWT/M2M boundaries.
- Local 55-group non-live regression, 1,171 pgTAP assertions, Worker tests,
  Chromium/WebKit Phase 7.27 checks and real local Journal Club integration had
  passed before rollout.
- The CI preflight now retries only transient 502/503/504 worker-bootstrap
  responses. It still requires the same final 200/CORS contract and does not
  retry authorization or application failures.

## Remaining audit work

These items are deliberately deferred to the post-preview review. They are
blocking for formal lecture operation, not for the temporary preview already
published.

1. Operator review of hosted Admin, student, Display, Demo and Archive UX.
2. Authenticated Admin preset preparation and hosted two-user ownership
   separation test.
3. Exact canonical PDF browser publication through Private R2, including
   uncommitted-object denial, nonce replay denial and immutable-object checks.
4. Representative 15 MiB PDF canary with Worker CPU/latency observation.
5. Real two-Admin preparation/publication race and interruption recovery.
6. Cleanup Cron convergence across two schedules and WAF/rate telemetry review.
7. Real smartphone layout/touch review and the separately deferred microphone
   test.
8. A rehearsal run only after the operator requests it; verify six draft Polls,
   PDF start guard, no cross-run comments/Poll/AI state and normal 30-day
   retention.
9. The one-time production run, final archive export, permanent-policy monotonic
   retention and offline sanitized archive copy only after the rehearsal and
   final human approval.
10. Explicit GitHub Code Scanning/Advanced Security cost decision if CodeQL
    upload is desired for this private repository.

## Resume protocol

1. Start from remote `main` and confirm a clean worktree; do not reuse ignored
   CI or upload state as evidence.
2. Read this handoff, `PHASE7_27_PRODUCTION_GATE_2026-07-22.md`,
   `PHASE7_27_JOURNAL_CLUB_INTEGRATION.md` and the Phase 7.26 threat model.
3. Confirm the canonical Pages source, Worker version, hosted migration list,
   flag state and Local Publisher isolation before any mutation.
4. Perform the operator UX corrections as minimal diffs and rerun Quality,
   Chromium/WebKit, local Supabase, Worker and hosted route checks.
5. Do not prepare a rehearsal or production run until the operator explicitly
   authorizes that stage. Preparation must not start a lecture, Poll, PDF or
   paid AI work.
6. Record every hosted/R2/human result in a new dated gate report. Do not rewrite
   the historical Local Gate or this stop snapshot.

## Rollback order

1. Disable frontend flags.
2. Disable the corresponding Edge and Worker capabilities after in-flight work
   is drained.
3. Restore the former Pages and Worker deployments above if required.
4. Restore application code from the immutable recovery tag.
5. Keep additive migrations in place and repair forward; do not drop production
   schema as an emergency rollback.

