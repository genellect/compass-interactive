import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isPhase730FEnvironmentAlias,
  isPhase730FIsoTimestamp,
  phase730FSecretInventoryNames,
} from './productionEnvironment.mjs'

export const PHASE730F_SCHEMA_VERSION = 'phase7-30f-readiness/v1'
export const PHASE730F_HOLD = 'HOLD'
export const PHASE730F_MAXIMUM_DECISION = 'READY_FOR_SEPARATE_HOSTED_EXECUTION'

const MAX_EVIDENCE_BYTES = 1024 * 1024
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateEvidenceFilePattern =
  /^\.phase7-30f-evidence(?:[a-z0-9._-]*)\.json$/
const schemaUrl = new URL(
  '../docs/evidence/phase7-30f-readiness.schema.json',
  import.meta.url,
)
const phase730fSchema = JSON.parse(readFileSync(schemaUrl, 'utf8'))

function collectAllowedEvidenceKeys(node, keys = new Set()) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return keys
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    keys.add(key)
    collectAllowedEvidenceKeys(child, keys)
  }
  for (const child of Object.values(node.$defs ?? {})) {
    collectAllowedEvidenceKeys(child, keys)
  }
  if (node.items) collectAllowedEvidenceKeys(node.items, keys)
  return keys
}

const allowedEvidenceKeys = collectAllowedEvidenceKeys(phase730fSchema)

const expectedIdentityControlFunctions = new Map([
  ['admin-ai-unlock', true],
  ['admin-identity-session', true],
  ['manage-admin-ledger', true],
])

const expectedOperationalFunctions = new Map([
  ['analyze-lecture-material', true],
  ['generate-academic-answer', true],
  ['generate-lecture-summary', true],
  ['issue-display-session', true],
  ['issue-pdf-access-token', true],
  ['issue-realtime-client-secret', true],
  ['manage-admin-sessions', true],
  ['manage-ai-control', true],
  ['manage-comments', true],
  ['manage-lecture-summaries', true],
  ['manage-lectures', true],
  ['manage-material-analysis', true],
  ['manage-pdf-documents', true],
  ['manage-pdf-publications', true],
  ['manage-polls', true],
  ['manage-presenter-connection', true],
  ['operator-live-snapshot', true],
  ['publish-caption-window', true],
  ['update-display-state', true],
])

const retiredFunctions = new Set(['verify-admin-pin', 'authorize-ai-start'])

const requiredAbsentSecrets = new Set(['ADMIN_PIN', 'BILLING_PIN'])
const requiredPresentSecrets = new Set(
  phase730FSecretInventoryNames.filter(
    (name) => !requiredAbsentSecrets.has(name),
  ),
)

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

const billingRetirementHumanRecordNames = [
  'personalAiPinEndToEnd',
  'sameScopeRetry',
  'scopeEscalation',
  'freeDowngradeStop',
  'masterNoProviderOrRealtime',
  'authorityDrainMatrix',
  'safeStatusStopRecovery',
]

const dangerousKeyNames = new Set([
  'secret',
  'secretvalue',
  'password',
  'passphrase',
  'pin',
  'adminpin',
  'billingpin',
  'aipin',
  'personalaipin',
  'otp',
  'totp',
  'totpsecret',
  'totpcode',
  'oauthclientsecret',
  'clientsecret',
  'servicerolekey',
  'supabaseservicerolekey',
  'anonkey',
  'publishablekey',
  'apikey',
  'openaiapikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'admintoken',
  'billinggrant',
  'authorization',
  'authorizationheader',
  'bearer',
  'bearertoken',
  'cookie',
  'setcookie',
  'recoverycode',
  'projectref',
  'email',
  'userid',
  'authuserid',
  'principalid',
  'membershipid',
])

const redactedStringPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z0-9 ]+-----/,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/i,
  /\b(?:sk|pk)[-_](?:live|test|proj)?[_-]?[A-Za-z0-9_-]{16,}\b/i,
  /\bya29\.[A-Za-z0-9_-]+\b/,
  /\b1\/\/[A-Za-z0-9_-]{16,}\b/,
  /\bpostgres(?:ql)?:\/\//i,
  /https:\/\/[a-z0-9]{16,}\.supabase\.(?:co|in)\b/i,
  /[?&](?:token|secret|key|code|password)=/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
]

function issue(code, path, message) {
  return { code, path, message }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKey(key) {
  return key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()
}

function assertNoDuplicateJsonKeys(source) {
  let cursor = 0

  const fail = () => {
    throw new Error('Evidence is not canonical duplicate-free JSON.')
  }
  const whitespace = () => {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1
  }
  const parseString = () => {
    if (source[cursor] !== '"') fail()
    const start = cursor
    cursor += 1
    while (cursor < source.length) {
      const character = source[cursor]
      if (character === '"') {
        cursor += 1
        return JSON.parse(source.slice(start, cursor))
      }
      if (character === '\\') {
        cursor += 1
        if (source[cursor] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(cursor + 1, cursor + 5))) {
            fail()
          }
          cursor += 5
        } else {
          if (!/^["\\/bfnrt]$/.test(source[cursor] ?? '')) fail()
          cursor += 1
        }
        continue
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) fail()
      cursor += 1
    }
    fail()
  }
  const parseValue = (depth = 0) => {
    if (depth > 64) fail()
    whitespace()
    const character = source[cursor]
    if (character === '{') {
      cursor += 1
      whitespace()
      const keys = new Set()
      if (source[cursor] === '}') {
        cursor += 1
        return
      }
      while (cursor < source.length) {
        whitespace()
        const key = parseString()
        if (keys.has(key)) fail()
        keys.add(key)
        whitespace()
        if (source[cursor] !== ':') fail()
        cursor += 1
        parseValue(depth + 1)
        whitespace()
        if (source[cursor] === '}') {
          cursor += 1
          return
        }
        if (source[cursor] !== ',') fail()
        cursor += 1
      }
      fail()
    }
    if (character === '[') {
      cursor += 1
      whitespace()
      if (source[cursor] === ']') {
        cursor += 1
        return
      }
      while (cursor < source.length) {
        parseValue(depth + 1)
        whitespace()
        if (source[cursor] === ']') {
          cursor += 1
          return
        }
        if (source[cursor] !== ',') fail()
        cursor += 1
      }
      fail()
    }
    if (character === '"') {
      parseString()
      return
    }
    const primitive = source
      .slice(cursor)
      .match(
        /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/,
      )?.[0]
    if (!primitive) fail()
    cursor += primitive.length
  }

  parseValue()
  whitespace()
  if (cursor !== source.length) fail()
}

function resolveLocalReference(root, reference) {
  if (!reference.startsWith('#/')) {
    throw new Error('Only local schema references are allowed.')
  }
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, part) => current?.[part], root)
}

function matchesType(value, expected) {
  switch (expected) {
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isObject(value)
    case 'integer':
      return Number.isSafeInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    default:
      return typeof value === expected
  }
}

function validateSchemaNode(value, node, path, errors, root) {
  if (node.$ref) {
    const resolved = resolveLocalReference(root, node.$ref)
    if (!resolved) {
      errors.push(
        issue('SCHEMA_REFERENCE_INVALID', path, 'Invalid schema reference.'),
      )
      return
    }
    validateSchemaNode(value, resolved, path, errors, root)
    return
  }

  if (Object.hasOwn(node, 'const') && !Object.is(value, node.const)) {
    errors.push(
      issue('SCHEMA_CONST', path, 'Value does not match the fixed contract.'),
    )
    return
  }
  if (
    node.enum &&
    !node.enum.some((candidate) => Object.is(candidate, value))
  ) {
    errors.push(
      issue('SCHEMA_ENUM', path, 'Value is outside the allowed states.'),
    )
    return
  }
  if (node.type) {
    const expectedTypes = Array.isArray(node.type) ? node.type : [node.type]
    if (!expectedTypes.some((expected) => matchesType(value, expected))) {
      errors.push(issue('SCHEMA_TYPE', path, 'Value has the wrong type.'))
      return
    }
    if (value === null) return
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push(issue('SCHEMA_STRING_LENGTH', path, 'String is too short.'))
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push(issue('SCHEMA_STRING_LENGTH', path, 'String is too long.'))
    }
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) {
      errors.push(issue('SCHEMA_PATTERN', path, 'String format is invalid.'))
    }
    if (node.format === 'date-time' && !isPhase730FIsoTimestamp(value)) {
      errors.push(issue('SCHEMA_DATETIME', path, 'Timestamp is invalid.'))
    }
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push(issue('SCHEMA_MINIMUM', path, 'Number is below the minimum.'))
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push(issue('SCHEMA_MAXIMUM', path, 'Number exceeds the maximum.'))
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push(
        issue('SCHEMA_ARRAY_LENGTH', path, 'Array has too few items.'),
      )
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      errors.push(
        issue('SCHEMA_ARRAY_LENGTH', path, 'Array has too many items.'),
      )
    }
    if (node.items) {
      value.forEach((entry, index) =>
        validateSchemaNode(
          entry,
          node.items,
          `${path}[${index}]`,
          errors,
          root,
        ),
      )
    }
  }

  if (isObject(value)) {
    const properties = node.properties ?? {}
    for (const required of node.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(
          issue(
            'SCHEMA_REQUIRED',
            `${path}.${required}`,
            'Required field is missing.',
          ),
        )
      }
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push(
            issue(
              'SCHEMA_UNKNOWN_KEY',
              `${path}.*`,
              'Unknown field is forbidden.',
            ),
          )
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateSchemaNode(
          value[key],
          childSchema,
          `${path}.${key}`,
          errors,
          root,
        )
      }
    }
  }
}

