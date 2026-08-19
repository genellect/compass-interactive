import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const functionBlock = (sql, qualifiedName) =>
  sql.match(
    new RegExp(
      `create (?:or replace )?function ${qualifiedName.replaceAll('.', '\\.')}` +
        `[\\s\\S]*?\\n\\$\\$;`,
    ),
  )?.[0] ?? ''

const authorityMigrationPath =
  'supabase/migrations/20260812050000_phase7_30e_admin_cutover_authority.sql'
assert.ok(
  existsSync(new URL(`../${authorityMigrationPath}`, import.meta.url)),
  `missing Phase 7.30E authority migration: ${authorityMigrationPath}`,
)

const migration = read(authorityMigrationPath)
const displayMigration = read(
  'supabase/migrations/20260812040000_phase7_30e_google_only_cutover.sql',
)
const pgTap = read('supabase/tests/phase7_30e_admin_cutover_authority_test.sql')
const config = read('supabase/config.toml')
const credential = read('src/lib/adminAuth/adminOperationCredential.ts')
const transport = read('src/repositories/supabase/transport.ts')
const adminRoute = read('src/pages/AdminRoute.tsx')
const legacyFieldGuard = read('supabase/functions/_shared/googleOnlyAdmin.ts')
const packageJson = JSON.parse(read('package.json'))
const ci = read('.github/workflows/ci.yml')
const nonlive = read('scripts/ci/run-nonlive-suite.mjs')
const browserRunner = read('scripts/ci/run-browser-e2e.mjs')
const browserGoogleFixture = read('e2e/helpers/googleAdminSession.ts')
const browserSafety = read('e2e/helpers/browserSafety.ts')
const displayRealtimeBrowser = read(
  'e2e/local/display-realtime-integration.spec.ts',
)
const adminIdentityBrowser = read('e2e/demo/phase7-30-admin-identity.spec.ts')
const localLifecycleBrowser = read('e2e/local/live-lecture.spec.ts')
const browserPdfPublication = read(
  'e2e/demo/browser-pdf-publication-admin.spec.ts',
)
const adminPage = read('src/pages/AdminPage.tsx')
const adminPageViewModel = read('src/pages/admin/adminPageViewModel.ts')
const adminLectureControl = read(
  'src/components/AdminWorkspace/AdminLectureControl.tsx',
)
const localGoogleFixture = read('scripts/test-phase7-30b1-local-edge.mjs')
const concurrency = read('scripts/test-phase7-30e-concurrency.mjs')
const localEdgeContract = read('scripts/test-production-local-edge.mjs')
const manageLectures = read('supabase/functions/manage-lectures/index.ts')
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const c1HeadUpgradeProbe = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe-test.sql',
)
const eUpgradeProbePaths = [
  'scripts/fixtures/phase7-30e-c2-head-upgrade-probe.sql',
  'scripts/fixtures/phase7-30e-c2-head-upgrade-probe-test.sql',
  'scripts/fixtures/phase7-30e-d-head-upgrade-probe.sql',
  'scripts/fixtures/phase7-30e-d-head-upgrade-probe-test.sql',
]
for (const path of eUpgradeProbePaths) {
  assert.ok(
    existsSync(new URL(`../${path}`, import.meta.url)),
    `missing Phase 7.30E populated upgrade probe: ${path}`,
  )
}
const c2HeadUpgradeFixture = read(eUpgradeProbePaths[0])
const c2HeadUpgradeProbe = read(eUpgradeProbePaths[1])
const dHeadUpgradeFixture = read(eUpgradeProbePaths[2])
const dHeadUpgradeProbe = read(eUpgradeProbePaths[3])

const operationalEdges = [
  'analyze-lecture-material',
  'generate-academic-answer',
  'generate-lecture-summary',
  'issue-display-session',
  'issue-pdf-access-token',
  'issue-realtime-client-secret',
  'manage-admin-sessions',
  'manage-ai-control',
  'manage-comments',
  'manage-lectures',
  'manage-lecture-summaries',
  'manage-material-analysis',
  'manage-pdf-documents',
  'manage-pdf-publications',
  'manage-polls',
  'manage-presenter-connection',
  'operator-live-snapshot',
  'publish-caption-window',
  'update-display-state',
]

assert.equal(operationalEdges.length, 19)
for (const edgeName of operationalEdges) {
  const source = read(`supabase/functions/${edgeName}/index.ts`)
  assert.match(
    source,
    /hasLegacyAdminFields\(body\)/,
    `${edgeName} must reject the retired Admin PIN and billing request fields`,
  )
  assert.match(
    source,
    /verifyGoogleAdminOperationRequest/,
    `${edgeName} must verify the Google application session`,
  )
  assert.match(
    source,
    /appSessionToken/,
    `${edgeName} must require the Google application-session credential`,
  )
  assert.doesNotMatch(
    source,
    /getAdminTokenClaims|verifyAdminToken|verify_and_touch_admin_session/,
    `${edgeName} must not retain a legacy Admin-token verifier`,
  )
}

