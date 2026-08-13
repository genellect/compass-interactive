import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const trackedFiles = execFileSync('git', ['ls-files', '--cached', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
const scannedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean)
const rules = [
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
]
const forbiddenTrackedEvidencePath =
  /(?:^|\/)\.phase7-30f-evidence[^/]*\.json$/i
const findings = trackedFiles
  .map((relative) => relative.replaceAll('\\', '/'))
  .filter((relative) => forbiddenTrackedEvidencePath.test(relative))
  .map((relative) =>
    `${relative} [Forbidden tracked Phase 7.30F operator evidence]`,
  )

for (const relative of scannedFiles) {
  const path = resolve(root, relative)
  // `git ls-files --cached` still reports a tracked file while it is staged or
  // pending deletion in the working tree. There is no content to scan in that
  // state, and the path will disappear from the index once the deletion is
  // committed.
  if (!existsSync(path)) continue
  if (statSync(path).size > 1_000_000) continue
  const buffer = readFileSync(path)
  if (buffer.includes(0)) continue
  const text = buffer.toString('utf8')
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length
      findings.push(`${relative}:${line} [${name}]`)
    }
  }
}

if (findings.length > 0) {
  console.error(
    'Forbidden tracked evidence paths or high-confidence secret patterns were found:',
  )
  findings.forEach((finding) => console.error(`- ${finding}`))
  process.exit(1)
}

console.log(
  `Secret scan passed across ${scannedFiles.length} tracked and untracked files.`,
)
