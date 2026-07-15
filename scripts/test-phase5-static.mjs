import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = {
  authorize: await readFile(
    new URL(
      '../supabase/functions/authorize-ai-start/index.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  config: await readFile(
    new URL('../supabase/config.toml', import.meta.url),
    'utf8',
  ),
  edge: await readFile(
    new URL(
      '../supabase/functions/analyze-lecture-material/index.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  env: await readFile(
    new URL('../.env.local.example', import.meta.url),
    'utf8',
  ),
  migration: await readFile(
    new URL(
      '../supabase/migrations/20260715155407_phase5_pdf_ai_poll_proposals.sql',
      import.meta.url,
    ),
    'utf8',
  ),
  model: await readFile(
    new URL(
      '../supabase/functions/_shared/materialAnalysis.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  manageAi: await readFile(
    new URL(
      '../supabase/functions/manage-ai-control/index.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  publisher: await readFile(
    new URL('../publisher/src/server/publisherServer.ts', import.meta.url),
    'utf8',
  ),
  requestBody: await readFile(
    new URL('../supabase/functions/_shared/requestBody.ts', import.meta.url),
    'utf8',
  ),
  ui: await readFile(
    new URL(
      '../src/components/AdminAiControl/MaterialAnalysisControl.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
}

assert.match(files.env, /^VITE_PHASE5_MATERIAL_ANALYSIS=false$/m)
assert.match(files.env, /^PHASE5_MATERIAL_ANALYSIS_ENABLED=false$/m)
assert.doesNotMatch(files.env, /^VITE_OPENAI_API_KEY=/m)
assert.match(files.authorize, /PHASE5_MATERIAL_ANALYSIS_ENABLED/)
assert.match(
  files.config,
  /\[functions\.analyze-lecture-material\][\s\S]*verify_jwt = true/,
)
assert.match(
  files.config,
  /\[functions\.manage-material-analysis\][\s\S]*verify_jwt = true/,
)

assert.match(files.edge, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assert.doesNotMatch(files.edge, /VITE_OPENAI_API_KEY/)
assert.match(files.model, /store: false/)
assert.doesNotMatch(files.model, /input_image|input_file|file_id/)
assert.doesNotMatch(files.model, /\btools\s*:/)
assert.match(files.model, /reasoning: \{ effort: 'low' \}/)
assert.match(files.model, /strict: true/)
assert.match(files.edge, /readJsonBody<RequestBody>/)
assert.match(files.requestBody, /request\.body\?\.getReader\(\)/)
assert.match(files.requestBody, /totalBytes > maxBytes/)
assert.match(files.manageAi, /Phase 5 operations must be finalized/)

for (const table of [
  'material_ai_operation_contexts',
  'lecture_material_analyses',
  'ai_poll_proposals',
]) {
  assert.match(
    files.migration,
    new RegExp(`alter table public\\.${table} enable row level security`),
  )
  assert.match(files.migration, new RegExp(`revoke all on public\\.${table}`))
}
assert.doesNotMatch(files.migration, /source_(?:page_)?text\s+text/i)
assert.doesNotMatch(files.migration, /alter publication|supabase_realtime/i)
assert.match(files.migration, /status = 'adopted'/)
assert.match(files.migration, /public\.admin_create_poll/)
assert.match(files.migration, /poll_type not in \('single', 'multiple'\)/)
assert.doesNotMatch(files.migration, /target_status[^\n]*'open'/)

const verifyPublisherPosition = files.publisher.indexOf('sessions.verify')
const loadPosition = files.publisher.indexOf('textStore.load')
assert.ok(
  verifyPublisherPosition >= 0 && verifyPublisherPosition < loadPosition,
)
assert.match(files.publisher, /verifyLectureAccessToken/)
assert.match(files.ui, /Billing PIN（毎回）/)
assert.match(files.ui, /AI生成・未検証/)
assert.match(files.ui, /通常Pollの下書きへ追加/)
assert.doesNotMatch(files.ui, /localStorage/)
assert.doesNotMatch(files.ui, /sessionStorage/)

console.log('Phase 5 static security and default-OFF checks passed.')