assert.match(legacyFieldGuard, /\['adminToken', 'billingGrant', 'billingPin'\]/)
for (const retiredEndpoint of ['verify-admin-pin', 'authorize-ai-start']) {
  assert.equal(
    existsSync(
      new URL(
        `../supabase/functions/${retiredEndpoint}/index.ts`,
        import.meta.url,
      ),
    ),
    false,
    `${retiredEndpoint} source must be deleted`,
  )
}
assert.doesNotMatch(
  config,
  /\[functions\.(?:verify-admin-pin|authorize-ai-start)\]/,
)
assert.doesNotMatch(
  config,
  /\b(?:verify-admin-pin|authorize-ai-start)\b/,
  'retired endpoints must not remain deployable from Supabase config',
)
assert.match(
  credential,
  /export type AdminOperationCredential = \{\s*appSessionToken: string\s*kind: 'google'\s*\}/,
)
assert.doesNotMatch(credential, /kind: 'legacy'|legacyToken|billingGrant/)
assert.match(
  transport,
  /isAdminOperationCredential\(suppliedAdminCredential\)[\s\S]*getAdminOperationCredentialBody\(credential\)/,
)
assert.match(transport, /Google Admin credential is required\./)
assert.match(adminRoute, /AdminWorkspaceApp/)
assert.doesNotMatch(adminRoute, /AdminLegacyApp|AdminAuthPanel/)

