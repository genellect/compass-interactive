# COMPASS Interactive Development History

This is a human-readable trajectory, not a replacement for Git history or Phase
gate evidence. Commit IDs identify the main implementation landmarks.

## 2026-07-18 - Phase 6.8 security/session foundation

- Added keyed application-level Admin PIN throttling and hash-at-rest,
  individually revocable Admin sessions with absolute/inactivity expiry.
- Added lecture-scoped seven-day resume tokens, version revocation and a private
  Worker archive index while retaining code plus Turnstile compatibility.
- Added CSP enforcement/report-only policy, bounded JSON/content-type handling
  across exposed Edge Functions and explicit frontend/provider deadlines.
- Added durable provider request correlation and conservative ambiguous-timeout
  accounting without an automatic paid-operation replay.
- Kept every new capability default-OFF; no hosted service, public web, secret,
  paid call or deployment was changed by the local Phase.

## 2026-07-18 - Phase 6.7 documentation baseline

- Replaced the Phase 0-only README with the Phase 0-6.6 implementation entrypoint.
- Established current architecture, security, data, database, roadmap and
  runbook-index documents.
- Added documentation consistency checks to prevent stale routes/scripts/flags.
- Adopted development preview version `0.7.0`.
- No classroom behavior, migration, hosted setting, paid call or deployment was
  introduced by this Phase.

## 2026-07-17 - Phase 6.6 integration and CI

- `74fa86d`: integrated the teacher/student UX, approximate presence metrics,
  code/Poll safeguards, R2 closed-lecture archive, daily operations digest and
  server-side Realtime provider control.
- `b979e37`: enabled trusted `pg_net` scheduler support.
- `8689f02`: prevented archive claims for code-less lectures.
- `cc1ae93`: added GitHub Actions, Playwright Demo E2E and disposable local
  Supabase teacher/student E2E.

Phase 6.6 local/human/hosted evidence remains separated. A Git commit or local
PASS does not by itself prove production parity.

## 2026-07-16 - AI learning support and integrated review

- `5bcdd1b`: Phase 5 bounded PDF text analysis and teacher-only AI Poll proposals.
- `d211079`: Phase 6 five-minute lecture summaries, comment pulse and immutable
  teacher review/publication revisions.
- `f7cecb2`: Phase 6.5 nullable per-comment nickname, ten-character maximum and
  local Demo behavior.
- `926488f`: Phase 0-6.5 integrated production-gate hardening.
- `ecda82d`: recorded the Development Production Review deployment.

## 2026-07-15 - private documents and paid realtime controls

- `d8a5354`: Phase 3 local Publisher, private R2/Worker PDF delivery and page
  synchronization.
- `66d3051`: Phase 4 separate API-use PIN, usage ledger and Realtime captions.
- `ac12a6a`: completed the Phase 4 local gate without real microphone storage.
- `4b6744b`: Phase 4.1 split Realtime and Batch concurrency lanes.

## 2026-07-14 - authentication, synchronization and lifecycle

- `0181112`, `c57239f`, `f7c5b68`: Phase 0 ownership/RLS hardening, validation,
  anonymous Auth and Turnstile.
- `9e213bc`: Phase 1 versioned five-second synchronization and cursor history.
- `e0531d2`: Phase 2 server-time 90-minute lifecycle, idempotent close, AI
  admission and archive state.

## Earlier MVP foundation

- `9d17b4e`: initial React/Vite classroom MVP.
- Milestone commits added Supabase live state, Admin lifecycle and PDF page
  synchronization.
- Subsequent UI commits established the mobile-first light learning experience,
  Demo mode and COMPASS branding.

Those early Phase 0/milestone documents are retained for traceability but may
describe mock-only or Realtime behavior that the Phase 1-6 design replaced.

## Planned trajectory

- Phase 6.9: internal modularization and deterministic CI/supply-chain quality.
- Phase 7.1: summary language, own comments and lecture QR.
- Phase 7.2: verified-primary-literature academic reference answers.
- Phase 7 Gate: next controlled production reflection.
- Phase 8/8.1/8.2: export/deletion evidence, Terra advanced analysis and optional
  comment attention ranking.
- Phase 9: full long-run, human and operations production certification.

See `docs/ROADMAP.md` for requirements and non-negotiable gates.
