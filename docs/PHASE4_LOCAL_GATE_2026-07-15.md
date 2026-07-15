# Phase 4 local gate record

Date: 2026-07-15 (JST)

Decision: **PASS — local implementation and mock/provider-boundary tests only**

Production decision: **HOLD**. No production Supabase migration/setting/secret,
Cloudflare resource, public Web deployment, hosted feature flag, external
service mutation, paid OpenAI request or Git push was performed. Phase 1-4
remain OFF until the combined Phase 6 rollout gate.

## Delivered

- Separate billing PIN gate with server lockout and two-minute one-use,
  lecture/action/Admin-session scoped grants.
- Atomic Phase 2 budget/audio/concurrency admission and model/price accounting.
- Standard-key-only Edge client-secret exchange and ephemeral-key-only WebRTC
  browser connection.
- Teacher-local Realtime deltas, same-device display BroadcastChannel, completed
  text-only local review storage, TXT/JSONL export, delete and 30-day purge.
- Changed-only five-second publication of a 45-second/1,000-character completed
  window through the existing versioned snapshot protocol.
- Participant-owned v3 snapshot, stop/close cleanup, server heartbeat,
  45-second stale-operation recovery and fail-closed/no-auto-reconnect client
  behavior.
- Default-OFF Admin/student UI and additive Phase 4 migration.

Detailed architecture, state/failure behavior, cost, migration, rollback and
production sequence are in `docs/PHASE4_BILLING_AND_REALTIME_CAPTIONS.md`.
Requirements and threat controls are in
`docs/PHASE4_REQUIREMENTS_AND_THREAT_MODEL.md`.

## Credential boundary

- `OPENAI_API_KEY`: present only in ignored local `.env.local`; value was never
  displayed or committed.
- `BILLING_PIN`: absent. Local live/paid smoke testing remains intentionally
  blocked until the developer creates a strong value distinct from
  `ADMIN_PIN`.
- All completed tests used fake keys/PINs or direct local DB fixtures. No paid
  provider request was sent.

## Database gates

Validation stack: Docker/Supabase local PostgreSQL 17, DB port 55422.

| Gate                          | Result | Evidence                                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Clean Phase 0→1→2→3→4 reset   | PASS   | All nine migrations applied from an empty DB after the final migration revision                                                       |
| Existing Phase 3 data upgrade | PASS   | Open lecture, participant and comment preserved; Phase 4 objects available after `migration up --local`                               |
| Full SQL regression           | PASS   | 10 pgTAP files, 399 assertions; Phase 0 27/27 and Phase 1-4 suites pass                                                               |
| Phase 4 SQL test              | PASS   | 59 assertions: RLS/grants, PIN lockout, scope/replay/expiry, budget, ledger, ownership, bounded publish, heartbeat/reaper, stop/close |
| DB lint                       | PASS   | public/private PL/pgSQL lint has no remaining warnings after removal of unread variables                                              |
| Realtime publication check    | PASS   | no Phase 4 table in `supabase_realtime`                                                                                               |

The local gate caught and fixed two defects before completion: a PL/pgSQL local
variable qualification that failed only when consuming a grant, and an overly
broad open-lecture read inherited from v2. The additive v3 RPC now requires
exact participant ownership without altering v2 compatibility.

## Application gates

| Gate                                                | Result                |
| --------------------------------------------------- | --------------------- |
| TypeScript `--noEmit`                               | PASS                  |
| Oxlint                                              | PASS, zero warnings   |
| Caption ordering/window/parser/export test          | PASS                  |
| Edge billing/Admin-token/OpenAI request-helper test | PASS; mock fetch only |
| Static secret/storage/responsibility test           | PASS                  |
| Existing frontend/demo/live/Admin/Phase 1-3 tests   | PASS                  |
| Production frontend build                           | PASS                  |
| `git diff --check`                                  | PASS before commit    |

## Load gate

| Scenario              | Student snapshots | Caption writes max | Heartbeats | Added Realtime subscriptions | Supabase audio/full transcript bytes |
| --------------------- | ----------------: | -----------------: | ---------: | ---------------------------: | -----------------------------------: |
| 20 students / 90 min  |            21,600 |              1,080 |        360 |                            0 |                                    0 |
| 300 students / 90 min |           324,000 |              1,080 |        360 |                            0 |                                    0 |

The caption-side DB write and heartbeat load does not scale with student count.
Actual changed-window frequency, Edge invocations and end-to-end latency remain
a 20-person canary measurement rather than a permanent quota guarantee.

## Rollback gate

- Keep `VITE_PHASE4_REALTIME_CAPTIONS=false` and
  `PHASE4_REALTIME_CAPTIONS_ENABLED=false`; additive objects remain idle.
- Stop is always available without PIN and immediately closes local audio.
- On provider/heartbeat/publish failure, do not reconnect automatically.
- After any canary use, disable flags and stop operations; preserve usage/audit
  rows and repair forward. Do not physically delete accounting data or run a
  destructive down migration.

## Production blockers / manual work

1. Create a strong `BILLING_PIN` distinct from `ADMIN_PIN`. For a future local
   live smoke, add it only to ignored `.env.local`; never use `VITE_`.
2. Install the official OpenAI developer-docs MCP if desired:
   `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp`,
   then restart Codex. The app sandbox could not execute `codex.exe`; official
   Web documentation was used instead.
3. Do not add hosted Edge secrets yet. At the Phase 6 production gate, add the
   standard key, billing PIN, model and price to Supabase Edge secrets/config
   with flags OFF, then run hosted security/two-user tests.
4. Obtain explicit approval for the first paid local/provider smoke request and
   define its maximum cost before enabling both Phase 4 flags.
5. Verify organization privacy/ZDR settings, microphone notice/consent text,
   hosted rate limits and model price immediately before rollout.

## Workspace integrity

`PROJECT_GUIDE.md` is a pre-existing, unstaged user modification. Phase 4 did
not edit, format, stage or commit it. `.env.local` remains ignored and is not
part of the commit. Generated build output, local Supabase state and validation
workspace are excluded.
