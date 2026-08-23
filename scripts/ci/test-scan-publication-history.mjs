import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scanner = fileURLToPath(
  new URL('./scan-publication-history.mjs', import.meta.url),
)
const root = mkdtempSync(join(tmpdir(), 'compass-publication-scan-'))

function git(repository, arguments_, options = {}) {
  return execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${repository.replaceAll('\\', '/')}`,
      '-C',
      repository,
      ...arguments_,
    ],
    {
      encoding: options.encoding ?? 'utf8',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
      },
      input: options.input,
      windowsHide: true,
    },
  ).trim()
}

function commit(repository, message, email = 'scanner@example.test') {
  git(repository, ['add', '.'])
  git(repository, [
    '-c',
    'user.name=Publication Scanner Test',
    '-c',
    `user.email=${email}`,
    'commit',
    '-q',
    '-m',
    message,
  ])
}

function runScanner(repository, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [
      scanner,
      '--repo',
      repository,
      '--chunk-bytes',
      '1024',
      '--max-findings',
      '200',
      ...extraArguments,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
}

try {
  const clean = join(root, 'clean')
  mkdirSync(clean)
  git(clean, ['init', '-q'])
  writeFileSync(join(clean, 'README.md'), 'Synthetic publication test.\n')
  commit(clean, 'clean history')

  const cleanResult = runScanner(clean)
  assert.equal(cleanResult.status, 0, cleanResult.stdout)
  assert.match(cleanResult.stdout, /PUBLICATION_HISTORY_SCAN=PASS/)

  const genericSecret = Array.from({ length: 48 }, (_, index) =>
    String.fromCharCode(65 + ((index * 7) % 26)),
  ).join('')
  mkdirSync(join(clean, 'e2e'))
  mkdirSync(join(clean, 'scripts'))
  writeFileSync(
    join(clean, 'e2e', 'synthetic.spec.ts'),
    `const token = "${genericSecret}"\nconst url = "https://user:fake-password-value@service.internal/path"\n`,
  )
  writeFileSync(
    join(clean, 'scripts', 'test-synthetic.ts'),
    `const client_secret = "${genericSecret}"\n`,
  )
  writeFileSync(join(clean, 'sample.pdf'), '%PDF-1.4\nsynthetic fixture\n')
  commit(clean, 'review-only history')
  const reviewResult = runScanner(clean)
  assert.equal(reviewResult.status, 0, reviewResult.stdout)
  assert.match(reviewResult.stdout, /PUBLICATION_HISTORY_SCAN=REVIEW/)
  assert.match(reviewResult.stdout, /rule=BINARY_OR_MEDIA_ASSET_PATH/)
  assert.match(reviewResult.stdout, /rule=SYNTHETIC_SECRET_ASSIGNMENT/)
  assert.doesNotMatch(reviewResult.stdout, /rule=PII_EMAIL/)
  const strictReviewResult = runScanner(clean, ['--fail-on-review'])
  assert.equal(strictReviewResult.status, 1, strictReviewResult.stdout)

  const leak = join(root, 'leak')
  mkdirSync(leak)
  git(leak, ['init', '-q'])
  writeFileSync(join(leak, 'README.md'), 'Initial synthetic test.\n')
  commit(leak, 'initial history')

  const secret = ['sk', 'proj', 'A'.repeat(36)].join('-')
  const privateEmail = ['owner', 'gmail.com'].join('@')
  const binary = Buffer.concat([
    Buffer.alloc(1013, 0xff),
    Buffer.from(secret),
    Buffer.alloc(2 * 1024 * 1024, 0x00),
  ])
  writeFileSync(join(leak, 'evidence.bin'), binary)
  writeFileSync(
    join(leak, 'credential.txt'),
    `client_secret = "${genericSecret}"\n`,
  )
  mkdirSync(join(leak, 'prefix', 'Users', 'private-user'), {
    recursive: true,
  })
  writeFileSync(
    join(leak, 'prefix', 'Users', 'private-user', 'totp-code-123456.txt'),
    'path redaction test\n',
  )
  commit(leak, 'history containing blocked material', privateEmail)

  const leakResult = runScanner(leak)
  assert.equal(leakResult.status, 1, leakResult.stdout)
  assert.match(leakResult.stdout, /rule=HIGH_ENTROPY_SECRET_ASSIGNMENT/)
  assert.match(leakResult.stdout, /rule=OPENAI_API_KEY/)
  assert.match(leakResult.stdout, /path="@commit" rule=PII_EMAIL/)
  assert.doesNotMatch(leakResult.stdout, new RegExp(secret))
  assert.doesNotMatch(leakResult.stdout, new RegExp(privateEmail))
  assert.doesNotMatch(leakResult.stdout, /private-user|123456/)
  assert.match(leakResult.stdout, /redacted-user/)
  assert.match(leakResult.stdout, /redacted-code/)

  const bare = join(root, 'leak.git')
  execFileSync('git', ['clone', '-q', '--bare', leak, bare], {
    windowsHide: true,
  })
  const bareResult = runScanner(bare)
  assert.equal(bareResult.status, 1, bareResult.stdout)
  assert.match(bareResult.stdout, /rule=OPENAI_API_KEY/)
  assert.match(bareResult.stdout, /rule=PII_EMAIL/)
  assert.doesNotMatch(bareResult.stdout, new RegExp(secret))
  assert.doesNotMatch(bareResult.stdout, new RegExp(privateEmail))

  const missing = join(root, 'missing')
  mkdirSync(missing)
  git(missing, ['init', '-q'])
  writeFileSync(join(missing, 'missing.txt'), 'object removed after commit\n')
  commit(missing, 'missing-object test')
  const blob = git(missing, ['rev-parse', 'HEAD:missing.txt'])
  const gitDirectory = git(missing, ['rev-parse', '--absolute-git-dir'])
  const looseObject = join(
    gitDirectory,
    'objects',
    blob.slice(0, 2),
    blob.slice(2),
  )
  unlinkSync(looseObject)
  const missingResult = runScanner(missing)
  assert.equal(missingResult.status, 2, missingResult.stdout)
  assert.match(
    missingResult.stdout,
    /rule=(?:MISSING_OBJECT|OBJECT_ENUMERATION_FAILED)/,
  )

  console.log('Publication history scanner focused tests: PASS')
} finally {
  rmSync(root, { recursive: true, force: true })
}
