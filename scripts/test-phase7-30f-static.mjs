import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  PHASE730F_HOLD,
  PHASE730F_MAXIMUM_DECISION,
  evaluatePhase730FEvidence,
  parsePhase730FEvidence,
  validatePhase730FEvidence,
} from './phase7-30f-readiness.mjs'
import {
  isPhase730FEnvironmentAlias,
  isPhase730FIsoTimestamp,
  phase730FDatabaseGateNames,
  phase730FEnvironmentAliasPattern,
  phase730FFrontendFlagNames,
  phase730FIsoTimestampPattern,
  phase730FSecretInventoryNames,
  phase730FServerFlagNames,
  validatePhase730FReadinessMetadata,
} from './productionEnvironment.mjs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const clone = (value) => structuredClone(value)
const digest = (character) => character.repeat(64)
const regressionRecordNames = [
  'database',
  'edge',
  'browser',
  'ci',
  'load',
  'security',
  'accessibility',
  'rollback',
]
const operationalAdminEdges = [
  'analyze-lecture-material',
  'generate-academic-answer',
  'generate-lecture-summary',
  'issue-display-session',
  'issue-pdf-access-token',
  'issue-realtime-client-secret',
  'manage-admin-sessions',
  'manage-ai-control',
  'manage-comments',
  'manage-lecture-summaries',
  'manage-lectures',
  'manage-material-analysis',
  'manage-pdf-documents',
  'manage-pdf-publications',
  'manage-polls',
  'manage-presenter-connection',
  'operator-live-snapshot',
  'publish-caption-window',
  'update-display-state',
]

const schema = JSON.parse(
  read('docs/evidence/phase7-30f-readiness.schema.json'),
)
const fixtureSource = read('scripts/fixtures/phase7-30f-evidence.example.json')
const fixture = parsePhase730FEvidence(fixtureSource)
assert.equal(
  fixture.configuration.environment.sourceCommitSha,
  '0123456789abcdef0123456789abcdef01234567',
  'the tracked example must use a synthetic SHA rather than a release head',
)
const validatorSource = read('scripts/phase7-30f-readiness.mjs')
const supabaseConfig = read('supabase/config.toml')
const gitignore = read('.gitignore')

function assertStrictObjects(node, path = '$') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const types = Array.isArray(node.type) ? node.type : [node.type]
  if (types.includes('object')) {
    assert.equal(
      node.additionalProperties,
      false,
      `${path} must reject unknown keys`,
    )
  }
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    assertStrictObjects(child, `${path}.properties.${name}`)
  }
  for (const [name, child] of Object.entries(node.$defs ?? {})) {
    assertStrictObjects(child, `${path}.$defs.${name}`)
  }
  if (node.items) assertStrictObjects(node.items, `${path}.items`)
}

assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
assert.equal(schema.additionalProperties, false)
assertStrictObjects(schema)
assert.match(gitignore, /^\/\.phase7-30f-evidence\*\.json$/m)
assert.doesNotMatch(
  gitignore,
  /^phase7-30f-evidence\*\.json$/m,
  'the tracked synthetic fixture must not be hidden by a global ignore',
)

