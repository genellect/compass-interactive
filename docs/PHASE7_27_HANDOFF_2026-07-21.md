# Phase 7.27 Journal Club integration handoff — 2026-07-21

## Stop state

- Worktree: `work/phase7-27-journal-club`
- Branch: `phase7-27-local`
- Base commit: `e8e68aff1cf61e18378a4e07781676686e623395`
- Production status: **HOLD**
- Hosted Supabase, Cloudflare Worker/R2, public Web, OpenAI, feature flags, `main`, push and deploy: **unchanged**
- Production Journal Club run: **not created**
- Protected historical files: **unchanged**
- Vite, Worker and Supabase target ports checked at stop: no listener remained on `5173`, the E2E ports, `54321`–`54323` or `8787`.
- Generated `tmp/` content, copied PDF inspection files and the Windows-only PDF.js test polyfill were removed before the checkpoint.

This is a safe implementation checkpoint, not a Local Gate or Production Gate PASS record.

## Accepted canonical PDF

The user accepted the corrected source without further edits. The singular heading and changed page numbering are intentional and must not be “fixed”.

- Source outside repository: `C:\Users\emers\OneDrive\Desktop\University\5_研究室\7_Presentation\Journal Club\260723 JournalClub Presentation.pdf`
- Bytes: `5,816,208`
- SHA-256: `8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842`
- Pages: `34`
- PDF version: `1.6`
- Encrypted: no
- Page 28 heading: `MY PERSPECTIVE`

The PDF has not been copied into Git or uploaded to production. Phase 7.27 binds this exact descriptor and publishes the original source only after the Human/Hosted Production Gate passes.

## Implemented contracts

### Database and lifecycle

- Additive migration: `20260721210000_phase7_27_journal_club_integration.sql`
- Service-only, RLS-enabled Journal Club run and Poll-slot metadata.
- Exactly one production run; repeatable rehearsals.
- Fresh lecture UUID and fresh six-digit code per run.
- Request-ID idempotency and advisory-lock/unique-index concurrency control.
- Six Polls are created as drafts and require explicit teacher start/close.
- Rehearsal comments, Poll responses and AI data remain tied to their fresh lecture and are not copied to later runs.
- Production-only exact PDF descriptor validation and permanent archive policy marker.
- Existing standard lecture and 30-day archive behavior remains unchanged.

### Edge and authorization

- New tracked-Admin action in `manage-lectures` behind the default-OFF server flag.
- Signed Admin session is rebound to the verified Supabase Auth user before the RPC.
- Preset creation does not start a lecture, Poll, PDF upload, Realtime or any billable AI operation.
- Poll template ordering is returned only while the Phase 7.27 server flag is enabled.

### UI

- Default-OFF frontend flag and dependency gating.
- Admin can prepare a rehearsal or the one-time production draft.
- The six Polls are visible in template order and remain drafts.
- Production/rehearsal labels are shown without replacing the existing Admin workflow.
- Archive UI recognizes only the exact production permanent-retention policy.
- The Phase 6.9 Admin view-model extraction keeps the large module within its existing size gate.

### Worker and archive

- Exact permanent-policy validation; no broad truthy marker.
- Production archives can retain up to 18 five-minute summaries while standard limits remain unchanged.
- Permanent production archives are excluded from normal 30/37-day cleanup.
- PDF retention binding can be repaired idempotently.
- Archive access tokens remain 15 minutes and PDF tickets remain 5 minutes.
- Phase 7.26 Origin, nonce, actual-byte count, PDF magic, native SHA-256, immutable upload and CAS fences remain in force.

## Verification completed

### Database

- Clean local migration reset: PASS.
- Phase 7.27 pgTAP: `53/53` PASS.
- Full SQL regression: `1,168/1,168` PASS across 24 files.
- Phase 7.26-to-7.27 upgrade probe: `9/9` PASS.
- Real two-connection concurrency probe: PASS for duplicate request convergence, one production, parallel rehearsals and one open run.
- Local DB lint with `--fail-on error`: PASS; only pre-existing unused-parameter warnings.
- Generated DB types: refreshed and typechecked.

### Unit, static, load and build

- Phase 7.27 Edge tests: `4/4` PASS.
- Asset Worker tests: `47/47` PASS.
- Full non-live suite: `55/55` groups PASS.
- Phase 7.27 20/300-participant load model: PASS; no added per-student periodic request or subscription.
- Main, Phase 3 and E2E TypeScript checks: PASS.
- `oxlint`: zero errors; one pre-existing `AdminPage.tsx` exhaustive-deps warning remains.
- Production build: PASS.
- Phase 6.9 bundle ceilings: PASS.
  - Admin JS `88,330 / 92,109` bytes
  - app CSS `86,103 / 88,449` bytes
  - index JS `288,693 / 529,742` bytes
  - PDF JS `460,791 / 479,617` bytes
- `git diff --check`: PASS before this handoff file was added.

### Browser regression

- Full demo triple run: `108` passed, `72` intentionally skipped, zero failed across Chromium/WebKit and desktop/mobile projects.
- Phase 7.26 browser PDF ON: `8/8` PASS on desktop Chromium/WebKit.
- Phase 7.26 flag OFF: `2/2` PASS.
- Phase 7.27 flag ON: `4/4` applicable PASS on desktop/mobile Chromium/WebKit.
- Phase 7.27 flag OFF: `4/4` applicable PASS on desktop/mobile Chromium/WebKit.
- Existing Phase 6.6 student flows, comment nickname, Poll, history, exit, accessibility and visual contract therefore have automated non-regression evidence.

