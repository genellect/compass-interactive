# COMPASS Interactive Runbook Index

Last reviewed: 2026-07-21

This file is the entrypoint for setup, verification, deployment, rollback and
incident work. A runbook is not authorization: hosted mutation, deploy, push,
secret change and paid call still require an explicit task.

## 1. Current canonical documents

| Need                         | Document                                      |
| ---------------------------- | --------------------------------------------- |
| Product and local entrypoint | `README.md`                                   |
| Current component/data flow  | `docs/architecture.md`                        |
| Security controls and gaps   | `docs/SECURITY.md`                            |
| Data collection/retention    | `docs/data_policy.md`                         |
| Database responsibility map  | `docs/database_schema.md`                     |
| Future phases and gates      | `docs/ROADMAP.md`                             |
| Development trajectory       | `docs/CHANGELOG.md`                           |
| Phase 6.7 acceptance         | `docs/PHASE6_7_DOCUMENTATION_BASELINE.md`     |
| Phase 6.7 local evidence     | `docs/PHASE6_7_LOCAL_GATE_2026-07-18.md`      |
| Phase 6.8 design             | `docs/PHASE6_8_SECURITY_SESSIONS_TIMEOUTS.md` |
| Phase 6.8 local evidence     | `docs/PHASE6_8_LOCAL_GATE_2026-07-18.md`      |
| Phase 6.9 design             | `docs/PHASE6_9_MODULARIZATION_AND_CI.md`      |
| Phase 6.9 local evidence     | `docs/PHASE6_9_LOCAL_GATE_2026-07-19.md`      |
| Phase 7.1 design             | `docs/PHASE7_1_CLASSROOM_UX_EXTENSIONS.md`    |
| Phase 7.1 local evidence     | `docs/PHASE7_1_LOCAL_GATE_2026-07-19.md`      |
| Phase 7.2 design             | `docs/PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS.md` |
| Phase 7.2 local evidence     | `docs/PHASE7_2_LOCAL_GATE_2026-07-20.md`      |
| Phase 7.2 safe-stop handoff  | `docs/PHASE7_2_HANDOFF_2026-07-20.md`         |
| Phase 7.26 requirements      | `docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md` |
| Phase 7.26 browser PDF design | `docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md`  |
| Phase 7.26 local evidence    | `docs/PHASE7_26_LOCAL_GATE_2026-07-21.md`    |
| Phase 7 production decision  | `docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`  |

If an older Phase document conflicts with these current documents and the real
code/migrations, treat the older document as historical evidence.

## 2. Local frontend and CI

- Basic commands and environment boundary: `README.md`
- CI and browser E2E: `docs/CI_AND_BROWSER_E2E.md`
- Production environment validation: `scripts/check-production-env.mjs`
- Non-live CI allowlist: `scripts/ci/run-nonlive-suite.mjs`

Recommended pre-commit sequence:

```bash
npm run typecheck
npm run typecheck:phase3
npm run typecheck:e2e
npm run lint
npm run test:phase6-7-docs
npm run test:phase6-8-static
npm run test:phase7-1-edge
npm run test:phase7-1-static
npm run test:phase7-2-edge
npm run test:phase7-2-static
npm run test:phase7-2-quality
npm run test:phase7-25-edge
npm run test:phase7-25-static
npm run test:phase7-26-browser-pdf
npm run test:phase7-26-edge
npm run test:phase7-26-static
npm run test:phase7-26-load
npm run build
git diff --check
```

Run `npm run test:ci:nonlive` when the complete non-live regression is required.

## 3. Local Supabase

- Current local setup: `docs/supabase_setup.md`
- Phase 0 ownership/RLS baseline: `docs/PHASE0_GATE_2026-07-14.md`
- Lifecycle design: `docs/PHASE2_LECTURE_LIFECYCLE.md`
- Database authority: `supabase/migrations/`, `supabase/tests/` and
  `supabase/config.toml`

Never link or push a hosted project as part of local verification. Confirm the
URL is localhost/127.0.0.1 before a browser integration test.

## 4. PDF Publisher, Worker and R2

- Architecture/threat model: `docs/PHASE3_PRIVATE_PDF_DELIVERY.md` and
  `docs/PHASE3_REQUIREMENTS_AND_THREAT_MODEL.md`
- Browser publication: `docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md` and
  `docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md`
- Recovery Publisher implementation: `publisher/`
- Worker implementation/config: `cloudflare/asset-worker/`
- Production Phase 6.6 rollout: `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`

Local recovery R2 credentials belong only in `.env.publisher.local` or the
approved OS secret launcher. Browser publication receives no permanent R2
credential. Never print values during connectivity checks, and never enable the
Local writer while browser mode is active.

## 5. OpenAI and paid features

- Realtime billing/captions: `docs/PHASE4_BILLING_AND_REALTIME_CAPTIONS.md`
- Concurrency lanes: `docs/PHASE4_1_AI_CONCURRENCY_LANES.md`
- Material analysis/Poll proposals: `docs/PHASE5_MATERIAL_ANALYSIS_AND_POLL_PROPOSALS.md`
- Five-minute summaries: `docs/PHASE6_FIVE_MINUTE_SUMMARIES.md`

Live OpenAI scripts and real microphone tests are intentionally outside default
CI. They require an explicit cost boundary and separate human gate.

## 6. Production deployment

- Pages routing/build guidance: `docs/cloudflare_pages_deploy.md`
- Phase 0-6.5 integrated gate: `docs/PRODUCTION_GATE_PHASE0_6_5_2026-07-16.md`
- Development Production Review record:
  `docs/PRODUCTION_REVIEW_DEPLOYMENT_2026-07-16.md`
- Phase 6.6 production sequence: `docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`
- Phase 6.6 human checks: `docs/PHASE6_6_HUMAN_TEST_CHECKLIST.md`
- Phase 7 production decision: `docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`

Standard order:

1. backup, owner, change window and stop thresholds;
2. expand migration;
3. Edge/Worker capability and secrets with server flags OFF;
4. frontend with Vite flags OFF;
5. Advisor/lint/two-user/hosted smoke;
6. for browser PDF, stop Local Publisher and revoke/isolate its R2 writer;
7. real cross-service, 15 MiB and cleanup/rollback canaries;
8. enable Worker, then Edge, then frontend for a controlled flag canary;
9. telemetry and cost review;
10. gate record.

Do not drop schema on rollback. Disable the feature and restore the previous
application/server version first.

## 7. Incident sequence

1. Stop/disable the affected feature; stopping paid work must not require a PIN.
2. Preserve audit and provider-ledger evidence.
3. Confirm whether ownership, secrets, data integrity or cost is affected.
4. Rotate the narrowest affected credential.
5. Roll back frontend/Edge/Worker or disable flags.
6. Repair forward with a clean/upgrade migration and regression evidence.
7. Record the incident and new prevention test.

Cross-user disclosure, unauthorized paid work, secret exposure, public R2 access
or post-close writes are immediate stop conditions.

## 8. Historical evidence

Files named `PHASE*_LOCAL_GATE_*`, `PRODUCTION_GATE_*` and dated deployment
records are immutable evidence for the commit and environment they describe.
They are not automatically current after a later migration or deployment.

Old milestone/Journal Club drafts remain useful for design history but may
describe removed Realtime behavior, development lecture IDs or manual SQL. Do
not execute an old manual instruction without checking current migrations and
the canonical documents above.
