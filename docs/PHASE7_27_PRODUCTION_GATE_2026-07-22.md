# Phase 7.27 Production Gate — 2026-07-22

## Decision

- Temporary public preview: **DEPLOYED**
- Final operational Production Gate: **HOLD**
- Production Journal Club run: **not created**
- Hosted human UX review: **pending after preview publication**
- Actual production-lecture E2E: **deferred until the real lecture**
- Stop conditions: ownership disclosure, unauthorized paid work, migration
  incompatibility, PDF replay/immutability failure, archive-policy downgrade or
  existing UX regression.

This temporary preview decision does not supersede the final operational HOLD.
The historical 2026-07-21 record and Phase 7.27 Local Gate remain unchanged.

## Release scope

- Lecture title: `Dual-targeting CasRx for C9orf72 ALS/FTD`.
- Rehearsal and production preparation create isolated draft lectures and six
  draft Polls, then enter the conventional Admin lecture list.
- Both run kinds use the same existing start action, exact active-PDF guard and
  90-minute lifecycle. Only the one-production constraint and its terminal
  permanent archive policy differ.
- Admin AI panels retain the existing controls while showing only the action,
  state and high-value cost/safety information required during a lecture.
- No production run is created by deployment or smoke testing.

## Preserved production recovery point

| Evidence | Value |
| --- | --- |
| Previous remote `main` | `cc1ae93722eedf35ea4eb8f6dd89ed5f012572e7` |
| Immutable recovery tag | `production-archive-20260722-pre-phase7` (pushed) |
| Previous Pages deployment | `45fa7102-104a-423b-8920-3616ebeb2633` |
| Previous Pages deployment URL | `https://45fa7102.compass-interactive.pages.dev` |
| Previous Worker deployment | `972cc170-51ed-4616-969c-a72e44893248` |
| Previous Worker version | `89b39838-195d-45ae-b863-7d2f2e9ae601` |
| Database schema dump | `569,013 bytes`, SHA-256 `a7ea367b61900297d5892760919cca671fcdeed8b4d0412201dc62b3c0537e25` |
| Database data dump | `66,613 bytes`, SHA-256 `922cb0391733458a6cf9513a49732f9eb00e181f28ef6825bb4573acb18094b0` |
| R2 inventory | `8 objects`, SHA-256 `26b1d3d91b49d34e66b728d5886b78507f5a55e7f961c933cce539908af82da1` |

The dump and inventory bodies remain ignored local recovery artifacts and are
not committed. Only their non-secret hashes and prior deployment identifiers
are recorded here.

## Local candidate evidence

- Clean migration and Phase 7.26 upgrade: PASS on the candidate migration set.
- pgTAP: **1,171/1,171 across 24 files**; Phase 7.27: **56/56**.
- Two-connection request replay, production uniqueness, parallel rehearsal and
  single-open races: PASS.
- Main, publisher and E2E type checks: PASS.
- Lint: zero errors; two pre-existing Admin hook dependency warnings.
- Non-live regression: **55/55 groups**.
- Asset Worker: **49/49**; production dry-run PASS.
- npm high-severity audit: zero vulnerabilities.
- Real browser -> local Edge -> local Postgres rehearsal/production parity:
  PASS; both were closed and removed from the local test database.
- A selected lecture is cleared only on an authoritative snapshot 404, not
  merely because it is outside the bounded recent-lecture list. Journal Club
  rows do not expose the generic duplicate-without-Polls/PDF action.
- Phase 7.27 flag ON Chromium/WebKit desktop/mobile: **24 PASS / 4 intended
  skips**; flag OFF: **4 PASS / 24 intended skips**.
- `git diff --check`, secret scan, bundle ceilings and production build: PASS.

## Hosted expand-first rollout

| Gate | State | Evidence |
| --- | --- | --- |
| Recovery tag pushed | PASS | `production-archive-20260722-pre-phase7` -> `cc1ae93722eedf35ea4eb8f6dd89ed5f012572e7` |
| Nine pending migrations applied in order | PASS | Remote history matches through `20260722012313` |
| Remote DB lint / Advisor-equivalent | PASS | Zero errors; four pre-existing unused-parameter warnings |
| New/changed Edge Functions deployed | PASS | 26 functions; 21 JWT and 5 intentional machine-only configurations verified |
| Worker capability deployed and activated for preview | PASS | Version `3bd7062a-e674-45c7-b32a-9f0f2ae2cbb6` |
| Existing public client smoke | PASS | Join, Demo, Display and Archive routes; no browser-console errors |
| Authenticated Admin / production two-user separation | HOLD | Requires operator Admin authentication after preview publication |
| Candidate integrated to `main`; hosted CI | PASS REQUIRED | Quality, browser and local-Supabase jobs must be green on the final release commit |
| Public Pages routes and browser console | PASS | Deployment `2b2708ac-2cad-446b-8a03-a1e879ef1c3d` from `3383265` |
| Worker -> Edge -> frontend staged activation | PASS | OFF-first deployment followed by explicit preview enablement |
| Hosted Journal Club run | INTENTIONALLY NOT CREATED | Rehearsal and production preparation are reserved for post-preview review |

## Short-route boundary and post-release audit

The operator authorized a time-bounded temporary preview route. It enables the
implemented capabilities for hosted UX verification while deliberately creating
no Journal Club run. It is not final authorization for lecture operation.

The following are explicitly tracked after publication because they cannot be
completed inside the one-hour release window:

- representative 15 MiB canary and extended Worker CPU/latency observation;
- authenticated Admin preset/PDF path and production two-user separation;
- real R2 publication, nonce/replay, immutable object and two-Admin race canaries;
- cleanup Cron convergence across two real schedules;
- real smartphone, operator UX review and real microphone operation;
- the actual one-time production run and terminal permanent-archive hash audit;
- longer WAF/rate-protection telemetry review.
- GitHub CodeQL upload after the private repository's billing-controlled Code
  Scanning capability is explicitly enabled. Until then, the pinned job remains
  conditional; secret scan, high-severity audit, SBOM, immutable Action refs and
  the repository's security regressions remain mandatory in Quality CI.

Until those observations complete, browser PDF publication remains enabled only
for the reversible preview, the Local Publisher stays stopped and its writer
credential remains isolated (not claimed revoked), paid AI still requires API
PIN and the production Journal Club run remains uncreated.

## Rollback

1. Disable frontend, Edge and Worker feature flags in that order.
2. Stop new Admin preparation/PDF publication; stopping paid work remains free.
3. Restore the previous Pages and Worker deployment identifiers above.
4. Restore application code from the immutable recovery tag.
5. Do not drop additive schema. Repair forward after evidence capture.
6. If permanent archive data ever exists, stop cleanup before any Worker
   rollback that lacks permanent-policy compatibility.