## Last interrupted check

`npm.cmd run test:e2e:local` did not reach application tests. Supabase CLI attempted to write telemetry under `C:\Users\emers\.supabase`, which the current workspace sandbox denied with `EPERM`. This is an execution-environment restriction, not an application assertion failure.

At resume, rerun it with an isolated writable home under the worktree, or with an approved execution context. Do not weaken the test to bypass Supabase behavior.

Suggested isolated-home retry, to be verified rather than assumed:

```powershell
$localHome = Join-Path (Get-Location) 'tmp\supabase-home'
New-Item -ItemType Directory -Force -Path $localHome | Out-Null
$previousUserProfile = $env:USERPROFILE
$previousHome = $env:HOME
$previousTelemetry = $env:SUPABASE_TELEMETRY_DISABLED
try {
  $env:USERPROFILE = $localHome
  $env:HOME = $localHome
  $env:SUPABASE_TELEMETRY_DISABLED = 'true'
  npm.cmd run test:e2e:local
} finally {
  $env:USERPROFILE = $previousUserProfile
  $env:HOME = $previousHome
  $env:SUPABASE_TELEMETRY_DISABLED = $previousTelemetry
}
```

## Required fixes or explicit gate decisions after resume

### Gate blockers

1. **Production start must require the canonical PDF to be active.**
   The current production run can technically be opened before its PDF is published. Add a production-only server-side start guard, or keep Production Gate HOLD with a tested operational guard. A DB guard is preferred because a UI-only rule is not fail-safe.

2. **Permanent archive retention must be monotonic.**
   Once an archive has the exact permanent policy, a later higher-version standard payload should not be able to downgrade it. Add Worker rejection and a regression test.

3. **Real local Phase 7.27 integration is missing.**
   Use synthetic secrets and disposable local Supabase/Worker state to test real Admin PIN login → rehearsal/production preparation → DB run and six Poll rows. Assert zero AI usage, zero automatic PDF document and no automatic lecture/Poll start.

4. **End-to-end archive chain is missing.**
   Test production close → export claim → Edge sanitizer → Worker ingest → same-code archive resolve → PDF ticket → Archive UI. Verify permanent production versus standard rehearsal expiry/cleanup.

5. **Phase 7.27 dedicated E2E must pass three consecutive times on the same commit.**
   Run both flag ON and OFF on Chromium/WebKit, desktop/mobile, with `--repeat-each=3`.

6. **Archive/UI accessibility regression needs direct coverage.**
   Add exact-policy display tests and Admin preset axe/keyboard/loading/error/visual checks.

### Recommended hardening

- Add direct run-isolation assertions for AI summaries, academic answers, usage reservations and resume tokens, not only comments and Poll responses.
- Avoid a needless Admin 409 when the production run is outside the short lecture list; expose production-prepared metadata without adding per-student load.
- Treat the permanent R2 archive as retention policy, not WORM backup. After the production archive is finalized, preserve a sanitized archive JSON, PDF SHA-256 and manifest in an independent offline recovery copy.
- Future physical deletion must remove Poll slots/runs in an explicit order because run/Admin-session foreign keys intentionally use `ON DELETE RESTRICT`.

## Hosted and Human Gate still required

Do not merge, push, deploy, enable flags or create the production run until all items below pass and the user explicitly approves the visual result.

- Hosted Supabase migration and Advisor/lint with flags OFF.
- Private R2/Worker/Edge staged deployment with flags OFF.
- Exact corrected PDF upload and all 34 pages checked.
- 15 MiB canary and immutable/retry/reuse failure paths.
- Two-Admin real concurrency.
- Turnstile hostname/action, two rate limiters, Durable Object and WAF/rate protection.
- Cleanup Cron success, retry and monitoring.
- Actual smartphone, desktop Admin, student lecture, Display and Archive review.
- PDF synchronization, comments, nickname, all six Polls, close convergence and same-code archive re-entry.
- Hosted CI and supply-chain checks on the exact candidate commit.
- Independent offline recovery copy after final production archive creation.

The six-digit lecture code is an entry capability, not a permanent high-entropy secret. Permanent archive approval therefore depends on the real Turnstile/rate/WAF controls and the short-lived resume-token path.

## Resume sequence

1. Confirm branch/worktree and read this document plus `PHASE7_27_JOURNAL_CLUB_INTEGRATION.md`.
2. Confirm the checkpoint commit and a clean worktree.
3. Recreate only ignored `tmp/` test state as needed; never copy the source PDF into Git.
4. Implement the production PDF start guard and monotonic permanent-retention rule with focused tests.
5. Add the missing real local integration/archive/a11y tests.
6. Rerun local Supabase E2E using a writable isolated CLI home.
7. Rerun full pgTAP, 55-group non-live suite, type/lint/build, dedicated E2E triple, secret scan and `git diff --check`.
8. Create the formal Phase 7.27 Local Gate record only after all local blockers pass.
9. Present the local browser to the user for Human Gate; keep all hosted flags OFF.
10. Only after explicit human approval, execute the staged Hosted Gate and then request the final production-enablement decision.
