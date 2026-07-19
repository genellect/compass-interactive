# Phase 7.1 Local Gate - 2026-07-19

Base commit: `89f59bd`
Decision: **PASS for automated local Phase 7.1 scope**
Release decision: **HOLD - real-phone QR and human classroom review remain;
no push, deployment, hosted setting, secret, paid call or flag enablement is
authorized**

## 1. Scope and protected work

The local scope covers deterministic summary language, ownership-safe
on-demand own comments and local Admin/Display QR. The following pre-existing
user edits were not edited, formatted, staged or committed:

- `docs/PHASE6_6_INTEGRATED_UX_AND_OPERATIONS.md`
- `docs/PHASE6_6_LOCAL_GATE_2026-07-16.md`
- `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`

## 2. Automated evidence

| Gate | Result |
| --- | --- |
| ja/en/mixed/manual/PDF/default resolution | PASS - 5 node:test cases |
| No bilingual/detection provider call | PASS - one existing Responses endpoint; idempotency key preserved |
| New DB authorization/state tests | PASS - 37 pgTAP assertions |
| Full Phase 0-7.1 pgTAP | PASS - 19 files / 907 assertions after both clean reset and Phase 6.9 upgrade |
| Independent QR decoding | PASS - module raster decoded by pinned `jsQR` |
| Browser QR decoding | PASS - rendered Admin and Display images decoded from canvas |
| Own history on-demand/no periodic call | PASS - first selection exactly one RPC, unchanged after 5.5 seconds |
| Demo isolation, a11y, visual and own filtering | PASS - 60/60, Desktop/Mobile Chromium/WebKit, three repetitions |
| Local DB Admin/student/Display lifecycle | PASS - 9/9, Chromium/WebKit/Mobile, three repetitions |
| Display StrictMode/operator safety | PASS - no participant-RPC fallback or pageerror after fix |
| Generated DB types | PASS - deterministic zero drift |
| TypeScript/lint/production build | PASS - app, Phase 3 and E2E types; zero lint errors; Vite production build |
| Bundle regression | PASS - Admin 87,399 B / 92,109 B limit; app CSS 82,275 B / 88,449 B limit |
| DB lint | PASS - zero errors; four pre-existing compatibility warnings |
| Load model | PASS - zero Phase 7.1 periodic requests/subscriptions and one summary call/window |
| Security | PASS - secret scan; npm audit found zero vulnerabilities |

## 3. Global gate classification

| Gate | Local result | Remaining evidence |
| --- | --- | --- |
| G0 traceability | PASS | none |
| G1 DB/authorization | PASS locally | hosted Advisor and two-user canary later |
| G2 code/artifacts | PASS locally | committed-SHA CI |
| G3 UX/accessibility | AUTOMATED PASS - 60/60 Demo browser cases | human Admin/student/Display review |
| G4 browser/visual | AUTOMATED PASS - Demo 60/60 and local DB 9/9 | real phone camera and public-origin scan |
| G5 load/cost | PASS | production canary telemetry |
| G6 compatibility/recovery | PASS locally | production backup/rollback rehearsal |
| G7 evidence/release control | PASS for local scope | hosted CI and human sign-off |

## 4. Migration and rollback evidence

The additive migration applies from zero and from the previous-Phase schema.
Old v2 history and Phase 6 summary contracts remain. The frontend and server
flags default OFF. Rollback disables both flags and restores prior code; the
new nullable/defaulted metadata and unused v3 RPC may remain until a future
contract cleanup.

## 5. Human/hosted items

1. scan the Admin QR and Display QR using a real phone camera on the intended
   public origin;
2. confirm join success and QR disappearance after lecture close;
3. review Desktop/Mobile/Admin/Display labels, focus, contrast and classroom
   distance readability;
4. run the committed SHA in GitHub Actions and retain browser, SBOM, CodeQL and
   dependency-review evidence;
5. at the later production gate, apply migration and Edge/frontend in the
   documented OFF-first order, run Advisor/two-user canary, then decide flag
   enablement.

Until these are recorded, Phase 7.2 progression and production release remain
HOLD under the Roadmap stop-the-line rule.