assert.deepEqual(Object.keys(schema.$defs.configuration.properties).sort(), [
  'databaseGates',
  'environment',
  'frontendFlags',
  'secretInventory',
  'serverFlags',
])
assert.deepEqual(Object.keys(schema.$defs.environment.properties).sort(), [
  'alias',
  'capturedAt',
  'environmentIdConfigured',
  'sourceCommitSha',
  'target',
])
assert.equal(
  schema.$defs.environment.properties.alias.pattern,
  phase730FEnvironmentAliasPattern,
)
assert.equal(schema.$defs.environment.properties.alias.maxLength, 40)
assert.equal(schema.$defs.dateTime.pattern, phase730FIsoTimestampPattern)
assert.equal(
  schema.$defs.nullableDateTime.pattern,
  phase730FIsoTimestampPattern,
)
assert.deepEqual(Object.keys(schema.$defs.databaseGates.properties).sort(), [
  'aiUnlockEnabled',
  'googleAdminLedgerEnabled',
  'googleAiMasterAdmissionEnabled',
  'googleOperationalAuthorizationEnabled',
  'googleSessionIssueEnabled',
  'legacyPinLoginEnabled',
  'operatorTotpFactorSetAdoptionEnabled',
  'rememberedBrowserEnabled',
  'totpFactorMutationEnabled',
])
assert.deepEqual(
  Object.keys(schema.$defs.frontendFlags.properties).sort(),
  [...phase730FFrontendFlagNames].sort(),
)
assert.deepEqual(
  Object.keys(schema.$defs.serverFlags.properties).sort(),
  [...phase730FServerFlagNames].sort(),
)
assert.deepEqual(
  Object.keys(schema.$defs.databaseGates.properties).sort(),
  [...phase730FDatabaseGateNames].sort(),
)
assert.deepEqual(
  fixture.configuration.secretInventory.captured
    ? fixture.configuration.secretInventory.entries
        .map(({ name }) => name)
        .sort()
    : [],
  [],
)
assert.deepEqual(
  validatePhase730FReadinessMetadata(fixture.configuration),
  [],
  'the tracked source-only evidence configuration must match the shared metadata contract',
)
assert.equal(phase730FSecretInventoryNames.length, 10)
assert.equal(
  schema.$defs.secretInventory.properties.entries.maxItems,
  phase730FSecretInventoryNames.length,
)
assert.deepEqual(
  [...schema.$defs.secretInventoryEntry.properties.name.enum].sort(),
  [...phase730FSecretInventoryNames].sort(),
)

const maximumSafeAlias = `staging-${'a'.repeat(32)}`
assert.equal(maximumSafeAlias.length, 40)
assert.equal(isPhase730FEnvironmentAlias(maximumSafeAlias), true)
const maximumAliasEvidence = clone(fixture)
maximumAliasEvidence.configuration.environment.alias = maximumSafeAlias
assert.deepEqual(validatePhase730FEvidence(maximumAliasEvidence), [])
assert.deepEqual(
  validatePhase730FReadinessMetadata(maximumAliasEvidence.configuration),
  [],
)
assert.equal(isPhase730FIsoTimestamp('2026-08-12T14:00:00.123Z'), true)
assert.equal(isPhase730FIsoTimestamp('2026-08-12T14:00:00.1Z'), false)
assert.equal(isPhase730FIsoTimestamp('2024-02-29T14:00:00Z'), true)
assert.equal(isPhase730FIsoTimestamp('2025-02-29T14:00:00Z'), false)
assert.equal(isPhase730FIsoTimestamp('2026-02-31T14:00:00Z'), false)

const invalidAliasEvidence = clone(fixture)
invalidAliasEvidence.configuration.environment.alias = 'abc'
assert.ok(
  validatePhase730FEvidence(invalidAliasEvidence).some(
    (error) => error.code === 'SCHEMA_PATTERN',
  ),
)
assert.match(
  validatePhase730FReadinessMetadata(invalidAliasEvidence.configuration).join(
    '\n',
  ),
  /alias must be a non-secret staging alias/,
)

const invalidFractionEvidence = clone(fixture)
invalidFractionEvidence.generatedAt = '2026-08-12T14:00:00.1Z'
assert.ok(
  validatePhase730FEvidence(invalidFractionEvidence).some(
    (error) => error.code === 'SCHEMA_PATTERN',
  ),
)

const invalidCalendarEvidence = clone(fixture)
invalidCalendarEvidence.generatedAt = '2026-02-31T14:00:00Z'
assert.ok(
  validatePhase730FEvidence(invalidCalendarEvidence).some(
    (error) => error.code === 'SCHEMA_DATETIME',
  ),
)

