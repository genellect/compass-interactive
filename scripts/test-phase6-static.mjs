import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [env, flags, config, migration, generate, manage, control, live, context] =
  await Promise.all([
    read('.env.local.example'),
    read('src/lib/featureFlags.ts'),
    read('supabase/config.toml'),
    read('supabase/migrations/20260716013632_phase6_five_minute_summaries.sql'),
    read('supabase/functions/generate-lecture-summary/index.ts'),
    read('supabase/functions/manage-lecture-summaries/index.ts'),
    read('src/components/AdminAiControl/LectureSummaryControl.tsx'),
    read('src/repositories/supabaseLiveStateRepository.ts'),
    read('src/context/CompassStateContext.tsx'),
  ])

assert.match(env, /^VITE_PHASE6_SUMMARIES=false$/m)
assert.match(env, /^PHASE6_SUMMARIES_ENABLED=false$/m)
assert.match(flags, /VITE_PHASE6_SUMMARIES === 'true'/)
assert.match(config, /\[functions\.generate-lecture-summary\]\s+verify_jwt = true/)
assert.match(config, /\[functions\.manage-lecture-summaries\]\s+verify_jwt = true/)
assert.match(generate, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assert.doesNotMatch(control, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/)
assert.doesNotMatch(env, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/)
assert.match(generate, /PHASE6_MIN_SOURCE_CHARACTERS/)
assert.match(generate, /skipped: true/)
assert.match(generate, /for \(let localAttempt = 1; localAttempt <= 2/)
assert.match(generate, /AbortSignal\.timeout\(45_000\)/)
assert.match(manage, /parseBillingGrantToken\(body\.billingGrant\)/)
assert.match(manage, /admin_start_lecture_summary_run/)
assert.match(control, /Billing PIN（開始時のみ）/)
assert.doesNotMatch(control, /localStorage.*runToken|sessionStorage.*runToken/)
assert.match(control, /getServerNow\(\)/)
assert.match(context, /estimateServerTimeMs\(sample, performance\.now\(\)\)/)
assert.match(live, /get_lecture_public_snapshot_v4/)
assert.match(live, /get_lecture_archive_v3/)

for (const table of [
  'lecture_summary_runs',
  'lecture_summary_windows',
  'lecture_ai_summaries',
  'lecture_ai_summary_revisions',
  'summary_publications',
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`))
}
assert.doesNotMatch(migration, /publication.*supabase_realtime|lecture_ai_summaries.*supabase_realtime/i)
assert.doesNotMatch(migration, /(?:transcript|pdf)_(?:text|content)\s+(?:text|jsonb)/i)
assert.match(migration, /security invoker/g)
assert.match(migration, /set search_path = ''/g)
assert.match(migration, /window_index integer not null check \(window_index between 1 and 18\)/)
assert.match(migration, /attempt_count integer not null default 0 check \(attempt_count between 0 and 2\)/)
assert.match(migration, /private\.phase6_public_summaries_json\(target_lecture_session_id, 6\)/)
assert.match(migration, /private\.phase6_public_summaries_json\(target_lecture_session_id, 12\)/)

console.log('Phase 6 static security and integration checks passed.')
