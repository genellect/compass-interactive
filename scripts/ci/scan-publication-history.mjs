#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_CHUNK_BYTES = 64 * 1024
const DEFAULT_MAX_FINDINGS = 500
const MAX_CHUNK_BYTES = 1024 * 1024
const MAX_ENUMERATION_BYTES = 512 * 1024 * 1024
const OVERLAP_BYTES = 16 * 1024

const gitEnvironment = {
  ...process.env,
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
}

const blockingContentRules = [
  {
    id: 'PRIVATE_KEY_PEM',
    pattern: /-----BEGIN\s+(?:(?:RSA|EC|DSA|OPENSSH|PGP)\s+)?PRIVATE KEY-----/i,
  },
  {
    id: 'OPENAI_API_KEY',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'GITHUB_TOKEN',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'GITLAB_TOKEN',
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'AWS_ACCESS_KEY_ID',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: 'GOOGLE_API_KEY',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
  },
  {
    id: 'GOOGLE_OAUTH_CLIENT_SECRET',
    pattern: /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/,
  },
  {
    id: 'SUPABASE_SECRET_KEY',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'STRIPE_LIVE_KEY',
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/,
  },
  {
    id: 'SLACK_TOKEN',
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    id: 'NPM_ACCESS_TOKEN',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'SENDGRID_API_KEY',
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  },
  {
    id: 'DATABASE_URL_WITH_PASSWORD',
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/i,
  },
]

const reviewContentRules = [
  {
    id: 'GOOGLE_OAUTH_CLIENT_ID',
    pattern: /\b[0-9]{6,}-[a-z0-9_-]{12,}\.apps\.googleusercontent\.com\b/i,
  },
  {
    id: 'SUPABASE_PROJECT_URL',
    pattern: /\bhttps:\/\/[a-z]{20}\.supabase\.co\b/i,
  },
  {
    id: 'SUPABASE_PUBLISHABLE_KEY',
    pattern: /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/,
  },
]

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi
const jwtPattern =
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const secretAssignmentPattern =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|credential|database[_-]?password|password|private[_-]?key|refresh[_-]?token|service[_-]?role(?:[_-]?key)?|session[_-]?secret|secret|token)\b\s*[:=]\s*(["'])([A-Za-z0-9._+/=-]{20,})\1/gi
const sixDigitAuthPattern =
  /\b(?:totp|otp|verification\s+code|authentication\s+code|six[- ]digit\s+code)\b[^0-9\r\n]{0,40}([0-9]{6})\b/gi
const windowsHomePattern = /\b[A-Z]:\\Users\\([^\\\r\n]+)\\/gi
const unixHomePattern = /\/(?:Users|home)\/([^/\s]+)\//g
const basicAuthUrlPattern = /\bhttps?:\/\/([^/\s:@]+):([^@\s/]+)@/gi

const binaryOrMediaExtensions = new Set([
  '.7z',
  '.avi',
  '.doc',
  '.docm',
  '.docx',
  '.gif',
  '.gz',
  '.har',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.odt',
  '.otf',
  '.pdf',
  '.png',
  '.ppt',
  '.pptm',
  '.pptx',
  '.svg',
  '.tar',
  '.tgz',
  '.trace',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsm',
  '.xlsx',
  '.zip',
])

const opaqueArchiveExtensions = new Set(['.7z', '.gz', '.tar', '.tgz', '.zip'])

class ScanFailure extends Error {
  constructor(rule, exitCode = 2) {
    super(rule)
    this.rule = rule
    this.exitCode = exitCode
  }
}

class ByteReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]()
    this.buffer = Buffer.alloc(0)
    this.done = false
  }

  async refill() {
    if (this.buffer.length > 0) return
    if (this.done) throw new ScanFailure('UNEXPECTED_CAT_FILE_EOF')
    const next = await this.iterator.next()
    if (next.done) {
      this.done = true
      throw new ScanFailure('UNEXPECTED_CAT_FILE_EOF')
    }
    this.buffer = Buffer.from(next.value)
  }

  async readLine(maximumBytes = 4096) {
    const parts = []
    let length = 0
    while (true) {
      await this.refill()
      const newline = this.buffer.indexOf(0x0a)
      if (newline !== -1) {
        const part = this.buffer.subarray(0, newline)
        parts.push(part)
        length += part.length
        this.buffer = this.buffer.subarray(newline + 1)
        if (length > maximumBytes) {
          throw new ScanFailure('CAT_FILE_HEADER_TOO_LARGE')
        }
        return Buffer.concat(parts, length).toString('ascii').replace(/\r$/, '')
      }
      parts.push(this.buffer)
      length += this.buffer.length
      this.buffer = Buffer.alloc(0)
      if (length > maximumBytes) {
        throw new ScanFailure('CAT_FILE_HEADER_TOO_LARGE')
      }
    }
  }

  async consume(length, chunkBytes, consumer) {
    let remaining = length
    while (remaining > 0) {
      await this.refill()
      const take = Math.min(remaining, chunkBytes, this.buffer.length)
      const chunk = this.buffer.subarray(0, take)
      this.buffer = this.buffer.subarray(take)
      remaining -= take
      consumer(chunk)
    }
  }

  async readDelimiter() {
    await this.refill()
    if (this.buffer[0] !== 0x0a) {
      throw new ScanFailure('INVALID_CAT_FILE_DELIMITER')
    }
    this.buffer = this.buffer.subarray(1)
  }
}