const ePreflightKeys = [
  'activeLegacyMasterCount',
  'activeLegacySessionCount',
  'activeOwnerCount',
  'authoritative',
  'cutoverCommitted',
  'environmentReady',
  'externalTransportAttestationRequired',
  'googleAdminLedgerEnabled',
  'googleOperationalAuthorizationEnabled',
  'googleSessionIssueEnabled',
  'issuedLegacyGrantCount',
  'pendingLegacyAcademicCount',
  'runningLegacySummaryCount',
  'runningLegacyUsageCount',
  'unboundPdfPublicationCount',
  'unownedActiveLectureCount',
]
const additionalSnapshotKeys = [
  'legacyPinLoginEnabled',
  'operatorTotpFactorSetAdoptionEnabled',
  'totpFactorMutationEnabled',
  'aiUnlockEnabled',
  'googleAiMasterAdmissionEnabled',
  'rememberedBrowserEnabled',
  'invalidActiveOwnershipCount',
  'cutoverReceiptCount',
  'cutoverReceiptEnvironmentMatches',
  'cutoverReceiptDeploymentEvidenceDigestMatches',
  'legacyVerifierServiceRoleExecute',
  'legacyBillingAcl',
  'triggers',
]
const snapshotProperties =
  schema.$defs.cutoverSnapshot.properties.snapshot.properties
assert.deepEqual(
  Object.keys(snapshotProperties).sort(),
  [...ePreflightKeys, ...additionalSnapshotKeys].sort(),
)
for (const key of ePreflightKeys) {
  assert.ok(snapshotProperties[key], `missing exact Phase 7.30E key ${key}`)
}
assert.deepEqual(Object.keys(schema.$defs.legacyBillingAcl.properties).sort(), [
  'privateConsumeAiBillingGrantAndStartOperations',
  'privateIssueAiBillingGrant',
  'publicAdminAuthorizeAiMaster',
  'publicAdminConsumeAiBillingGrant',
  'publicAdminIssueAiBillingGrant',
  'publicAdminIssueAiBillingGrantFromMaster',
])
assert.deepEqual(Object.keys(schema.$defs.triggerState.properties).sort(), [
  'activeLectureOwnershipFenceEnabled',
  'legacyGateTombstoneEnabled',
  'legacySessionFenceEnabled',
])

assert.doesNotMatch(
  validatorSource,
  /node:(?:http|https|net|tls|dgram|child_process|worker_threads)/,
  'validator must not import network, process-spawn or worker APIs',
)
assert.doesNotMatch(
  validatorSource,
  /\b(?:writeFile|appendFile|createWriteStream|mkdir|rm|unlink|rename|copyFile|fetch)\b/,
  'validator must remain read-only and offline',
)
assert.doesNotMatch(
  validatorSource,
  /(?:PRODUCTION_PASS|Production PASS)/,
  'validator must not expose a Production success state',
)
assert.match(validatorSource, /READY_FOR_SEPARATE_HOSTED_EXECUTION/)
assert.match(validatorSource, /productionAuthorized:\s*false/)
assert.match(validatorSource, /canaryAuthorized:\s*false/)

const sourceResult = evaluatePhase730FEvidence(fixture)
assert.equal(sourceResult.valid, true)
assert.equal(sourceResult.decision, PHASE730F_HOLD)
assert.equal(sourceResult.sourceReadiness, 'SOURCE_READY')
assert.equal(sourceResult.maximumDecision, PHASE730F_MAXIMUM_DECISION)
assert.equal(sourceResult.productionAuthorized, false)
assert.equal(sourceResult.canaryAuthorized, false)
assert.ok(sourceResult.holdReasons.includes('HOSTED_MODE_REQUIRED'))
assert.ok(sourceResult.holdReasons.includes('HUMAN_EVIDENCE_NOT_OBSERVED'))

const rootWithUnknownKey = clone(fixture)
rootWithUnknownKey.unreviewedOverride = true
assert.ok(
  validatePhase730FEvidence(rootWithUnknownKey).some(
    (error) => error.code === 'SCHEMA_UNKNOWN_KEY',
  ),
  'unknown root keys must fail closed',
)

const nestedWithUnknownKey = clone(fixture)
nestedWithUnknownKey.configuration.environment.url = 'staging'
assert.ok(
  validatePhase730FEvidence(nestedWithUnknownKey).some(
    (error) => error.code === 'SCHEMA_UNKNOWN_KEY',
  ),
  'unknown nested keys must fail closed',
)

