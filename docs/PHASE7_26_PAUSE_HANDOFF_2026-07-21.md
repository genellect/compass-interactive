# Phase 7.26 pause and resume handoff — 2026-07-21

> Historical checkpoint only. The implementation counts, UI behavior and open
> work below describe the pause boundary and are superseded by
> `docs/PHASE7_26_LOCAL_GATE_2026-07-21.md` and
> `docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`. In particular, browser mode now
> hides all Local Publisher controls, uses permanent terminal sentinels and has
> newer Worker/Publisher regression counts. Do not use this file as an
> activation or rollback runbook.

## Pause boundary

- Worktree: `work/phase7-25-implementation`
- Branch: `phase7-25-local`
- Last completed baseline commit before the current work: `15a8e58`
- This checkpoint contains local Phase 7.25 work and the in-progress Phase 7.26 browser-complete PDF publication work.
- No production Supabase change, hosted setting change, Cloudflare deployment, public Web deployment, feature-flag activation, push, or external service mutation was performed during Phase 7.26.
- Browser PDF publication remains fail-closed and disabled by default.
- Local Publisher remains the compatibility and recovery path; it has not been removed.
- The existing Review/archive policy was audited read-only and intentionally left unchanged.

## Implemented so far

### Phase 7.25 carried in this checkpoint

- Multidisciplinary, DOI-oriented academic-answer source handling and automatic candidate flow.
- Updated Admin/student/demo presentation for AI reference answers.
- Revised public demo PDF and demo behavior.
- Phase 7.25 migration, pgTAP, static, load, and Edge test sources are present.

Phase 7.25 still requires the regression repairs listed below before it may pass its Local Gate.

### Phase 7.26 design and browser path

- Requirements, threat model, lifecycle, rollback, and responsibility-boundary documents.
- Browser Web Worker preflight for PDF magic, byte size, page/text limits, and SHA-256 metadata.
- Browser publication client with safe, non-secret recovery metadata and no PDF bytes, extracted text, ticket, or signed URL in browser storage.
- Admin primary browser publication flow behind `VITE_PHASE7_26_BROWSER_PDF_PUBLISHING`; default is off.
- In-memory extracted-text handoff to AI controls, with private-R2 re-download and revalidation fallback.
- Local Publisher UI demoted to a recovery/compatibility disclosure when the browser feature is enabled.

### Phase 7.26 database and Edge coordination

- Additive migration for `pending -> uploaded -> committed -> active`, plus `retired`, `aborted`, and `expired` recovery states.
- Server-side Admin actor, lecture/document, Origin, byte count, SHA-256, nonce/JTI, generation, expiry, and immutable object binding.
- Five-minute upload lease, explicit ticket reissue, idempotent commit/activation operations, future access-version fence, audit events, and cleanup claim leases.
- RLS, service-role-only Worker RPC access, `SECURITY INVOKER` public RPCs, and FK/lookup indexes for Phase 7.26.
- Edge functions for Admin orchestration and Worker-to-Supabase coordination.
- Activation ambiguity handling now re-reads authoritative DB state and avoids destructive rollback when the DB outcome cannot be established.
- A publication already replaced and marked `retired` is accepted as a committed activation outcome rather than being rolled back.

### Phase 7.26 Cloudflare Worker

- ES256 ticket verification, exact Origin check, MIME and optional Content-Length checks.
- Atomic DB nonce claim before accepting the body.
- Streaming byte count and `%PDF-` magic verification, native R2 SHA-256 verification, immutable conditional upload, and publication-scoped object key.
- Hidden manifest commit, future access-version activation, rollback, status reconciliation, and DB-leased cleanup.
- Same-ticket `receiving` retries can resume.
- A newer, DB-approved ticket generation can atomically replace a stale `receiving` ledger; a fully stored exact object can be adopted without a second object write.
- Staged-manifest recovery now validates the full immutable metadata set, not only key/bytes/hash.
- Cleanup permits the normal `DB retired + Worker active ledger` combination only for `retired` jobs and still refuses deletion while the object is visible in the manifest.

## Verified evidence at the pause boundary

- Phase 7.26 migration applied in a transaction over the existing 21-migration local schema: PASS.
- Phase 7.26 pgTAP: 78/78 PASS.
- Phase 7.26-only DB Production Gate checks: 14/14 PASS.
- Phase 7.26 DB regression subset reported by the DB audit: 852 assertions PASS.
- Phase 7.26 schema/test transaction rolled back cleanly; the test run did not leave the new tables in the baseline DB.
- Cloudflare Worker test suite: 19/19 PASS after the latest Worker implementation edit.
- Phase 3 TypeScript typecheck: PASS after the latest Worker implementation edit.
- Earlier browser preflight module E2E: 12/12 PASS before the interrupted Admin-UI E2E addition.
- Earlier Local Publisher suite: 11/11 PASS.
- `git diff --check`: PASS at pause preparation.

These are local results only. They do not constitute the Phase 7.26 Local Gate or Production Gate because the unfinished items below remain.

## Unfinished requirements and known blockers

### P0 — recovery and security correctness

1. Add focused Worker tests for the newly implemented stale-generation path:
   - generation 1 `receiving` without an object -> generation 2 succeeds;
   - generation 1 `receiving` with a complete exact object -> generation 2 adopts it;
   - old/new concurrent CAS leaves generation 2 canonical and only one immutable object;
   - coordinator rejection and CAS interruption converge on retry;
   - cross-lecture/document/hash/key and old-generation replay fail closed;
   - crash points after DB claim, ledger CAS, R2 put, and before DB receipt can all resume.
