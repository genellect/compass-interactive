import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

function assertSecretsAreNotReturned(source) {
  const sourceFile = ts.createSourceFile(
    'manage-ai-control.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const leakedIdentifiers = []
  const inspectResponseValue = (node) => {
    if (
      ts.isIdentifier(node) &&
      (node.text === 'openAiApiKey' || node.text === 'serviceRoleKey')
    ) {
      leakedIdentifiers.push(node.text)
    }
    ts.forEachChild(node, inspectResponseValue)
  }
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'jsonResponse' &&
      node.arguments[0]
    ) {
      inspectResponseValue(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.deepEqual(
    leakedIdentifiers,
    [],
    'Server-only credentials must never be included in an Edge JSON response.',
  )
}

const migration = read('supabase/migrations/20260711080712_admin_lifecycle.sql')
const manageLectures = read('supabase/functions/manage-lectures/index.ts')
const managePolls = read('supabase/functions/manage-polls/index.ts')
const updateDisplay = read('supabase/functions/update-display-state/index.ts')
const manageAiControl = read('supabase/functions/manage-ai-control/index.ts')
const adminPage = read('src/pages/AdminPage.tsx')
const adminRepository = read('src/repositories/supabaseAdminRepository.ts')
const edgeTransport = read('src/repositories/supabase/transport.ts')
const config = read('supabase/config.toml')

for (const functionName of [
  'admin_create_lecture',
  'admin_set_lecture_status',
  'admin_create_poll',
  'admin_set_poll_status',
]) {
  assert.match(
    migration,
    new RegExp(`create function public\\.${functionName}\\b`),
  )
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${functionName}`),
  )
}

for (const source of [
  manageLectures,
  managePolls,
  updateDisplay,
  manageAiControl,
]) {
  assert.match(source, /verifyGoogleAdminOperationRequest/)
  assert.match(source, /hasLegacyAdminFields\(body\)/)
  assert.match(source, /appSessionToken/)
  assert.doesNotMatch(source, /verifyAdminToken|getAdminTokenClaims/)
  assert.doesNotMatch(source, /function timingSafeEqual|function signToken/)
}
assert.equal(
  existsSync(join(root, 'supabase/functions/verify-admin-pin/index.ts')),
  false,
  'the shared Admin PIN issuer must stay removed',
)
assert.match(manageLectures, /manage_google_admin_lectures_v1/)
assert.match(manageLectures, /target_action: action/)
assert.match(manageLectures, /target_action: body\.action/)
assert.doesNotMatch(manageLectures, /from\('lecture_sessions'\)\s*\.insert/)
assert.doesNotMatch(manageLectures, /transition_at:\s*new Date/)
assert.match(
  adminRepository,
  /let response = await invokeEdgeFunction<ManageLecturesResponse>[\s\S]*?request\.action !== 'list'[\s\S]*?providerAttemptIsAmbiguous\(response\.error\)[\s\S]*?response = await invokeEdgeFunction<ManageLecturesResponse>[\s\S]*?const \{ data, error \} = response/,
  'ambiguous lecture mutations must retry exactly once with the reserved request ID while list and durable errors remain single-attempt',
)
assert.match(manageAiControl, /manage_google_admin_ai_control_v1/)
assert.match(manageAiControl, /target_action: semanticAction/)
assert.match(manageAiControl, /provider_specific_authority_required/)
assert.doesNotMatch(
  manageAiControl,
  /admin_start_lecture_ai_operation|admin_stop_lecture_ai_control|admin_heartbeat_realtime_caption_operation/,
)
assert.match(manageAiControl, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assertSecretsAreNotReturned(manageAiControl)
assert.match(managePolls, /manage_google_admin_polls_v1/)
assert.doesNotMatch(managePolls, /admin_create_poll|admin_set_poll_status/)
assert.match(managePolls, /hasMore/)
assert.match(adminRepository, /async managePolls/)
assert.doesNotMatch(adminRepository, /async verifyAdminPin\b|verify-admin-pin/)
assert.doesNotMatch(config, /\[functions\.verify-admin-pin\]/)
assert.match(edgeTransport, /supabase\.functions\.invoke/)
assert.match(adminPage, /handleCreatePoll/)
assert.doesNotMatch(adminPage, /setPollStatus/)
assert.match(config, /\[functions\.manage-polls\][\s\S]*?verify_jwt = true/)

console.log('Milestone 3 Admin lifecycle unit and static checks passed.')
