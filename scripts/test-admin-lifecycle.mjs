import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  createAdminToken,
  verifyAdminToken,
} from '../supabase/functions/_shared/adminToken.ts'

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

const secret = 'milestone-3-test-secret'
const token = await createAdminToken(secret)
assert.equal(await verifyAdminToken(token, secret), true)
assert.equal(await verifyAdminToken(`${token}tampered`, secret), false)
assert.equal(await verifyAdminToken('invalid-token', secret), false)

const originalNow = Date.now
Date.now = () => originalNow() + 9 * 60 * 60 * 1000
assert.equal(await verifyAdminToken(token, secret), false)
Date.now = originalNow

const migration = read('supabase/migrations/20260711080712_admin_lifecycle.sql')
const manageLectures = read('supabase/functions/manage-lectures/index.ts')
const managePolls = read('supabase/functions/manage-polls/index.ts')
const updateDisplay = read('supabase/functions/update-display-state/index.ts')
const manageAiControl = read('supabase/functions/manage-ai-control/index.ts')
const verifyPin = read('supabase/functions/verify-admin-pin/index.ts')
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
  assert.match(source, /_shared\/adminToken\.ts/)
  assert.match(source, /verifyAdminToken|getAdminTokenClaims/)
  assert.doesNotMatch(source, /function timingSafeEqual|function signToken/)
}
assert.match(verifyPin, /_shared\/adminToken\.ts/)
assert.match(manageLectures, /rpc\('admin_create_lecture_v2'/)
assert.match(manageLectures, /rpc\('admin_duplicate_lecture_v1'/)
assert.match(manageLectures, /rpc\(\s*'admin_set_lecture_status'/)
assert.doesNotMatch(manageLectures, /from\('lecture_sessions'\)\s*\.insert/)
assert.doesNotMatch(manageLectures, /transition_at:\s*new Date/)
assert.match(manageAiControl, /admin_stop_lecture_ai_control/)
assert.match(manageAiControl, /admin_heartbeat_realtime_caption_operation/)
assert.match(
  manageAiControl,
  /Starting a paid AI feature requires a billing grant/,
)
assert.doesNotMatch(
  manageAiControl,
  /rpc\(\s*'admin_start_lecture_ai_operation'/,
)
assert.match(manageAiControl, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
assertSecretsAreNotReturned(manageAiControl)
assert.match(managePolls, /rpc\('admin_create_poll'/)
assert.match(managePolls, /'admin_set_poll_status'/)
assert.match(managePolls, /\.eq\('status', 'open'\)/)
assert.match(managePolls, /\.neq\('status', 'open'\)/)
assert.match(managePolls, /hasMore/)
assert.match(adminRepository, /async managePolls/)
assert.match(
  adminRepository,
  /async verifyAdminPin[\s\S]*?await ensureAnonymousAuthSession\(\)[\s\S]*?invokeEdgeFunction/,
)
assert.match(edgeTransport, /supabase\.functions\.invoke/)
assert.match(adminPage, /handleCreatePoll/)
assert.doesNotMatch(adminPage, /setPollStatus/)
assert.match(config, /\[functions\.manage-polls\][\s\S]*?verify_jwt = true/)

console.log('Milestone 3 Admin lifecycle unit and static checks passed.')