const forbiddenKey = clone(fixture)
forbiddenKey.configuration.environment.accessToken = 'not-recorded'
assert.ok(
  validatePhase730FEvidence(forbiddenKey).some(
    (error) => error.code === 'FORBIDDEN_SENSITIVE_KEY',
  ),
  'secret-bearing keys must be rejected before reporting values',
)

const forbiddenValue = clone(fixture)
forbiddenValue.configuration.environment.alias =
  'Bearer eyJaaaaaaaa.eyJbbbbbbbb.cccccccccc'
assert.ok(
  validatePhase730FEvidence(forbiddenValue).some(
    (error) => error.code === 'FORBIDDEN_SECRET_VALUE',
  ),
  'secret-shaped values must be rejected',
)

assert.throws(
  () => parsePhase730FEvidence('{"a":1,"a":2}'),
  /duplicate-free JSON/,
)
assert.throws(() => parsePhase730FEvidence('{'), /duplicate-free JSON/)

const contradictoryResult = clone(fixture)
contradictoryResult.humanEvidence.aal1ToAal2.status = 'PASS'
assert.ok(
  validatePhase730FEvidence(contradictoryResult).some(
    (error) => error.code === 'CONTRADICTORY_RESULT_TIME',
  ),
)

const claimedSourceExecution = clone(fixture)
claimedSourceExecution.configuration.environment.environmentIdConfigured = true
claimedSourceExecution.configuration.environment.capturedAt =
  '2026-08-12T14:00:00Z'
assert.ok(
  validatePhase730FEvidence(claimedSourceExecution).some(
    (error) => error.code === 'SOURCE_EXAMPLE_EXECUTED',
  ),
  'tracked source example cannot claim Hosted execution',
)

const configuredFunctions = [
  ...supabaseConfig.matchAll(
    /\[functions\.([^\]]+)\]\r?\nverify_jwt = (true|false)/g,
  ),
].map((match) => ({
  name: match[1],
  version: 1,
  verifyJwt: match[2] === 'true',
}))
const configuredOperationalAdminEdges = configuredFunctions.filter(({ name }) =>
  operationalAdminEdges.includes(name),
)
assert.equal(configuredFunctions.length, 31)
assert.equal(configuredOperationalAdminEdges.length, 19)
assert.equal(
  new Set(configuredOperationalAdminEdges.map(({ name }) => name)).size,
  operationalAdminEdges.length,
)
assert.ok(
  configuredOperationalAdminEdges.every(
    ({ name, verifyJwt }) => operationalAdminEdges.includes(name) && verifyJwt,
  ),
)
assert.ok(
  configuredOperationalAdminEdges.every(
    ({ name }) => !['verify-admin-pin', 'authorize-ai-start'].includes(name),
  ),
)

const preSnapshot = {
  activeLegacyMasterCount: 0,
  activeLegacySessionCount: 0,
  activeOwnerCount: 2,
  authoritative: false,
  cutoverCommitted: false,
  environmentReady: true,
  externalTransportAttestationRequired: true,
  googleAdminLedgerEnabled: true,
  googleOperationalAuthorizationEnabled: true,
  googleSessionIssueEnabled: true,
  operatorTotpFactorSetAdoptionEnabled: true,
  totpFactorMutationEnabled: true,
  aiUnlockEnabled: true,
  googleAiMasterAdmissionEnabled: true,
  rememberedBrowserEnabled: true,
  issuedLegacyGrantCount: 0,
  pendingLegacyAcademicCount: 0,
  runningLegacySummaryCount: 0,
  runningLegacyUsageCount: 0,
  unboundPdfPublicationCount: 0,
  unownedActiveLectureCount: 0,
  legacyPinLoginEnabled: true,
  invalidActiveOwnershipCount: 0,
  cutoverReceiptCount: 0,
  cutoverReceiptEnvironmentMatches: null,
  cutoverReceiptDeploymentEvidenceDigestMatches: null,
  legacyVerifierServiceRoleExecute: true,
  legacyBillingAcl: Object.fromEntries(
    Object.keys(schema.$defs.legacyBillingAcl.properties).map((name) => [
      name,
      {
        serviceRoleExecute: true,
        publicExecute: false,
        anonExecute: false,
        authenticatedExecute: false,
      },
    ]),
  ),
  triggers: {
    legacyGateTombstoneEnabled: true,
    legacySessionFenceEnabled: true,
    activeLectureOwnershipFenceEnabled: true,
  },
}
const postSnapshot = clone(preSnapshot)
postSnapshot.cutoverCommitted = true
postSnapshot.legacyPinLoginEnabled = false
postSnapshot.cutoverReceiptCount = 1
postSnapshot.cutoverReceiptEnvironmentMatches = true
postSnapshot.cutoverReceiptDeploymentEvidenceDigestMatches = true
postSnapshot.legacyVerifierServiceRoleExecute = false
for (const name of Object.keys(postSnapshot.legacyBillingAcl)) {
  postSnapshot.legacyBillingAcl[name].serviceRoleExecute = false
}

