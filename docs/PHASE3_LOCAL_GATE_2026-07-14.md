# Phase 3 local gate record

Date: 2026-07-14 (JST)

Decision: **PASS — local implementation only**

Production decision: **HOLD**. Phase 1, Phase 2 and Phase 3 remain unapplied and
OFF in production until the combined Phase 6 rollout gate. No hosted Supabase
setting/migration, R2 bucket/token, Worker route/Cron, Cloudflare deployment,
public Web deployment, external service mutation or Git push was performed.

## Scope delivered

- Loopback-only teacher Publisher with one-time pairing and Origin/Host/body
  defenses.
- Text-layer-only PDF validation: name/MIME/magic, 15 MiB, 75 pages, 20,000
  characters, encrypted/corrupt/textless rejection and deterministic hashes.
- Teacher-local page text, immutable private object publication, complete
  upload verification and manifest CAS.
- Private R2 Worker delivery with local ES256 authorization, five-minute
  document tickets, Range/ETag, download enforcement and no per-asset Supabase
  query.
- Metadata-only Supabase schema/RPCs, Phase 1 five-second PDF pointer extension,
  page bound validation and Phase 0 ownership preservation.
- Day-30 authorization cutoff and exact close-time retention reconciliation;
  durable day-37 cleanup intents for R2 plus local extracted-text expiry.
- Default-OFF Admin/student UI with explicit publication then activation,
  protected download, retry, legacy fallback and 1 MiB PDF.js range chunks.

The detailed architecture, state transitions, failure behavior, migration,
rollback, secrets, load model and production sequence are in
`docs/PHASE3_PRIVATE_PDF_DELIVERY.md`. The preimplementation correspondence
matrix and threat model are in
`docs/PHASE3_REQUIREMENTS_AND_THREAT_MODEL.md`.

## Database gates

Validation stack: Docker/Supabase local PostgreSQL 17, DB port 55422.

| Gate                                       | Result | Evidence                                                                                                                                   |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean Phase 0→1→2→3 migration reset        | PASS   | All eight migrations applied from an empty local DB                                                                                        |
| Existing Phase 2 data upgrade              | PASS   | Three draft/open/closed fixtures preserved; new defaults/backfill valid; legacy PDF RPC remained writable only for draft/open state        |
| Full SQL regression                        | PASS   | 9 pgTAP files, 340 assertions                                                                                                              |
| Phase 3 PDF SQL test                       | PASS   | 51 assertions via `no_plan`: schema, RLS/grants, invoker/definer, ownership, limits, idempotency, closed-write rejection, archive boundary |
| DB lint / Advisor-equivalent static checks | PASS   | `supabase db lint --local --level warning`: no schema errors; Phase 2 advisor suite and Phase 3 privilege/search-path checks passed        |
| Generated TypeScript DB contract           | PASS   | Regenerated from the Phase 3 local DB and frontend typecheck passed                                                                        |

The upgrade fixture separately verified that no synthetic private publication
rows are fabricated for existing lectures, the two fixed document IDs preserve
page count/visibility with manifest version zero, and the legacy RPC still
operates through the compatibility wrapper.

## Application and delivery gates

| Gate                                                                     | Result                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------- |
| Root TypeScript check                                                    | PASS                                           |
| Publisher/Worker TypeScript check                                        | PASS                                           |
| Oxlint                                                                   | PASS, zero warnings                            |
| Existing demo/live/Admin/PDF/Phase 1/Phase 2 static and unit regressions | PASS                                           |
| Publisher tests                                                          | PASS, 7 tests                                  |
| Worker tests                                                             | PASS, 5 tests                                  |
| Phase 3 static responsibility/security contract                          | PASS                                           |
| Production frontend build                                                | PASS                                           |
| Wrangler 4.110.0 deployment dry-run                                      | PASS; no deployment; 31.76 KiB / gzip 7.69 KiB |
| npm advisory check                                                       | PASS offline cache, 0 vulnerabilities          |
| `git diff --check`                                                       | Required immediately before commit             |

Publisher tests include text extraction without rendering/OCR, MIME/size/text
layer rejection, immutable publish and CAS failure, pairing/Origin isolation,
canonical local retention deletion, hostile Origin and pre-parse body limit.
Worker tests include lecture/document isolation, hostile Origin, expiry,
download permission, byte range, CAS conflict, repeated cleanup, interruption
after manifest commit and retention-feed reconciliation.

## Load gate

Executable assumptions: 90 minutes, three material versions, 60 Admin page
changes, 1 MiB PDF range chunks, 16 maximum-size asset reads per material.

| Scenario         | Existing five-second snapshots | Added token calls | Metadata/live writes | Worker requests | R2 PDF reads | PDF bytes in Supabase |
| ---------------- | -----------------------------: | ----------------: | -------------------: | --------------: | -----------: | --------------------: |
| Free MVP / 20    |                         21,600 |                60 |               3 / 63 |           1,080 |          960 |                     0 |
| Pro target / 300 |                        324,000 |               900 |               3 / 63 |          16,200 |       14,400 |                     0 |

Phase 3 adds zero Realtime subscriptions, zero main-app redeploys per PDF and
four fixed retention-feed Edge requests in the modeled 90-minute window. The
300-user Worker estimate is below the current 100,000-request daily Free limit;
R2 Standard operation/storage allowances also cover the modeled weekly lecture.
Pricing/limits remain a production-gate recheck, not a permanent guarantee.

## Rollback gate

- Before activation: keep `VITE_PHASE3_PRIVATE_PDF=false`; additive DB state may
  remain idle and old clients/assets/RPCs continue unchanged.
- After first publication: roll back frontend flag/Worker route, preserve
  private objects and metadata, and repair forward. Do not run a destructive
  down migration.
- Manifest/metadata failure never automatically changes the live PDF.
- Access revocation uses the lecture access version; key/secret compromise uses
  key rotation plus version bump and route disable.
- Physical deletion has no local automatic production authorization. Enable
  Cron only after inventory, dry-run, alert and restore drill.

## Production blockers / follow-up

These do not block the Phase 3 local gate because production is intentionally
deferred:

1. Create/test the private R2 Standard bucket, least-privilege Publisher token,
   exact origins and fail-closed Worker route.
2. Install Publisher credentials through Windows Credential Manager or another
   approved per-user launcher; no real secret may be stored in `.env`.
3. Establish ES256/HMAC/retention-secret owners, rotation and emergency
   `pdf_access_version` procedure.
4. Apply migration and Edge functions in the documented expand-first order;
   rerun hosted Advisor and two-user ownership tests with all flags off.
5. Verify hosted R2 Range/CORS/cache headers and capture real PDF.js request
   counts in the 20-user canary.
6. Configure and observe the retention feed/Cron before enabling closed-lecture
   archive access or physical deletion.
7. Revisit the existing broad Admin session together with Phase 4 billing-PIN
   hardening.

## Workspace integrity

`PROJECT_GUIDE.md` was a pre-existing, unstaged user modification. Phase 3 did
not edit, format, stage or commit that file. Generated `dist`, local Supabase,
Wrangler bundle and validation workspaces are excluded from the Phase 3 commit.
