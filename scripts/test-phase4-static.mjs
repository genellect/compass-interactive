import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
const adminPageViewModel = read(
  'src',
  'pages',
  'admin',
  'adminPageViewModel.ts',
)
const adminAiControlPanel = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminAiControlPanel.tsx',
)
const config = read('supabase', 'config.toml')

assert.match(envExample, /VITE_PHASE4_REALTIME_CAPTIONS=false/)
assert.doesNotMatch(envExample, /VITE_PHASE4_REALTIME_CAPTIONS=true/)
assert.match(envExample, /PHASE4_REALTIME_CAPTIONS_ENABLED=false/)
assert.doesNotMatch(
  browserSource,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|BILLING_PIN\s*=/,
)
assert.doesNotMatch(browserSource, /sk-proj-|sk-[A-Za-z0-9_-]{20,}/)
assert.equal(
  existsSync(
    join(root, 'supabase', 'functions', 'authorize-ai-start', 'index.ts'),
  ),
  false,
)
assert.match(realtimeCallEndpoint, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assert.match(realtimeCallEndpoint, /hasLegacyAdminFields/)
assert.match(realtimeCallEndpoint, /issue_google_realtime_ai_child_grant_v1/)
assert.match(realtimeCallEndpoint, /start_google_admin_realtime_operation_v1/)
assert.match(realtimeCallEndpoint, /activate_google_admin_realtime_provider_v1/)
assert.match(realtimeCallEndpoint, /fail_google_admin_realtime_provider_v1/)
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
assert.doesNotMatch(control, /billingPin|API利用PIN/)
assert.doesNotMatch(control, /localStorage|sessionStorage/)
assert.match(control, /5_000/)
assert.match(control, /15_000/)
assert.match(control, /'requesting_microphone'/)
assert.match(control, /MICROPHONE_REQUEST_TIMEOUT_MS = 15_000/)
assert.match(control, /Promise\.race\(\[/)
assert.match(control, /const startAttemptGenerationRef = useRef\(0\)/)
assert.match(
  control,
  /const startAttemptGeneration = \+\+startAttemptGenerationRef\.current[\s\S]*?stream = await requestMicrophoneStream\(\)[\s\S]*?startAttemptGenerationRef\.current !== startAttemptGeneration[\s\S]*?stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)[\s\S]*?return/,
  'a late microphone result from an invalidated start attempt must stop before provider IDs or Edge dispatch',
)
assert.match(
  control,
  /return \(\) => \{[\s\S]*?startAttemptGenerationRef\.current \+= 1[\s\S]*?sessionRef\.current\?\.stop\(\)/,
  'lecture change and unmount must invalidate an in-flight microphone request',
)
assert.match(
  control,
  /requestExpired[\s\S]*?lateStream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
  'a microphone stream that resolves after timeout must have every track stopped',
)
assert.match(control, /マイクの使用が許可されていません/)
assert.match(control, /このブラウザではマイクを利用できません/)
assert.match(control, /マイクの確認が15秒以内に完了しませんでした/)
assert.match(control, /status === 'error'[\s\S]*?'エラー'/)
const microphoneRequestIndex = control.indexOf(
  'stream = await requestMicrophoneStream()',
)
const grantRequestIdIndex = control.indexOf(
  'const grantRequestId = crypto.randomUUID()',
)
const startRequestIdIndex = control.indexOf(
  'const startRequestId = crypto.randomUUID()',
)
const providerCallIndex = control.indexOf(
  'supabaseAdminRepository.createRealtimeCaptionCall',
)
assert.ok(microphoneRequestIndex >= 0)
assert.ok(grantRequestIdIndex > microphoneRequestIndex)
assert.ok(startRequestIdIndex > microphoneRequestIndex)
assert.ok(providerCallIndex > startRequestIdIndex)
assert.match(control, /client_unmount/)
assert.match(control, /publishInFlightRef/)
assert.match(control, /createRealtimeCaptionCall/)
assert.match(control, /sdpOffer/)
assert.match(control, /sdpAnswer/)
assert.match(
  adminPageViewModel,
  /const activeAdminLecture = input\.lectures\.find\([\s\S]*?lecture\.id === input\.activeLectureSessionId/,
)
assert.match(
  adminAiControlPanel,
  /const status = activeLecture\?\.status \?\? lectureStatus/,
)
assert.match(adminAiControlPanel, /lectureStatus=\{status\}/)
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
assert.match(
  providerControlMigration,
  /provider_call\.activated_at is not null/,
)
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
  'issue-realtime-client-secret',
  'publish-caption-window',
]) {
  assert.match(
    config,
    new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`),
  )
}
assert.doesNotMatch(config, /\[functions\.authorize-ai-start\]/)
assert.match(
  config,
  /\[functions\.sweep-realtime-provider-calls\][\s\S]*?verify_jwt = false/,
)

console.log(
  'Phase 4 static Google authorization, trusted signalling, provider shutdown, storage, and responsibility checks passed.',
)