const complete = clone(fixture)
complete.evidenceMode = 'HOSTED_HUMAN_STAGING'
complete.generatedAt = '2026-08-12T14:08:00Z'
complete.configuration.environment.capturedAt = '2026-08-12T14:07:00Z'
complete.configuration.environment.environmentIdConfigured = true
complete.configuration.frontendFlags = Object.fromEntries(
  Object.keys(complete.configuration.frontendFlags).map((name) => [name, true]),
)
complete.configuration.serverFlags = Object.fromEntries(
  Object.keys(complete.configuration.serverFlags).map((name) => [name, true]),
)
complete.configuration.databaseGates = {
  legacyPinLoginEnabled: false,
  googleSessionIssueEnabled: true,
  operatorTotpFactorSetAdoptionEnabled: true,
  totpFactorMutationEnabled: true,
  googleOperationalAuthorizationEnabled: true,
  googleAdminLedgerEnabled: true,
  aiUnlockEnabled: true,
  googleAiMasterAdmissionEnabled: true,
  rememberedBrowserEnabled: true,
}
complete.configuration.secretInventory = {
  captured: true,
  capturedAt: '2026-08-12T14:05:00Z',
  entries: [
    'ADMIN_AI_BROWSER_CHALLENGE_SECRET',
    'ADMIN_AI_CHILD_GRANT_SECRET',
    'ADMIN_AI_NETWORK_PEPPER',
    'ADMIN_AI_PIN_PEPPER',
    'ADMIN_IDENTITY_PEPPER',
    'ADMIN_INVITATION_SECRET',
    'ADMIN_SESSION_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].map((name) => ({
    name,
    present: true,
    minimumBytesSatisfied: true,
    rotationVersion: 1,
    rotatedAt: '2026-08-01T00:00:00Z',
  })),
}
complete.configuration.secretInventory.entries.push(
  {
    name: 'ADMIN_PIN',
    present: false,
    minimumBytesSatisfied: null,
    rotationVersion: null,
    rotatedAt: null,
  },
  {
    name: 'BILLING_PIN',
    present: false,
    minimumBytesSatisfied: null,
    rotationVersion: null,
    rotatedAt: null,
  },
)
complete.preCutover = {
  captured: true,
  capturedAt: '2026-08-12T14:02:00Z',
  readOnlyTransaction: true,
  snapshotDigestSha256: digest('1'),
  snapshot: preSnapshot,
}
complete.postCutover = {
  captured: true,
  capturedAt: '2026-08-12T14:04:00Z',
  readOnlyTransaction: true,
  snapshotDigestSha256: digest('2'),
  snapshot: postSnapshot,
}
complete.hostedEvidence = {
  executed: true,
  executedAt: '2026-08-12T14:03:00Z',
  deploymentEvidenceDigestSha256: digest('3'),
  immutableRevisionSha256: digest('4'),
  sourceCommitMatches: true,
  retiredAdminFunctionsAbsent: true,
  legacyWireFieldsAbsent: true,
  callbackOriginAllowlistPass: true,
  oauthConsentPass: true,
  functionInventory: configuredOperationalAdminEdges,
}
for (const record of Object.values(complete.humanEvidence)) {
  record.status = 'PASS'
  record.performedAt = '2026-08-12T14:05:00Z'
  record.evidenceDigestSha256 = digest('5')
}
for (const name of regressionRecordNames) {
  const record = complete.regressionEvidence[name]
  record.status = 'PASS'
  record.performedAt = '2026-08-12T14:06:00Z'
  record.evidenceDigestSha256 = digest('6')
}
complete.regressionEvidence.advisors = {
  captured: true,
  capturedAt: '2026-08-12T14:06:00Z',
  evidenceDigestSha256: digest('7'),
  criticalFindings: 0,
  highFindings: 0,
}
complete.rollbackEvidence = {
  rehearsal: {
    status: 'PASS',
    performedAt: '2026-08-12T14:06:00Z',
    evidenceDigestSha256: digest('8'),
  },
  immutableGoogleOnlyRevision: digest('4'),
  sharedPinRestored: false,
  paidAdmissionDisabledDuringRecovery: true,
  freeStopAvailable: true,
  operatorOwnerRecoveryRehearsed: true,
}
for (const name of [
  'stagingHostedMutation',
  'oauthProviderConfiguration',
  'stagingHumanIdentityRun',
  'googleOnlyCutover',
  'adminPinSecretDeletion',
  'legacyBillingAuthorityRetirement',
  'billingPinSecretDeletion',
]) {
  complete.approvals[name] = {
    state: 'APPROVED',
    recordedAt: '2026-08-12T14:01:00Z',
    evidenceDigestSha256: digest('9'),
  }
}
complete.independentReview = {
  status: 'PASS',
  reviewedAt: '2026-08-12T14:07:00Z',
  evidenceDigestSha256: digest('a'),
  separateFromExecutor: true,
}