function scanForSensitiveMaterial(value, path, errors, depth = 0) {
  if (depth > 32) {
    errors.push(issue('UNSAFE_DEPTH', path, 'Evidence nesting is too deep.'))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanForSensitiveMaterial(entry, `${path}[${index}]`, errors, depth + 1),
    )
    return
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeKey(key)
      const safePath = `${path}.${allowedEvidenceKeys.has(key) ? key : '*'}`
      if (
        dangerousKeyNames.has(normalized) ||
        /(?:secret|token|pin|password|credential|cookie|jwt)(?:value|material|plaintext|raw|contents?)$/.test(
          normalized,
        )
      ) {
        errors.push(
          issue(
            'FORBIDDEN_SENSITIVE_KEY',
            safePath,
            'Secret-bearing field is forbidden.',
          ),
        )
      }
      scanForSensitiveMaterial(entry, safePath, errors, depth + 1)
    }
    return
  }
  if (typeof value !== 'string') return
  if (
    path === '$.configuration.environment.alias' &&
    isPhase730FEnvironmentAlias(value)
  ) {
    return
  }
  if (
    /^\$\.configuration\.secretInventory\.entries\[[0-9]+\]\.name$/.test(
      path,
    ) &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(value)
  ) {
    return
  }
  if (value.length > 512) {
    errors.push(
      issue(
        'FORBIDDEN_LONG_STRING',
        path,
        'Long opaque strings are forbidden.',
      ),
    )
    return
  }
  if (redactedStringPatterns.some((pattern) => pattern.test(value))) {
    errors.push(
      issue(
        'FORBIDDEN_SECRET_VALUE',
        path,
        'Secret-shaped value is forbidden.',
      ),
    )
    return
  }
  if (/^[0-9]{4}$/.test(value) || /^[0-9]{6,8}$/.test(value)) {
    errors.push(
      issue(
        'FORBIDDEN_CODE_VALUE',
        path,
        'PIN or one-time-code shaped value is forbidden.',
      ),
    )
    return
  }
  if (
    /^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(value) &&
    !/^[0-9a-f]{40}$/.test(value) &&
    !/^[0-9a-f]{64}$/.test(value)
  ) {
    errors.push(
      issue(
        'FORBIDDEN_OPAQUE_VALUE',
        path,
        'Opaque credential-shaped value is forbidden.',
      ),
    )
  }
}

function validateTimedRecord(record, path, errors, generatedAt) {
  const notRun = record.status === 'NOT_RUN'
  if (notRun !== (record.performedAt === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_RESULT_TIME',
        path,
        'Result timestamp does not match status.',
      ),
    )
  }
  if (notRun !== (record.evidenceDigestSha256 === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_RESULT_DIGEST',
        path,
        'Result digest does not match status.',
      ),
    )
  }
  if (record.performedAt && Date.parse(record.performedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        path,
        'Result occurs after document generation.',
      ),
    )
  }
}

function validateSourceResultRecord(record, path, errors, generatedAt) {
  validateTimedRecord(record, path, errors, generatedAt)
  const notRun = record.status === 'NOT_RUN'
  if (notRun !== (record.observedCommitSha === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_SOURCE_COMMIT',
        path,
        'Source result commit does not match status.',
      ),
    )
  }
}

function validateSourceReviewRecord(review, path, errors, generatedAt) {
  const notReviewed = review.status === 'NOT_REVIEWED'
  for (const [field, code] of [
    ['reviewedAt', 'CONTRADICTORY_SOURCE_REVIEW_TIME'],
    ['evidenceDigestSha256', 'CONTRADICTORY_SOURCE_REVIEW_DIGEST'],
    ['observedCommitSha', 'CONTRADICTORY_SOURCE_REVIEW_COMMIT'],
  ]) {
    if (notReviewed !== (review[field] === null)) {
      errors.push(
        issue(code, path, 'Source review metadata does not match status.'),
      )
    }
  }
  if (notReviewed && review.separateFromExecutor) {
    errors.push(
      issue(
        'CONTRADICTORY_SOURCE_REVIEWER',
        path,
        'Missing source review cannot assert reviewer separation.',
      ),
    )
  }
  if (!notReviewed && !review.separateFromExecutor) {
    errors.push(
      issue(
        'SOURCE_REVIEWER_NOT_INDEPENDENT',
        path,
        'Completed source review must be independent.',
      ),
    )
  }
  if (review.reviewedAt && Date.parse(review.reviewedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        path,
        'Source review occurs after document generation.',
      ),
    )
  }
}

function validateApprovalRecord(record, path, errors, generatedAt) {
  const onHold = record.state === 'HOLD'
  if (onHold !== (record.recordedAt === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_APPROVAL_TIME',
        path,
        'Approval timestamp does not match state.',
      ),
    )
  }
  if (onHold !== (record.evidenceDigestSha256 === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_APPROVAL_DIGEST',
        path,
        'Approval digest does not match state.',
      ),
    )
  }
  if (record.recordedAt && Date.parse(record.recordedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        path,
        'Approval occurs after document generation.',
      ),
    )
  }
}

function validateCutoverWrapper(wrapper, path, errors, generatedAt) {
  if (!wrapper.captured) {
    if (
      wrapper.capturedAt !== null ||
      wrapper.readOnlyTransaction !== false ||
      wrapper.snapshotDigestSha256 !== null ||
      wrapper.snapshot !== null
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_SNAPSHOT',
          path,
          'Uncaptured snapshot must be empty.',
        ),
      )
    }
    return
  }
  if (
    wrapper.capturedAt === null ||
    wrapper.readOnlyTransaction !== true ||
    wrapper.snapshotDigestSha256 === null ||
    wrapper.snapshot === null
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_SNAPSHOT',
        path,
        'Captured snapshot requires read-only evidence.',
      ),
    )
    return
  }
  if (Date.parse(wrapper.capturedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        path,
        'Snapshot occurs after document generation.',
      ),
    )
  }
  const snapshot = wrapper.snapshot
  const receiptExists = snapshot.cutoverReceiptCount > 0
  if (receiptExists !== snapshot.cutoverCommitted) {
    errors.push(
      issue(
        'CONTRADICTORY_CUTOVER_RECEIPT',
        path,
        'Receipt and cutover state disagree.',
      ),
    )
  }
  if (
    receiptExists !== (snapshot.cutoverReceiptEnvironmentMatches !== null) ||
    receiptExists !==
      (snapshot.cutoverReceiptDeploymentEvidenceDigestMatches !== null)
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_RECEIPT_MATCH',
        path,
        'Receipt match metadata is inconsistent.',
      ),
    )
  }
  if (snapshot.cutoverCommitted && snapshot.legacyPinLoginEnabled) {
    errors.push(
      issue(
        'CONTRADICTORY_LEGACY_GATE',
        path,
        'Committed cutover cannot retain legacy admission.',
      ),
    )
  }
}

function validateBillingRetirementEvidence(wrapper, path, errors, generatedAt) {
  if (!wrapper.captured) {
    if (
      wrapper.capturedAt !== null ||
      wrapper.readOnlyTransaction !== false ||
      wrapper.snapshotDigestSha256 !== null ||
      wrapper.snapshot !== null
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_BILLING_RETIREMENT',
          path,
          'Uncaptured billing retirement evidence must be empty.',
        ),
      )
    }
    return
  }
  if (
    wrapper.capturedAt === null ||
    wrapper.readOnlyTransaction !== true ||
    wrapper.snapshotDigestSha256 === null ||
    wrapper.snapshot === null
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_BILLING_RETIREMENT',
        path,
        'Captured billing retirement requires read-only evidence.',
      ),
    )
    return
  }
  if (Date.parse(wrapper.capturedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        path,
        'Billing retirement evidence occurs after document generation.',
      ),
    )
  }
}

