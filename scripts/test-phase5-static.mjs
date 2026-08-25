import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = {
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
  repository: await readFile(
    new URL(
      '../src/repositories/supabase/adminContentAiRepository.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  retryMigration: await readFile(
    new URL(
      '../supabase/migrations/20260722213000_phase7_27_material_analysis_recovery.sql',
      import.meta.url,
    ),
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
assert.match(files.edge, /PHASE5_MATERIAL_ANALYSIS_ENABLED/)
assert.match(files.edge, /hasLegacyAdminFields\(body\)/)
assert.match(files.edge, /issue_google_material_ai_child_grant_v1/)
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
assert.match(files.model, /phase5-material-v2/)
assert.match(files.model, /exactly 5 genuinely high-value proposals/)
assert.match(
  files.retryMigration,
  /alter column material_analysis_call_limit set default 2/,
)
assert.doesNotMatch(files.retryMigration, /update public\.lecture_ai_control/)
assert.match(files.edge, /readJsonBody<RequestBody>/)
assert.match(
  files.edge,
  /selectedCharacterCount === 0[\s\S]*selected_text_unavailable[\s\S]*422[\s\S]*estimateReservation/,
)
assert.match(files.requestBody, /request\.body\?\.getReader\(\)/)
assert.match(files.requestBody, /totalBytes > maxBytes/)
assert.match(files.manageAi, /provider_specific_authority_required/)

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
assert.doesNotMatch(files.ui, /API利用PIN/)
assert.match(files.ui, /AI生成・未検証/)
assert.match(files.ui, /内容を確認する/)
assert.match(files.ui, /投票下書きに追加/)
assert.doesNotMatch(files.ui, /localStorage/)
assert.doesNotMatch(files.ui, /sessionStorage/)
assert.equal(
  files.repository.match(/'analyze-lecture-material'/g)?.length,
  1,
  'all material provider attempts use one closed dispatch helper',
)
assert.match(
  files.repository,
  /waitForMaterialAnalysisResult[\s\S]*?'manage-material-analysis'[\s\S]*?action: 'list'/,
)
assert.match(
  files.repository,
  /sourceDocumentId ===[\s\S]*?request\.request\.documentId[\s\S]*?sourceDocumentVersion ===[\s\S]*?request\.request\.documentVersion/,
)
const materialWait = files.repository.slice(
  files.repository.indexOf('async function waitForMaterialAnalysisResult('),
  files.repository.indexOf('function toMaterialProviderWireRequest('),
)
const materialCandidate = materialWait.indexOf('const candidateFound')
const materialExactReplay = materialWait.indexOf(
  'dispatchMaterialProviderRequest(',
  materialCandidate,
)
const materialExactResult = materialWait.indexOf(
  'results: toAdminMaterialResults(confirmation.data.results)',
  materialExactReplay,
)
assert.ok(
  materialCandidate >= 0 &&
    materialCandidate < materialExactReplay &&
    materialExactReplay < materialExactResult,
  'a read-only material candidate is returned only after exact same-wire receipt reconciliation',
)
assert.match(
  materialWait,
  /confirmation\.error[\s\S]*providerAttemptIsAmbiguous\(confirmation\.error\)[\s\S]*return \{ error: confirmation\.error, results: null \}/,
  'operation_in_progress and ambiguous exact replays keep polling while definitive errors stop',
)
const materialWire = files.repository.slice(
  files.repository.indexOf('function toMaterialProviderWireRequest('),
  files.repository.indexOf('function dispatchMaterialProviderRequest('),
)
assert.match(
  materialWire,
  /grantRequestId: request\.grantRequestId[\s\S]*startRequestId: request\.startRequestId/,
)
assert.doesNotMatch(materialWire, /knownProposalIds|previousAnalysisId/)
assert.match(
  files.repository,
  /const wireRequest = toMaterialProviderWireRequest\(request\)[\s\S]*dispatchMaterialProviderRequest\(wireRequest\)[\s\S]*waitForMaterialAnalysisResult\(\{[\s\S]*request,[\s\S]*wireRequest/,
  'initial material dispatch and confirmation replay share the exact closed wire body',
)
assert.match(files.ui, /shouldRetainAdminProviderAttempt[\s\S]*?retainAttempt/)

console.log('Phase 5 static security and default-OFF checks passed.')