const completeResult = evaluatePhase730FEvidence(complete)
assert.deepEqual(completeResult.errors, [])
assert.deepEqual(completeResult.holdReasons, [])
assert.equal(completeResult.decision, PHASE730F_MAXIMUM_DECISION)
assert.equal(completeResult.productionAuthorized, false)
assert.equal(completeResult.canaryAuthorized, false)

const unreviewedSecretName = clone(complete)
unreviewedSecretName.configuration.secretInventory.entries.push({
  name: 'UNREVIEWED_EXTRA_SECRET',
  present: false,
  minimumBytesSatisfied: null,
  rotationVersion: null,
  rotatedAt: null,
})
const unreviewedSecretErrors = validatePhase730FEvidence(unreviewedSecretName)
assert.ok(
  unreviewedSecretErrors.some(
    (error) =>
      error.code === 'SCHEMA_ARRAY_LENGTH' || error.code === 'SCHEMA_ENUM',
  ),
)

const duplicatedSecretName = clone(complete)
duplicatedSecretName.configuration.secretInventory.entries.at(-1).name =
  'ADMIN_PIN'
assert.ok(
  validatePhase730FEvidence(duplicatedSecretName).some(
    (error) => error.code === 'SECRET_INVENTORY_SET_MISMATCH',
  ),
)

const mismatchedHostedTopology = clone(complete)
mismatchedHostedTopology.configuration.serverFlags.PHASE730_ADMIN_IDENTITY_ENABLED = false
assert.ok(
  validatePhase730FEvidence(mismatchedHostedTopology).some(
    (error) => error.code === 'HOSTED_GATE_TOPOLOGY_MISMATCH',
  ),
)

const oauthWithoutApproval = clone(complete)
oauthWithoutApproval.approvals.oauthProviderConfiguration = {
  state: 'HOLD',
  recordedAt: null,
  evidenceDigestSha256: null,
}
assert.ok(
  validatePhase730FEvidence(oauthWithoutApproval).some(
    (error) => error.code === 'OAUTH_CONFIGURATION_WITHOUT_APPROVAL',
  ),
)