function validateSecretInventory(inventory, errors, generatedAt) {
  if (!inventory.captured) {
    if (inventory.capturedAt !== null || inventory.entries.length !== 0) {
      errors.push(
        issue(
          'CONTRADICTORY_SECRET_INVENTORY',
          '$.configuration.secretInventory',
          'Uncaptured secret inventory must be empty.',
        ),
      )
    }
    return
  }
  if (inventory.capturedAt === null || inventory.entries.length === 0) {
    errors.push(
      issue(
        'CONTRADICTORY_SECRET_INVENTORY',
        '$.configuration.secretInventory',
        'Captured secret inventory requires timestamp and entries.',
      ),
    )
  }
  if (inventory.capturedAt && Date.parse(inventory.capturedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        '$.configuration.secretInventory',
        'Secret inventory occurs after document generation.',
      ),
    )
  }
  const names = new Set()
  inventory.entries.forEach((entry, index) => {
    const path = `$.configuration.secretInventory.entries[${index}]`
    if (names.has(entry.name)) {
      errors.push(
        issue(
          'DUPLICATE_SECRET_NAME',
          path,
          'Secret metadata name is duplicated.',
        ),
      )
    }
    names.add(entry.name)
    if (
      !entry.present &&
      (entry.minimumBytesSatisfied !== null ||
        entry.rotationVersion !== null ||
        entry.rotatedAt !== null ||
        entry.removedAt === null)
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_SECRET_ENTRY',
          path,
          'Absent secret requires removal time and cannot expose rotation metadata.',
        ),
      )
    }
    if (
      entry.present &&
      (entry.minimumBytesSatisfied === null ||
        entry.rotationVersion === null ||
        entry.rotatedAt === null ||
        entry.removedAt !== null)
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_SECRET_ENTRY',
          path,
          'Present secret requires rotation metadata and cannot claim removal.',
        ),
      )
    }
    if (entry.rotatedAt && Date.parse(entry.rotatedAt) > generatedAt) {
      errors.push(
        issue(
          'FUTURE_EVIDENCE',
          path,
          'Secret rotation occurs after document generation.',
        ),
      )
    }
    if (entry.removedAt && Date.parse(entry.removedAt) > generatedAt) {
      errors.push(
        issue(
          'FUTURE_EVIDENCE',
          path,
          'Secret removal occurs after document generation.',
        ),
      )
    }
    for (const [field, timestamp] of [
      ['rotatedAt', entry.rotatedAt],
      ['removedAt', entry.removedAt],
    ]) {
      if (
        timestamp &&
        inventory.capturedAt &&
        Date.parse(timestamp) > Date.parse(inventory.capturedAt)
      ) {
        errors.push(
          issue(
            'SECRET_METADATA_AFTER_INVENTORY_CAPTURE',
            `${path}.${field}`,
            'Secret rotation or removal metadata cannot postdate the inventory capture.',
          ),
        )
      }
    }
  })
  if (
    inventory.entries.length !== phase730FSecretInventoryNames.length ||
    names.size !== phase730FSecretInventoryNames.length ||
    phase730FSecretInventoryNames.some((name) => !names.has(name))
  ) {
    errors.push(
      issue(
        'SECRET_INVENTORY_SET_MISMATCH',
        '$.configuration.secretInventory.entries',
        'Secret inventory must contain the exact approved metadata names.',
      ),
    )
  }
}

function validateHostedEvidence(hosted, errors, generatedAt) {
  const nullableFields = [
    'executedAt',
    'deploymentEvidenceDigestSha256',
    'immutableRevisionSha256',
    'sourceCommitMatches',
    'retiredAdminFunctionsAbsent',
    'legacyWireFieldsAbsent',
    'callbackOriginAllowlistPass',
    'oauthConsentPass',
  ]
  if (!hosted.executed) {
    if (
      nullableFields.some((field) => hosted[field] !== null) ||
      hosted.operationalFunctionInventory.length !== 0 ||
      hosted.identityControlFunctionInventory.length !== 0
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_HOSTED_EVIDENCE',
          '$.hostedEvidence',
          'Unexecuted Hosted evidence must be empty.',
        ),
      )
    }
    return
  }
  if (
    nullableFields.some((field) => hosted[field] === null) ||
    hosted.operationalFunctionInventory.length === 0 ||
    hosted.identityControlFunctionInventory.length === 0
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_HOSTED_EVIDENCE',
        '$.hostedEvidence',
        'Executed Hosted evidence is incomplete.',
      ),
    )
  }
  if (hosted.executedAt && Date.parse(hosted.executedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        '$.hostedEvidence',
        'Hosted evidence occurs after generation.',
      ),
    )
  }
  const names = new Set()
  const inventoryEntries = [
    ...hosted.operationalFunctionInventory.map((entry, index) => ({
      entry,
      path: `$.hostedEvidence.operationalFunctionInventory[${index}]`,
    })),
    ...hosted.identityControlFunctionInventory.map((entry, index) => ({
      entry,
      path: `$.hostedEvidence.identityControlFunctionInventory[${index}]`,
    })),
  ]
  inventoryEntries.forEach(({ entry, path }) => {
    if (names.has(entry.name)) {
      errors.push(
        issue('DUPLICATE_FUNCTION_NAME', path, 'Function name is duplicated.'),
      )
    }
    names.add(entry.name)
  })
}

function validateRollbackEvidence(rollback, errors, generatedAt) {
  validateTimedRecord(
    rollback.rehearsal,
    '$.rollbackEvidence.rehearsal',
    errors,
    generatedAt,
  )
  const fields = [
    'immutableGoogleOnlyRevision',
    'sharedPinRestored',
    'paidAdmissionDisabledDuringRecovery',
    'freeStopAvailable',
    'operatorOwnerRecoveryRehearsed',
  ]
  if (rollback.rehearsal.status === 'NOT_RUN') {
    if (fields.some((field) => rollback[field] !== null)) {
      errors.push(
        issue(
          'CONTRADICTORY_ROLLBACK',
          '$.rollbackEvidence',
          'Unrun rollback evidence must be empty.',
        ),
      )
    }
  } else if (fields.some((field) => rollback[field] === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_ROLLBACK',
        '$.rollbackEvidence',
        'Executed rollback evidence is incomplete.',
      ),
    )
  }
}

