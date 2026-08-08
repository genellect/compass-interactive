import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

function pass(message) {
  console.log(`[cloud-doctor] PASS ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`[cloud-doctor] FAIL ${message}`)
}

function requireFile(relativePath) {
  if (existsSync(resolve(root, relativePath))) {
    pass(relativePath)
  } else {
    fail(`${relativePath} is missing`)
  }
}

function command(commandName, args) {
  try {
    return execFileSync(commandName, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value)
  return match ? match.slice(1).map(Number) : null
}

function versionAtLeast(actual, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

for (const file of [
  'AGENTS.md',
  'package.json',
  'package-lock.json',
  '.node-version',
  '.devcontainer/devcontainer.json',
  'docs/CLOUD_DEVELOPMENT.md',
  'docs/GATE_ROUTING.md',
]) {
  requireFile(file)
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)
const packageLock = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
)
if (
  packageLock.name === packageJson.name &&
  packageLock.version === packageJson.version &&
  packageLock.packages?.['']?.version === packageJson.version
) {
  pass('package.json and package-lock.json identity')
} else {
  fail('package.json and package-lock.json identity drift')
}

const minimumNode = parseVersion(
  String(packageJson.engines?.node ?? '').replace(/^>=/, ''),
)
const actualNode = parseVersion(process.versions.node)
if (minimumNode && actualNode && versionAtLeast(actualNode, minimumNode)) {
  pass(`Node.js ${process.versions.node} satisfies ${packageJson.engines.node}`)
} else {
  fail(
    `Node.js ${process.versions.node} does not satisfy ${packageJson.engines?.node}`,
  )
}

if (existsSync(resolve(root, 'node_modules', '.package-lock.json'))) {
  pass('npm dependencies are installed from the lockfile')
} else {
  fail('node_modules is missing; run npm ci')
}

for (const dependency of ['playwright', 'supabase', 'vite']) {
  const binary = resolve(root, 'node_modules', '.bin', dependency)
  if (
    existsSync(binary) ||
    existsSync(`${binary}.cmd`) ||
    existsSync(`${binary}.ps1`)
  ) {
    pass(`${dependency} locked binary`)
  } else {
    fail(`${dependency} locked binary is missing`)
  }
}

const supabaseFunctions = readdirSync(resolve(root, 'supabase', 'functions'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort()
const supabaseConfig = readFileSync(
  resolve(root, 'supabase', 'config.toml'),
  'utf8',
)
const functionsMissingPolicy = supabaseFunctions.filter(
  (functionName) =>
    !supabaseConfig.includes(`[functions.${functionName}]`),
)
if (functionsMissingPolicy.length === 0) {
  pass(`${supabaseFunctions.length} Edge Functions have explicit JWT policy`)
} else {
  fail(
    `Edge Functions missing explicit JWT policy: ${functionsMissingPolicy.join(', ')}`,
  )
}

if (command('git', ['rev-parse', '--is-inside-work-tree']) === 'true') {
  pass('operable Git worktree')
} else {
  fail('workspace is not an operable Git worktree')
}

const origin = command('git', ['remote', 'get-url', 'origin']) ?? ''
const canonicalOrigin =
  /(?:github\.com[/:])genellect\/compass-interactive(?:\.git)?$/i
if (canonicalOrigin.test(origin)) {
  pass('canonical GitHub origin genellect/compass-interactive')
} else {
  fail('origin is not the canonical genellect/compass-interactive repository')
}

const head = command('git', ['rev-parse', '--short=12', 'HEAD'])
if (head) {
  pass(`Git HEAD ${head}`)
} else {
  fail('Git HEAD could not be resolved')
}

if (failures.length > 0) {
  console.error(
    `[cloud-doctor] NOT READY: ${failures.length} contract check(s) failed.`,
  )
  process.exit(1)
}

console.log(
  '[cloud-doctor] READY non-live cloud workspace. Docker, Hosted services, paid APIs and Windows COM were not probed.',
)
