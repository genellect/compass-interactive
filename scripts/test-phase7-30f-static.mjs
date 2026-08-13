import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
const preCutoverHumanRecordNames = [
  'twoActiveOwners',
  'aiEnabledAdmin',
  'standardAdmin',
  'suspendedAdminDenied',
  'crossUserDenied',
  'crossLectureDenied',
  'crossEnvironmentDenied',
  'individualRevoke',
  'globalRevoke',
  'lastOwnerProtection',
  'googleCallbackOriginAllowlist',
  'oauthConsent',
  'aal1ToAal2',
  'ownerRecovery',
  'tokenRotation',
  'staleSessionDenied',
  'sessionContinuityNoIdlePrompt',
  'eightHourSessionCap',
  'backingAuthSessionDeletion',
  'totpFactorSetDrain',
  'accountDisable',
  'personalAiPinIntentOnly',
  'rememberedBrowserLifecycle',
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
const identityControlEdges = [
  'admin-ai-unlock',
  'admin-identity-session',
  'manage-admin-ledger',
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
const secretScanSource = read('scripts/ci/scan-secrets.mjs')

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
assert.match(
  secretScanSource,
  /const trackedFiles = execFileSync\('git', \['ls-files', '--cached', '-z'\]/,
  'tracked evidence rejection must inspect the Git index, including force-added ignored files',
)
assert.match(
  secretScanSource,
  /\(\?:\^\|\\\/\)\\\.phase7-30f-evidence\[\^\/\]\*\\\.json\$\/i/,
  'tracked evidence rejection must cover repository-root and nested dot-evidence JSON paths',
)
assert.match(
  secretScanSource,
  /const findings = trackedFiles[\s\S]*Forbidden tracked Phase 7\.30F operator evidence[\s\S]*for \(const relative of scannedFiles\)/,
  'tracked-path findings must be produced independently of content scanning',
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

const maximumSafeAlias = 'staging-identity-slot-z'
assert.equal(maximumSafeAlias.length, 23)
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

const projectRefShapedAlias = `staging-${'a'.repeat(20)}`
assert.equal(isPhase730FEnvironmentAlias(projectRefShapedAlias), false)
const projectRefAliasEvidence = clone(fixture)
projectRefAliasEvidence.configuration.environment.alias = projectRefShapedAlias
assert.ok(
  validatePhase730FEvidence(projectRefAliasEvidence).some(
    (error) => error.code === 'SCHEMA_PATTERN',
  ),
  'a Supabase project-ref-shaped staging alias must be rejected',
)
assert.equal(
  isPhase730FEnvironmentAlias('staging-xaaaaaaaaaaaaaaaaaaaa'),
  false,
)
assert.equal(isPhase730FEnvironmentAlias('staging-personal-name'), false)
assert.match(
  validatePhase730FReadinessMetadata(
    projectRefAliasEvidence.configuration,
  ).join('\n'),
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
  'activeAiEnabledInstructorCount',
  'activeStandardInstructorCount',
  'suspendedAdminCount',
  'suspendedInstructorCount',
  'activePersonalAiPinFactorCount',
  'activeAiEnabledInstructorPersonalAiPinFactorCount',
  'activeApprovedTotpPrincipalCount',
  'activeOwnerApprovedTotpCount',
  'activeAiEnabledInstructorApprovedTotpCount',
  'activeStandardInstructorApprovedTotpCount',
  'activeGoogleSessionCount',
  'unbackedGoogleSessionCount',
  'overCapGoogleSessionCount',
  'googleSessionIdleCapMismatchCount',
  'invalidGoogleSessionAuthorityCount',
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
assert.deepEqual(Object.keys(schema.$defs.functionAcl.properties).sort(), [
  'anonExecute',
  'authenticatedExecute',
  'functionExists',
  'publicExecute',
  'serviceRoleExecute',
])
assert.deepEqual(Object.keys(schema.$defs.triggerState.properties).sort(), [
  'activeLectureOwnershipFenceEnabled',
  'googleSessionAbsoluteIdleTriggerEnabled',
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
assert.equal(sourceResult.sourceReadiness, PHASE730F_HOLD)
assert.equal(sourceResult.maximumDecision, PHASE730F_MAXIMUM_DECISION)
assert.equal(sourceResult.productionAuthorized, false)
assert.equal(sourceResult.canaryAuthorized, false)
assert.ok(sourceResult.holdReasons.includes('HOSTED_MODE_REQUIRED'))
assert.ok(sourceResult.holdReasons.includes('HUMAN_EVIDENCE_NOT_OBSERVED'))
assert.ok(sourceResult.holdReasons.includes('SOURCE_EVIDENCE_NOT_READY'))

function markSourceReady(evidence) {
  const mergedECommitSha = '1111111111111111111111111111111111111111'
  const candidateCommitSha = evidence.configuration.environment.sourceCommitSha
  evidence.sourceEvidence.phase730eMergeCommitSha = mergedECommitSha
  evidence.sourceEvidence.phase730fBaseCommitSha = mergedECommitSha
  evidence.sourceEvidence.phase730ePostMergeCi = {
    status: 'PASS',
    performedAt: '2026-08-12T13:00:00Z',
    evidenceDigestSha256: digest('1'),
    observedCommitSha: mergedECommitSha,
  }
  evidence.sourceEvidence.phase730fBaseOnMergedE = {
    status: 'PASS',
    performedAt: '2026-08-12T13:01:00Z',
    evidenceDigestSha256: digest('2'),
    observedCommitSha: candidateCommitSha,
  }
  for (const record of Object.values(evidence.sourceEvidence.checks)) {
    record.status = 'PASS'
    record.performedAt = '2026-08-12T13:02:00Z'
    record.evidenceDigestSha256 = digest('3')
    record.observedCommitSha = candidateCommitSha
  }
  evidence.sourceEvidence.independentSourceReview = {
    status: 'PASS',
    reviewedAt: '2026-08-12T13:03:00Z',
    evidenceDigestSha256: digest('4'),
    observedCommitSha: candidateCommitSha,
    separateFromExecutor: true,
    criticalFindings: 0,
    highFindings: 0,
  }
}

const sourceReady = clone(fixture)
markSourceReady(sourceReady)
const sourceReadyResult = evaluatePhase730FEvidence(sourceReady)
assert.equal(sourceReadyResult.valid, true)
assert.equal(sourceReadyResult.sourceReadiness, 'SOURCE_READY')
assert.equal(sourceReadyResult.decision, PHASE730F_HOLD)
assert.ok(!sourceReadyResult.holdReasons.includes('SOURCE_EVIDENCE_NOT_READY'))

const sourceReviewEqualLatestCheck = clone(sourceReady)
sourceReviewEqualLatestCheck.sourceEvidence.independentSourceReview.reviewedAt =
  '2026-08-12T13:02:00Z'
assert.ok(
  validatePhase730FEvidence(sourceReviewEqualLatestCheck).some(
    (error) => error.code === 'SOURCE_REVIEW_PRECEDES_EVIDENCE',
  ),
  'independent source review must be strictly later than every covered source check',
)

const finalReviewBeforeSourceReview = clone(sourceReady)
finalReviewBeforeSourceReview.independentReview = {
  status: 'PASS',
  reviewedAt: '2026-08-12T13:02:30Z',
  evidenceDigestSha256: digest('5'),
  separateFromExecutor: true,
  criticalFindings: 0,
  highFindings: 0,
}
assert.ok(
  validatePhase730FEvidence(finalReviewBeforeSourceReview).some(
    (error) => error.code === 'REVIEW_PRECEDES_EVIDENCE',
  ),
  'final review must follow the independent source review and all source evidence',
)

const sourceCheckWrongCommit = clone(sourceReady)
sourceCheckWrongCommit.sourceEvidence.checks.build.observedCommitSha =
  '2222222222222222222222222222222222222222'
assert.ok(
  validatePhase730FEvidence(sourceCheckWrongCommit).some(
    (error) => error.code === 'SOURCE_RESULT_COMMIT_MISMATCH',
  ),
)

const sourceWrongBase = clone(sourceReady)
sourceWrongBase.sourceEvidence.phase730fBaseCommitSha =
  '2222222222222222222222222222222222222222'
assert.ok(
  validatePhase730FEvidence(sourceWrongBase).some(
    (error) => error.code === 'SOURCE_BASE_COMMIT_MISMATCH',
  ),
)

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
const configuredIdentityControlEdges = configuredFunctions.filter(({ name }) =>
  identityControlEdges.includes(name),
)
assert.equal(configuredFunctions.length, 31)
assert.equal(configuredOperationalAdminEdges.length, 19)
assert.equal(configuredIdentityControlEdges.length, 3)
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
  configuredIdentityControlEdges.every(
    ({ name, verifyJwt }) => identityControlEdges.includes(name) && verifyJwt,
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
  activeAiEnabledInstructorCount: 1,
  activeStandardInstructorCount: 1,
  suspendedAdminCount: 1,
  suspendedInstructorCount: 1,
  activePersonalAiPinFactorCount: 1,
  activeAiEnabledInstructorPersonalAiPinFactorCount: 1,
  activeApprovedTotpPrincipalCount: 4,
  activeOwnerApprovedTotpCount: 2,
  activeAiEnabledInstructorApprovedTotpCount: 1,
  activeStandardInstructorApprovedTotpCount: 1,
  activeGoogleSessionCount: 4,
  unbackedGoogleSessionCount: 0,
  overCapGoogleSessionCount: 0,
  googleSessionIdleCapMismatchCount: 0,
  invalidGoogleSessionAuthorityCount: 0,
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
        functionExists: true,
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
    googleSessionAbsoluteIdleTriggerEnabled: true,
  },
}
const postSnapshot = clone(preSnapshot)
postSnapshot.cutoverCommitted = true
postSnapshot.legacyPinLoginEnabled = false
postSnapshot.cutoverReceiptCount = 1
postSnapshot.cutoverReceiptEnvironmentMatches = true
postSnapshot.cutoverReceiptDeploymentEvidenceDigestMatches = true
postSnapshot.legacyVerifierServiceRoleExecute = false

const complete = clone(fixture)
markSourceReady(complete)
complete.evidenceMode = 'HOSTED_HUMAN_STAGING'
complete.generatedAt = '2026-08-12T14:20:00Z'
complete.configuration.environment.capturedAt = '2026-08-12T14:15:00Z'
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
  capturedAt: '2026-08-12T14:14:00Z',
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
    removedAt: null,
  })),
}
complete.configuration.secretInventory.entries.push(
  {
    name: 'ADMIN_PIN',
    present: false,
    minimumBytesSatisfied: null,
    rotationVersion: null,
    rotatedAt: null,
    removedAt: '2026-08-12T14:06:00Z',
  },
  {
    name: 'BILLING_PIN',
    present: false,
    minimumBytesSatisfied: null,
    rotationVersion: null,
    rotatedAt: null,
    removedAt: '2026-08-12T14:13:00Z',
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
  executedAt: '2026-08-12T14:01:00Z',
  deploymentEvidenceDigestSha256: digest('3'),
  immutableRevisionSha256: digest('4'),
  sourceCommitMatches: true,
  retiredAdminFunctionsAbsent: true,
  legacyWireFieldsAbsent: true,
  callbackOriginAllowlistPass: true,
  oauthConsentPass: true,
  operationalFunctionInventory: configuredOperationalAdminEdges,
  identityControlFunctionInventory: configuredIdentityControlEdges,
}
for (const record of Object.values(complete.humanEvidence)) {
  record.status = 'PASS'
  record.performedAt = '2026-08-12T14:07:00Z'
  record.evidenceDigestSha256 = digest('5')
}
for (const name of preCutoverHumanRecordNames) {
  complete.humanEvidence[name].performedAt = '2026-08-12T14:03:10Z'
}
complete.humanEvidence.personalAiPinEndToEnd.performedAt =
  '2026-08-12T14:07:00Z'
complete.billingRetirement = {
  captured: true,
  capturedAt: '2026-08-12T14:09:00Z',
  readOnlyTransaction: true,
  snapshotDigestSha256: digest('b'),
  snapshot: {
    legacyBillingAcl: Object.fromEntries(
      Object.keys(schema.$defs.legacyBillingAcl.properties).map((name) => [
        name,
        {
          functionExists: true,
          serviceRoleExecute: false,
          publicExecute: false,
          anonExecute: false,
          authenticatedExecute: false,
        },
      ]),
    ),
    personalAiPinEvidenceDigestMatches: true,
    safeStatusStopRevokeAccountingAvailable: true,
    historicalIntegrityPreserved: true,
  },
}
for (const name of regressionRecordNames) {
  const record = complete.regressionEvidence[name]
  record.status = 'PASS'
  record.performedAt = '2026-08-12T14:10:00Z'
  record.evidenceDigestSha256 = digest('6')
}
complete.regressionEvidence.advisors = {
  captured: true,
  capturedAt: '2026-08-12T14:10:00Z',
  evidenceDigestSha256: digest('7'),
  criticalFindings: 0,
  highFindings: 0,
}
complete.rollbackEvidence = {
  rehearsal: {
    status: 'PASS',
    performedAt: '2026-08-12T14:11:00Z',
    evidenceDigestSha256: digest('8'),
  },
  immutableGoogleOnlyRevision: digest('4'),
  sharedPinRestored: false,
  paidAdmissionDisabledDuringRecovery: true,
  freeStopAvailable: true,
  operatorOwnerRecoveryRehearsed: true,
}
const approvedActions = [
  'stagingHostedMutation',
  'oauthProviderConfiguration',
  'stagingHumanIdentityRun',
  'googleOnlyCutover',
  'adminPinSecretDeletion',
  'legacyBillingAuthorityRetirement',
  'billingPinSecretDeletion',
]
const approvalTimes = {
  stagingHostedMutation: '2026-08-12T13:59:00Z',
  oauthProviderConfiguration: '2026-08-12T13:59:10Z',
  stagingHumanIdentityRun: '2026-08-12T13:59:20Z',
  googleOnlyCutover: '2026-08-12T14:03:30Z',
  adminPinSecretDeletion: '2026-08-12T14:05:00Z',
  legacyBillingAuthorityRetirement: '2026-08-12T14:08:00Z',
  billingPinSecretDeletion: '2026-08-12T14:12:00Z',
}
const approvalDigestCharacters = ['9', 'a', 'b', 'c', 'd', 'e', 'f']
for (const [index, name] of approvedActions.entries()) {
  complete.approvals[name] = {
    state: 'APPROVED',
    recordedAt: approvalTimes[name],
    evidenceDigestSha256: digest(approvalDigestCharacters[index]),
  }
}
complete.independentReview = {
  status: 'PASS',
  reviewedAt: '2026-08-12T14:16:00Z',
  evidenceDigestSha256: digest('a'),
  separateFromExecutor: true,
  criticalFindings: 0,
  highFindings: 0,
}
assert.deepEqual(
  validatePhase730FReadinessMetadata({
    ...fixture.configuration,
    secretInventory: complete.configuration.secretInventory,
  }),
  [],
  'captured secret removal metadata must match the shared production-environment contract',
)

const completeResult = evaluatePhase730FEvidence(complete)
assert.deepEqual(completeResult.errors, [])
assert.deepEqual(completeResult.holdReasons, [])
assert.equal(completeResult.decision, PHASE730F_MAXIMUM_DECISION)
assert.equal(completeResult.productionAuthorized, false)
assert.equal(completeResult.canaryAuthorized, false)

const humanBeforeHosted = clone(complete)
humanBeforeHosted.humanEvidence.aal1ToAal2.performedAt = '2026-08-12T14:00:59Z'
assert.ok(
  validatePhase730FEvidence(humanBeforeHosted).some(
    (error) => error.code === 'HUMAN_EVIDENCE_NOT_AFTER_HOSTED',
  ),
)

const finalReviewEqualEnvironmentCapture = clone(complete)
finalReviewEqualEnvironmentCapture.independentReview.reviewedAt =
  finalReviewEqualEnvironmentCapture.configuration.environment.capturedAt
assert.ok(
  validatePhase730FEvidence(finalReviewEqualEnvironmentCapture).some(
    (error) => error.code === 'REVIEW_PRECEDES_EVIDENCE',
  ),
  'final review must be strictly later than the environment capture',
)

const finalReviewBeforeRejectedApproval = clone(complete)
finalReviewBeforeRejectedApproval.approvals.limitedIdentityCanary = {
  state: 'REJECTED',
  recordedAt: '2026-08-12T14:17:00Z',
  evidenceDigestSha256: digest('0'),
}
assert.ok(
  validatePhase730FEvidence(finalReviewBeforeRejectedApproval).some(
    (error) => error.code === 'REVIEW_PRECEDES_EVIDENCE',
  ),
  'final review must follow every non-HOLD approval, including a rejection',
)

for (const field of ['rotatedAt', 'removedAt']) {
  const secretMetadataAfterCapture = clone(complete)
  const entry =
    field === 'rotatedAt'
      ? secretMetadataAfterCapture.configuration.secretInventory.entries.find(
          ({ name }) => name === 'ADMIN_SESSION_SECRET',
        )
      : secretMetadataAfterCapture.configuration.secretInventory.entries.find(
          ({ name }) => name === 'BILLING_PIN',
        )
  entry[field] = '2026-08-12T14:14:30Z'
  assert.ok(
    validatePhase730FEvidence(secretMetadataAfterCapture).some(
      (error) => error.code === 'SECRET_METADATA_AFTER_INVENTORY_CAPTURE',
    ),
    field,
  )
}

const independentCriticalFinding = clone(complete)
independentCriticalFinding.independentReview.criticalFindings = 1
const independentCriticalFindingResult = evaluatePhase730FEvidence(
  independentCriticalFinding,
)
assert.equal(independentCriticalFindingResult.valid, true)
assert.ok(
  independentCriticalFindingResult.holdReasons.includes(
    'INDEPENDENT_REVIEW_NOT_READY',
  ),
)

const reusedSnapshotDigest = clone(complete)
reusedSnapshotDigest.billingRetirement.snapshotDigestSha256 =
  reusedSnapshotDigest.postCutover.snapshotDigestSha256
assert.ok(
  validatePhase730FEvidence(reusedSnapshotDigest).some(
    (error) => error.code === 'SNAPSHOT_DIGEST_REUSED',
  ),
)

const approvalDigestReused = clone(complete)
approvalDigestReused.approvals.billingPinSecretDeletion.evidenceDigestSha256 =
  approvalDigestReused.approvals.adminPinSecretDeletion.evidenceDigestSha256
assert.ok(
  validatePhase730FEvidence(approvalDigestReused).some(
    (error) => error.code === 'APPROVAL_DIGEST_REUSED',
  ),
  'each separately scoped approval requires a distinct evidence digest',
)

const hostedAfterPreCutover = clone(complete)
hostedAfterPreCutover.hostedEvidence.executedAt = '2026-08-12T14:04:30Z'
assert.ok(
  validatePhase730FEvidence(hostedAfterPreCutover).some(
    (error) => error.code === 'HOSTED_EVIDENCE_NOT_PRE_CUTOVER',
  ),
)

const hostedEqualPreCutover = clone(complete)
hostedEqualPreCutover.hostedEvidence.executedAt =
  hostedEqualPreCutover.preCutover.capturedAt
assert.ok(
  validatePhase730FEvidence(hostedEqualPreCutover).some(
    (error) => error.code === 'HOSTED_EVIDENCE_NOT_PRE_CUTOVER',
  ),
  'Hosted deployment evidence must be strictly earlier than the pre-cutover snapshot',
)

const humanAfterCutover = clone(complete)
humanAfterCutover.humanEvidence.aal1ToAal2.performedAt = '2026-08-12T14:04:30Z'
assert.ok(
  validatePhase730FEvidence(humanAfterCutover).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const adminDeletionApprovedBeforePost = clone(complete)
adminDeletionApprovedBeforePost.approvals.adminPinSecretDeletion.recordedAt =
  '2026-08-12T14:03:50Z'
assert.ok(
  validatePhase730FEvidence(adminDeletionApprovedBeforePost).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const cutoverApprovedBeforePreSnapshot = clone(complete)
cutoverApprovedBeforePreSnapshot.approvals.googleOnlyCutover.recordedAt =
  '2026-08-12T14:01:30Z'
assert.ok(
  validatePhase730FEvidence(cutoverApprovedBeforePreSnapshot).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const billingRetirementApprovedBeforePersonalPin = clone(complete)
billingRetirementApprovedBeforePersonalPin.approvals.legacyBillingAuthorityRetirement.recordedAt =
  '2026-08-12T14:06:30Z'
assert.ok(
  validatePhase730FEvidence(billingRetirementApprovedBeforePersonalPin).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const safeControlAfterBillingApproval = clone(complete)
safeControlAfterBillingApproval.humanEvidence.authorityDrainMatrix.performedAt =
  '2026-08-12T14:08:30Z'
assert.ok(
  validatePhase730FEvidence(safeControlAfterBillingApproval).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const billingRetirementApprovedBeforeLocalEvidence = clone(complete)
billingRetirementApprovedBeforeLocalEvidence.sourceEvidence.independentSourceReview.reviewedAt =
  '2026-08-12T14:08:30Z'
assert.ok(
  validatePhase730FEvidence(billingRetirementApprovedBeforeLocalEvidence).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const billingDeletionApprovedBeforeRollback = clone(complete)
billingDeletionApprovedBeforeRollback.approvals.billingPinSecretDeletion.recordedAt =
  '2026-08-12T14:10:30Z'
assert.ok(
  validatePhase730FEvidence(billingDeletionApprovedBeforeRollback).some(
    (error) => error.code === 'APPROVAL_PRECEDES_PREREQUISITE',
  ),
)

const billingRemovedBeforeRollback = clone(complete)
billingRemovedBeforeRollback.configuration.secretInventory.entries.find(
  ({ name }) => name === 'BILLING_PIN',
).removedAt = '2026-08-12T14:10:30Z'
assert.ok(
  validatePhase730FEvidence(billingRemovedBeforeRollback).some(
    (error) => error.code === 'APPROVAL_RECORDED_TOO_LATE',
  ),
)

const conflatedBillingRetirement = clone(complete)
for (const acl of Object.values(
  conflatedBillingRetirement.postCutover.snapshot.legacyBillingAcl,
)) {
  acl.serviceRoleExecute = false
}
assert.ok(
  validatePhase730FEvidence(conflatedBillingRetirement).some(
    (error) => error.code === 'BILLING_RETIREMENT_CONFLATED_WITH_CUTOVER',
  ),
)

for (const phase of ['preCutover', 'postCutover', 'billingRetirement']) {
  const missingBillingFunction = clone(complete)
  missingBillingFunction[
    phase
  ].snapshot.legacyBillingAcl.publicAdminIssueAiBillingGrant.functionExists =
    false
  assert.ok(
    validatePhase730FEvidence(missingBillingFunction).some(
      (error) => error.code === 'SCHEMA_CONST',
    ),
    `${phase} must reject a dropped or renamed legacy billing function`,
  )
}

for (const phase of ['preCutover', 'postCutover']) {
  const authoritativeSnapshot = clone(complete)
  authoritativeSnapshot[phase].snapshot.authoritative = true
  assert.ok(
    validatePhase730FEvidence(authoritativeSnapshot).some(
      (error) => error.code === 'SCHEMA_CONST',
    ),
    `${phase} evidence must remain explicitly non-authoritative`,
  )
}

for (const [key, failingValue] of Object.entries({
  activeOwnerCount: 1,
  activeAiEnabledInstructorCount: 0,
  activeStandardInstructorCount: 0,
  suspendedAdminCount: 0,
  suspendedInstructorCount: 0,
  activePersonalAiPinFactorCount: 0,
  activeAiEnabledInstructorPersonalAiPinFactorCount: 0,
  activeApprovedTotpPrincipalCount: 3,
  activeOwnerApprovedTotpCount: 1,
  activeAiEnabledInstructorApprovedTotpCount: 0,
  activeStandardInstructorApprovedTotpCount: 0,
  activeGoogleSessionCount: 0,
  unbackedGoogleSessionCount: 1,
  overCapGoogleSessionCount: 1,
  googleSessionIdleCapMismatchCount: 1,
  invalidGoogleSessionAuthorityCount: 1,
})) {
  const belowThreshold = clone(complete)
  belowThreshold.postCutover.snapshot[key] = failingValue
  const result = evaluatePhase730FEvidence(belowThreshold)
  assert.equal(result.valid, true, key)
  assert.ok(result.holdReasons.includes('POST_CUTOVER_NOT_READY'), key)
}

const disabledAbsoluteIdleTrigger = clone(complete)
disabledAbsoluteIdleTrigger.postCutover.snapshot.triggers.googleSessionAbsoluteIdleTriggerEnabled = false
const disabledAbsoluteIdleTriggerResult = evaluatePhase730FEvidence(
  disabledAbsoluteIdleTrigger,
)
assert.equal(disabledAbsoluteIdleTriggerResult.valid, true)
assert.ok(
  disabledAbsoluteIdleTriggerResult.holdReasons.includes(
    'POST_CUTOVER_NOT_READY',
  ),
)

for (const mutateInventory of [
  (hosted) => hosted.operationalFunctionInventory.pop(),
  (hosted) => hosted.identityControlFunctionInventory.pop(),
  (hosted) => {
    hosted.identityControlFunctionInventory[0].name = 'unknown-identity-control'
  },
  (hosted) => {
    hosted.identityControlFunctionInventory[0].verifyJwt = false
  },
]) {
  const incompleteInventory = clone(complete)
  mutateInventory(incompleteInventory.hostedEvidence)
  const result = evaluatePhase730FEvidence(incompleteInventory)
  assert.equal(result.valid, true)
  assert.ok(result.holdReasons.includes('HOSTED_STATE_NOT_READY'))
}

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
failedHumanScenario.humanEvidence.safeStatusStopRecovery.status = 'FAIL'
const failedHumanResult = evaluatePhase730FEvidence(failedHumanScenario)
assert.equal(failedHumanResult.valid, false)
assert.equal(failedHumanResult.decision, PHASE730F_HOLD)
assert.ok(
  failedHumanResult.errors.some(
    (error) => error.code === 'BILLING_RETIREMENT_HUMAN_PREREQUISITE_MISSING',
  ),
)

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
  evidenceDigestSha256: digest('0'),
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
const privateFixturePath = fileURLToPath(
  new URL('../.phase7-30f-evidence-static-test.json', import.meta.url),
)
const noEvidenceCli = spawnSync(process.execPath, [validatorPath, '--json'], {
  encoding: 'utf8',
})
assert.equal(noEvidenceCli.status, 0, noEvidenceCli.stderr)
assert.equal(JSON.parse(noEvidenceCli.stdout).decision, PHASE730F_HOLD)

let fixtureCli
try {
  writeFileSync(privateFixturePath, fixtureSource, 'utf8')
  fixtureCli = spawnSync(
    process.execPath,
    [validatorPath, '--evidence', privateFixturePath, '--json'],
    { encoding: 'utf8' },
  )
} finally {
  unlinkSync(privateFixturePath)
}
assert.equal(fixtureCli.status, 0, fixtureCli.stderr)
const fixtureCliResult = JSON.parse(fixtureCli.stdout)
assert.equal(fixtureCliResult.decision, PHASE730F_HOLD)
assert.equal(fixtureCliResult.sourceReadiness, PHASE730F_HOLD)
assert.equal(fixtureCliResult.productionAuthorized, false)
assert.equal(fixtureCliResult.canaryAuthorized, false)
assert.ok(
  !fixtureCli.stdout.includes(
    fixture.configuration.environment.sourceCommitSha,
  ),
  'redacted CLI output must not echo the supplied source SHA',
)

const nestedFixtureCli = spawnSync(
  process.execPath,
  [validatorPath, '--evidence', fixturePath, '--json'],
  { encoding: 'utf8' },
)
assert.equal(nestedFixtureCli.status, 2)
assert.deepEqual(JSON.parse(nestedFixtureCli.stdout).errors, [
  { code: 'EVIDENCE_PATH_FORBIDDEN', path: '$' },
])

const uppercaseFixtureCli = spawnSync(
  process.execPath,
  [
    validatorPath,
    '--evidence',
    fileURLToPath(
      new URL('../.PHASE7-30F-EVIDENCE-CASE-REJECTED.json', import.meta.url),
    ),
    '--json',
  ],
  { encoding: 'utf8' },
)
assert.equal(uppercaseFixtureCli.status, 2)
assert.deepEqual(JSON.parse(uppercaseFixtureCli.stdout).errors, [
  { code: 'EVIDENCE_PATH_FORBIDDEN', path: '$' },
])

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
  [
    validatorPath,
    '--evidence',
    fileURLToPath(
      new URL('../.phase7-30f-evidence-static-missing.json', import.meta.url),
    ),
    '--json',
  ],
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
for (const [name, functionName, triggerType] of [
  [
    'admin_identity_runtime_gate_google_only_tombstone',
    'enforce_google_only_admin_gate_tombstone_v1',
    27,
  ],
  [
    'admin_sessions_google_only_admin_fence',
    'enforce_google_only_admin_session_fence_v1',
    31,
  ],
  [
    'lecture_sessions_google_only_active_ownership',
    'enforce_active_admin_lecture_ownership_v1',
    21,
  ],
  [
    'admin_sessions_google_absolute_idle',
    'enforce_google_admin_session_absolute_idle_v1',
    23,
  ],
]) {
  const triggerContract = new RegExp(
    `${name}[\\s\\S]*tgfoid[\\s\\S]*${functionName}[\\s\\S]*tgtype\\s*=\\s*${triggerType}[\\s\\S]*tgconstraint`,
    'i',
  )
  assert.match(
    preflightMigration,
    triggerContract,
    `${name} must bind the expected function, timing/events and constraint shape`,
  )
}
assert.match(
  preflightMigration,
  /lecture_sessions_google_only_active_ownership[\s\S]*tgconstraint\s*<>\s*0[\s\S]*tgdeferrable[\s\S]*tginitdeferred/i,
)
assert.match(
  preflightMigration,
  /'functionExists',\s*procedure\.oid is not null/i,
  'legacy billing ACL evidence must distinguish missing functions from revoked grants',
)
for (const [source, label] of [
  [preflightPgTap, 'from-zero pgTAP'],
  [populatedUpgradeProbe, 'populated E-to-F upgrade probe'],
]) {
  assert.match(
    source,
    /value -> 'legacyVerifierAcl'[\s\S]{0,500}'functionExists',\s*true[\s\S]{0,500}'serviceRoleExecute',\s*true/i,
    `${label} must preserve the retained legacy verifier function and its pre-cutover service-role ACL`,
  )
}
assert.equal(
  [...preflightMigration.matchAll(/tgenabled\s*=\s*'O'/g)].length,
  4,
  'each readiness trigger must use the normal enabled state exactly',
)
for (const column of [
  'authentication_method',
  'auth_user_id',
  'supabase_auth_session_id',
  'issued_at',
  'expires_at',
  'idle_expires_at',
]) {
  assert.match(
    preflightMigration,
    new RegExp(`attnum = any\\(trigger_row\\.tgattr\\)[\\s\\S]*${column}`),
    `absolute/idle trigger identity must cover ${column}`,
  )
}
assert.match(
  preflightPgTap,
  /all four readiness triggers have exact table, function, timing\/event, enabled and constraint identities/i,
)
assert.equal(
  [...preflightPgTap.matchAll(/\bunalike\(/g)].length,
  3,
  'pgTAP must use the supported unalike assertion for all three mutation guards',
)
assert.doesNotMatch(
  preflightPgTap,
  /\bunlike\(/,
  'pgTAP does not expose an unlike assertion',
)
assert.match(
  preflightPgTap,
  /absolute\/idle trigger covers the exact six authority and lifetime columns/i,
)
assert.match(
  preflightPgTap,
  /phase730f_noop_trigger[\s\S]*admin_sessions_google_absolute_idle[\s\S]*same-name enabled no-op trigger cannot satisfy/i,
  'pgTAP must reject a same-name trigger wired to the wrong function',
)
assert.match(
  preflightPgTap,
  /rename to phase730f_missing_admin_issue_ai_billing_grant[\s\S]*dropped or renamed legacy billing signature is missing, not retired[\s\S]*missing historical billing compatibility cannot satisfy retirement evidence/i,
  'pgTAP must distinguish missing billing functions from revoked retained functions',
)
assert.match(
  preflightMigration,
  /create function private\.get_phase7_30f_source_readiness_preflight_v1\([\s\S]*?language sql[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
)
assert.match(
  preflightMigration,
  /approved_totp_factor_set_hash\s*=\s*private\.current_verified_totp_factor_set_hash_v1\(\s*principal\.auth_user_id\s*\)/i,
  'approved-TOTP readiness must match the current verified Auth factor set',
)
assert.match(
  preflightMigration,
  /'suspendedAdminCount',\s*\([\s\S]*?join private\.admin_principals as principal[\s\S]*?membership\.status = 'suspended'[\s\S]*?membership\.expires_at > statement_timestamp\(\)[\s\S]*?principal\.status = 'active'[\s\S]*?\),\s*'suspendedInstructorCount'/i,
  'suspended Admin readiness must require an active principal and a non-expired membership',
)
assert.match(
  preflightMigration,
  /'suspendedInstructorCount',\s*\([\s\S]*?join private\.admin_principals as principal[\s\S]*?membership\.role = 'instructor'[\s\S]*?membership\.status = 'suspended'[\s\S]*?membership\.expires_at > statement_timestamp\(\)[\s\S]*?principal\.status = 'active'[\s\S]*?\),\s*'activePersonalAiPinFactorCount'/i,
  'suspended instructor readiness must require the instructor role, an active principal and a non-expired membership',
)
assert.match(
  preflightPgTap,
  /expired suspended instructor[\s\S]*inactive-principal suspended instructor[\s\S]*non-expired suspended instructor with an active principal/i,
  'pgTAP must reject expired and inactive-principal suspended evidence before accepting an eligible suspended instructor',
)
assert.match(
  preflightPgTap,
  /status\s*=\s*'unverified'[\s\S]*activeAiEnabledInstructorApprovedTotpCount[\s\S]*removed current AI-instructor TOTP factor/i,
  'pgTAP must prove cached approval cannot survive current-factor removal',
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