assert.match(
  displayMigration,
  /create function private\.verify_google_display_terminal_session_v1\([\s\S]*target_display_auth_user_id uuid/,
)
assert.match(
  displayMigration,
  /from private\.admin_google_display_sessions[\s\S]*token_jti_hash = target_token_jti_hash[\s\S]*lecture_session_id = target_lecture_session_id[\s\S]*issued_at = target_token_issued_at[\s\S]*expires_at = target_token_expires_at/,
  'terminal Display review must require exact durable Google provenance',
)
assert.match(
  displayMigration,
  /revoke all on function private\.verify_google_display_terminal_session_v1[\s\S]*service_role[\s\S]*grant execute on function public\.verify_google_display_terminal_session_v1[\s\S]*to service_role/,
)

for (const table of [
  'admin_lecture_ownership_claim_approvals',
  'admin_lecture_ownership_claim_receipts',
  'admin_identity_cutover_receipts',
]) {
  assert.match(migration, new RegExp(`create table private\\.${table}`))
  assert.match(
    migration,
    new RegExp(
      `alter table private\\.${table}[\\s\\S]*enable row level security`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on (?:table )?private\\.${table}[\\s\\S]*` +
        `public, anon, authenticated, service_role`,
    ),
  )
}

assert.match(
  migration,
  /admin_lecture_ownership_claim_approvals[\s\S]*expected_lecture_status[\s\S]*expected_lifecycle_version[\s\S]*mapping_evidence_digest/,
  'operator approval freezes the reviewed lecture state and mapping evidence',
)
assert.match(
  migration,
  /admin_lecture_ownership_claim_(?:approvals|receipts)[\s\S]*reject_admin_c1_evidence_mutation_v1/,
  'ownership adoption evidence remains append-only',
)
assert.match(
  migration,
  /admin_identity_cutover_receipts[\s\S]*deployment_evidence_digest/,
  'the irreversible cutover records the reviewed deployment digest',
)
assert.match(
  migration,
  /ownership_source[\s\S]*'google_create'[\s\S]*'operator_claim'/,
)
assert.match(migration, /ownership_approval_id/)

const approval = functionBlock(
  migration,
  'private.approve_google_admin_lecture_ownership_claim_v1',
)
const claim = functionBlock(
  migration,
  'private.claim_approved_google_admin_lecture_ownership_v1',
)
const cutover = functionBlock(
  migration,
  'private.commit_google_only_admin_cutover_v1',
)
const verifier = functionBlock(
  migration,
  'public.verify_and_touch_admin_session',
)
const legacyGateHold = functionBlock(
  migration,
  'private.hold_legacy_admin_session_gate_v1',
)
const sessionFence = functionBlock(
  migration,
  'private.enforce_google_only_admin_session_fence_v1',
)
const gateFence = functionBlock(
  migration,
  'private.enforce_google_only_admin_gate_tombstone_v1',
)
const lectureFence = functionBlock(
  migration,
  'private.enforce_active_admin_lecture_ownership_v1',
)

for (const [label, block] of [
  ['approval', approval],
  ['claim', claim],
  ['cutover', cutover],
  ['legacy verifier', verifier],
  ['legacy gate hold', legacyGateHold],
  ['session fence', sessionFence],
  ['gate tombstone fence', gateFence],
  ['active lecture ownership fence', lectureFence],
]) {
  assert.ok(block, `missing Phase 7.30E ${label} function`)
}

assert.match(
  approval,
  /target_mapping_evidence_digest[\s\S]*\^\[0-9a-f\]\{64\}\$/,
)
assert.match(
  approval,
  /from private\.admin_principals[\s\S]*from private\.admin_environment_memberships[\s\S]*from private\.admin_environments[\s\S]*from public\.admin_sessions[\s\S]*from public\.lecture_sessions/,
  'approval rechecks the reviewed environment, identity and lecture instead of inferring an owner',
)
assert.match(
  approval,
  /expected_lecture_status[\s\S]*expected_lifecycle_version/,
)
assert.match(
  approval,
  /insert into private\.admin_lecture_ownership_claim_approvals/,
)
assert.match(
  approval,
  /if found then[\s\S]*'replayed', true[\s\S]*admin_identity_cutover_receipts[\s\S]*cutover already committed/,
  'approval preserves exact replay but rejects new evidence after cutover',
)

assert.match(
  claim,
  /from private\.admin_lecture_ownership_claim_receipts[\s\S]*if found then[\s\S]*from private\.admin_lecture_ownership_claim_approvals/,
  'claim resolves an exact replay before consuming reviewed approval evidence',
)
assert.match(claim, /expected_lecture_status[\s\S]*expected_lifecycle_version/)
assert.match(
  claim,
  /insert into private\.admin_lecture_ownerships[\s\S]*operator_claim/,
)
assert.match(
  claim,
  /insert into private\.admin_lecture_ownership_claim_receipts/,
)
assert.match(
  claim,
  /if found then[\s\S]*'replayed', true[\s\S]*admin_identity_cutover_receipts[\s\S]*cutover already committed/,
  'claim preserves exact replay but rejects new authority after cutover',
)
const claimDiscovery = claim.indexOf(
  'from private.admin_lecture_ownership_claim_approvals as approval',
)
const claimReplay = claim.indexOf(
  'from private.admin_lecture_ownership_claim_receipts as receipt',
  claimDiscovery,
)
const claimApprovalLock = claim.indexOf(
  'from private.admin_lecture_ownership_claim_approvals as approval',
  claimReplay,
)
const claimDescendantLock = claim.indexOf('lock table', claimApprovalLock)
const claimPrincipalLock = claim.indexOf(
  'from private.admin_principals as principal',
  claimDescendantLock,
)
assert.ok(
  claimDiscovery >= 0 &&
    claimDiscovery < claimReplay &&
    claimReplay < claimApprovalLock &&
    claimApprovalLock < claimDescendantLock &&
    claimDescendantLock < claimPrincipalLock,
  'claim discovers its environment, resolves replay, locks approval and descendant tables, then starts the canonical identity row locks',
)
assert.doesNotMatch(
  claim,
  /created_by|created_user|owner_email|auth_user_id\s*=/i,
  'claim may not infer historical ownership from incidental lecture metadata',
)

assert.match(cutover, /transaction_isolation[\s\S]*serializable/i)
assert.match(
  cutover,
  /target_deployment_evidence_digest[\s\S]*\^\[0-9a-f\]\{64\}\$/,
)
assert.match(
  cutover,
  /serialize_admin_ai_scope_v1[\s\S]*serialize_admin_ai_request_v1[\s\S]*admin_identity_cutover_receipts[\s\S]*'replayed', true/,
  'cutover serializes its environment and request and supports exact replay',
)
assert.match(cutover, /lock table[\s\S]*nowait/i)
assert.match(
  cutover,
  /google_session_issue_enabled[\s\S]*google_operational_authorization_enabled[\s\S]*google_admin_ledger_enabled/,
)
assert.match(cutover, /role = 'owner'[\s\S]*(?:>= 2|< 2)/)
assert.match(
  cutover,
  /lecture_sessions[\s\S]*status in \('draft', 'open'\)[\s\S]*admin_lecture_ownerships/,
)
assert.match(
  cutover,
  /legacy_pin_login_enabled\s*=\s*false[\s\S]*authentication_method = 'legacy_pin'[\s\S]*revoked_at/,
)
assert.match(
  cutover,
  /lecture_ai_master_authorizations[\s\S]*ai_billing_grants[\s\S]*ai_usage_ledger[\s\S]*lecture_summary_runs[\s\S]*academic_answer_requests[\s\S]*lecture_pdf_publications/,
  'cutover audits every authority descendant before committing the tombstone',
)
assert.match(
  cutover,
  /revoke execute on function public\.verify_and_touch_admin_session\(uuid, text, text\) from service_role/,
)
assert.match(cutover, /insert into private\.admin_identity_cutover_receipts/)
assert.match(cutover, /deployment_evidence_digest/)

assert.match(
  verifier,
  /hold_legacy_admin_session_gate_v1\(\) is not true[\s\S]*return null/,
  'the old verifier fails closed after the database tombstone',
)
assert.match(
  legacyGateHold,
  /from private\.admin_identity_runtime_gate[\s\S]*for share[\s\S]*admin_identity_cutover_receipts/,
  'legacy verification holds the identity gate against the cutover transaction',
)
assert.match(sessionFence, /authentication_method[\s\S]*legacy_pin/)
assert.match(
  sessionFence,
  /old\.revoked_at is null[\s\S]*new\.revoked_at is not null[\s\S]*to_jsonb\(new\)[\s\S]*to_jsonb\(old\)[\s\S]*Legacy Admin session authority is fenced/,
  'a legacy session permits only one monotonic terminal revocation',
)
assert.match(gateFence, /legacy_pin_login_enabled[\s\S]*false/)
assert.match(lectureFence, /status[\s\S]*'draft'[\s\S]*'open'/)
assert.match(lectureFence, /admin_lecture_ownerships/)
assert.match(
  migration,
  /create constraint trigger[\s\S]*deferrable initially deferred[\s\S]*enforce_active_admin_lecture_ownership_v1/i,
)

for (const [name, catalogSignature] of [
  [
    'private.approve_google_admin_lecture_ownership_claim_v1',
    'private.approve_google_admin_lecture_ownership_claim_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone)',
  ],
  [
    'private.claim_approved_google_admin_lecture_ownership_v1',
    'private.claim_approved_google_admin_lecture_ownership_v1(uuid,uuid)',
  ],
  [
    'private.commit_google_only_admin_cutover_v1',
    'private.commit_google_only_admin_cutover_v1(uuid,uuid,text,text,text)',
  ],
]) {
  assert.match(
    migration,
    new RegExp(
      `revoke all on function ${name.replaceAll('.', '\\.')}` +
        `\\([\\s\\S]*?\\) from public, anon, authenticated, service_role`,
    ),
  )
  assert.doesNotMatch(
    migration,
    new RegExp(
      `grant execute on function ${name.replaceAll('.', '\\.')}` +
        `\\([\\s\\S]*?to service_role`,
    ),
    `${name} must remain operator-only`,
  )
  assert.ok(
    pgTap.includes(catalogSignature),
    `pgTAP inventories ${catalogSignature}`,
  )
}

const beforeAuthorityFunctions = migration.slice(
  0,
  migration.indexOf(
    'create function private.approve_google_admin_lecture_ownership_claim_v1',
  ),
)
assert.doesNotMatch(
  beforeAuthorityFunctions,
  /update private\.admin_identity_runtime_gate[\s\S]*legacy_pin_login_enabled\s*=\s*false/,
  'migration application alone must not activate the cutover',
)
assert.doesNotMatch(
  beforeAuthorityFunctions,
  /insert into private\.admin_identity_cutover_receipts/,
  'migration application alone must not fabricate a cutover receipt',
)

assert.equal(
  packageJson.scripts['test:phase7-30e-static'],
  'node scripts/test-phase7-30e-static.mjs',
)
assert.equal(
  packageJson.scripts['test:phase7-30e-concurrency'],
  'node scripts/test-phase7-30e-concurrency.mjs',
)
assert.equal(
  (concurrency.match(/'owner', 'active', true/g) ?? []).length,
  2,
  'Phase E concurrency fixture Owners must retain complete AI capability',
)
assert.doesNotMatch(concurrency, /'owner', 'active', false/)
assert.match(ci, /run: npm run test:phase7-30e-concurrency/)
assert.match(
  ci,
  /local-supabase:[\s\S]*?- run: npm ci[\s\S]*?- name: Install Chromium and WebKit[\s\S]*?run: npx playwright install --with-deps chromium webkit[\s\S]*?- name: Start isolated local Supabase/,
  'the Local job must install browsers before Docker-backed Supabase consumes runner resources',
)
assert.match(nonlive, /'test:phase7-30e-static'/)
assert.match(
  localGoogleFixture,
  /delete from auth\.identities[\s\S]*provider <> 'google'/,
  'the local AAL2 fixture must expose one Google identity to strict operational verification',
)
assert.match(
  localLifecycleBrowser,
  /#teacher-workspace-setup-tab'\)\.click\(\)[\s\S]*const adminQr = admin\.page[\s\S]*await expect\(adminQr\.locator\('img'\)\)\.toBeVisible\(\)[\s\S]*decodeQrImage\(admin\.page, '\.lecture-join-qr img'\)[\s\S]*#teacher-workspace-ai-tab'\)\.click\(\)/,
  'the lifecycle must return to setup for the join QR before entering the optional AI stage',
)
assert.match(
  localLifecycleBrowser,
  /みんなに共有[\s\S]*#teacher-workspace-participation-tab[\s\S]*adminComment[\s\S]*displayComment[\s\S]*非表示にする[\s\S]*comment\)\.toHaveCount\(0[\s\S]*displayComment\)\.toHaveCount\(0[\s\S]*表示に戻す[\s\S]*comment\)\.toContainText\('CI学生'[\s\S]*displayComment\)\.toBeVisible/,
  'the live lifecycle must prove student comment delivery, teacher moderation, and Student/Display restoration through UI controls',
)
assert.match(
  adminPage,
  /lecturesLoaded[\s\S]*?requestedAdminLectureSessionId[\s\S]*?activeAdminLecture\.status === 'closed'[\s\S]*?clearSelectedLectureSession\(\)/,
  'a restored closed lecture must be cleared before the next preparation flow',
)
assert.match(
  adminPage,
  /initialRestoredLectureSessionIdRef = useRef\([\s\S]*?runtimeMode === 'live'[\s\S]*?restoredActiveLectureSessionId[\s\S]*?refreshLectures\([\s\S]*?adminToken,[\s\S]*?Boolean\(initialRestoredLectureSessionIdRef\.current\)/,
  'the initial list must include history only when resolving a restored live lecture so an older open lecture is not cleared as missing',
)
assert.doesNotMatch(
  adminPageViewModel,
  /終了した講義です。履歴を確認するか、次の講義を準備できます。/,
  'the preparation workspace must not retain the closed-lecture explanation',
)
assert.match(
  adminPageViewModel,
  /filter\(\(lecture\) => lecture\.status !== 'closed'\)/,
  'closed lectures must stay out of the default preparation list',
)
const duplicateLectureBlock = adminPage.slice(
  adminPage.indexOf('async function duplicateLecture'),
  adminPage.indexOf('async function handleCreatePoll'),
)
assert.match(duplicateLectureBlock, /selectAdminLecture\(duplicatedLecture\)/)
assert.doesNotMatch(duplicateLectureBlock, /action: 'start'/)
assert.match(
  adminLectureControl,
  /lecture\.status !== 'closed'[\s\S]*?onSelect\(lecture\)/,
  'closed history rows must not become mutable preparation targets',
)
assert.match(
  browserPdfPublication,
  /lectureStatus: 'closed'[\s\S]*?講義を準備する[\s\S]*?input\[type="file"\][\s\S]*?toBeEnabled\(\)[\s\S]*?講義を作成して資料を公開する[\s\S]*?toBeEnabled\(\)/,
  'browser coverage must prove that a restored closed lecture cannot block the next PDF',
)
assert.match(
  localLifecycleBrowser,
  /popupSession = await issuedDisplaySession[\s\S]*installClipboardCapture\(admin\.page\)[\s\S]*isolatedDisplaySessionResponse = admin\.page\.waitForResponse[\s\S]*issue-display-session[\s\S]*getByRole\('button', \{ name: '別ブラウザ用リンクをコピー' \}\)[\s\S]*\.click\(\)[\s\S]*await expect\([\s\S]*getByRole\('button', \{ name: 'リンクをコピーしました' \}\)[\s\S]*\)\.toBeVisible\(\)[\s\S]*const isolatedDisplayUrl = await copiedDisplayUrl\(admin\.page\)/,
  'the isolated lifecycle Display page must wait for a separately issued one-use URL to finish copying',
)
assert.match(
  localLifecycleBrowser,
  /issuedIsolatedSession\.lectureSessionId[\s\S]*popupSession\.lectureSessionId[\s\S]*issuedIsolatedSession\.displayToken\)\.not\.toBe\([\s\S]*popupSession\.displayToken[\s\S]*isolatedDisplayUrl\)\.toContain\([\s\S]*encodeURIComponent\(issuedIsolatedSession\.displayToken\)[\s\S]*isolatedDisplayPage\.goto\(isolatedDisplayUrl\)/,
  'the isolated lifecycle Display page must claim a separately issued one-use URL instead of replaying the popup token',
)
assert.match(
  localLifecycleBrowser,
  /settingsPopupPromise = admin\.page\.waitForEvent\('popup'\)[\s\S]*getByRole\('link', \{ name: '教員管理' \}\)\.click\(\)[\s\S]*settingsPage = await settingsPopupPromise[\s\S]*getByRole\('heading', \{ name: '教員一覧' \}\)[\s\S]*locator\('\.admin-ledger-session'\)[\s\S]*filter\(\{ hasText: '現在のセッション' \}\)[\s\S]*locator\('\.admin-identity-card'\)[\s\S]*toHaveCount\(0\)/,
  'the lifecycle must inherit the ready Admin session into the separate settings page without another identity challenge',
)
assert.match(
  localLifecycleBrowser,
  /pageCountBeforeWorkspaceReturn = adminContext\.pages\(\)\.length[\s\S]*getByRole\('link', \{ name: '講義コントロール', exact: true \}\)[\s\S]*\.click\(\)[\s\S]*admin\.page\.locator\('\.admin-workflow'\)[\s\S]*adminContext\.pages\(\)[\s\S]*toHaveLength\(pageCountBeforeWorkspaceReturn\)/,
  'the settings surface must return to the named lecture workspace instead of creating another TOTP-bound tab',
)
assert.match(
  browserRunner,
  /VITE_PHASE7_28_DISPLAY_REALTIME:[\s\S]*mode === 'local' \|\|[\s\S]*mode === 'local-jc'[\s\S]*\? 'true'[\s\S]*: 'false'/,
  'the local lifecycle harness must expose the separately issued Display URL while production remains default-off',
)
assert.match(
  browserRunner,
  /const localFixtureEnvironmentId = localMode[\s\S]*00000000-0000-4000-8000-000000000730[\s\S]*TEST_ADMIN_ENVIRONMENT_ID: localFixtureEnvironmentId[\s\S]*TEST_GOOGLE_ADMIN_FIXTURE_RESET_RETAINED_MEMBERSHIPS:[\s\S]*googleAdminFixtureHandles\.length === 0 \? 'true' : 'false'[\s\S]*retainEnvironment: true/,
  'local browser runs must share the create-only Edge environment and reset retained memberships exactly once before each Playwright run',
)
assert.match(
  localGoogleFixture,
  /browserFixtureResetRetainedMemberships[\s\S]*role = 'instructor'[\s\S]*can_use_ai = false[\s\S]*id <> \$\{sqlLiteral\(completed\.session\.membershipId\)\}[\s\S]*activeAiMemberships[\s\S]*activeOwners[\s\S]*activePriorSessions[\s\S]*assert\.equal\(Number\(resetState\.activeAiMemberships\), 1\)[\s\S]*assert\.equal\(Number\(resetState\.activeOwners\), 1\)[\s\S]*assert\.equal\(Number\(resetState\.activePriorSessions\), 0\)/,
  'the first retained fixture must deprivilege stale memberships while preserving exactly one active AI Owner and no stale active session',
)
assert.match(
  adminIdentityBrowser,
  /\/auth\/v1\/factors\/\$\{factorId\}\/challenge[\s\S]*\/auth\/v1\/factors\/\$\{factorId\}\/verify/,
  'the identity demo must exercise the Supabase TOTP challenge and verification endpoints',
)
assert.match(
  adminIdentityBrowser,
  /action === 'completeStepUp'[\s\S]*appSessionToken[\s\S]*\.admin-workflow[\s\S]*getByRole\('button', \{ name: 'ログアウト', exact: true \}\)/,
  'the identity demo must prove that Google plus TOTP enters the operational Admin workspace',
)
assert.match(
  adminIdentityBrowser,
  /\/functions\/v1\/manage-lectures[\s\S]*appSessionToken[\s\S]*authorization: `Bearer \$\{aal2AccessToken\}`/,
  'the identity demo must pin the Google AAL2 bearer and application-session body used by the workspace',
)
assert.match(
  adminIdentityBrowser,
  /\/functions\/v1\/manage-admin-ledger[\s\S]*action === 'snapshot'[\s\S]*action === 'audit'[\s\S]*not\.toHaveProperty\('adminToken'\)/,
  'the owner workspace must load safe ledger surfaces without the retired Admin credential field',
)
assert.match(
  adminIdentityBrowser,
  /settingsPopupPromise = page\.waitForEvent\('popup'\)[\s\S]*settingsLink\.click\(\)[\s\S]*settingsPage = await settingsPopupPromise[\s\S]*settingsPage\.locator\('\.admin-identity-card'\)[\s\S]*toHaveCount\(0\)/,
  'the identity demo must prove the separate settings surface inherits the ready app session without another TOTP challenge',
)
assert.match(
  adminIdentityBrowser,
  /'stale-admin-app-session'[\s\S]*settingsReloadPromise = settingsPage\.waitForEvent\('load'\)[\s\S]*settingsLink\.click\(\)[\s\S]*await settingsReloadPromise[\s\S]*sessionStorage\.getItem\(adminAppSessionStorageKey\)[\s\S]*toBe\(appSessionToken\)/,
  'a reused settings surface must reload exactly when the handed-off app session changes',
)
assert.match(
  adminIdentityBrowser,
  /adminWorkspaceDocument = 'preserved'[\s\S]*getByRole\('link', \{ name: '講義コントロール', exact: true \}\)[\s\S]*\.click\(\)[\s\S]*adminWorkspaceDocument[\s\S]*toBe\('preserved'\)/,
  'returning with the same app session must focus the existing lecture document without reloading it',
)
assert.match(
  adminIdentityBrowser,
  /const context = page\.context\(\)[\s\S]*context\.route\('https:\/\/example\.supabase\.co\/\*\*'/,
  'the identity demo must mock Admin Auth and Edge requests for both the lecture page and its settings popup',
)
assert.match(
  adminIdentityBrowser,
  /settingsPage[\s\S]*getByRole\('button', \{ name: 'ログアウト', exact: true \}\)[\s\S]*\.click\(\)[\s\S]*card\.locator\('\.eyebrow'\)[\s\S]*toHaveText\('EDUCATOR PORTAL'\)/,
  'logging out from the settings surface must immediately clear the lecture workspace',
)
assert.match(
  adminRoute,
  /EDUCATOR PORTAL[\s\S]*教員ポータル[\s\S]*登録済みの教員アカウントでCOMPASS Interactiveにアクセスします。[\s\S]*セキュリティ保護のため、2段階認証が必要です。[\s\S]*Googleで続ける/,
  'the signed-out educator portal must keep the concise approved login copy',
)
assert.match(
  adminRoute,
  /TWO-STEP VERIFICATION[\s\S]*<h1>2段階認証<\/h1>[\s\S]*認証アプリに表示されている6桁のコードを入力してください。[\s\S]*<span>認証コード<\/span>[\s\S]*placeholder="6桁のコード"[\s\S]*'続ける'/,
  'the TOTP surface must keep the approved two-step verification copy and input contract',
)
assert.doesNotMatch(
  adminIdentityBrowser,
  /card\.locator\('\.admin-identity-summary'\)/,
  'the Google-only identity demo must not expect the retired identity-only ready card',
)
assert.match(
  adminRoute,
  /restoreGoogleAdminSession\(appSessionToken\)[\s\S]*'aal2_required',[\s\S]*'app_session_invalid',[\s\S]*'identity_invalid',[\s\S]*\.includes\(error\.code\)[\s\S]*await adminSupabase\.auth[\s\S]*\.signOut\(\{ scope: 'local' \}\)[\s\S]*\.catch\(\(\) => undefined\)[\s\S]*clearGoogleAdminWorkspace\([\s\S]*appSessionToken[\s\S]*return/,
  'boot-time invalid Google identity state must sign out locally and clear the workspace',
)
assert.match(
  browserRunner,
  /configuredCountOption\('--retries', process\.env\.CI \? 1 : 0, 0\)[\s\S]*configuredCountOption\('--repeat-each', 1, 1\)/,
  'the local browser fixture count must match Playwright retry and repeat defaults',
)
assert.match(
  browserRunner,
  /const retryCount = configuredRetryCount\(\)[\s\S]*const repeatEachCount = configuredRepeatEachCount\(\)[\s\S]*repeatEachIndex < repeatEachCount[\s\S]*retry <= retryCount[\s\S]*projectFixtures\.push/,
  'local browser repeats and retries must receive independent Google Admin fixtures',
)
assert.match(
  browserRunner,
  /TEST_GOOGLE_ADMIN_BROWSER_RETRY_STRIDE: String\(retryCount \+ 1\)/,
  'the local browser helper must receive the retry stride used to flatten repeat attempts',
)
assert.match(
  browserGoogleFixture,
  /repeatEachIndex \* retryStride \+ test\.info\(\)\.retry[\s\S]*Array\.isArray\(configuredFixture\)[\s\S]*configuredFixture\[attemptIndex\]/,
  'each local browser attempt must select its repeat-and-retry-scoped Google Admin fixture',
)
assert.match(
  localGoogleFixture,
  /if \(browserFixtureAiPin\) \{[\s\S]*?const stalePinControl = await invoke\([\s\S]*?action: 'completeControlStepUp'[\s\S]*?409,[\s\S]*?stalePinControl\.code, 'step_up_invalid'[\s\S]*?await waitForNextTotpWindow\(\)[\s\S]*?authClient\.auth\.mfa\.challengeAndVerify\([\s\S]*?assert\.notEqual\(pinControlAal2, aal2\)[\s\S]*?browserAal2 = pinControlAal2[\s\S]*?accessToken: browserAal2/,
  'the local AI-PIN fixture must prove stale-bearer rejection and export a real post-challenge bearer',
)
assert.match(
  localGoogleFixture,
  /insert into private\.admin_ai_policies[\s\S]*?array\[[\s\S]*?'academic_answers',[\s\S]*?'captions',[\s\S]*?'material_analysis',[\s\S]*?'poll_suggestions',[\s\S]*?'summaries'[\s\S]*?\]::text\[\]/,
  'the local AI-PIN fixture policy must cover every action required by the current master scopes',
)
assert.match(
  localGoogleFixture,
  /if \(browserFixtureAiPin\) \{[\s\S]*?set google_ai_master_admission_enabled = true,[\s\S]*?google_ai_child_grant_enabled = true/,
  'the local AI-PIN fixture must enable both master admission and child-grant scheduling',
)
assert.equal(
  (
    localGoogleFixture.match(
      /set ai_unlock_enabled = false,[\s\S]*?google_ai_master_admission_enabled = false,[\s\S]*?google_ai_child_grant_enabled = false,[\s\S]*?remembered_browser_enabled = false/g,
    ) ?? []
  ).length,
  2,
  'both retained and disposable fixture cleanup paths must restore the child-grant gate to OFF',
)
assert.doesNotMatch(
  localGoogleFixture,
  /const pinControlAal2 = accessToken\(status,[\s\S]{0,160}?totpTimestamp: Math\.floor\(Date\.now\(\) \/ 1_000\)/,
  'the local AI-PIN fixture must not bypass control-step-up freshness with a synthetic AMR timestamp',
)
assert.match(
  browserSafety,
  /expectConsoleErrorOnce: \(expected: \{[\s\S]*message: string[\s\S]*url: string[\s\S]*\}\) => Promise<void>/,
  'browser safety must expose an exact, one-shot expected console-error contract',
)
assert.match(
  browserSafety,
  /locationUrl: message\.location\(\)\.url[\s\S]*message: `console: \$\{message\.text\(\)\}`/,
  'browser safety must retain the console source URL beside the exact message',
)
assert.match(
  browserSafety,
  /error\.message === expectedMessage[\s\S]*error\.locationUrl === expected\.url[\s\S]*matchingErrors\(\)\.length[\s\S]*\.toBe\(1\)[\s\S]*matchingIndexes[\s\S]*\.toHaveLength\(1\)[\s\S]*browserErrors\.splice/,
  'expected console errors must match one exact message and URL and consume only that entry',
)
assert.doesNotMatch(
  browserSafety,
  /401|Unauthorized|admin-identity-session/,
  'the shared browser monitor must not carry a global authentication-error allowlist',
)
assert.match(
  browserSafety,
  /page\.on\('pageerror'[\s\S]*message: `pageerror: \$\{error\.message\}`[\s\S]*externalRequests\.push\(requestUrl\.origin\)[\s\S]*route\.abort\('blockedbyclient'\)[\s\S]*new Set\(externalRequests\)[\s\S]*browserErrors\.map/,
  'one-shot console consumption must preserve page-error and external-host rejection',
)
const revokedDisplayBrowserPhaseStart = displayRealtimeBrowser.indexOf(
  '// The regression intentionally revokes the issuing Google Admin session.',
)
assert.ok(
  revokedDisplayBrowserPhaseStart >= 0,
  'the Display browser regression must retain its explicit revoke boundary',
)
const revokedDisplayBrowserPhase = displayRealtimeBrowser.slice(
  revokedDisplayBrowserPhaseStart,
)
assert.match(
  displayRealtimeBrowser,
  /await adminSafety\.assertClean\(\)[\s\S]*await adminPage\.close\(\)[\s\S]*set_display_realtime_runtime_v1[\s\S]*phase728b_e2e_revoke/,
  'the Display regression must stop the original clean Admin page before revoking its tracked session',
)
assert.match(
  revokedDisplayBrowserPhase,
  /adminContext\.newPage\(\)[\s\S]*installBrowserSafetyMonitor\(invalidAdminPage\)[\s\S]*installGoogleAdminSession\(invalidAdminPage, appSessionToken\)[\s\S]*invalidAdminPage\.waitForResponse[\s\S]*\/functions\/v1\/admin-identity-session[\s\S]*request\.method\(\) !== 'POST'[\s\S]*response\.status\(\) !== 401[\s\S]*request\.postDataJSON\(\)[\s\S]*body\.action === 'status'[\s\S]*await invalidAdminPage\.goto\('\/admin'\)[\s\S]*invalidSessionResponse\.json\(\)[\s\S]*code: 'app_session_invalid'[\s\S]*ok: false/,
  'the final Display phase must prove the exact fail-closed Admin status response on a fresh page in the same browser context',
)
assert.match(
  revokedDisplayBrowserPhase,
  /await invalidAdminSafety\.expectConsoleErrorOnce\(\{[\s\S]*Failed to load resource: the server responded with a status of 401 \(Unauthorized\)[\s\S]*url: invalidSessionResponse\.url\(\)[\s\S]*await displaySafety\.assertClean\(\)[\s\S]*await invalidAdminSafety\.assertClean\(\)/,
  'the Display regression may consume only the proven status 401 before its final safety checks',
)
assert.match(
  ci,
  /name: local-integration-evidence-\$\{\{ github\.run_attempt \}\}[\s\S]*test-results\/local\/[\s\S]*test-results\/reports\/local\//,
  'failed local integration evidence must retain both raw traces and the HTML report',
)
assert.match(
  ci,
  /name: demo-e2e-evidence-\$\{\{ github\.run_attempt \}\}[\s\S]*test-results\/demo\/[\s\S]*test-results\/reports\/demo\//,
  'failed demo integration evidence must retain both raw traces and the HTML report',
)
assert.match(
  ci,
  /ADMIN_AI_CHILD_GRANT_SECRET=compass-ci-only-admin-ai-child-grant-secret-at-least-32-bytes[\s\S]*ADMIN_AI_CHILD_GRANT_SECRET_VERSION=1/,
  'the local Edge fixture must configure deterministic Google AI child-grant signing before browser integration',
)
assert.match(
  localGoogleFixture,
  /disable trigger admin_google_operation_receipts_append_only[\s\S]*delete from private\.admin_google_operation_receipts[\s\S]*where environment_id =[\s\S]*enable trigger admin_google_operation_receipts_append_only[\s\S]*delete from public\.admin_sessions/,
  'the isolated local fixture must remove immutable operation receipts before deleting its Admin sessions',
)
assert.match(
  localEdgeContract,
  /action: 'revokeAll'[\s\S]*requestId: randomUUID\(\)/,
  'the Google-only local revokeAll contract must carry its mutation request ID',
)
assert.match(
  manageLectures,
  /data === null[\s\S]*GoogleAdminAppSessionInvalidError/,
  'the lecture facade must distinguish an invalid application session from an internal error',
)
assert.match(
  manageLectures,
  /error instanceof GoogleAdminAppSessionInvalidError[\s\S]*app_session_invalid[\s\S]*401/,
  'a revoked Google application session must fail with a structured 401 response',
)
assert.match(upgradeRunner, /upgrade through Phase 7\.30[EFG]/)
assert.match(
  c1HeadUpgradeProbe,
  /admin_identity_cutover_receipts[\s\S]*admin_lecture_ownership_claim_approvals[\s\S]*externalTransportAttestationRequired[\s\S]*issuedLegacyGrantCount/,
  'populated C1-head upgrade proves E remains dormant and preserves unresolved authority as HOLD',
)
assert.match(
  upgradeRunner,
  /20260812033000[\s\S]*phase7-30e-c2-head-upgrade-probe\.sql[\s\S]*'migration', 'up'[\s\S]*phase7-30e-c2-head-upgrade-probe-test\.sql/,
  'the populated C2-head Display probe is registered before the D-head probe',
)
assert.match(
  upgradeRunner,
  /20260812043000[\s\S]*phase7-30e-d-head-upgrade-probe\.sql[\s\S]*'migration', 'up'[\s\S]*phase7-30e-d-head-upgrade-probe-test\.sql/,
  'the populated D-head authority probe upgrades only across E authority',
)
assert.match(
  upgradeRunner,
  /finally[\s\S]*'db', 'reset'[\s\S]*'--local'[\s\S]*'--no-seed'/,
  'the populated upgrade runner always restores a clean current-head database',
)
assert.match(
  c2HeadUpgradeFixture,
  /insert into private\.admin_google_display_sessions[\s\S]*2026-01-01 00:00:00\+00[\s\S]*2026-01-01 00:05:00\+00/,
  'the C2-head fixture carries an expired exact Google Display root into E',
)
assert.match(
  c2HeadUpgradeProbe,
  /verify_google_display_terminal_session_v1[\s\S]*recognized[\s\S]*valid[\s\S]*different Display Auth user[\s\S]*has_function_privilege[\s\S]*has_table_privilege/,
  'the C2-head probe executes terminal claim, cross-UID rejection and ACL checks',
)
assert.match(
  dHeadUpgradeFixture,
  /insert into private\.admin_environment_memberships[\s\S]*insert into public\.admin_sessions[\s\S]*insert into private\.admin_lecture_ownerships[\s\S]*'google_create'[\s\S]*insert into private\.admin_invitations[\s\S]*insert into private\.admin_audit_events/,
  'the D-head fixture carries Google identity, ownership and ledger authority into E',
)
assert.match(
  dHeadUpgradeProbe,
  /ownership_source = 'google_create'[\s\S]*ownership_approval_id is null[\s\S]*admin_invitations[\s\S]*admin_audit_events[\s\S]*legacy_pin_login_enabled[\s\S]*admin_identity_cutover_receipts[\s\S]*authoritative'[\s\S]*false/,
  'the D-head probe preserves Google-create provenance and proves E remains dormant',
)

console.log('Phase 7.30E Google-only cutover static checks passed.')
