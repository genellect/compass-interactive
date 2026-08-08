# COMPASS Interactive Documentation Index

Status: Operationally verified
Scope: entrypoint and status vocabulary for the 96 documents in `docs/`
Last verified: 2026-08-09

This directory holds design records, gate evidence, and operational runbooks accumulated across Phase 0 through Phase 7.29. Most of those files are **dated records of a past decision**, not statements of current behavior. This index exists so that a reader arriving cold does not mistake one for the other.

`docs/RUNBOOK_INDEX.md` remains the entrypoint for setup, verification, deployment, rollback and incident work. This file indexes the whole directory and assigns each document a status.

## Precedence

When two sources disagree, the higher one wins.

1. What the user explicitly required for the task at hand
2. Current Production behavior and the implementation on the latest `origin/main`
3. [`AGENTS.md`](../AGENTS.md)
4. Approved current future contracts: [`ROADMAP.md`](ROADMAP.md) controls phase
   order and gates; [`PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`](PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md)
   and [`PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`](PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md)
   control their detailed domain contracts
5. [`README.md`](../README.md) and [`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md)
6. [`docs/CLOUD_DEVELOPMENT.md`](CLOUD_DEVELOPMENT.md), [`docs/architecture.md`](architecture.md), [`docs/SECURITY.md`](SECURITY.md), [`docs/data_policy.md`](data_policy.md), [`docs/database_schema.md`](database_schema.md)
7. [`docs/RUNBOOK_INDEX.md`](RUNBOOK_INDEX.md), [`docs/GATE_ROUTING.md`](GATE_ROUTING.md), [`docs/CI_AND_BROWSER_E2E.md`](CI_AND_BROWSER_E2E.md), and other route- or feature-specific requirement documents
8. Other `PHASE*` design, gate and handoff records

If Production and `origin/main` disagree, report the difference. Do not pick one as canonical by guessing.
If the Roadmap and an approved detailed domain contract disagree, stop and
reconcile both in the same reviewed change; neither silently overrides the
other.

## Status vocabulary

Every document in this directory falls into exactly one of these. New documents must declare theirs on the second line.

| Status                              | Meaning                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Production`                        | Describes behavior currently live in Production, confirmed by a Production Gate record.                                                                                |
| `Operationally verified`            | Describes the current implementation on `main` and is confirmed by an automated gate that runs in CI. Says nothing about Production rollout.                           |
| `Implemented, verification pending` | The code exists on `main`, but the hosted, human or Production evidence named in the document has not been produced.                                                   |
| `Planned`                           | Design or requirements only. No implementation is claimed.                                                                                                             |
| `Historical`                        | A dated record of a past decision, gate run or handoff. Preserved as evidence. **Does not describe current state and must never be used to justify present behavior.** |

A document dated in the past is not automatically `Historical` — `architecture.md` is dated and current. Conversely, a `PHASE*_LOCAL_GATE_*` record was accurate on its date and is `Historical` regardless of how recent it is.

## Canonical documents

| Document                                                                                                                 | Status                 | Responsibility                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| [`architecture.md`](architecture.md)                                                                                     | Operationally verified | Component and data flow, architectural invariants                                                  |
| [`SECURITY.md`](SECURITY.md)                                                                                             | Operationally verified | Security controls, known gaps                                                                      |
| [`data_policy.md`](data_policy.md)                                                                                       | Operationally verified | Data collection, retention, deletion                                                               |
| [`database_schema.md`](database_schema.md)                                                                               | Operationally verified | Table and policy responsibility map                                                                |
| [`CLOUD_DEVELOPMENT.md`](CLOUD_DEVELOPMENT.md)                                                                           | Operationally verified | Environments, safe execution levels, isolation, completion criteria                                |
| [`CLOUD_CANONICALIZATION_GATE.md`](CLOUD_CANONICALIZATION_GATE.md)                                                       | Operationally verified | GitHub source admission and recovery-import contract                                               |
| [`GATE_ROUTING.md`](GATE_ROUTING.md)                                                                                     | Operationally verified | Change surface to responsible gate                                                                 |
| [`CI_AND_BROWSER_E2E.md`](CI_AND_BROWSER_E2E.md)                                                                         | Operationally verified | CI composition and browser E2E                                                                     |
| [`RUNBOOK_INDEX.md`](RUNBOOK_INDEX.md)                                                                                   | Operationally verified | Entrypoint for setup, verification, deployment, rollback, incidents                                |
| [`ROADMAP.md`](ROADMAP.md)                                                                                               | Planned                | Future phases, cross-phase invariants, stop-the-line gates                                         |
| [`AGENT_EXECUTION_ROUTING.md`](AGENT_EXECUTION_ROUTING.md)                                                               | Planned                | Reasoning budget and internal/external agent responsibility                                        |
| [`PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`](PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md)                                     | Planned                | Google identity, AAL2, RBAC, COMPASS reuse and rollout contract                                    |
| [`PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`](PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md) | Planned                | GitHub protection/publication, real reviewer environment, commercial readiness and Phase 7.33 gate |
| [`CHANGELOG.md`](CHANGELOG.md)                                                                                           | Historical             | Development trajectory. Not a substitute for Git history or gate evidence                          |

## Setup and deployment

| Document                                                                                         | Status                            | Scope                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------- |
| [`supabase_setup.md`](supabase_setup.md)                                                         | Operationally verified            | Supabase project and local stack setup            |
| [`cloudflare_pages_deploy.md`](cloudflare_pages_deploy.md)                                       | Operationally verified            | Cloudflare Pages delivery                         |
| [`gas_integration.md`](gas_integration.md)                                                       | Implemented, verification pending | Google Apps Script integration boundary           |
| [`PRODUCTION_ROLLOUT_RUNBOOK_PHASE0_6_5.md`](PRODUCTION_ROLLOUT_RUNBOOK_PHASE0_6_5.md)           | Historical                        | Rollout procedure as of Phase 6.5                 |
| [`PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`](PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md)               | Historical                        | Rollout procedure as of Phase 6.6                 |
| [`PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md`](PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md) | Production                        | PPT rescue, dormant deploy and rollback           |
| [`PHASE7_29B_HOSTED_DORMANT_GATE_2026-08-09.md`](PHASE7_29B_HOSTED_DORMANT_GATE_2026-08-09.md)   | Historical                        | Dated Hosted evidence for the default-OFF release |

A runbook records the contract in source and the operational procedure. External state — Cloudflare dashboard, hosted secrets, real mail delivery — is not proven current by the document's date. The operator confirms it.

## Feature and subsystem documents

| Document                                                                               | Status                            | Scope                                              |
| -------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| [`lecture_lifecycle.md`](lecture_lifecycle.md)                                         | Operationally verified            | Lecture state machine, server-authoritative expiry |
| [`milestone0_database_baseline.md`](milestone0_database_baseline.md)                   | Historical                        | Initial database baseline                          |
| [`milestone4_pdf_sync.md`](milestone4_pdf_sync.md)                                     | Historical                        | PDF page synchronization milestone                 |
| [`phase2_backend_readiness.md`](phase2_backend_readiness.md)                           | Historical                        | Phase 2 backend readiness                          |
| [`phase2_poll_backend.md`](phase2_poll_backend.md)                                     | Historical                        | Poll backend design                                |
| [`phase2_poll_results_rpc.md`](phase2_poll_results_rpc.md)                             | Historical                        | Poll results RPC design                            |
| [`phase2_realtime_comments.md`](phase2_realtime_comments.md)                           | Historical                        | Realtime comments design                           |
| [`phase2_realtime_likes.md`](phase2_realtime_likes.md)                                 | Historical                        | Realtime likes design                              |
| [`phase2_seed_data.md`](phase2_seed_data.md)                                           | Historical                        | Seed data for Phase 2                              |
| [`journal_club_mvp.md`](journal_club_mvp.md)                                           | Historical                        | Journal Club MVP scope                             |
| [`journal_club_join.md`](journal_club_join.md)                                         | Implemented, verification pending | Journal Club join flow                             |
| [`journal_club_display.md`](journal_club_display.md)                                   | Implemented, verification pending | Journal Club Display surface                       |
| [`journal_club_display_control.md`](journal_club_display_control.md)                   | Implemented, verification pending | Display control model                              |
| [`journal_club_sync_strategy.md`](journal_club_sync_strategy.md)                       | Implemented, verification pending | Synchronization strategy                           |
| [`journal_club_admin_gate.md`](journal_club_admin_gate.md)                             | Implemented, verification pending | Admin gate for Journal Club                        |
| [`journal_club_realtime_check.md`](journal_club_realtime_check.md)                     | Historical                        | Realtime behavior check record                     |
| [`PHASE7_29_POWERPOINT_PRESENTER_BRIDGE.md`](PHASE7_29_POWERPOINT_PRESENTER_BRIDGE.md) | Implemented, verification pending | Optional Windows Presenter boundary                |

The Journal Club documents predate the Phase 7.27 integration. Where they conflict with `PHASE7_27_JOURNAL_CLUB_INTEGRATION.md` and the code, the code wins.

## Human test checklists

| Document                                                               | Status  |
| ---------------------------------------------------------------------- | ------- |
| [`PHASE6_HUMAN_TEST_CHECKLIST.md`](PHASE6_HUMAN_TEST_CHECKLIST.md)     | Planned |
| [`PHASE6_5_HUMAN_TEST_CHECKLIST.md`](PHASE6_5_HUMAN_TEST_CHECKLIST.md) | Planned |
| [`PHASE6_6_HUMAN_TEST_CHECKLIST.md`](PHASE6_6_HUMAN_TEST_CHECKLIST.md) | Planned |

A checklist is a list of things a human must do. Its presence in the repository is not evidence that anyone did them.

## Phase design and requirements records

`Planned` where the document states design intent, and superseded by the implementation wherever they differ. Read these for _why_, read the code for _what_.

`PHASE1_SYNC_PROTOCOL`, `PHASE2_LECTURE_LIFECYCLE`, `PHASE2_REQUIREMENTS_MATRIX`, `PHASE3_PRIVATE_PDF_DELIVERY`, `PHASE3_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE4_BILLING_AND_REALTIME_CAPTIONS`, `PHASE4_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE4_1_AI_CONCURRENCY_LANES`, `PHASE5_MATERIAL_ANALYSIS_AND_POLL_PROPOSALS`, `PHASE5_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE6_FIVE_MINUTE_SUMMARIES`, `PHASE6_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE6_5_OPTIONAL_COMMENT_NICKNAMES`, `PHASE6_5_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE6_6_INTEGRATED_UX_AND_OPERATIONS`, `PHASE6_7_DOCUMENTATION_BASELINE`, `PHASE6_8_SECURITY_SESSIONS_TIMEOUTS`, `PHASE6_9_MODULARIZATION_AND_CI`, `PHASE7_1_CLASSROOM_UX_EXTENSIONS`, `PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS`, `PHASE7_26_BROWSER_PDF_PUBLICATION`, `PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL`, `PHASE7_27_JOURNAL_CLUB_INTEGRATION`, `PHASE7_28_REQUIREMENTS_AND_DESIGN`, `PHASE7_29_POWERPOINT_PRESENTER_BRIDGE`, `PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN`, `PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS`

## Gate evidence records

**All `Historical`.** Each records the state of a gate run on its date. A `LOCAL GATE PASS` is local acceptance only and does not imply CI, hosted, device, human or Production acceptance.

- Local gate records: `PHASE0_GATE_2026-07-14`, `PHASE1_LOCAL_GATE_2026-07-14`, `PHASE2_LOCAL_GATE_2026-07-14`, `PHASE3_LOCAL_GATE_2026-07-14`, `PHASE4_LOCAL_GATE_2026-07-15`, `PHASE4_1_LOCAL_GATE_2026-07-15`, `PHASE5_LOCAL_GATE_2026-07-16`, `PHASE6_LOCAL_GATE_2026-07-16`, `PHASE6_5_LOCAL_GATE_2026-07-16`, `PHASE6_6_LOCAL_GATE_2026-07-16`, `PHASE6_7_LOCAL_GATE_2026-07-18`, `PHASE6_8_LOCAL_GATE_2026-07-18`, `PHASE6_9_LOCAL_GATE_2026-07-19`, `PHASE7_1_LOCAL_GATE_2026-07-19`, `PHASE7_2_LOCAL_GATE_2026-07-20`, `PHASE7_26_LOCAL_GATE_2026-07-21`, `PHASE7_27_LOCAL_GATE_2026-07-22`, `PHASE7_28_LOCAL_GATE_2026-07-31`, `PHASE7_29_LOCAL_GATE_2026-08-01`
- Production gate records: `PRODUCTION_GATE_PHASE0_6_5_2026-07-16`, `PRODUCTION_REVIEW_DEPLOYMENT_2026-07-16`, `PHASE7_PRODUCTION_GATE_2026-07-21`, `PHASE7_27_PRODUCTION_GATE_2026-07-22`, `PHASE7_27_DISPLAY_AND_LECTURE_OPERATIONS_GATE_2026-07-22`, `PHASE7_28_PRODUCTION_GATE_2026-08-01`, `PHASE7_29B_HOSTED_DORMANT_GATE_2026-08-09`
- Handoff and pause records: `PHASE4_PAUSE_RECORD_2026-07-15`, `PHASE7_2_HANDOFF_2026-07-20`, `PHASE7_26_PAUSE_HANDOFF_2026-07-21`, `PHASE7_27_HANDOFF_2026-07-21`, `PHASE7_27_TEMPORARY_PREVIEW_HANDOFF_2026-07-22`

Two of these carry conditions that survive their date and must be read before claiming a feature is live:

- `PHASE7_27_PRODUCTION_GATE_2026-07-22` records a temporary public preview as deployed while the **final operational Production Gate remains HOLD**.
- `PHASE7_28_PRODUCTION_GATE_2026-08-01` records a **provisional** PASS with human and paid-canary acceptance explicitly deferred. Phase 7.28A remains recovery-only and OFF.

Neither is a general statement that the phase is complete.

## Reading the PHASE0-PHASE7_29 series

The series is a chronological archive, not a description of the product. Three failure modes to avoid:

1. **Treating a design document as current behavior.** Design was written before implementation and was frequently revised during it. The code and migrations are the answer.
2. **Treating a `LOCAL GATE` record as release evidence.** Local, CI, hosted, device, human and Production acceptance are separate and never substitute for one another.
3. **Reading phase numbers as a feature taxonomy.** A phase number records _when_ work happened. `test:phase7-28b-lock-order` covers Display versus Admin lock ordering, which has nothing to do with the Phase 7.28 label beyond the date it was written. Route work by change surface using [`GATE_ROUTING.md`](GATE_ROUTING.md).

## Maintenance rules

- Give every new document a `Status`, a `Scope`, and a `Last verified` date, using the vocabulary above.
- Attach a baseline date, target system and scope to any figure that can change.
- Secret _names_ may appear. Values, recovery information, lecture codes and personal data may not.
- When code and documentation change in the same task, do not label the document `Production` ahead of the actual Production Gate.
- Before deleting an old document, confirm the successor exists, update inbound links, and rely on Git history for the rest.
- `test:phase6-7-docs` asserts that a fixed set of documents exists. Renaming or removing anything in that list breaks `test:ci:nonlive`; update the script in the same change.
