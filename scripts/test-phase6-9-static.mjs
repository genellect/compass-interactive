import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const normalizedUtf8Bytes = (path) =>
  Buffer.byteLength(read(path).replaceAll('\r\n', '\n'), 'utf8')
const adminPage = read('src/pages/AdminPage.tsx')
const adminPollCoordinator = read(
  'src/pages/admin/useAdminPollRefreshCoordinator.ts',
)
const context = read('src/context/CompassStateContext.tsx')
const liveRepository = read('src/repositories/supabaseLiveStateRepository.ts')
const adminRepository = read('src/repositories/supabaseAdminRepository.ts')
const adminMappers = read('src/repositories/supabase/adminMappers.ts')
const workflow = read('.github/workflows/ci.yml')
const packageJson = JSON.parse(read('package.json'))

for (const component of [
  'AdminLectureControl',
  'AdminPdfControl',
  'AdminPollControl',
  'AdminAiControlPanel',
  'AdminModerationPanel',
]) {
  assert.match(adminPage, new RegExp(`\\b${component}\\b`))
}
assert.doesNotMatch(adminPage, /AdminSessionPanel|セッション管理/)
assert.match(
  adminPage,
  /href="\/admin\/settings"[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"[\s\S]*教員管理/,
)
assert.match(
  adminPage,
  /runtimeMode === 'live' \? restoredActiveLectureSessionId : null[\s\S]*activeLectureSessionId = activeAdminLecture\?\.id \?\? null/,
  'Admin operations must ignore demo and non-owned restored lecture selections',
)
assert.match(
  adminPage,
  /TeacherWorkspaceNav[\s\S]*teacher-workspace-stage[\s\S]*view=\{workspaceView === 'slides' \? 'slides' : 'material'\}/,
  'the teacher workspace must expose only the stage selected from server-derived availability',
)
assert.match(
  adminPollCoordinator,
  /inFlightByKeyRef[\s\S]*refreshSequence !== refreshSequenceRef\.current[\s\S]*mutationEpoch !== mutationEpochRef\.current[\s\S]*lectureSessionId !== activeLectureIdRef\.current[\s\S]*applyPollList\(result, lectureSessionId\)/,
  'a delayed poll-list response must not cross a lecture-selection boundary',
)
assert.match(
  adminPage,
  /adminPollsLectureSessionId === requestedAdminLectureSessionId[\s\S]*adminPolls: pollsBelongToRequestedLecture \? adminPolls : \[\][\s\S]*adminPollsHasMore: pollsBelongToRequestedLecture/,
  'poll rows must remain hidden until their owner lecture matches the selected lecture',
)
assert.match(
  adminPollCoordinator,
  /epoch: \+\+mutationEpochRef\.current[\s\S]*mutation\.epoch === mutationEpochRef\.current[\s\S]*mutation\.lectureSessionId === activeLectureIdRef\.current/,
  'a stale background poll response must not overwrite a newer poll mutation',
)
assert.match(
  adminPollCoordinator,
  /if \(!silent\) \{[\s\S]*setPollsLoading\(true\)[\s\S]*finally \{[\s\S]*!silent &&[\s\S]*setPollsLoading\(false\)/,
  'background poll refresh must not interrupt teacher controls with loading state',
)
for (const responsibility of [
  'commentsAndPolls',
  'sessionLifecycle',
  'snapshotState',
  'useArchiveResume',
]) {
  assert.match(context, new RegExp(responsibility))
}
assert.ok(normalizedUtf8Bytes('src/pages/AdminPage.tsx') < 50_000)
assert.ok(normalizedUtf8Bytes('src/context/CompassStateContext.tsx') < 50_000)
assert.ok(
  normalizedUtf8Bytes('src/repositories/supabaseLiveStateRepository.ts') <
    20_000,
)
assert.ok(
  normalizedUtf8Bytes('src/repositories/supabaseAdminRepository.ts') < 30_000,
)

for (const repository of [liveRepository, adminRepository]) {
  assert.match(repository, /supabase\/requestPolicy/)
  assert.match(repository, /supabase\/transport/)
}
assert.match(liveRepository, /supabase\/liveStateMappers/)
assert.doesNotMatch(liveRepository, /function mapPublicSnapshotV2/)
assert.match(adminRepository, /supabase\/adminMappers/)
assert.doesNotMatch(adminRepository, /function toAdmin/)
assert.match(adminMappers, /function toAdminDisplayState/)
assert.match(adminMappers, /function toAdminMaterialResults/)
assert.match(adminMappers, /function toAdminSummaryResults/)

const actionReferences = [
  ...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g),
].map((match) => match[1])
assert.ok(actionReferences.length >= 10)
for (const reference of actionReferences) {
  assert.match(reference, /^[a-f0-9]{40}$/, `Mutable action ref: ${reference}`)
}
for (const required of [
  'actions/dependency-review-action@',
  'github/codeql-action/init@',
  'security:secrets',
  'security:audit',
  'npm sbom --sbom-format cyclonedx',
  'db:types:check',
  'webkit',
]) {
  assert.match(
    workflow,
    new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
}
for (const script of ['test:e2e:demo:triple', 'test:e2e:local:triple']) {
  assert.match(packageJson.scripts[script], /--repeat-each=3/)
  assert.match(workflow, new RegExp(`npm run ${script.replace(':', '\\:')}`))
}

for (const dependency of [
  '@playwright/test',
  '@axe-core/playwright',
  'supabase',
]) {
  const version = packageJson.devDependencies[dependency]
  assert.equal(typeof version, 'string')
  assert.match(version, /^\d+\.\d+\.\d+$/, `${dependency} must be exact-pinned`)
}
assert.match(
  read('scripts/ci/database-types.mjs'),
  /--local.*--schema.*public/s,
)
assert.match(read('e2e/demo/accessibility.spec.ts'), /AxeBuilder/)
assert.match(read('e2e/demo/accessibility.spec.ts'), /critical.*serious/s)
assert.match(read('e2e/demo/visual-contract.spec.ts'), /toMatchSnapshot/)
for (const project of [
  'desktop-chromium',
  'mobile-chromium',
  'desktop-webkit',
  'mobile-webkit',
]) {
  assert.doesNotThrow(() =>
    read(
      `e2e/demo/visual-contract.spec.ts-snapshots/lecture-layout-${project}.json`,
    ),
  )
}

console.log(
  'Phase 6.9 modularization, generated types, supply-chain, and browser static gate passed.',
)
