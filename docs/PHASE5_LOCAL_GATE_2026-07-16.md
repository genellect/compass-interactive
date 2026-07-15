# Phase 5 local gate record

Date: 2026-07-16 (JST)

Decision: **PASS - local material analysis and AI Poll proposal implementation**

Production decision: **HOLD**. No production Supabase migration or setting,
Cloudflare resource, hosted secret, external service configuration, public Web
deployment, feature flag, Git push or model activation was changed.

## Delivered

- Teacher-initiated analysis of the exact immutable Phase 3 PDF extraction.
- No OpenAI call during PDF publication and no PDF source text in Supabase.
- Server-owned model, prompt, token ceiling and price snapshot.
- Strict Responses API output, `store: false`, no tools/files/images/background
  execution, and deterministic evidence/quality gates.
- Billing PIN authorization for the initial analysis and every additional Poll
  proposal request.
- Phase 4.1 Batch-lane admission, atomic usage reservation/finalization and
  actor-bound idempotency.
- Admin-only analyses/proposals with RLS, minimal grants and no Realtime or
  student snapshot exposure.
- Teacher review/edit/reject flow; adoption creates only an ordinary Poll
  `draft` and never starts student delivery.
- Feature flags remain OFF by default in the frontend and Edge runtime.

Detailed state transitions, cost controls, rollback and production ordering are
in `PHASE5_MATERIAL_ANALYSIS_AND_POLL_PROPOSALS.md`. Requirements and threats
are mapped in `PHASE5_REQUIREMENTS_AND_THREAT_MODEL.md`.

## Database gates

| Gate                                  | Result | Evidence                                                              |
| ------------------------------------- | ------ | --------------------------------------------------------------------- |
| Clean Phase 0 -> 5 reset              | PASS   | All eleven migrations applied from an empty local PostgreSQL database |
| Existing Phase 4.1 data upgrade       | PASS   | Phase 4.1 fixture preserved; Phase 5 migration applied independently  |
| Upgrade assertions                    | PASS   | 14/14 pgTAP assertions                                                |
| Full SQL regression                   | PASS   | 12 pgTAP files, 498 assertions                                        |
| Phase 0 authentication regression     | PASS   | Original 27/27 assertions rerun explicitly                            |
| Phase 5 SQL suite                     | PASS   | 54 assertions included in the full regression                         |
| Phase 4.1 real concurrency regression | PASS   | start/finish/stop/close completed without deadlock                    |
| DB lint                               | PASS   | `public`/`private`, warning threshold: no findings                    |
| Local Advisor equivalent              | PASS   | security Advisor pgTAP plus DB lint/static privilege checks           |

The final local database was returned to a clean all-migrations-applied state
after the upgrade-path test.

## OpenAI contract and cost gate

The real provider contract test was intentionally run once with non-personal,
synthetic academic content. It used `gpt-5.6-luna`, returned strict structured
output with three accepted proposals, and reported 861 input plus 1,518 output
tokens. The server-side price snapshot calculated 9,969 micro-USD
(`$0.009969`). The response body and provider request ID were not printed or
stored in repository artifacts. The test was not repeated during final
regression to avoid unnecessary billing.

## Load gate

| Scenario           | Added student calls | Added Realtime subscriptions | PDF bytes/text in Supabase | Concurrent Batch operations |
| ------------------ | ------------------: | ---------------------------: | -------------------------: | --------------------------: |
| 20 students / 90m  |                   0 |                            0 |                          0 |                           1 |
| 300 students / 90m |                   0 |                            0 |                          0 |                           1 |

Phase 5 work is teacher initiated. It adds no five-second polling fields,
student reads, student subscriptions or per-student AI operations.

## Application and repository gates

| Gate                                                  | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| TypeScript `--noEmit`                                 | PASS                                              |
| Phase 3 Publisher/Worker TypeScript                   | PASS                                              |
| Oxlint                                                | PASS                                              |
| Phase 5 Edge helper suite                             | PASS (8/8)                                        |
| Phase 3 Publisher suite                               | PASS (7/7)                                        |
| Existing Phase 0-4.1 frontend/Edge/static/load suites | PASS                                              |
| Phase 5 static/default-OFF/load suites                | PASS                                              |
| Production frontend build                             | PASS                                              |
| Local boot-shell browser check                        | PASS with no console error or horizontal overflow |
| `git diff --check`                                    | PASS                                              |

The browser check intentionally used a build with hosted configuration absent
and all Phase flags OFF. It verified the Admin and student route shells only;
an authenticated Phase 5 panel visual canary remains part of the later hosted
rollout gate. No preview-only route or authentication bypass was introduced.

## Rollback and deferred production work

1. Keep Phase 1-5 frontend and Edge flags OFF until the combined Phase 6
   production gate.
2. Before rollout, recheck the selected model, price snapshot, hosted Edge
   timeout/body limits and organization/project quota.
3. Apply migrations expand-first, deploy both Edge functions and frontend OFF,
   then run hosted Advisor and two-Admin ownership/idempotency tests.
4. Run a teacher-authenticated Publisher-to-Edge canary with a disposable PDF
   before enabling any paid action.
5. Contract rollback disables both Phase 5 flags first. Tables and functions
   remain in place while older clients continue to operate; destructive removal
   is a later migration only after retention evidence is reviewed.
6. The real microphone/WebRTC test remains explicitly deferred to a later
   phase. Phase 5 does not change the audio path.

## Workspace integrity

`PROJECT_GUIDE.md` was not edited, formatted, staged or committed. Local
credentials, `.env.local`, provider response content, generated build output
and local Supabase state are excluded from the Phase 5 commit. The independent
commit hash is recorded in the handoff because a commit cannot safely contain
its own final hash.