function validateSemanticConsistency(evidence) {
  const errors = []
  const generatedAt = Date.parse(evidence.generatedAt)

  validateSecretInventory(
    evidence.configuration.secretInventory,
    errors,
    generatedAt,
  )
  validateCutoverWrapper(
    evidence.preCutover,
    '$.preCutover',
    errors,
    generatedAt,
  )
  validateCutoverWrapper(
    evidence.postCutover,
    '$.postCutover',
    errors,
    generatedAt,
  )
  validateBillingRetirementEvidence(
    evidence.billingRetirement,
    '$.billingRetirement',
    errors,
    generatedAt,
  )
  validateHostedEvidence(evidence.hostedEvidence, errors, generatedAt)

  const source = evidence.sourceEvidence
  validateSourceResultRecord(
    source.phase730ePostMergeCi,
    '$.sourceEvidence.phase730ePostMergeCi',
    errors,
    generatedAt,
  )
  validateSourceResultRecord(
    source.phase730fBaseOnMergedE,
    '$.sourceEvidence.phase730fBaseOnMergedE',
    errors,
    generatedAt,
  )
  for (const [name, record] of Object.entries(source.checks)) {
    validateSourceResultRecord(
      record,
      `$.sourceEvidence.checks.${name}`,
      errors,
      generatedAt,
    )
  }
  validateSourceReviewRecord(
    source.independentSourceReview,
    '$.sourceEvidence.independentSourceReview',
    errors,
    generatedAt,
  )

  if (
    source.phase730eMergeCommitSha !== null &&
    source.phase730fBaseCommitSha !== null &&
    source.phase730eMergeCommitSha !== source.phase730fBaseCommitSha
  ) {
    errors.push(
      issue(
        'SOURCE_BASE_COMMIT_MISMATCH',
        '$.sourceEvidence.phase730fBaseCommitSha',
        'Phase 7.30F must be based on the verified merged Phase 7.30E commit.',
      ),
    )
  }
  if (
    source.phase730ePostMergeCi.observedCommitSha !== null &&
    source.phase730ePostMergeCi.observedCommitSha !==
      source.phase730eMergeCommitSha
  ) {
    errors.push(
      issue(
        'SOURCE_RESULT_COMMIT_MISMATCH',
        '$.sourceEvidence.phase730ePostMergeCi.observedCommitSha',
        'Post-merge CI must observe the declared Phase 7.30E merge commit.',
      ),
    )
  }
  if (
    source.phase730fBaseOnMergedE.observedCommitSha !== null &&
    source.phase730fBaseOnMergedE.observedCommitSha !==
      evidence.configuration.environment.sourceCommitSha
  ) {
    errors.push(
      issue(
        'SOURCE_RESULT_COMMIT_MISMATCH',
        '$.sourceEvidence.phase730fBaseOnMergedE.observedCommitSha',
        'Ancestry verification must observe the declared Phase 7.30F candidate commit.',
      ),
    )
  }
  const sourceCommitSha = evidence.configuration.environment.sourceCommitSha
  for (const [name, record] of Object.entries(source.checks)) {
    if (
      record.observedCommitSha !== null &&
      record.observedCommitSha !== sourceCommitSha
    ) {
      errors.push(
        issue(
          'SOURCE_RESULT_COMMIT_MISMATCH',
          `$.sourceEvidence.checks.${name}.observedCommitSha`,
          'Source check must observe the declared candidate commit.',
        ),
      )
    }
  }
  if (
    source.independentSourceReview.observedCommitSha !== null &&
    source.independentSourceReview.observedCommitSha !== sourceCommitSha
  ) {
    errors.push(
      issue(
        'SOURCE_RESULT_COMMIT_MISMATCH',
        '$.sourceEvidence.independentSourceReview.observedCommitSha',
        'Independent source review must observe the declared candidate commit.',
      ),
    )
  }
  if (source.independentSourceReview.status !== 'NOT_REVIEWED') {
    const sourceEvidenceTimes = [
      source.phase730ePostMergeCi.performedAt,
      source.phase730fBaseOnMergedE.performedAt,
      ...Object.values(source.checks).map((record) => record.performedAt),
    ]
      .filter(Boolean)
      .map((timestamp) => Date.parse(timestamp))
    if (
      sourceEvidenceTimes.length > 0 &&
      Date.parse(source.independentSourceReview.reviewedAt) <=
        Math.max(...sourceEvidenceTimes)
    ) {
      errors.push(
        issue(
          'SOURCE_REVIEW_PRECEDES_EVIDENCE',
          '$.sourceEvidence.independentSourceReview',
          'Independent source review must be strictly later than every source check it covers.',
        ),
      )
    }
  }

  for (const [name, record] of Object.entries(evidence.humanEvidence)) {
    validateTimedRecord(record, `$.humanEvidence.${name}`, errors, generatedAt)
    if (
      record.status !== 'NOT_RUN' &&
      (!evidence.hostedEvidence.executedAt ||
        Date.parse(record.performedAt) <=
          Date.parse(evidence.hostedEvidence.executedAt))
    ) {
      errors.push(
        issue(
          'HUMAN_EVIDENCE_NOT_AFTER_HOSTED',
          `$.humanEvidence.${name}`,
          'Human evidence must observe the deployed Hosted revision.',
        ),
      )
    }
  }
  for (const name of regressionRecordNames) {
    validateTimedRecord(
      evidence.regressionEvidence[name],
      `$.regressionEvidence.${name}`,
      errors,
      generatedAt,
    )
  }
  const advisors = evidence.regressionEvidence.advisors
  if (!advisors.captured) {
    if (
      advisors.capturedAt !== null ||
      advisors.evidenceDigestSha256 !== null ||
      advisors.criticalFindings !== 0 ||
      advisors.highFindings !== 0
    ) {
      errors.push(
        issue(
          'CONTRADICTORY_ADVISORS',
          '$.regressionEvidence.advisors',
          'Uncaptured advisors must be empty.',
        ),
      )
    }
  } else if (
    advisors.capturedAt === null ||
    advisors.evidenceDigestSha256 === null
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_ADVISORS',
        '$.regressionEvidence.advisors',
        'Captured advisors require timestamp and digest.',
      ),
    )
  }
  if (advisors.capturedAt && Date.parse(advisors.capturedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        '$.regressionEvidence.advisors',
        'Advisor evidence occurs after generation.',
      ),
    )
  }

  validateRollbackEvidence(evidence.rollbackEvidence, errors, generatedAt)
  const approvalDigests = new Map()
  for (const [name, record] of Object.entries(evidence.approvals)) {
    validateApprovalRecord(record, `$.approvals.${name}`, errors, generatedAt)
    if (record.state !== 'HOLD' && record.evidenceDigestSha256 !== null) {
      const priorName = approvalDigests.get(record.evidenceDigestSha256)
      if (priorName) {
        errors.push(
          issue(
            'APPROVAL_DIGEST_REUSED',
            `$.approvals.${name}.evidenceDigestSha256`,
            `Approval evidence digest is already assigned to ${priorName}.`,
          ),
        )
      } else {
        approvalDigests.set(record.evidenceDigestSha256, name)
      }
    }
  }

  const requireApprovalBefore = (name, eventAt) => {
    const approval = evidence.approvals[name]
    if (
      approval.state === 'APPROVED' &&
      eventAt &&
      Date.parse(approval.recordedAt) >= Date.parse(eventAt)
    ) {
      errors.push(
        issue(
          'APPROVAL_RECORDED_TOO_LATE',
          `$.approvals.${name}`,
          'Approval must precede the authorized operation.',
        ),
      )
    }
  }
  const requireEvidenceBeforeApproval = (evidenceAt, name, path, message) => {
    const approval = evidence.approvals[name]
    if (
      evidenceAt &&
      approval.state === 'APPROVED' &&
      Date.parse(evidenceAt) >= Date.parse(approval.recordedAt)
    ) {
      errors.push(issue('APPROVAL_PRECEDES_PREREQUISITE', path, message))
    }
  }
  requireApprovalBefore(
    'stagingHostedMutation',
    evidence.hostedEvidence.executedAt,
  )
  if (
    evidence.hostedEvidence.callbackOriginAllowlistPass !== null ||
    evidence.hostedEvidence.oauthConsentPass !== null
  ) {
    requireApprovalBefore(
      'oauthProviderConfiguration',
      evidence.hostedEvidence.executedAt,
    )
  }
  for (const record of Object.values(evidence.humanEvidence)) {
    if (record.status !== 'NOT_RUN') {
      requireApprovalBefore('stagingHumanIdentityRun', record.performedAt)
    }
  }
  if (evidence.postCutover.snapshot?.cutoverCommitted) {
    requireApprovalBefore('googleOnlyCutover', evidence.postCutover.capturedAt)
    requireEvidenceBeforeApproval(
      evidence.hostedEvidence.executedAt,
      'googleOnlyCutover',
      '$.approvals.googleOnlyCutover',
      'Google-only cutover approval must follow Hosted deployment evidence.',
    )
    requireEvidenceBeforeApproval(
      evidence.preCutover.capturedAt,
      'googleOnlyCutover',
      '$.approvals.googleOnlyCutover',
      'Google-only cutover approval must follow the read-only pre-cutover snapshot.',
    )
    for (const name of preCutoverHumanRecordNames) {
      const record = evidence.humanEvidence[name]
      if (record.status !== 'PASS') {
        errors.push(
          issue(
            'CUTOVER_HUMAN_PREREQUISITE_MISSING',
            `$.humanEvidence.${name}`,
            'Committed cutover requires passing Human identity, MFA and recovery evidence.',
          ),
        )
      } else {
        requireEvidenceBeforeApproval(
          record.performedAt,
          'googleOnlyCutover',
          '$.approvals.googleOnlyCutover',
          'Google-only cutover approval must follow all required Human identity, MFA and recovery evidence.',
        )
      }
    }
  }
  const secretsByName = new Map(
    evidence.configuration.secretInventory.entries.map((entry) => [
      entry.name,
      entry,
    ]),
  )
  if (secretsByName.get('ADMIN_PIN')?.present === false) {
    requireApprovalBefore(
      'adminPinSecretDeletion',
      secretsByName.get('ADMIN_PIN').removedAt,
    )
    requireEvidenceBeforeApproval(
      evidence.postCutover.capturedAt,
      'adminPinSecretDeletion',
      '$.approvals.adminPinSecretDeletion',
      'ADMIN_PIN deletion approval must follow committed cutover evidence.',
    )
  }
  if (secretsByName.get('BILLING_PIN')?.present === false) {
    requireApprovalBefore(
      'billingPinSecretDeletion',
      secretsByName.get('BILLING_PIN').removedAt,
    )
    requireEvidenceBeforeApproval(
      evidence.billingRetirement.capturedAt,
      'billingPinSecretDeletion',
      '$.approvals.billingPinSecretDeletion',
      'BILLING_PIN deletion approval must follow billing retirement evidence.',
    )
    requireEvidenceBeforeApproval(
      evidence.rollbackEvidence.rehearsal.performedAt,
      'billingPinSecretDeletion',
      '$.approvals.billingPinSecretDeletion',
      'BILLING_PIN deletion approval must follow rollback rehearsal evidence.',
    )
  }
  if (evidence.billingRetirement.captured) {
    requireApprovalBefore(
      'legacyBillingAuthorityRetirement',
      evidence.billingRetirement.capturedAt,
    )
    for (const name of billingRetirementHumanRecordNames) {
      const record = evidence.humanEvidence[name]
      if (record.status !== 'PASS') {
        errors.push(
          issue(
            'BILLING_RETIREMENT_HUMAN_PREREQUISITE_MISSING',
            `$.humanEvidence.${name}`,
            'Billing retirement requires passing Personal AI PIN and safe-control Human evidence.',
          ),
        )
      } else {
        requireEvidenceBeforeApproval(
          record.performedAt,
          'legacyBillingAuthorityRetirement',
          '$.approvals.legacyBillingAuthorityRetirement',
          'Billing retirement approval must follow all Personal AI PIN and safe-control Human evidence.',
        )
      }
    }
    for (const [path, evidenceAt] of [
      [
        '$.sourceEvidence.checks.browserMatrix',
        evidence.sourceEvidence.checks.browserMatrix.performedAt,
      ],
      [
        '$.sourceEvidence.checks.phase730fStaticContract',
        evidence.sourceEvidence.checks.phase730fStaticContract.performedAt,
      ],
      [
        '$.sourceEvidence.independentSourceReview',
        evidence.sourceEvidence.independentSourceReview.reviewedAt,
      ],
    ]) {
      requireEvidenceBeforeApproval(
        evidenceAt,
        'legacyBillingAuthorityRetirement',
        '$.approvals.legacyBillingAuthorityRetirement',
        `Billing retirement approval must follow local Personal AI PIN evidence at ${path}.`,
      )
    }
  }

  const review = evidence.independentReview
  const reviewMissing = review.status === 'NOT_REVIEWED'
  if (reviewMissing !== (review.reviewedAt === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_REVIEW_TIME',
        '$.independentReview',
        'Review timestamp does not match status.',
      ),
    )
  }
  if (reviewMissing !== (review.evidenceDigestSha256 === null)) {
    errors.push(
      issue(
        'CONTRADICTORY_REVIEW_DIGEST',
        '$.independentReview',
        'Review digest does not match status.',
      ),
    )
  }
  if (reviewMissing && review.separateFromExecutor) {
    errors.push(
      issue(
        'CONTRADICTORY_REVIEWER',
        '$.independentReview',
        'Missing review cannot assert separation.',
      ),
    )
  }
  if (
    reviewMissing &&
    (review.criticalFindings !== 0 || review.highFindings !== 0)
  ) {
    errors.push(
      issue(
        'CONTRADICTORY_REVIEW_FINDINGS',
        '$.independentReview',
        'Missing review cannot claim findings.',
      ),
    )
  }
  if (!reviewMissing && !review.separateFromExecutor) {
    errors.push(
      issue(
        'REVIEWER_NOT_INDEPENDENT',
        '$.independentReview',
        'Completed review must be independent.',
      ),
    )
  }
  if (review.reviewedAt && Date.parse(review.reviewedAt) > generatedAt) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        '$.independentReview',
        'Review occurs after generation.',
      ),
    )
  }
  if (review.status !== 'NOT_REVIEWED') {
    const completedEvidenceTimes = [
      evidence.configuration.environment.capturedAt,
      evidence.sourceEvidence.phase730ePostMergeCi.performedAt,
      evidence.sourceEvidence.phase730fBaseOnMergedE.performedAt,
      ...Object.values(evidence.sourceEvidence.checks).map(
        (record) => record.performedAt,
      ),
      evidence.sourceEvidence.independentSourceReview.reviewedAt,
      evidence.hostedEvidence.executedAt,
      evidence.configuration.secretInventory.capturedAt,
      evidence.preCutover.capturedAt,
      evidence.postCutover.capturedAt,
      evidence.billingRetirement.capturedAt,
      ...evidence.configuration.secretInventory.entries.map(
        (entry) => entry.removedAt,
      ),
      evidence.regressionEvidence.advisors.capturedAt,
      evidence.rollbackEvidence.rehearsal.performedAt,
      ...Object.values(evidence.humanEvidence).map(
        (record) => record.performedAt,
      ),
      ...regressionRecordNames.map(
        (name) => evidence.regressionEvidence[name].performedAt,
      ),
      ...Object.values(evidence.approvals)
        .filter((record) => record.state !== 'HOLD')
        .map((record) => record.recordedAt),
    ]
      .filter(Boolean)
      .map((timestamp) => Date.parse(timestamp))
    if (
      completedEvidenceTimes.length > 0 &&
      Date.parse(review.reviewedAt) <= Math.max(...completedEvidenceTimes)
    ) {
      errors.push(
        issue(
          'REVIEW_PRECEDES_EVIDENCE',
          '$.independentReview',
          'Independent review must be strictly later than all evidence and non-HOLD approvals it covers.',
        ),
      )
    }
  }

  if (evidence.postCutover.captured && !evidence.preCutover.captured) {
    errors.push(
      issue(
        'POST_WITHOUT_PRE',
        '$.postCutover',
        'Post-cutover snapshot requires a separate pre-cutover snapshot.',
      ),
    )
  }
  const snapshotDigests = [
    [
      '$.preCutover.snapshotDigestSha256',
      evidence.preCutover.snapshotDigestSha256,
    ],
    [
      '$.postCutover.snapshotDigestSha256',
      evidence.postCutover.snapshotDigestSha256,
    ],
    [
      '$.billingRetirement.snapshotDigestSha256',
      evidence.billingRetirement.snapshotDigestSha256,
    ],
  ].filter(([, digest]) => digest !== null)
  const observedSnapshotDigests = new Set()
  for (const [path, digest] of snapshotDigests) {
    if (observedSnapshotDigests.has(digest)) {
      errors.push(
        issue(
          'SNAPSHOT_DIGEST_REUSED',
          path,
          'Distinct pre-cutover, post-cutover and billing-retirement snapshots require distinct digests.',
        ),
      )
    }
    observedSnapshotDigests.add(digest)
  }
  if (
    evidence.preCutover.capturedAt &&
    evidence.postCutover.capturedAt &&
    Date.parse(evidence.preCutover.capturedAt) >=
      Date.parse(evidence.postCutover.capturedAt)
  ) {
    errors.push(
      issue(
        'CUTOVER_ORDER_INVALID',
        '$.postCutover',
        'Post snapshot must follow pre snapshot.',
      ),
    )
  }
  if (
    evidence.hostedEvidence.executedAt &&
    evidence.preCutover.capturedAt &&
    Date.parse(evidence.hostedEvidence.executedAt) >=
      Date.parse(evidence.preCutover.capturedAt)
  ) {
    errors.push(
      issue(
        'HOSTED_EVIDENCE_NOT_PRE_CUTOVER',
        '$.hostedEvidence.executedAt',
        'Hosted deployment evidence must precede the read-only pre-cutover snapshot.',
      ),
    )
  }
  if (
    evidence.postCutover.capturedAt &&
    evidence.configuration.secretInventory.capturedAt &&
    Date.parse(evidence.postCutover.capturedAt) >
      Date.parse(evidence.configuration.secretInventory.capturedAt)
  ) {
    errors.push(
      issue(
        'SECRET_INVENTORY_PRECEDES_POST_CUTOVER',
        '$.configuration.secretInventory',
        'Secret-deletion inventory must not precede post-cutover evidence.',
      ),
    )
  }
  if (evidence.preCutover.snapshot?.cutoverCommitted) {
    errors.push(
      issue(
        'PRE_ALREADY_CUT_OVER',
        '$.preCutover.snapshot',
        'Pre snapshot cannot already be cut over.',
      ),
    )
  }
  if (evidence.postCutover.snapshot?.cutoverCommitted) {
    const identityCutoverBillingAcl = Object.values(
      evidence.postCutover.snapshot.legacyBillingAcl,
    )
    if (
      !identityCutoverBillingAcl.every(
        (acl) =>
          acl.functionExists &&
          acl.serviceRoleExecute &&
          !acl.publicExecute &&
          !acl.anonExecute &&
          !acl.authenticatedExecute,
      )
    ) {
      errors.push(
        issue(
          'BILLING_RETIREMENT_CONFLATED_WITH_CUTOVER',
          '$.postCutover.snapshot.legacyBillingAcl',
          'Identity cutover evidence must retain service-role-only legacy billing authority until its separately approved retirement.',
        ),
      )
    }
  }

  const adminPinRemovedAt = secretsByName.get('ADMIN_PIN')?.removedAt ?? null
  const billingPinRemovedAt =
    secretsByName.get('BILLING_PIN')?.removedAt ?? null
  const personalAiPinCompletedAt =
    evidence.humanEvidence.personalAiPinEndToEnd.performedAt
  const requireStrictOrder = (beforeAt, afterAt, path, message) => {
    if (beforeAt && afterAt && Date.parse(beforeAt) >= Date.parse(afterAt)) {
      errors.push(issue('EVIDENCE_ORDER_INVALID', path, message))
    }
  }
  requireStrictOrder(
    evidence.postCutover.capturedAt,
    adminPinRemovedAt,
    '$.configuration.secretInventory.entries',
    'ADMIN_PIN removal must follow committed Google-only cutover evidence.',
  )
  requireStrictOrder(
    adminPinRemovedAt,
    personalAiPinCompletedAt,
    '$.humanEvidence.personalAiPinEndToEnd',
    'Personal AI PIN end-to-end evidence must follow ADMIN_PIN removal.',
  )
  requireStrictOrder(
    personalAiPinCompletedAt,
    evidence.billingRetirement.capturedAt,
    '$.billingRetirement',
    'Legacy billing authority retirement must follow Personal AI PIN end-to-end evidence.',
  )
  requireStrictOrder(
    evidence.billingRetirement.capturedAt,
    billingPinRemovedAt,
    '$.configuration.secretInventory.entries',
    'BILLING_PIN removal must follow legacy billing authority retirement evidence.',
  )
  for (const entry of evidence.configuration.secretInventory.entries) {
    requireStrictOrder(
      entry.removedAt,
      evidence.configuration.secretInventory.capturedAt,
      '$.configuration.secretInventory.capturedAt',
      'Secret inventory capture must follow every recorded secret removal.',
    )
  }

  const humanObserved = Object.values(evidence.humanEvidence).some(
    (record) => record.status !== 'NOT_RUN',
  )
  const environment = evidence.configuration.environment
  const anyObserved =
    evidence.hostedEvidence.executed ||
    humanObserved ||
    evidence.preCutover.captured ||
    evidence.postCutover.captured ||
    evidence.billingRetirement.captured ||
    evidence.configuration.secretInventory.captured
  if (anyObserved !== (environment.capturedAt !== null)) {
    errors.push(
      issue(
        'CONTRADICTORY_ENVIRONMENT_CAPTURE',
        '$.configuration.environment',
        'Environment timestamp disagrees with evidence.',
      ),
    )
  }
  if (
    environment.capturedAt &&
    Date.parse(environment.capturedAt) > generatedAt
  ) {
    errors.push(
      issue(
        'FUTURE_EVIDENCE',
        '$.configuration.environment',
        'Environment capture occurs after generation.',
      ),
    )
  }

  const latestSnapshot = evidence.postCutover.captured
    ? evidence.postCutover.snapshot
    : evidence.preCutover.captured
      ? evidence.preCutover.snapshot
      : null
  if (latestSnapshot) {
    const gates = evidence.configuration.databaseGates
    for (const key of [
      'legacyPinLoginEnabled',
      'googleSessionIssueEnabled',
      'operatorTotpFactorSetAdoptionEnabled',
      'totpFactorMutationEnabled',
      'googleOperationalAuthorizationEnabled',
      'googleAdminLedgerEnabled',
      'aiUnlockEnabled',
      'googleAiMasterAdmissionEnabled',
      'rememberedBrowserEnabled',
    ]) {
      if (gates[key] !== latestSnapshot[key]) {
        errors.push(
          issue(
            'DATABASE_GATE_SNAPSHOT_MISMATCH',
            `$.configuration.databaseGates.${key}`,
            'Gate metadata disagrees with latest snapshot.',
          ),
        )
      }
    }
  }

  if (evidence.evidenceMode === 'HOSTED_HUMAN_STAGING') {
    const frontend = evidence.configuration.frontendFlags
    const server = evidence.configuration.serverFlags
    const gates = evidence.configuration.databaseGates
    const topology = [
      [
        frontend.VITE_PHASE7_30_ADMIN_IDENTITY,
        server.PHASE730_ADMIN_IDENTITY_ENABLED,
        gates.googleSessionIssueEnabled,
      ],
      [
        frontend.VITE_PHASE7_30_ADMIN_AI_UNLOCK,
        server.PHASE730_ADMIN_AI_UNLOCK_ENABLED,
        gates.aiUnlockEnabled,
      ],
      [
        frontend.VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION,
        server.PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED,
        gates.totpFactorMutationEnabled,
      ],
      [
        frontend.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS,
        server.PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED,
        gates.googleOperationalAuthorizationEnabled,
      ],
      [
        frontend.VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER,
        server.PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED,
        gates.googleAdminLedgerEnabled,
      ],
      [
        server.PHASE730_C1_GOOGLE_AI_MASTER_ENABLED,
        gates.googleAiMasterAdmissionEnabled,
      ],
    ]
    if (
      topology.some((states) => states.some((state) => state !== states[0]))
    ) {
      errors.push(
        issue(
          'HOSTED_GATE_TOPOLOGY_MISMATCH',
          '$.configuration',
          'Hosted frontend, Edge and database gate metadata must agree.',
        ),
      )
    }
  }

  if (evidence.rollbackEvidence.immutableGoogleOnlyRevision) {
    if (
      evidence.rollbackEvidence.immutableGoogleOnlyRevision !==
      evidence.hostedEvidence.immutableRevisionSha256
    ) {
      errors.push(
        issue(
          'ROLLBACK_REVISION_MISMATCH',
          '$.rollbackEvidence',
          'Rollback and Hosted immutable revisions disagree.',
        ),
      )
    }
  }

  if (evidence.hostedEvidence.executed) {
    if (evidence.approvals.stagingHostedMutation.state !== 'APPROVED') {
      errors.push(
        issue(
          'HOSTED_WITHOUT_APPROVAL',
          '$.approvals.stagingHostedMutation',
          'Hosted execution requires prior approval.',
        ),
      )
    }
  }
  if (
    evidence.hostedEvidence.executed &&
    evidence.approvals.oauthProviderConfiguration.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'OAUTH_CONFIGURATION_WITHOUT_APPROVAL',
        '$.approvals.oauthProviderConfiguration',
        'OAuth/provider configuration evidence requires prior approval.',
      ),
    )
  }
  if (
    humanObserved &&
    evidence.approvals.stagingHumanIdentityRun.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'HUMAN_RUN_WITHOUT_APPROVAL',
        '$.approvals.stagingHumanIdentityRun',
        'Staging Human identity evidence requires prior approval.',
      ),
    )
  }
  if (
    evidence.postCutover.snapshot?.cutoverCommitted &&
    evidence.approvals.googleOnlyCutover.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'CUTOVER_WITHOUT_APPROVAL',
        '$.approvals.googleOnlyCutover',
        'Committed cutover requires prior approval.',
      ),
    )
  }
  if (
    evidence.postCutover.snapshot?.cutoverCommitted &&
    !evidence.hostedEvidence.executed
  ) {
    errors.push(
      issue(
        'CUTOVER_WITHOUT_HOSTED_EVIDENCE',
        '$.postCutover',
        'Committed cutover requires prior Hosted deployment evidence.',
      ),
    )
  }
  if (
    secretsByName.get('ADMIN_PIN')?.present === false &&
    evidence.approvals.adminPinSecretDeletion.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'ADMIN_PIN_DELETION_WITHOUT_APPROVAL',
        '$.approvals.adminPinSecretDeletion',
        'ADMIN_PIN deletion requires separate prior approval.',
      ),
    )
  }
  if (
    secretsByName.get('ADMIN_PIN')?.present === false &&
    !evidence.postCutover.snapshot?.cutoverCommitted
  ) {
    errors.push(
      issue(
        'ADMIN_PIN_DELETED_BEFORE_CUTOVER',
        '$.configuration.secretInventory.entries',
        'ADMIN_PIN cannot be removed before committed Google-only cutover evidence.',
      ),
    )
  }
  if (
    evidence.billingRetirement.captured &&
    evidence.approvals.legacyBillingAuthorityRetirement.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'BILLING_RETIREMENT_WITHOUT_APPROVAL',
        '$.approvals.legacyBillingAuthorityRetirement',
        'Legacy billing retirement requires separate prior approval.',
      ),
    )
  }
  if (
    evidence.billingRetirement.captured &&
    (!evidence.postCutover.snapshot?.cutoverCommitted ||
      evidence.humanEvidence.personalAiPinEndToEnd.status !== 'PASS')
  ) {
    errors.push(
      issue(
        'BILLING_RETIREMENT_PREREQUISITE_MISSING',
        '$.billingRetirement',
        'Billing retirement requires committed cutover and passing Personal AI PIN end-to-end evidence.',
      ),
    )
  }
  if (
    secretsByName.get('BILLING_PIN')?.present === false &&
    evidence.approvals.billingPinSecretDeletion.state !== 'APPROVED'
  ) {
    errors.push(
      issue(
        'BILLING_PIN_DELETION_WITHOUT_APPROVAL',
        '$.approvals.billingPinSecretDeletion',
        'BILLING_PIN deletion requires separate prior approval.',
      ),
    )
  }
  if (
    secretsByName.get('BILLING_PIN')?.present === false &&
    !evidence.billingRetirement.captured
  ) {
    errors.push(
      issue(
        'BILLING_PIN_DELETED_BEFORE_RETIREMENT',
        '$.configuration.secretInventory.entries',
        'BILLING_PIN cannot be removed before billing authority retirement evidence.',
      ),
    )
  }

  if (evidence.evidenceMode === 'SOURCE_READINESS_EXAMPLE') {
    const allFlags = [
      ...Object.values(evidence.configuration.frontendFlags),
      ...Object.values(evidence.configuration.serverFlags),
    ]
    const allResults = [
      ...Object.values(evidence.humanEvidence),
      ...regressionRecordNames.map((name) => evidence.regressionEvidence[name]),
      evidence.rollbackEvidence.rehearsal,
    ]
    if (
      environment.capturedAt !== null ||
      environment.environmentIdConfigured ||
      allFlags.some(Boolean) ||
      !evidence.configuration.databaseGates.legacyPinLoginEnabled ||
      evidence.configuration.databaseGates.googleSessionIssueEnabled ||
      evidence.configuration.databaseGates
        .operatorTotpFactorSetAdoptionEnabled ||
      evidence.configuration.databaseGates.totpFactorMutationEnabled ||
      evidence.configuration.databaseGates
        .googleOperationalAuthorizationEnabled ||
      evidence.configuration.databaseGates.googleAdminLedgerEnabled ||
      evidence.configuration.databaseGates.aiUnlockEnabled ||
      evidence.configuration.databaseGates.googleAiMasterAdmissionEnabled ||
      evidence.configuration.databaseGates.rememberedBrowserEnabled ||
      evidence.configuration.secretInventory.captured ||
      evidence.preCutover.captured ||
      evidence.postCutover.captured ||
      evidence.billingRetirement.captured ||
      evidence.hostedEvidence.executed ||
      allResults.some((record) => record.status !== 'NOT_RUN') ||
      evidence.regressionEvidence.advisors.captured ||
      Object.values(evidence.approvals).some(
        (record) => record.state !== 'HOLD',
      ) ||
      evidence.independentReview.status !== 'NOT_REVIEWED'
    ) {
      errors.push(
        issue(
          'SOURCE_EXAMPLE_EXECUTED',
          '$',
          'Tracked source example cannot claim Hosted or Human execution.',
        ),
      )
    }
  }

  return errors
}

