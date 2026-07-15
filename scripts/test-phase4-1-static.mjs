import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const migration = readFileSync(
  join(
    root,
    'supabase',
    'migrations',
    '20260715145555_phase4_1_ai_concurrency_lanes.sql',
  ),
  'utf8',
)

assert.match(migration, /alter column max_concurrent_operations set default 2/)
assert.match(migration, /ai_usage_ledger_running_realtime_uidx/)
assert.match(migration, /ai_usage_ledger_running_batch_uidx/)
assert.match(migration, /status = 'running' and feature = 'captions'/)
assert.match(
  migration,
  /status = 'running'[\s\S]*?'summaries'[\s\S]*?'material_analysis'[\s\S]*?'poll_suggestions'[\s\S]*?'academic_answers'/,
)
assert.match(migration, /'concurrency_lane', rejection_lane/)
assert.match(migration, /'grant_lane_conflict'/)
assert.match(migration, /preserve_terminal boolean default true/)
assert.match(
  migration,
  /create function private\.reconcile_lecture_ai_runtime_state[\s\S]*?security definer[\s\S]*?set search_path = ''/,
)
assert.match(
  migration,
  /revoke all on function private\.reconcile_lecture_ai_runtime_state\(uuid, boolean\)[\s\S]*?from public, anon, authenticated, service_role/,
)
assert.doesNotMatch(
  migration,
  /grant execute on function private\.reconcile_lecture_ai_runtime_state/,
)
assert.doesNotMatch(migration, /alter publication supabase_realtime add table/)
assert.doesNotMatch(
  migration,
  /drop table|drop column|delete from public\.ai_usage_ledger/i,
)
assert.doesNotMatch(
  migration,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|BILLING_PIN=/,
)

for (const functionName of [
  'close_lecture_core',
  'start_lecture_ai_operation',
  'finish_lecture_ai_operation',
  'stop_lecture_ai_control',
  'issue_ai_billing_grant',
  'consume_ai_billing_grant_and_start_operations',
  'finish_realtime_caption_operation',
  'reap_stale_realtime_caption_operations',
  'heartbeat_realtime_caption_operation',
  'publish_lecture_caption',
]) {
  assert.match(
    migration,
    new RegExp(
      `create or replace function private\\.${functionName}\\b[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
    ),
  )
}

console.log('Phase 4.1 static concurrency-lane checks passed.')