const humanWithoutApproval = clone(complete)
humanWithoutApproval.approvals.stagingHumanIdentityRun = {
  state: 'HOLD',
  recordedAt: null,
  evidenceDigestSha256: null,
}
assert.ok(
  validatePhase730FEvidence(humanWithoutApproval).some(
    (error) => error.code === 'HUMAN_RUN_WITHOUT_APPROVAL',
  ),
)

const failedHumanScenario = clone(complete)
failedHumanScenario.humanEvidence.accountDisable.status = 'FAIL'
const failedHumanResult = evaluatePhase730FEvidence(failedHumanScenario)
assert.equal(failedHumanResult.valid, true)
assert.equal(failedHumanResult.decision, PHASE730F_HOLD)
assert.ok(failedHumanResult.holdReasons.includes('HUMAN_SCENARIOS_NOT_READY'))

const criticalFinding = clone(complete)
criticalFinding.regressionEvidence.advisors.criticalFindings = 1
const criticalFindingResult = evaluatePhase730FEvidence(criticalFinding)
assert.equal(criticalFindingResult.valid, true)
assert.equal(criticalFindingResult.decision, PHASE730F_HOLD)
assert.ok(
  criticalFindingResult.holdReasons.includes(
    'CRITICAL_HIGH_FINDINGS_NOT_CLEARED',
  ),
)

const canaryApproved = clone(complete)
canaryApproved.approvals.limitedIdentityCanary = {
  state: 'APPROVED',
  recordedAt: '2026-08-12T14:07:00Z',
  evidenceDigestSha256: digest('b'),
}
const canaryApprovedResult = evaluatePhase730FEvidence(canaryApproved)
assert.equal(canaryApprovedResult.valid, true)
assert.equal(canaryApprovedResult.decision, PHASE730F_HOLD)
assert.equal(canaryApprovedResult.canaryAuthorized, false)
assert.ok(canaryApprovedResult.holdReasons.includes('CANARY_MUST_REMAIN_HOLD'))

const contradictoryCutover = clone(complete)
contradictoryCutover.postCutover.snapshot.legacyPinLoginEnabled = true
assert.ok(
  validatePhase730FEvidence(contradictoryCutover).some(
    (error) => error.code === 'CONTRADICTORY_LEGACY_GATE',
  ),
)

const secretInventoryBeforePostCutover = clone(complete)
secretInventoryBeforePostCutover.configuration.secretInventory.capturedAt =
  '2026-08-12T14:03:00Z'
assert.ok(
  validatePhase730FEvidence(secretInventoryBeforePostCutover).some(
    (error) => error.code === 'SECRET_INVENTORY_PRECEDES_POST_CUTOVER',
  ),
  'secret-deletion evidence must not predate the post-cutover snapshot',
)

const validatorPath = fileURLToPath(
  new URL('./phase7-30f-readiness.mjs', import.meta.url),
)
const fixturePath = fileURLToPath(
  new URL('./fixtures/phase7-30f-evidence.example.json', import.meta.url),
)
const noEvidenceCli = spawnSync(process.execPath, [validatorPath, '--json'], {
  encoding: 'utf8',
})
assert.equal(noEvidenceCli.status, 0, noEvidenceCli.stderr)
assert.equal(JSON.parse(noEvidenceCli.stdout).decision, PHASE730F_HOLD)

const fixtureCli = spawnSync(
  process.execPath,
  [validatorPath, '--evidence', fixturePath, '--json'],
  { encoding: 'utf8' },
)
assert.equal(fixtureCli.status, 0, fixtureCli.stderr)
const fixtureCliResult = JSON.parse(fixtureCli.stdout)
assert.equal(fixtureCliResult.decision, PHASE730F_HOLD)
assert.equal(fixtureCliResult.sourceReadiness, 'SOURCE_READY')
assert.equal(fixtureCliResult.productionAuthorized, false)
assert.equal(fixtureCliResult.canaryAuthorized, false)
assert.ok(
  !fixtureCli.stdout.includes(
    fixture.configuration.environment.sourceCommitSha,
  ),
  'redacted CLI output must not echo the supplied source SHA',
)