function addHold(failures, condition, code) {
  if (!condition) failures.push(code)
}

function snapshotReady(snapshot, phase) {
  if (!snapshot) return false
  const common =
    snapshot.authoritative === false &&
    snapshot.activeLegacyMasterCount === 0 &&
    snapshot.activeLegacySessionCount === 0 &&
    snapshot.activeOwnerCount >= 2 &&
    snapshot.activeAiEnabledInstructorCount >= 1 &&
    snapshot.activeStandardInstructorCount >= 1 &&
    snapshot.suspendedAdminCount >= 1 &&
    snapshot.suspendedInstructorCount >= 1 &&
    snapshot.activePersonalAiPinFactorCount >= 1 &&
    snapshot.activeAiEnabledInstructorPersonalAiPinFactorCount >= 1 &&
    snapshot.activeApprovedTotpPrincipalCount >= 4 &&
    snapshot.activeOwnerApprovedTotpCount >= 2 &&
    snapshot.activeAiEnabledInstructorApprovedTotpCount >= 1 &&
    snapshot.activeStandardInstructorApprovedTotpCount >= 1 &&
    snapshot.activeGoogleSessionCount >= 1 &&
    snapshot.unbackedGoogleSessionCount === 0 &&
    snapshot.overCapGoogleSessionCount === 0 &&
    snapshot.googleSessionIdleCapMismatchCount === 0 &&
    snapshot.invalidGoogleSessionAuthorityCount === 0 &&
    snapshot.environmentReady &&
    snapshot.externalTransportAttestationRequired &&
    snapshot.googleAdminLedgerEnabled &&
    snapshot.googleOperationalAuthorizationEnabled &&
    snapshot.googleSessionIssueEnabled &&
    snapshot.operatorTotpFactorSetAdoptionEnabled &&
    snapshot.totpFactorMutationEnabled &&
    snapshot.aiUnlockEnabled &&
    snapshot.googleAiMasterAdmissionEnabled &&
    snapshot.rememberedBrowserEnabled &&
    snapshot.issuedLegacyGrantCount === 0 &&
    snapshot.pendingLegacyAcademicCount === 0 &&
    snapshot.runningLegacySummaryCount === 0 &&
    snapshot.runningLegacyUsageCount === 0 &&
    snapshot.unboundPdfPublicationCount === 0 &&
    snapshot.unownedActiveLectureCount === 0 &&
    snapshot.invalidActiveOwnershipCount === 0 &&
    Object.values(snapshot.triggers).every(Boolean)
  if (!common) return false
  if (phase === 'pre') {
    return (
      !snapshot.cutoverCommitted &&
      snapshot.legacyPinLoginEnabled &&
      snapshot.cutoverReceiptCount === 0 &&
      snapshot.cutoverReceiptEnvironmentMatches === null &&
      snapshot.cutoverReceiptDeploymentEvidenceDigestMatches === null &&
      snapshot.legacyVerifierServiceRoleExecute &&
      Object.values(snapshot.legacyBillingAcl).every(
        (acl) =>
          acl.functionExists &&
          acl.serviceRoleExecute &&
          !acl.publicExecute &&
          !acl.anonExecute &&
          !acl.authenticatedExecute,
      )
    )
  }
  return (
    snapshot.cutoverCommitted &&
    !snapshot.legacyPinLoginEnabled &&
    snapshot.cutoverReceiptCount === 1 &&
    snapshot.cutoverReceiptEnvironmentMatches === true &&
    snapshot.cutoverReceiptDeploymentEvidenceDigestMatches === true &&
    !snapshot.legacyVerifierServiceRoleExecute &&
    Object.values(snapshot.legacyBillingAcl).every(
      (acl) =>
        acl.functionExists &&
        acl.serviceRoleExecute &&
        !acl.publicExecute &&
        !acl.anonExecute &&
        !acl.authenticatedExecute,
    )
  )
}

