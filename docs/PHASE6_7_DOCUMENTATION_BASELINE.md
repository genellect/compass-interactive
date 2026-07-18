# Phase 6.7 Documentation and Release Baseline

Date: 2026-07-18
Implementation type: documentation-centered, no classroom or hosted behavior

## 1. Objective

Phase 6.7 removes the operational risk created by Phase 0-only entry documents,
fragmented Phase evidence and an implicit future roadmap. A developer or
operator must be able to identify the current product, trust boundaries,
commands, deployment authority and next gate without reconstructing the entire
Git history.

## 2. Scope

### Included

- README as the canonical repository entrypoint;
- current architecture, security, data and database responsibility documents;
- Phase 0-6.6 development history;
- Phase 6.7-9 requirements, ordering and stop-the-line gates;
- runbook and historical-evidence index;
- documentation consistency test in non-live CI;
- package development-preview version.

### Excluded

- database migration or Hosted Supabase change;
- RLS/RPC/Edge behavior change;
- frontend UI or route behavior change;
- Cloudflare Worker/R2/Pages deploy;
- OpenAI call, key or model change;
- production push or feature-flag activation;
- edits to unrelated pre-existing working-tree changes.

## 3. Documentation authority order

1. Real code, migrations and configuration.
2. `README.md` for the current entrypoint.
3. Current architecture/security/data/schema documents.
4. `docs/ROADMAP.md` for future requirements and gates.
5. `docs/RUNBOOK_INDEX.md` for operations routing.
6. Dated Phase gate/deployment documents for historical evidence.
7. Older milestone/draft documents for design history only.

When prose conflicts with code, the phase stops. The discrepancy is corrected
and tested rather than silently treating either source as current.

## 4. Traceability matrix

| Requirement                                | Artifact                  | Verification                                |
| ------------------------------------------ | ------------------------- | ------------------------------------------- |
| Current implementation visible from README | `README.md`               | Required-section and stale-claim assertions |
| Phase 0-6.6 trajectory                     | `docs/CHANGELOG.md`       | Landmark and roadmap assertions             |
| Current responsibility boundaries          | `docs/architecture.md`    | Required subsystem/route assertions         |
| Security and known gaps                    | `docs/SECURITY.md`        | Secret/RLS/Phase 6.8 assertions             |
| Data retention and exclusions              | `docs/data_policy.md`     | Required boundary assertions                |
| Schema map without duplicating migrations  | `docs/database_schema.md` | Migration-authority assertion               |
| Phase 6.7-9 plan and gates                 | `docs/ROADMAP.md`         | Phase/G0-G7 assertions                      |
| Operational navigation                     | `docs/RUNBOOK_INDEX.md`   | Relative-link existence test                |
| README commands are real                   | README/package scripts    | npm-script reference test                   |
| Routes and flags are current               | README/source/example env | route/flag reference test                   |
| Placeholder version removed                | package files             | version assertion                           |

## 5. Historical status reconstructed from code and evidence

- Phase 0: anonymous Auth, Turnstile and `auth.uid()` ownership hardening.
- Phase 1: public/private versioned snapshots and cursor history without comment
  Realtime dependence.
- Phase 2: server-time lifecycle, 90-minute stop, idempotent close, AI control
  and archive state.
- Phase 3: local PDF Publisher, private R2/Worker delivery and page sync.
- Phase 4/4.1: separate paid authorization, Realtime captions, usage ledger and
  separate Realtime/Batch concurrency lanes.
- Phase 5: bounded PDF-text material analysis and teacher-only Poll proposals.
- Phase 6: five-minute summaries/comment pulse with immutable review/publication.
- Phase 6.5: nullable per-comment nickname and isolated Demo implementation.
- Phase 6.6: integrated UX, approximate presence, R2 archive, operations digest
  and provider hangup control.
- CI baseline: non-live regression, Demo Chromium and local Supabase browser E2E.

## 6. Acceptance gates

Phase 6.7 is PASS only when:

1. required current documents exist and are reachable from README;
2. every README `npm run` command exists in `package.json`;
3. current routes and frontend Phase flags are documented;
4. canonical documents contain no `C:\\Users\\...` path or credential value;
5. README no longer claims the application is Phase 0/mock-only;
6. `package.json` and `package-lock.json` use the same non-placeholder version;
7. documentation test, typecheck, lint, non-live regression and build PASS;
8. `git diff --check` and changed-file secret scan PASS;
9. no migration, production environment or UI behavior changed;
10. pre-existing unrelated changes remain unstaged and unmodified.

If a human fresh-clone walkthrough cannot be performed in the current turn, the
local report must identify that as a blocking or later release-gate item rather
than claiming evidence that does not exist.

## 7. Rollback

Phase 6.7 has no database or hosted rollback. Revert only the Phase 6.7 commit
if the new canonical documents or test are incorrect. Do not delete historical
Phase evidence. Restore the previous package metadata together with README/test
changes so the documented version and CI contract remain consistent.

## 8. Next phase entry

Phase 6.8 may start only after the Phase 6.7 local gate records the applicable
global gates as PASS and no contradictory canonical document remains. Phase 6.8
must begin with a requirements/current-code matrix for PIN limiting, Admin
sessions, CSP, resume tokens and communication/provider timeouts.