2. Add cleanup tests for `retired + active ledger`:
   - hidden reference is removed and the object/ledger are deleted;
   - already-absent object/reference completes idempotently;
   - visible reference, binding mismatch, and manifest CAS conflict preserve data;
   - the replacement visible document is never changed.
3. Close the cross-tab recovery gap. Current safe job metadata is stored only in `sessionStorage`; closing the tab can lose discovery and collide with the one-inflight-publication constraint. Preferred design:
   - add an Admin-owned Edge/DB lookup for the current in-flight publication scoped to lecture + tracked Admin actor;
   - resume only when the immutable request fingerprint matches;
   - require an explicit abort decision when a different file is selected;
   - optionally cache only non-secret discovery metadata in expiring `localStorage` as a convenience, never tickets, PDF bytes, extracted text, signed URLs, or secrets.
4. Harden Worker -> coordinator HTTP communication:
   - HTTPS only, with explicit localhost development exception;
   - exact Supabase host/path validation and no userinfo/query/fragment;
   - `redirect: 'error'` so the shared secret cannot follow a redirect;
   - bounded response body (for example 64 KiB) before JSON parsing;
   - explicit timeout tests, HTTP/redirect/oversized-body negative tests.
5. Make the coordinator Edge function reject every unknown `action` explicitly instead of allowing fall-through into `recordUploaded` validation.

The attempted patch for items 4 and 5 did not apply and therefore was not partially relied on.

### P0 — Phase 7.25 regression blockers

1. Grant the minimum required `SELECT` on `academic_answer_publication_events` to `service_role`; writes should remain behind the existing controlled function path.
2. Add four missing leading FK indexes:
   - publication events `(lecture_session_id, answer_id, revision_id)`;
   - academic requests `(lecture_session_id, automation_run_id)`;
   - academic requests `(automation_run_id)`;
   - summary runs `(academic_authorization_grant_id)`.
3. Update the Phase 7.2 late-result test source fixture so it satisfies the Phase 7.25 source verifier (`passed`, primary/original-research classification, and the appropriate provider evidence).
4. Re-run Phase 7.25 pgTAP after the permission/index/fixture repairs.

### P1 — browser integration and regression

1. The actual Admin-page Playwright test was being added when work was paused. Treat `e2e/demo/browser-pdf-publication-admin.spec.ts` and related runner/package changes as unverified work-in-progress.
2. Complete and pass these Admin flows with network mocks:
   - select PDF -> preflight -> Worker PUT -> Edge finalize -> active document;
   - reload/recovery via status -> finalize;
   - Local Publisher remains visible only as a recovery path;
   - no ticket, PDF bytes, or extracted text remain in browser storage.
3. Add a completely closed-tab/new-context recovery test once the server-side discovery mechanism exists.
4. Re-run current typecheck, lint, unit/static/load tests, production build, Chromium E2E, WebKit E2E, accessibility, and visual regression.
5. Confirm the Phase 6.6 production UX and Phase 6.8-7.2 behavior remain unchanged outside the new feature flag.

### P1 — database and operational validation

1. Generate/update checked-in DB types after the migrations are finalized.
2. Validate both clean reset and existing Phase 0-7.2 upgrade migration paths.
3. Execute true two-connection concurrency tests for nonce claim, commit, activation, and cleanup leases.
4. Run every pgTAP file, including Phase 0's 27 security assertions and all Phase 7.25/7.26 tests.
5. Run DB lint/Advisor-equivalent local checks and missing-FK-index checks.
6. Replace the provisional Phase 7.26 load write estimate with implementation-derived counts and confirm publication cost is independent of 20/300 student fan-out.
7. Perform a real Cloudflare Workers Free CPU/memory measurement with representative 15 MB PDFs before Production Gate. Heavy parsing remains in the browser; the Worker must remain streaming-only.

## Required Local Gate sequence after resuming

1. Re-read this handoff and the two Phase 7.26 design documents.
2. Inspect `git status`, the checkpoint commit, and the Admin E2E file created immediately before pause.
3. Finish P0 security/recovery corrections and focused tests first.
4. Repair the three Phase 7.25 regression categories and run its DB tests.
5. Complete Admin UI E2E and cross-tab recovery.
6. Apply migrations to an isolated local Supabase DB, regenerate DB types, and run clean-reset plus upgrade suites.
7. Run all frontend, Edge, Worker, Publisher, DB, load, Chromium, WebKit, accessibility, visual, build, lint, and secret checks.
8. Create a Phase 7.26 Local Gate report. Any failed required check keeps the gate `HOLD`.
9. Only after Local Gate PASS, perform Human/Hosted/Production Gate review. Production flags remain off until then.

## Fast resume commands

```powershell
Set-Location 'C:\Users\emers\Documents\Codex\2026-07-13\c-users-emers-onedrive-desktop-compass\work\phase7-25-implementation'
git branch --show-current
git status --short
git log -3 --oneline
Get-Content -Encoding utf8 docs\PHASE7_26_PAUSE_HANDOFF_2026-07-21.md
```

Expected branch is `phase7-25-local`. Continue locally; do not switch to `main`, push, deploy, or enable flags during the resumed Local Gate work.

## Review/archive note

No archive behavior was changed. The current R2 Review route remains code-and-Turnstile based, permits a code holder who was not an original participant to open an exported archive during its retention window, and avoids live Supabase polling. Its present payload includes the lecture metadata, approximate close-time participant count, visible comments (bounded), closed polls, public summaries, public academic answers, and the active archived PDF. Enhancements such as cumulative unique participants, more than 12 summaries, pagination beyond 500 comments, and multiple-PDF history remain intentionally deferred.