function billingRetirementReady(wrapper) {
  if (!wrapper.captured || !wrapper.snapshot) return false
  return (
    wrapper.readOnlyTransaction &&
    wrapper.snapshot.personalAiPinEvidenceDigestMatches &&
    wrapper.snapshot.safeStatusStopRevokeAccountingAvailable &&
    wrapper.snapshot.historicalIntegrityPreserved &&
    Object.values(wrapper.snapshot.legacyBillingAcl).every(
      (acl) =>
        acl.functionExists &&
        !acl.serviceRoleExecute &&
        !acl.publicExecute &&
        !acl.anonExecute &&
        !acl.authenticatedExecute,
    )
  )
}

function sourceEvidenceReady(evidence) {
  const source = evidence.sourceEvidence
  const candidateCommitSha = evidence.configuration.environment.sourceCommitSha
  const mergedECommitSha = source.phase730eMergeCommitSha
  return (
    mergedECommitSha !== null &&
    source.phase730fBaseCommitSha === mergedECommitSha &&
    source.phase730ePostMergeCi.status === 'PASS' &&
    source.phase730ePostMergeCi.observedCommitSha === mergedECommitSha &&
    source.phase730fBaseOnMergedE.status === 'PASS' &&
    source.phase730fBaseOnMergedE.observedCommitSha === candidateCommitSha &&
    Object.values(source.checks).every(
      (record) =>
        record.status === 'PASS' &&
        record.observedCommitSha === candidateCommitSha,
    ) &&
    source.independentSourceReview.status === 'PASS' &&
    source.independentSourceReview.observedCommitSha === candidateCommitSha &&
    source.independentSourceReview.separateFromExecutor &&
    source.independentSourceReview.criticalFindings === 0 &&
    source.independentSourceReview.highFindings === 0
  )
}