const invalidArgumentsCli = spawnSync(
  process.execPath,
  [validatorPath, '--unknown', '--json'],
  { encoding: 'utf8' },
)
assert.equal(invalidArgumentsCli.status, 2)
assert.deepEqual(JSON.parse(invalidArgumentsCli.stdout).errors, [
  { code: 'INVALID_ARGUMENTS', path: '$' },
])

const missingEvidenceCli = spawnSync(
  process.execPath,
  [validatorPath, '--evidence', `${fixturePath}.missing`, '--json'],
  { encoding: 'utf8' },
)
assert.equal(missingEvidenceCli.status, 2)
assert.deepEqual(JSON.parse(missingEvidenceCli.stdout).errors, [
  { code: 'EVIDENCE_PARSE_FAILED', path: '$' },
])

const preflightSql = read('scripts/phase7-30f-hosted-readonly-preflight.sql')
const preflightMigration = read(
  'supabase/migrations/20260812142023_phase7_30f_source_readiness_preflight.sql',
)
const preflightPgTap = read(
  'supabase/tests/phase7_30f_source_readiness_preflight_test.sql',
)
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const populatedUpgradeProbe = read(
  'scripts/fixtures/phase7-30f-e-head-upgrade-probe-test.sql',
)
assert.match(preflightSql, /begin[\s\S]*transaction[\s\S]*read only/i)
assert.match(preflightSql, /rollback\s*;/i)
assert.match(preflightSql, /get_google_only_admin_cutover_preflight_v1/i)
assert.match(
  preflightSql,
  /1\s*\/\s*case[\s\S]*environmentKind[\s\S]*=\s*'staging'[\s\S]*else\s+0[\s\S]*staging_validated/i,
  'operator SQL must fail closed when the authoritative database environment is not staging',
)
for (const key of ePreflightKeys) {
  assert.ok(preflightSql.includes(key), `read-only SQL must emit ${key}`)
}
for (const pattern of [
  /legacyPinLoginEnabled/,
  /invalidActiveOwnershipCount/,
  /cutoverReceiptDeploymentEvidenceDigestMatches/,
  /legacyVerifierServiceRoleExecute/,
  /legacyGateTombstoneEnabled/,
  /legacySessionFenceEnabled/,
  /activeLectureOwnershipFenceEnabled/,
]) {
  assert.match(preflightSql, pattern)
}
assert.match(
  preflightMigration,
  /create function private\.get_phase7_30f_source_readiness_preflight_v1\([\s\S]*?language sql[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
)
assert.match(
  preflightMigration,
  /revoke all on function private\.get_phase7_30f_source_readiness_preflight_v1\(uuid\)[\s\S]*?from public, anon, authenticated, service_role/i,
)
assert.doesNotMatch(
  preflightMigration,
  /\b(?:insert\s+into|update\s+private\.|delete\s+from|grant\s+execute)\b/i,
  'the Phase 7.30F migration must remain observational and operator-only',
)
for (const key of Object.keys(schema.$defs.legacyBillingAcl.properties)) {
  assert.ok(preflightMigration.includes(`'${key}'`))
  assert.ok(preflightPgTap.includes(`'${key}'`))
}
assert.match(
  preflightPgTap,
  /SELECT no_plan\(\)[\s\S]*SELECT \* FROM finish\(\)[\s\S]*ROLLBACK;/i,
)
assert.match(
  upgradeRunner,
  /phase7-30e-d-head-upgrade-probe-test\.sql[\s\S]*phase7-30f-e-head-upgrade-probe-test\.sql/,
  'the populated D-to-E upgrade must run the F-specific probe before reset',
)
for (const pattern of [
  /get_phase7_30f_source_readiness_preflight_v1/,
  /activeOwnerCount/,
  /activeApprovedTotpPrincipalCount/,
  /activeGoogleSessionCount/,
  /legacyBillingCompatibilityRetired/,
  /legacyGateTombstoneEnabled/,
  /the populated Phase 7\.30F preflight call is observational/,
]) {
  assert.match(populatedUpgradeProbe, pattern)
}

process.stdout.write('Phase 7.30F readiness static contract: PASS\n')
