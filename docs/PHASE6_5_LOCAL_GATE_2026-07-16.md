# Phase 6.5 Local Gate - 2026-07-16

## Decision

Automated local gate: **PASS**

Human visual/accessibility acceptance: **PENDING, non-blocking for the local
implementation commit**

Production Supabase, Hosted settings, Cloudflare, public Web, feature flags,
and external services were not changed.

## Delivered

- nullable per-comment `comments.nickname`;
- 10-character/control/trim database constraint;
- unchanged Phase 0 ownership RLS and Phase 2 lecture-state write rejection;
- nickname propagation through snapshot v2/v3/v4, history v2, and archive
  v2/v3;
- default `匿名の参加者` student UI;
- one-insert optimistic live flow;
- Supabase-independent demo local nickname flow;
- live feature flag default OFF;
- clean and upgrade migration fixtures;
- Phase 6.5 unit/static/load/pgTAP coverage;
- human browser checklist.

## Test evidence

| Check | Result |
| --- | --- |
| Clean Phase 0-6.5 migration reset | PASS |
| Phase 6.5 pgTAP | PASS, 42 tests |
| All SQL regression | PASS, 14 files / 599 tests |
| Phase 6 -> 6.5 upgrade pgTAP | PASS, 12 tests |
| DB lint `public,private`, warnings fail | PASS, no findings |
| TypeScript typecheck | PASS |
| oxlint | PASS |
| Production build | PASS |
| Demo repository tests | PASS |
| Live-state tests | PASS |
| Phase 1-6 non-live regression | PASS |
| Phase 6.5 nickname unit tests | PASS, 3 tests |
| Phase 6.5 static security checks | PASS |
| Phase 6.5 20/300 load invariants | PASS |
| `git diff --check` | PASS |
| Secret scan | PASS; no new secret or local credential in the diff |

The SQL suite includes Phase 0 authentication, Phase 1 synchronization, Phase
2 lifecycle/security-advisor checks, Phase 3 PDF delivery, Phase 4 billing and
concurrency, Phase 5 material analysis, and Phase 6 summaries.

## Load result

For both 20 and 300 students:

- comment writes per post: `1`;
- additional participant profile rows: `0`;
- additional Realtime subscriptions: `0`;
- additional student requests: `0`;
- nickname length: maximum `10` characters.

## Compatibility

- Old comment rows remain valid and read as `NULL`.
- Old public RPC signatures remain available.
- Old clients ignore the additional nickname JSON property.
- New live UI remains OFF until the later combined production gate.
- Deployment order must be migration first, frontend second, flag last.

## Remaining human checks

See `docs/PHASE6_5_HUMAN_TEST_CHECKLIST.md`. The repository has no browser E2E
framework, and the current automation surface did not expose an interactive
browser-control session. Visual desktop/mobile, keyboard, and screen-reader
acceptance therefore remain explicitly recorded rather than inferred.

## Production gate requirements

1. Back up production and confirm rollback criteria.
2. Apply the additive migration with all feature flags OFF.
3. Re-run Advisor, DB lint, and two-user ownership tests.
4. Deploy the frontend with the Phase 6.5 flag OFF.
5. Complete the human checklist on the deployed preview.
6. Enable only through the combined Phase 0-6.5 staged rollout.