function parseArguments(argv) {
  let repository = '.'
  let repositoryWasSet = false
  let failOnReview = false
  let chunkBytes = DEFAULT_CHUNK_BYTES
  let maxFindings = DEFAULT_MAX_FINDINGS

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      return { help: true }
    }
    if (argument === '--fail-on-review') {
      failOnReview = true
      continue
    }
    if (argument === '--repo') {
      index += 1
      if (!argv[index]) throw new ScanFailure('MISSING_REPOSITORY_ARGUMENT')
      repository = argv[index]
      repositoryWasSet = true
      continue
    }
    if (argument === '--chunk-bytes') {
      index += 1
      chunkBytes = Number.parseInt(argv[index] ?? '', 10)
      continue
    }
    if (argument === '--max-findings') {
      index += 1
      maxFindings = Number.parseInt(argv[index] ?? '', 10)
      continue
    }
    if (argument.startsWith('-')) throw new ScanFailure('UNKNOWN_ARGUMENT')
    if (repositoryWasSet) throw new ScanFailure('MULTIPLE_REPOSITORY_ARGUMENTS')
    repository = argument
    repositoryWasSet = true
  }

  if (
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 16 ||
    chunkBytes > MAX_CHUNK_BYTES
  ) {
    throw new ScanFailure('INVALID_CHUNK_SIZE')
  }
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 0) {
    throw new ScanFailure('INVALID_FINDING_LIMIT')
  }

  return { repository, failOnReview, chunkBytes, maxFindings }
}

function gitArguments(repository, commandArguments) {
  return [
    '-c',
    `safe.directory=${repository}`,
    '-c',
    'core.quotePath=false',
    '-C',
    repository,
    ...commandArguments,
  ]
}

