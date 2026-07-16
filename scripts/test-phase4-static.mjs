import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
function readTree(path) {
  return readdirSync(path)
    .flatMap((name) => {
      const target = join(path, name)
      return statSync(target).isDirectory()
        ? readTree(target)
        : [readFileSync(target, 'utf8')]
    })
    .join('\n')
}

const migration = read(
  'supabase',
  'migrations',
  '20260715032806_phase4_billing_and_realtime_captions.sql',
)
const providerControlMigration = read(
  'supabase',
  'migrations',
  '20260717090500_phase6_6_realtime_provider_control.sql',
)
const envExample = read('.env.local.example')
const browserSource = readTree(join(root, 'src'))
const authorize = read(
  'supabase',
  'functions',
  'authorize-ai-start',
  'index.ts',
)
const realtimeCallEndpoint = read(
  'supabase',
  'functions',
  'issue-realtime-client-secret',
  'index.ts',
)
const realtimeSweepEndpoint = read(
  'supabase',
  'functions',
  'sweep-realtime-provider-calls',
  'index.ts',
)
const openAiRealtime = read(
  'supabase',
  'functions',
  '_shared',
  'openaiRealtime.ts',
)
const transcriptStore = read('src', 'caption', 'captionTranscriptStore.ts')
const realtimeSession = read('src', 'caption', 'realtimeCaptionSession.ts')
const control = read(
  'src',
  'components',
  'AdminAiControl',
  'RealtimeCaptionControl.tsx',
)
const adminPage = read('src', 'pages', 'AdminPage.tsx')
const config = read('supabase', 'config.toml')

assert.match(envExample, /VITE_PHASE4_REALTIME_CAPTIONS=false/)
assert.doesNotMatch(envExample, /VITE_PHASE4_REALTIME_CAPTIONS=true/)
assert.match(envExample, /PHASE4_REALTIME_CAPTIONS_ENABLED=false/)
assert.doesNotMatch(
  browserSource,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|BILLING_PIN\s*=/,
)
assert.doesNotMatch(browserSource, /sk-proj-|sk-[A-Za-z0-9_-]{20,}/)
assert.match(authorize, /verifyBillingPin/)
assert.match(authorize, /pin_succeeded: pinSucceeded/)
assert.doesNotMatch(authorize, /billingPin[^\n]*(insert|update|rpc)/i)
assert.match(realtimeCallEndpoint, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assert.match(
  realtimeCallEndpoint,
  /admin_consume_realtime_billing_grant/,
)
assert.match(
  realtimeCallEndpoint,
  /admin_activate_realtime_provider_call/,
)
assert.match(realtimeCallEndpoint, /admin_finish_realtime_caption_operation/)
assert.match(realtimeCallEndpoint, /sdpOffer/)
assert.match(realtimeCallEndpoint, /sdpAnswer/)
assert.match(openAiRealtime, /\/v1\/realtime\/calls/)
assert.match(openAiRealtime, /\/hangup/)
assert.doesNotMatch(openAiRealtime, /\/v1\/realtime\/client_secrets/)
assert.doesNotMatch(
  openAiRealtime,
  /console\.|apiKey[^\n]*(jsonResponse|JSON\.stringify)/,
)
assert.doesNotMatch(
  realtimeSession,
  /api\.openai\.com|Authorization|clientSecret/,
)
assert.match(realtimeSession, /createOffer/)
assert.match(realtimeSession, /connect\(answerSdp/)
assert.match(realtimeSession, /input_audio_buffer\.commit/)
assert.match(realtimeSession, /getTracks\(\).*track\.stop/)
assert.match(transcriptStore, /IndexedDB|indexedDB/i)
assert.doesNotMatch(
  transcriptStore,
  /MediaRecorder|AudioBuffer|BlobEvent|arrayBuffer\(/,
)
assert.match(control, /setBillingPin\(''\)/)
assert.doesNotMatch(control, /localStorage|sessionStorage/)
assert.match(control, /5_000/)
assert.match(control, /15_000/)
assert.match(control, /client_unmount/)
assert.match(control, /publishInFlightRef/)
assert.match(control, /createRealtimeCaptionCall/)
assert.match(control, /sdpOffer/)
assert.match(control, /sdpAnswer/)
assert.match(
  adminPage,
  /const activeAdminLecture = lectures\.find\([\s\S]*?item\.id === activeLectureSessionId/,
)
assert.match(
  adminPage,
  /lectureStatus=\{activeAdminLecture\?\.status \?\? lecture\.status\}/,
)
assert.match(migration, /lecture_public_captions/)
assert.match(
  migration,
  /char_length\(trim\(coalesce\(target_text, ''\)\)\) not between 1 and 1000/,
)
assert.match(migration, /expires_at[\s\S]*interval '2 minutes'/)
assert.match(
  migration,
  /revoke all on public\.ai_billing_grants from public, anon, authenticated/,
)
assert.match(migration, /reap_stale_realtime_caption_operations/)
assert.match(migration, /interval '45 seconds'/)
assert.doesNotMatch(migration, /alter publication supabase_realtime add table/)
assert.match(
  providerControlMigration,
  /create table public\.ai_realtime_provider_calls/,
)
assert.match(
  providerControlMigration,
  /ai_usage_ledger_enqueue_realtime_provider_hangup/,
)
assert.match(providerControlMigration, /idempotent_replay/)
assert.match(providerControlMigration, /provider_call\.activated_at is not null/)
assert.match(providerControlMigration, /reason', 'stale_sequence'/)
assert.match(
  providerControlMigration,
  /revoke all on public\.ai_realtime_provider_calls[\s\S]*?authenticated/,
)
assert.match(
  providerControlMigration,
  /grant execute on function public\.claim_realtime_provider_hangups[\s\S]*?service_role/,
)
assert.match(realtimeSweepEndpoint, /REALTIME_SWEEP_TRIGGER_SECRET/)
assert.match(realtimeSweepEndpoint, /timingSafeEqual/)
assert.match(realtimeSweepEndpoint, /runRealtimeProviderHangupSweep/)
assert.match(envExample, /REALTIME_SWEEP_TRIGGER_SECRET=/)
for (const functionName of [
  'authorize-ai-start',
  'issue-realtime-client-secret',
  'publish-caption-window',
]) {
  assert.match(
    config,
    new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`),
  )
}
assert.match(
  config,
  /\[functions\.sweep-realtime-provider-calls\][\s\S]*?verify_jwt = false/,
)

console.log(
  'Phase 4 static secret, billing, trusted signalling, provider shutdown, storage, and responsibility checks passed.',
)