function functionInventoryReady(entries, expectedFunctions) {
  if (entries.length !== expectedFunctions.size) return false
  const observed = new Map(
    entries.map((entry) => [entry.name, entry.verifyJwt]),
  )
  if (
    retiredFunctions.size > 0 &&
    [...retiredFunctions].some((name) => observed.has(name))
  ) {
    return false
  }
  return [...expectedFunctions].every(
    ([name, verifyJwt]) => observed.get(name) === verifyJwt,
  )
}

function secretInventoryReady(inventory) {
  if (!inventory.captured) return false
  const observed = new Map(
    inventory.entries.map((entry) => [entry.name, entry]),
  )
  if (
    inventory.entries.length !== phase730FSecretInventoryNames.length ||
    observed.size !== phase730FSecretInventoryNames.length ||
    phase730FSecretInventoryNames.some((name) => !observed.has(name))
  ) {
    return false
  }
  for (const name of requiredPresentSecrets) {
    const entry = observed.get(name)
    if (
      !entry?.present ||
      entry.minimumBytesSatisfied !== true ||
      !entry.rotationVersion ||
      !entry.rotatedAt ||
      entry.removedAt !== null
    ) {
      return false
    }
  }
  for (const name of requiredAbsentSecrets) {
    const entry = observed.get(name)
    if (
      !entry ||
      entry.present ||
      entry.minimumBytesSatisfied !== null ||
      entry.rotationVersion !== null ||
      entry.rotatedAt !== null ||
      !entry.removedAt
    ) {
      return false
    }
  }
  return true
}

function readinessFailures(evidence) {
  const failures = []
  const environment = evidence.configuration.environment
  const hosted = evidence.hostedEvidence
  const approvals = evidence.approvals
  const review = evidence.independentReview
  const rollback = evidence.rollbackEvidence
  const advisors = evidence.regressionEvidence.advisors

  addHold(failures, sourceEvidenceReady(evidence), 'SOURCE_EVIDENCE_NOT_READY')

  addHold(
    failures,
    evidence.evidenceMode === 'HOSTED_HUMAN_STAGING',
    'HOSTED_MODE_REQUIRED',
  )
  addHold(
    failures,
    environment.environmentIdConfigured,
    'ENVIRONMENT_ID_NOT_CONFIGURED',
  )
  addHold(failures, hosted.executed, 'HOSTED_EVIDENCE_NOT_OBSERVED')
  addHold(
    failures,
    Object.values(evidence.humanEvidence).some(
      (record) => record.status !== 'NOT_RUN',
    ),
    'HUMAN_EVIDENCE_NOT_OBSERVED',
  )
  addHold(
    failures,
    Object.values(evidence.configuration.frontendFlags).every(Boolean) &&
      Object.values(evidence.configuration.serverFlags).every(Boolean),
    'HOSTED_ACTIVATION_FLAGS_NOT_READY',
  )
  addHold(
    failures,
    snapshotReady(evidence.preCutover.snapshot, 'pre'),
    'PRE_CUTOVER_NOT_READY',
  )
  addHold(
    failures,
    snapshotReady(evidence.postCutover.snapshot, 'post'),
    'POST_CUTOVER_NOT_READY',
  )
  addHold(
    failures,
    billingRetirementReady(evidence.billingRetirement),
    'BILLING_RETIREMENT_NOT_READY',
  )
  addHold(
    failures,
    !evidence.configuration.databaseGates.legacyPinLoginEnabled &&
      evidence.configuration.databaseGates.googleSessionIssueEnabled &&
      evidence.configuration.databaseGates
        .operatorTotpFactorSetAdoptionEnabled &&
      evidence.configuration.databaseGates.totpFactorMutationEnabled &&
      evidence.configuration.databaseGates
        .googleOperationalAuthorizationEnabled &&
      evidence.configuration.databaseGates.googleAdminLedgerEnabled &&
      evidence.configuration.databaseGates.aiUnlockEnabled &&
      evidence.configuration.databaseGates.googleAiMasterAdmissionEnabled &&
      evidence.configuration.databaseGates.rememberedBrowserEnabled,
    'FINAL_DATABASE_GATES_NOT_READY',
  )
  addHold(
    failures,
    hosted.executed &&
      hosted.sourceCommitMatches === true &&
      hosted.retiredAdminFunctionsAbsent === true &&
      hosted.legacyWireFieldsAbsent === true &&
      hosted.callbackOriginAllowlistPass === true &&
      hosted.oauthConsentPass === true &&
      functionInventoryReady(
        hosted.operationalFunctionInventory,
        expectedOperationalFunctions,
      ) &&
      functionInventoryReady(
        hosted.identityControlFunctionInventory,
        expectedIdentityControlFunctions,
      ),
    'HOSTED_STATE_NOT_READY',
  )
  addHold(
    failures,
    secretInventoryReady(evidence.configuration.secretInventory),
    'SECRET_METADATA_NOT_READY',
  )
  addHold(
    failures,
    Object.values(evidence.humanEvidence).every(
      (record) => record.status === 'PASS',
    ),
    'HUMAN_SCENARIOS_NOT_READY',
  )
  addHold(
    failures,
    regressionRecordNames.every(
      (name) => evidence.regressionEvidence[name].status === 'PASS',
    ),
    'REGRESSION_NOT_READY',
  )
  addHold(
    failures,
    advisors.captured &&
      advisors.criticalFindings === 0 &&
      advisors.highFindings === 0,
    'CRITICAL_HIGH_FINDINGS_NOT_CLEARED',
  )
  addHold(
    failures,
    rollback.rehearsal.status === 'PASS' &&
      rollback.immutableGoogleOnlyRevision === hosted.immutableRevisionSha256 &&
      rollback.sharedPinRestored === false &&
      rollback.paidAdmissionDisabledDuringRecovery === true &&
      rollback.freeStopAvailable === true &&
      rollback.operatorOwnerRecoveryRehearsed === true,
    'ROLLBACK_NOT_READY',
  )
  for (const name of [
    'stagingHostedMutation',
    'oauthProviderConfiguration',
    'stagingHumanIdentityRun',
    'googleOnlyCutover',
    'adminPinSecretDeletion',
    'legacyBillingAuthorityRetirement',
    'billingPinSecretDeletion',
  ]) {
    addHold(
      failures,
      approvals[name].state === 'APPROVED',
      `APPROVAL_${name.toUpperCase()}_MISSING`,
    )
  }
  addHold(
    failures,
    approvals.limitedIdentityCanary.state === 'HOLD',
    'CANARY_MUST_REMAIN_HOLD',
  )
  addHold(
    failures,
    approvals.productionActivation.state === 'HOLD',
    'PRODUCTION_MUST_REMAIN_HOLD',
  )
  addHold(
    failures,
    review.status === 'PASS' &&
      review.separateFromExecutor &&
      review.criticalFindings === 0 &&
      review.highFindings === 0,
    'INDEPENDENT_REVIEW_NOT_READY',
  )
  return failures
}

