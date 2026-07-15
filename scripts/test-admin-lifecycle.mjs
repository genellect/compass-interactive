import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAdminToken,
  verifyAdminToken,
} from '../supabase/functions/_shared/adminToken.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

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
assert.match(manageLectures, /rpc\('admin_create_lecture'/)
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
assert.doesNotMatch(
  manageAiControl,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY[^)]*jsonResponse/,
)
assert.match(managePolls, /rpc\('admin_create_poll'/)
assert.match(managePolls, /'admin_set_poll_status'/)
assert.match(adminRepository, /async managePolls/)
assert.match(adminPage, /handleCreatePoll/)
assert.doesNotMatch(adminPage, /setPollStatus/)
assert.match(config, /\[functions\.manage-polls\][\s\S]*?verify_jwt = true/)

console.log('Milestone 3 Admin lifecycle unit and static checks passed.')
