# Phase 7.26 Local Gate — 2026-07-21

## Decision

- Automated Local Gate: **PASS**.
- Human local visual gate: **HOLD** until the operator records approval.
- Hosted/Production gate: **HOLD**. No production Supabase, Cloudflare, public
  Web, hosted setting, feature flag, credential, push or deployment was changed.
- Browser PDF publication remains default OFF at frontend, Edge and Worker.

This record covers Phase 7.25 regression plus the Phase 7.26 browser-complete
private PDF publication implementation. A PASS here proves the local repository
and disposable local services only; it is not production authorization.

## Requirement disposition

| Requirement group | Result | Evidence |
| --- | --- | --- |
| One-CTA browser flow and Local recovery compatibility | PASS | Admin hook/client/E2E; flag ON hides Local controls and rejects all Local register requests; flag OFF preserves Local UI. |
| No permanent browser R2 credential and no PDF bytes in Supabase | PASS | Edge receives bounded JSON/receipts only; browser streams directly to Worker; static and Edge contract tests. |
| Worker distrusts browser validation | PASS | Ticket, exact Origin/path, actual byte count, `%PDF-` magic, R2-native SHA-256, binding, expiry, nonce and immutable key tests. |
| One-effect upload and idempotent recovery | PASS | DB nonce claim, private ledger CAS, discovery, status, finalize and two-connection race tests. |
| `pending -> uploaded -> committed -> active` | PASS | Hidden commit and future-access-version activation; lecture state is rechecked at every durable transition. |
| Uncommitted content denied | PASS | Manifest/read tests and Worker tests for pre-commit, hidden and terminal states. |
| Bounded browser parsing/no OCR | PASS | Dedicated validation Worker, 15 MiB/75 page/20,000 character limits and static rejection tests. |
| Terminal cleanup and delayed-request fence | PASS | Permanent ledger/object sentinels, last-moment ledger ETag checks, retryable exact-reference rollback and cleanup tests. |
| Local/Browser mutual exclusion | Local PASS | Code/UI contracts pass. Hosted proof still requires stopping Local Publisher and revoking/isolating its R2 writer. |
| Workers Free resource suitability | Modeled PASS | No Worker PDF parser/full-buffer hash; real 15 MiB CPU/memory/duration canary remains Hosted HOLD. |

## Defects found and corrected during the gate

1. Cleanup could retry manifest conflicts up to `O(limit^2)`. Each success or
   conflict now consumes one due-item budget, keeping work `O(limit)`.
2. Cleanup intent keys could collide for equal SHA-256 at different object keys.
   v2 intent/audit keys now injectively include the full object key; legacy v1
   intents remain readable.
3. A delayed upload/commit/activate could outlive a time-based assumption.
   Terminal cleanup now leaves permanent immutable sentinels and every mutation
   rechecks the exact ledger ETag immediately before manifest CAS.
4. Admin PDF extraction cache reuse could avoid reauthorization and a download
   could buffer an unbounded response. Cached use now obtains a new private
   access session; download has a 30-second deadline and 15 MiB streaming cap;
   logout clears the cache.
5. Local Publisher receipts did not carry the full manifest/access fence.
   Publisher, server, client and Admin registration now propagate and validate
   `accessVersion` plus the verified manifest ETag.
6. Full pgTAP could be polluted by archive outbox rows left by a prior real-DB
   E2E. The Phase 6.6 claim test now removes pre-existing outbox rows only inside
   its rollback transaction, preserving the real DB while making the suite
   repeatable. The polluted-state suite then passed 1115/1115.

## Database and migration evidence

Additive migrations:

- `20260720205404_phase7_25_multidisciplinary_auto_academic_answers.sql`
- `20260721075029_phase7_26_browser_pdf_publication.sql`
- `20260721190000_phase7_26_terminal_activation_cleanup.sql`
- `20260721200000_phase7_26_local_publisher_manifest_fence.sql`

Results:

- clean reset through all migrations: PASS;
- full pgTAP: **23 files, 1115 tests, PASS**;
- Phase 7.2 data fixture upgraded through all four migrations: **6/6 PASS** and
  fixture data preserved;
- two independent DB connections racing nonce, lease, finalize, abort and
  cleanup: PASS without deadlock;
- generated database types deterministic/current: PASS;
- DB lint with `--fail-on error`: PASS. Four existing warning-only unused
  compatibility parameters remain in private snapshot functions; no new error.

Rollback is expand-first and non-destructive: disable new browser starts, drain
or terminalize all jobs and due cleanup, disable Edge, disable Worker upload,
then deliberately reissue/enable the isolated Local credential. No migration or
active object is dropped.

## Code, security and browser evidence

- all non-live CI groups: **52/52 PASS**;
- Cloudflare Worker: **44/44 PASS**;
- Local Publisher: **12/12 PASS**;
- Phase 7.26 Edge contract: **3/3 PASS**;
- Phase 7.26 browser-mode E2E: **8/8 PASS** on Chromium/WebKit;
- flag-OFF Local compatibility E2E: **2/2 PASS** on Chromium/WebKit;
- real local-Supabase teacher/student lifecycle stability E2E: **9/9 PASS**
  across Chromium, WebKit and Mobile Chromium, three repetitions each;
- complete Demo stability E2E: **96 PASS, 60 expected skips, 0 failures** across
  Desktop/Mobile Chromium and WebKit, three repetitions;
- typecheck, lint, production build and Phase 6.9 bundle budgets: PASS;
- Admin JavaScript 87,183 bytes, below the 92,109-byte gate;
- secret scan: **435 tracked/untracked files, PASS**;
- `git diff --check`: PASS; no credentials, local absolute paths, binary PDF,
  test output or protected Phase 6.6/Project Guide edits are included.

The in-app browser inspected the production build at Desktop and 390 x 844:
Demo content/order and explicit `(デモ)` participant label, Admin PIN entry and
Join UI rendered with no page-level horizontal overflow or console error. This
automated inspection does not count as human approval.

## Load and cost boundary

- First browser publication: 17 modeled DB writes and 8 R2 mutations.
- Replacement publication: 20 modeled DB writes and 8 R2 mutations.
- Normal terminal cleanup: 8 DB/4 R2 mutations; activation-expiry repair:
  10 DB/at most 6 R2 mutations.
- Work is Admin/job bounded and adds zero per-student upload requests or Realtime
  subscriptions in both 20-person Free and 300-person Pro lecture models.
- Worker performs no page parsing, OCR or OpenAI call. Phase 7.26 introduces no
  paid AI provider call.

## Remaining Local/Human evidence

- operator visual review of the real Admin publication CTA, student PDF and
  Display page using a representative real PDF;
- real-phone scan of the Phase 7.1 QR;
- teacher review of Phase 7.2/7.25 multidisciplinary claim/source wording.

The commit containing this document is the independent Phase 7.25/7.26 local
implementation commit; its hash is recorded in the final handoff report.