export function parsePhase730FEvidence(source) {
  if (typeof source !== 'string') {
    throw new TypeError('Evidence source must be a JSON string.')
  }
  assertNoDuplicateJsonKeys(source)
  return JSON.parse(source)
}

export function validatePhase730FEvidence(evidence) {
  const errors = []
  scanForSensitiveMaterial(evidence, '$', errors)
  validateSchemaNode(evidence, phase730fSchema, '$', errors, phase730fSchema)
  if (errors.length === 0) {
    errors.push(...validateSemanticConsistency(evidence))
  }
  return errors
}

export function evaluatePhase730FEvidence(evidence) {
  const errors = validatePhase730FEvidence(evidence)
  if (errors.length > 0) {
    return {
      schemaVersion: PHASE730F_SCHEMA_VERSION,
      valid: false,
      decision: PHASE730F_HOLD,
      sourceReadiness: PHASE730F_HOLD,
      maximumDecision: PHASE730F_MAXIMUM_DECISION,
      productionAuthorized: false,
      canaryAuthorized: false,
      errors,
      holdReasons: [],
    }
  }
  const holdReasons = readinessFailures(evidence)
  const sourceReadiness = sourceEvidenceReady(evidence)
    ? 'SOURCE_READY'
    : PHASE730F_HOLD
  return {
    schemaVersion: PHASE730F_SCHEMA_VERSION,
    valid: true,
    decision:
      holdReasons.length === 0 ? PHASE730F_MAXIMUM_DECISION : PHASE730F_HOLD,
    sourceReadiness,
    maximumDecision: PHASE730F_MAXIMUM_DECISION,
    productionAuthorized: false,
    canaryAuthorized: false,
    errors: [],
    holdReasons,
  }
}

function redactedResult(result) {
  return {
    schemaVersion: result.schemaVersion,
    valid: result.valid,
    decision: result.decision,
    sourceReadiness: result.sourceReadiness,
    maximumDecision: result.maximumDecision,
    productionAuthorized: false,
    canaryAuthorized: false,
    errorCount: result.errors.length,
    errors: result.errors.map(({ code, path }) => ({ code, path })),
    holdReasons: result.holdReasons,
  }
}

function noEvidenceResult() {
  return {
    schemaVersion: PHASE730F_SCHEMA_VERSION,
    valid: true,
    decision: PHASE730F_HOLD,
    sourceReadiness: PHASE730F_HOLD,
    maximumDecision: PHASE730F_MAXIMUM_DECISION,
    productionAuthorized: false,
    canaryAuthorized: false,
    errors: [],
    holdReasons: ['NO_EVIDENCE_SUPPLIED'],
  }
}

function parseArguments(arguments_) {
  let evidencePath = null
  let json = false
  let help = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--evidence') {
      if (evidencePath !== null || !arguments_[index + 1]) {
        throw new Error('Invalid evidence argument.')
      }
      evidencePath = arguments_[index + 1]
      index += 1
      continue
    }
    throw new Error('Unknown argument.')
  }
  return { evidencePath, json, help }
}

function resolvePrivateEvidencePath(evidencePath) {
  const resolvedPath = resolve(repositoryRoot, evidencePath)
  if (
    dirname(resolvedPath) !== repositoryRoot ||
    !privateEvidenceFilePattern.test(basename(resolvedPath))
  ) {
    return null
  }
  return resolvedPath
}

function printResult(result, json) {
  const redacted = redactedResult(result)
  if (json) {
    process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`)
    return
  }
  process.stdout.write(`Phase 7.30F decision: ${redacted.decision}\n`)
  process.stdout.write(`Source readiness: ${redacted.sourceReadiness}\n`)
  process.stdout.write(
    `Maximum validator decision: ${redacted.maximumDecision}\n`,
  )
  process.stdout.write('Production activation authorized: false\n')
  process.stdout.write('Limited identity canary authorized: false\n')
  if (redacted.errorCount > 0) {
    process.stdout.write(`Validation errors: ${redacted.errorCount}\n`)
    for (const error of redacted.errors) {
      process.stdout.write(`- ${error.code} at ${error.path}\n`)
    }
  } else {
    for (const reason of redacted.holdReasons) {
      process.stdout.write(`- ${reason}\n`)
    }
  }
}

export function runPhase730FReadinessCli(arguments_) {
  let options
  try {
    options = parseArguments(arguments_)
  } catch {
    const result = {
      ...noEvidenceResult(),
      valid: false,
      sourceReadiness: PHASE730F_HOLD,
      errors: [issue('INVALID_ARGUMENTS', '$', 'Arguments are invalid.')],
      holdReasons: [],
    }
    printResult(result, arguments_.includes('--json'))
    return 2
  }

  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/phase7-30f-readiness.mjs [--evidence <metadata.json>] [--json]\n',
    )
    return 0
  }
  if (!options.evidencePath) {
    printResult(noEvidenceResult(), options.json)
    return 0
  }

  const resolvedEvidencePath = resolvePrivateEvidencePath(options.evidencePath)
  if (!resolvedEvidencePath) {
    const result = {
      ...noEvidenceResult(),
      valid: false,
      sourceReadiness: PHASE730F_HOLD,
      errors: [
        issue(
          'EVIDENCE_PATH_FORBIDDEN',
          '$',
          'Evidence must be a private repository-root Phase 7.30F JSON file.',
        ),
      ],
      holdReasons: [],
    }
    printResult(result, options.json)
    return 2
  }

  let evidence
  try {
    const canonicalEvidencePath = realpathSync(resolvedEvidencePath)
    if (
      dirname(canonicalEvidencePath) !== realpathSync(repositoryRoot) ||
      !privateEvidenceFilePattern.test(basename(canonicalEvidencePath))
    ) {
      throw Object.assign(new Error('Evidence path escapes repository root.'), {
        code: 'EVIDENCE_PATH_FORBIDDEN',
      })
    }
    const metadata = statSync(canonicalEvidencePath)
    if (!metadata.isFile() || metadata.size > MAX_EVIDENCE_BYTES) {
      throw new Error('Evidence file is unavailable or too large.')
    }
    evidence = parsePhase730FEvidence(
      readFileSync(canonicalEvidencePath, 'utf8'),
    )
  } catch (error) {
    const result = {
      ...noEvidenceResult(),
      valid: false,
      sourceReadiness: PHASE730F_HOLD,
      errors: [
        issue(
          error?.code === 'EVIDENCE_PATH_FORBIDDEN'
            ? 'EVIDENCE_PATH_FORBIDDEN'
            : 'EVIDENCE_PARSE_FAILED',
          '$',
          'Evidence JSON cannot be parsed safely.',
        ),
      ],
      holdReasons: [],
    }
    printResult(result, options.json)
    return 2
  }

  const result = evaluatePhase730FEvidence(evidence)
  printResult(result, options.json)
  return result.valid ? 0 : 2
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPhase730FReadinessCli(process.argv.slice(2))
}
