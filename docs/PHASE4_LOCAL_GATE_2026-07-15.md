# Phase 4 local gate record

Date: 2026-07-15 (JST)

Decision: **PASS — local implementation, isolated browser/DB verification and
real no-audio provider-boundary verification**

Production decision: **HOLD**. No production Supabase migration/setting/secret,
Cloudflare resource, public Web deployment, hosted feature flag, external
service configuration or Git push was changed. One local OpenAI client-secret
request was made without WebRTC, microphone access or audio. Phase 1-4 remain
OFF until the combined Phase 6 rollout gate.

The developer explicitly deferred the real microphone/WebRTC canary to a later
phase. Phase 4 therefore gates the provider credential/client-secret boundary,
mocked WebRTC event flow and real application state flow; live audio quality,
latency and microphone permission behavior remain Phase 6 canary measurements.

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
- `BILLING_PIN`: present only in ignored local `.env.local`; value was never
  displayed or committed and remains separate from the Admin credential.
- A real-key, no-audio boundary test minted one short-lived
  `gpt-realtime-whisper` client secret and immediately cancelled the operation.
  No standard key, Admin token, billing PIN or ephemeral secret was printed or
  persisted in application data.

## Database gates

Validation stack: Docker/Supabase local PostgreSQL 17, DB port 55422.

| Gate                          | Result | Evidence                                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Clean Phase 0→1→2→3→4 reset   | PASS   | All nine migrations applied from an empty DB after the final migration revision                                                       |
| Existing Phase 3 data upgrade | PASS   | Open lecture, participant and comment preserved; Phase 4 objects available after `migration up --local`                               |
| Full SQL regression           | PASS   | 10 pgTAP files, 399 assertions; Phase 0 27/27 and Phase 1-4 suites pass                                                               |
| Phase 4 SQL test              | PASS   | 59 assertions: RLS/grants, PIN lockout, scope/replay/expiry, budget, ledger, ownership, bounded publish, heartbeat/reaper, stop/close |
| DB lint                       | PASS   | public/private PL/pgSQL lint has no remaining warnings after removal of unread variables                                              |
| Local DB Advisors             | PASS   | Supabase security and performance Advisors reported no issues                                                                          |
| Realtime publication check    | PASS   | no Phase 4 table in `supabase_realtime`                                                                                               |

The local gate caught and fixed three defects before completion: a PL/pgSQL
local-variable qualification that failed only when consuming a grant, an overly
broad open-lecture read inherited from v2, and an Admin caption guard that read
participant-owned context state and disabled start when the Admin was not also
a participant. The additive v3 RPC retains exact participant ownership, while
the Admin control now uses the independently authorized Admin lecture list.

## Application gates

| Gate                                                | Result                |
| --------------------------------------------------- | --------------------- |
| TypeScript `--noEmit`                               | PASS                  |
| Oxlint                                              | PASS, zero warnings   |
| Caption ordering/window/parser/export test          | PASS                  |
| Edge billing/Admin-token/OpenAI request-helper test | PASS; mock fetch      |
| Real OpenAI client-secret boundary                  | PASS; no audio/WebRTC |
| Isolated Admin/student browser flow                 | PASS                  |
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

## Deferred production work

1. Do not add hosted Edge secrets yet. At the Phase 6 production gate, add the
   standard key, a strong billing PIN distinct from `ADMIN_PIN`, model and price
   with both flags OFF, then run hosted security/two-user tests.
2. Run the developer-deferred microphone/WebRTC canary only after approving the
   microphone notice and a maximum test budget.
3. Verify organization privacy/ZDR settings, hosted rate limits and the current
   model price immediately before rollout.
4. Re-evaluate Supabase's current publishable/secret API-key migration before
   hosted deployment. The local implementation still supports the legacy
   service-role variable, which must never be exposed to a browser.

## Workspace integrity

`PROJECT_GUIDE.md` is a pre-existing, unstaged user modification. Phase 4 did
not edit, format, stage or commit it. `.env.local` remains ignored and is not
part of the commit. Generated build output, local Supabase state and validation
workspace are excluded.