function runGit(repository, commandArguments, options = {}) {
  const result = spawnSync('git', gitArguments(repository, commandArguments), {
    encoding: options.encoding ?? null,
    env: gitEnvironment,
    input: options.input,
    maxBuffer: options.maxBuffer ?? MAX_ENUMERATION_BYTES,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new ScanFailure(options.failureRule ?? 'GIT_COMMAND_FAILED')
  }
  return result.stdout
}

function tryGit(repository, commandArguments) {
  const result = spawnSync('git', gitArguments(repository, commandArguments), {
    encoding: 'utf8',
    env: gitEnvironment,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

function normalizeRepository(repository) {
  try {
    return realpathSync(resolve(repository)).replaceAll('\\', '/')
  } catch {
    throw new ScanFailure('REPOSITORY_NOT_FOUND')
  }
}

function objectPath(object) {
  if (object.type === 'commit') return '@commit'
  if (object.type === 'tag') return '@tag'
  if (object.paths.size > 0) return [...object.paths].sort()[0]
  return `@${object.type ?? 'object'}`
}

function extensionOf(path) {
  const normalized = path.toLowerCase().split(/[?#]/, 1)[0]
  const slash = normalized.lastIndexOf('/')
  const dot = normalized.lastIndexOf('.')
  return dot > slash ? normalized.slice(dot) : ''
}

function looksLikeBinaryPath(path) {
  return binaryOrMediaExtensions.has(extensionOf(path))
}

function entropy(value) {
  const counts = new Map()
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  let result = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    result -= probability * Math.log2(probability)
  }
  return result
}

function isSynthetic(value, context = '') {
  return /(?:ci[-_]?only|dummy|example|fake|fixture|local[-_]?only|not[-_]?real|placeholder|replace[-_]?with|sample|synthetic|test(?:ing)?|your[-_])/i.test(
    `${value} ${context}`,
  )
}

function isSyntheticTestPath(path) {
  const normalized = path.replaceAll('\\', '/')
  return (
    /(?:^|\/)(?:__tests__|e2e|fixtures?|test|tests)(?:\/|$)/i.test(
      normalized,
    ) ||
    /(?:^|\/)(?:test[-_][^/]+|[^/]+\.(?:spec|test)\.[^/]+)$/i.test(normalized)
  )
}

function isNonPrivateEmail(value) {
  const lower = value.toLowerCase()
  const [, domain = ''] = lower.split('@')
  return (
    domain === 'example.com' ||
    domain === 'example.net' ||
    domain === 'example.org' ||
    domain.endsWith('.example') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.test') ||
    domain === 'users.noreply.github.com' ||
    lower === 'noreply@github.com' ||
    lower === 'noreply@anthropic.com' ||
    lower === 'support@github.com' ||
    lower === 'admin@email.com'
  )
}

function isUrlUserInfoEmail(text, start) {
  const lineStart = Math.max(text.lastIndexOf('\n', start - 1) + 1, 0)
  const prefix = text.slice(lineStart, start)
  const schemeIndex = prefix.lastIndexOf('://')
  if (schemeIndex === -1) return false
  return !/[/?#\s]/.test(prefix.slice(schemeIndex + 3))
}

function isGenericHomeUser(value) {
  return /^(?:default|node|public|root|runner|runneradmin|test|ubuntu|user|username|vscode)$/i.test(
    value,
  )
}

function decodeJwtPayload(token) {
  try {
    const segment = token.split('.')[1]
    const normalized = segment.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(
      Buffer.from(`${normalized}${padding}`, 'base64').toString(),
    )
  } catch {
    return null
  }
}

function addFinding(target, severity, rule) {
  target.add(`${severity}:${rule}`)
}

function inspectWindow(text, findings, binaryPath, syntheticTestPath = false) {
  for (const rule of blockingContentRules) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(text)) addFinding(findings, 'BLOCK', rule.id)
  }
  for (const rule of reviewContentRules) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(text)) addFinding(findings, 'REVIEW', rule.id)
  }

  emailPattern.lastIndex = 0
  for (
    let match = emailPattern.exec(text);
    match;
    match = emailPattern.exec(text)
  ) {
    if (isNonPrivateEmail(match[0])) continue
    if (isUrlUserInfoEmail(text, match.index)) continue
    addFinding(
      findings,
      binaryPath ? 'REVIEW' : 'BLOCK',
      binaryPath ? 'BINARY_EMAIL_PATTERN' : 'PII_EMAIL',
    )
  }

  jwtPattern.lastIndex = 0
  for (
    let match = jwtPattern.exec(text);
    match;
    match = jwtPattern.exec(text)
  ) {
    const start = Math.max(0, match.index - 160)
    const end = Math.min(text.length, jwtPattern.lastIndex + 160)
    const context = text.slice(start, end)
    const payload = decodeJwtPayload(match[0])
    if (payload?.role === 'service_role') {
      addFinding(findings, 'BLOCK', 'SUPABASE_SERVICE_ROLE_JWT')
    } else if (isSynthetic(match[0], context)) {
      addFinding(findings, 'REVIEW', 'SYNTHETIC_JWT_OR_SESSION')
    } else {
      addFinding(findings, 'BLOCK', 'JWT_OR_SESSION_TOKEN')
    }
  }

  secretAssignmentPattern.lastIndex = 0
  for (
    let match = secretAssignmentPattern.exec(text);
    match;
    match = secretAssignmentPattern.exec(text)
  ) {
    const candidate = match[2]
    const start = Math.max(0, match.index - 120)
    const end = Math.min(text.length, secretAssignmentPattern.lastIndex + 120)
    const context = text.slice(start, end)
    if (isSynthetic(candidate, context) || syntheticTestPath) {
      addFinding(findings, 'REVIEW', 'SYNTHETIC_SECRET_ASSIGNMENT')
    } else if (entropy(candidate) >= 3.2) {
      addFinding(findings, 'BLOCK', 'HIGH_ENTROPY_SECRET_ASSIGNMENT')
    } else {
      addFinding(findings, 'REVIEW', 'LOW_ENTROPY_SECRET_ASSIGNMENT')
    }
  }

  basicAuthUrlPattern.lastIndex = 0
  for (
    let match = basicAuthUrlPattern.exec(text);
    match;
    match = basicAuthUrlPattern.exec(text)
  ) {
    const context = text.slice(
      Math.max(0, match.index - 100),
      Math.min(text.length, basicAuthUrlPattern.lastIndex + 100),
    )
    addFinding(
      findings,
      isSynthetic(`${match[1]}:${match[2]}`, context) ? 'REVIEW' : 'BLOCK',
      isSynthetic(`${match[1]}:${match[2]}`, context)
        ? 'SYNTHETIC_URL_USERINFO'
        : 'URL_WITH_CREDENTIALS',
    )
  }

  sixDigitAuthPattern.lastIndex = 0
  if (sixDigitAuthPattern.test(text)) {
    addFinding(findings, 'REVIEW', 'SIX_DIGIT_AUTH_CONTEXT')
  }

  windowsHomePattern.lastIndex = 0
  for (
    let match = windowsHomePattern.exec(text);
    match;
    match = windowsHomePattern.exec(text)
  ) {
    addFinding(
      findings,
      isGenericHomeUser(match[1]) ? 'REVIEW' : 'BLOCK',
      isGenericHomeUser(match[1]) ? 'GENERIC_HOME_PATH' : 'PII_HOME_PATH',
    )
  }

  unixHomePattern.lastIndex = 0
  for (
    let match = unixHomePattern.exec(text);
    match;
    match = unixHomePattern.exec(text)
  ) {
    addFinding(
      findings,
      isGenericHomeUser(match[1]) ? 'REVIEW' : 'BLOCK',
      isGenericHomeUser(match[1]) ? 'GENERIC_HOME_PATH' : 'PII_HOME_PATH',
    )
  }
}

class ContentScanner {
  constructor(object) {
    const paths = [...object.paths].sort()
    this.binaryPath =
      paths.length > 0 && paths.every((path) => looksLikeBinaryPath(path))
    this.syntheticTestPath =
      paths.length > 0 && paths.every((path) => isSyntheticTestPath(path))
    this.findings = new Set()
    this.tail = ''
  }

  push(buffer) {
    const text = `${this.tail}${buffer.toString('latin1')}`
    inspectWindow(text, this.findings, this.binaryPath, this.syntheticTestPath)
    this.tail = text.slice(-OVERLAP_BYTES)
  }
}

function inspectPath(path) {
  const findings = new Set()
  const normalized = path.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  const extension = extensionOf(lower)

  if (
    (base === '.env' || base.startsWith('.env.')) &&
    !/(?:^|\.)(?:example|sample|template)$/.test(base)
  ) {
    addFinding(findings, 'BLOCK', 'PRIVATE_ENV_FILE_PATH')
  }
  if (
    (base === '.dev.vars' || base.startsWith('.dev.vars.')) &&
    !/(?:^|\.)(?:example|sample|template)$/.test(base)
  ) {
    addFinding(findings, 'BLOCK', 'PRIVATE_DEV_VARS_PATH')
  }
  if (
    /(?:^|\/)(?:playwright\/\.auth|\.auth)(?:\/|$)/.test(lower) ||
    /(?:^|[-_.])(?:auth|browser|storage)[-_.]?state(?:[-_.]|$)/.test(base) ||
    /(?:^|[-_.])cookies?(?:[-_.]|$)/.test(base)
  ) {
    addFinding(findings, 'BLOCK', 'AUTHENTICATED_STATE_PATH')
  }
  if (
    /(?:^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(lower) ||
    /\.(?:jks|key|keystore|p12|pem|pfx)$/.test(lower)
  ) {
    addFinding(findings, 'BLOCK', 'PRIVATE_KEY_OR_KEYSTORE_PATH')
  }
  if (/\.(?:bak|db|dump|sqlite|sqlite3)$/.test(lower)) {
    addFinding(findings, 'BLOCK', 'DATABASE_OR_BACKUP_PATH')
  }
  if (
    /(?:^|\/)\.phase7-30f-evidence[^/]*\.json$/.test(lower) ||
    /(?:^|\/)(?:credential|credentials|service-account|session-token)\.json$/.test(
      lower,
    )
  ) {
    addFinding(findings, 'BLOCK', 'PRIVATE_EVIDENCE_OR_CREDENTIAL_PATH')
  }
  if (
    /(?:^|\/)(?:test-results|playwright-report|blob-report)(?:\/|$)/.test(
      lower,
    ) ||
    /\.(?:har|log|trace|webm)$/.test(lower)
  ) {
    addFinding(findings, 'REVIEW', 'TEST_OR_RUNTIME_EVIDENCE_PATH')
  }
  if (opaqueArchiveExtensions.has(extension)) {
    addFinding(findings, 'REVIEW', 'OPAQUE_ARCHIVE_PATH')
  } else if (binaryOrMediaExtensions.has(extension)) {
    addFinding(findings, 'REVIEW', 'BINARY_OR_MEDIA_ASSET_PATH')
  }
  if (/^(?:\.netrc|\.npmrc|\.pypirc)$/.test(base)) {
    addFinding(findings, 'REVIEW', 'SENSITIVE_TOOL_CONFIG_PATH')
  }

  const pathContentFindings = new Set()
  inspectWindow(normalized, pathContentFindings, false)
  for (const finding of pathContentFindings) findings.add(finding)

  return findings
}

function redactPath(path) {
  let result = ''
  for (const character of path) {
    const code = character.charCodeAt(0)
    result += code <= 0x1f || code === 0x7f ? '?' : character
  }
  for (const rule of [...blockingContentRules, ...reviewContentRules]) {
    result = replaceAllMatches(result, rule.pattern, '<redacted-indicator>')
  }
  result = replaceAllMatches(result, emailPattern, '<redacted-email>')
  result = replaceAllMatches(result, jwtPattern, '<redacted-token>')
  result = replaceAllMatches(
    result,
    secretAssignmentPattern,
    (match, _quote, value) => match.replace(value, '<redacted-secret>'),
  )
  result = replaceAllMatches(result, basicAuthUrlPattern, (match) => {
    const authorityStart = match.indexOf('://') + 3
    return `${match.slice(0, authorityStart)}<redacted-userinfo>@`
  })
  result = replaceAllMatches(result, sixDigitAuthPattern, (match, code) =>
    match.replace(code, '<redacted-code>'),
  )
  result = replaceAllMatches(result, windowsHomePattern, (match, user) =>
    match.replace(user, '<redacted-user>'),
  )
  result = replaceAllMatches(result, unixHomePattern, (match, user) =>
    match.replace(user, '<redacted-user>'),
  )
  return JSON.stringify(result)
}

function replaceAllMatches(text, pattern, replacement) {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`
  return text.replace(new RegExp(pattern.source, flags), replacement)
}

function parseReachableObjects(buffer) {
  const objects = new Map()
  const missing = new Set()
  const segments = buffer.toString('utf8').split('\0')
  let currentObject = null

  for (const segment of segments) {
    if (!segment) continue
    const objectMatch = /^([0-9a-f]{40}|[0-9a-f]{64})$/.exec(segment)
    if (objectMatch) {
      currentObject = objectMatch[1]
      if (!objects.has(currentObject)) {
        objects.set(currentObject, { oid: currentObject, paths: new Set() })
      }
      continue
    }
    const pathMatch = /^path=([\s\S]*)$/.exec(segment)
    if (pathMatch && currentObject) {
      objects.get(currentObject).paths.add(pathMatch[1])
      continue
    }
    if (segment === 'missing=yes' && currentObject) {
      missing.add(currentObject)
      currentObject = null
      continue
    }
    const missingMatch = /^(?:missing=|\?)([0-9a-f]{40}|[0-9a-f]{64})$/.exec(
      segment,
    )
    if (missingMatch) {
      missing.add(missingMatch[1])
      currentObject = null
      continue
    }

    const legacyMatch =
      /^(\??)([0-9a-f]{40}|[0-9a-f]{64})(?: ([\s\S]*))?$/.exec(segment)
    if (legacyMatch) {
      if (legacyMatch[1] === '?') {
        missing.add(legacyMatch[2])
        currentObject = null
      } else {
        currentObject = legacyMatch[2]
        if (!objects.has(currentObject)) {
          objects.set(currentObject, { oid: currentObject, paths: new Set() })
        }
        if (legacyMatch[3]) objects.get(currentObject).paths.add(legacyMatch[3])
      }
      continue
    }
    throw new ScanFailure('UNRECOGNIZED_REV_LIST_OUTPUT')
  }

  return { objects, missing }
}

function attachObjectMetadata(repository, objects) {
  const objectIds = [...objects.keys()].sort()
  const output = runGit(
    repository,
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    {
      input: Buffer.from(`${objectIds.join('\n')}\n`),
      failureRule: 'CAT_FILE_CHECK_FAILED',
    },
  ).toString('utf8')
  const seen = new Set()
  const missing = new Set()

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue
    const match =
      /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|commit|tag|tree) ([0-9]+)$/.exec(line)
    const missingMatch = /^([0-9a-f]{40}|[0-9a-f]{64}) missing$/.exec(line)
    if (missingMatch) {
      missing.add(missingMatch[1])
      continue
    }
    if (!match) throw new ScanFailure('UNRECOGNIZED_CAT_FILE_CHECK_OUTPUT')
    const [, oid, type, sizeText] = match
    const size = Number.parseInt(sizeText, 10)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ScanFailure('UNSUPPORTED_OBJECT_SIZE')
    }
    const object = objects.get(oid)
    if (!object) throw new ScanFailure('UNEXPECTED_OBJECT_METADATA')
    object.type = type
    object.size = size
    seen.add(oid)
  }

  if (seen.size + missing.size !== objectIds.length) {
    throw new ScanFailure('INCOMPLETE_OBJECT_METADATA')
  }
  return missing
}

async function scanObjectContents(repository, objects, chunkBytes, addResult) {
  const scanTargets = [...objects.values()]
    .filter((object) => ['blob', 'commit', 'tag'].includes(object.type))
    .sort((left, right) => left.oid.localeCompare(right.oid))
  const child = spawn(
    'git',
    gitArguments(repository, ['cat-file', '--batch']),
    {
      env: gitEnvironment,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    },
  )
  const reader = new ByteReader(child.stdout)
  let childError = null
  child.once('error', (error) => {
    childError = error
  })

  for (const object of scanTargets) {
    if (childError) throw new ScanFailure('CAT_FILE_PROCESS_FAILED')
    if (!child.stdin.write(`${object.oid}\n`)) await once(child.stdin, 'drain')
    const header = await reader.readLine()
    const match =
      /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|commit|tag) ([0-9]+)$/.exec(header)
    if (!match) {
      if (/ missing$/.test(header)) throw new ScanFailure('MISSING_OBJECT')
      throw new ScanFailure('UNRECOGNIZED_CAT_FILE_HEADER')
    }
    if (
      match[1] !== object.oid ||
      match[2] !== object.type ||
      Number.parseInt(match[3], 10) !== object.size
    ) {
      throw new ScanFailure('CAT_FILE_OBJECT_MISMATCH')
    }

    const path = objectPath(object)
    const scanner = new ContentScanner(object)
    await reader.consume(object.size, chunkBytes, (chunk) =>
      scanner.push(chunk),
    )
    await reader.readDelimiter()
    for (const finding of scanner.findings) {
      const separator = finding.indexOf(':')
      addResult(
        finding.slice(0, separator),
        object.oid,
        path,
        finding.slice(separator + 1),
      )
    }
  }

  child.stdin.end()
  const [status] = await once(child, 'close')
  if (childError || status !== 0)
    throw new ScanFailure('CAT_FILE_PROCESS_FAILED')
}

function emitOperationalFailure(rule, object = '-') {
  console.log(`ERROR object=${object} path="@repository" rule=${rule}`)
  console.log(
    'PUBLICATION_HISTORY_SCAN=INCOMPLETE refs=0 objects=0 blobs=0 blocking=0 review=0 emitted=1',
  )
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    const failure =
      error instanceof ScanFailure ? error : new ScanFailure('INVALID_ARGUMENT')
    emitOperationalFailure(failure.rule)
    process.exitCode = failure.exitCode
    return
  }

  if (options.help) {
    console.log(
      'Usage: node scripts/ci/scan-publication-history.mjs [--repo] <repository> [--fail-on-review] [--max-findings N]',
    )
    return
  }

  let repository
  try {
    repository = normalizeRepository(options.repository)
    runGit(repository, ['rev-parse', '--git-dir'], {
      failureRule: 'NOT_A_GIT_REPOSITORY',
    })
    const shallow = runGit(
      repository,
      ['rev-parse', '--is-shallow-repository'],
      { encoding: 'utf8', failureRule: 'SHALLOW_CHECK_FAILED' },
    ).trim()
    if (shallow === 'true') throw new ScanFailure('SHALLOW_REPOSITORY')

    const refs = runGit(
      repository,
      ['for-each-ref', '--format=%(objectname) %(refname)'],
      { encoding: 'utf8', failureRule: 'REF_ENUMERATION_FAILED' },
    )
      .split(/\r?\n/)
      .filter(Boolean)
    const hasHead =
      tryGit(repository, ['rev-parse', '--verify', 'HEAD']) !== null
    if (refs.length === 0 && !hasHead)
      throw new ScanFailure('NO_REACHABLE_REFS')

    const revisions = ['--all']
    if (hasHead) revisions.push('HEAD')
    const enumeration = runGit(
      repository,
      ['rev-list', '--objects', '-z', '--missing=print', ...revisions],
      { failureRule: 'OBJECT_ENUMERATION_FAILED' },
    )
    const { objects, missing } = parseReachableObjects(enumeration)

    if (missing.size > 0) {
      for (const oid of [...missing].sort().slice(0, options.maxFindings)) {
        console.log(
          `ERROR object=${oid} path="@repository" rule=MISSING_OBJECT`,
        )
      }
      console.log(
        `PUBLICATION_HISTORY_SCAN=INCOMPLETE refs=${refs.length} objects=${objects.size} blobs=0 blocking=0 review=0 emitted=${Math.min(missing.size, options.maxFindings)}`,
      )
      process.exitCode = 2
      return
    }

    const metadataMissing = attachObjectMetadata(repository, objects)
    if (metadataMissing.size > 0) {
      for (const oid of [...metadataMissing]
        .sort()
        .slice(0, options.maxFindings)) {
        console.log(
          `ERROR object=${oid} path="@repository" rule=MISSING_OBJECT`,
        )
      }
      console.log(
        `PUBLICATION_HISTORY_SCAN=INCOMPLETE refs=${refs.length} objects=${objects.size} blobs=0 blocking=0 review=0 emitted=${Math.min(metadataMissing.size, options.maxFindings)}`,
      )
      process.exitCode = 2
      return
    }

    const connectivity = spawnSync(
      'git',
      gitArguments(repository, [
        'fsck',
        '--connectivity-only',
        '--strict',
        '--no-reflogs',
        '--no-dangling',
      ]),
      {
        encoding: null,
        env: gitEnvironment,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
    )
    if (connectivity.error || connectivity.status !== 0) {
      throw new ScanFailure('GIT_CONNECTIVITY_FAILED')
    }

    const results = new Map()
    const addResult = (severity, oid, path, rule) => {
      const key = `${severity}\0${oid}\0${path}\0${rule}`
      if (!results.has(key)) results.set(key, { severity, oid, path, rule })
    }

    for (const object of objects.values()) {
      if (object.type !== 'blob') continue
      for (const path of object.paths) {
        for (const finding of inspectPath(path)) {
          const separator = finding.indexOf(':')
          addResult(
            finding.slice(0, separator),
            object.oid,
            path,
            finding.slice(separator + 1),
          )
        }
      }
    }

    for (const ref of refs) {
      const separator = ref.indexOf(' ')
      const oid = ref.slice(0, separator)
      const name = ref.slice(separator + 1)
      for (const finding of inspectPath(`@ref/${name}`)) {
        const findingSeparator = finding.indexOf(':')
        addResult(
          finding.slice(0, findingSeparator),
          oid,
          `@ref/${name}`,
          finding.slice(findingSeparator + 1),
        )
      }
    }

    await scanObjectContents(repository, objects, options.chunkBytes, addResult)

    const sorted = [...results.values()].sort(
      (left, right) =>
        left.severity.localeCompare(right.severity) ||
        left.rule.localeCompare(right.rule) ||
        left.path.localeCompare(right.path) ||
        left.oid.localeCompare(right.oid),
    )
    const blocking = sorted.filter((finding) => finding.severity === 'BLOCK')
    const review = sorted.filter((finding) => finding.severity === 'REVIEW')
    const emitted = sorted.slice(0, options.maxFindings)
    for (const finding of emitted) {
      console.log(
        `${finding.severity} object=${finding.oid} path=${redactPath(finding.path)} rule=${finding.rule}`,
      )
    }

    const blobs = [...objects.values()].filter(
      (object) => object.type === 'blob',
    ).length
    const state =
      blocking.length > 0 ? 'BLOCKED' : review.length > 0 ? 'REVIEW' : 'PASS'
    console.log(
      `PUBLICATION_HISTORY_SCAN=${state} refs=${refs.length} objects=${objects.size} blobs=${blobs} blocking=${blocking.length} review=${review.length} emitted=${emitted.length}`,
    )
    if (blocking.length > 0 || (options.failOnReview && review.length > 0)) {
      process.exitCode = 1
    }
  } catch (error) {
    const failure =
      error instanceof ScanFailure
        ? error
        : new ScanFailure('UNEXPECTED_SCANNER_FAILURE')
    emitOperationalFailure(failure.rule)
    process.exitCode = failure.exitCode
  }
}

await main()
