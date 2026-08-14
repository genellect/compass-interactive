import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const contractOnly = process.argv.includes('--contract-only')
const failures = []

function pass(message) {
  console.log(`[cloud-handoff] PASS ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`[cloud-handoff] FAIL ${message}`)
}

function requireFile(relativePath) {
  if (existsSync(resolve(root, relativePath))) {
    pass(relativePath)
  } else {
    fail(`${relativePath} is missing`)
  }
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

function gitSucceeds(args) {
  return (
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).status === 0
  )
}

for (const file of [
  'AGENTS.md',
  '.codex/setup.sh',
  '.devcontainer/devcontainer.json',
  '.github/workflows/ci.yml',
  '.github/workflows/devcontainer-contract.yml',
  'docs/LECTURE_CYCLE_PRODUCTION_CANDIDATE_PLAN.md',
  'docs/LECTURE_CYCLE_CLOUD_AGENT_PLAYBOOK.md',
  'docs/CLOUD_DEVELOPMENT.md',
  'scripts/cloud-workspace-doctor.mjs',
  'scripts/cloud-handoff-doctor.mjs',
]) {
  requireFile(file)
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)
if (packageJson.private === true) {
  pass('package.json keeps the repository private')
} else {
  fail('package.json must keep private=true')
}

if (
  packageJson.scripts?.['cloud:handoff'] ===
  'npm run cloud:doctor && node scripts/cloud-handoff-doctor.mjs'
) {
  pass('cloud:handoff package command')
} else {
  fail('cloud:handoff package command is missing or changed')
}

const origin = git(['remote', 'get-url', 'origin']) ?? ''
if (
  /(?:github\.com[/:])genellect\/compass-interactive(?:\.git)?$/i.test(origin)
) {
  pass('canonical private repository origin')
} else {
  fail('origin is not genellect/compass-interactive')
}

const tracked = (git(['ls-files', '-z']) ?? '').split('\0').filter(Boolean)

const forbiddenTrackedEvidence = tracked.filter((path) =>
  /^\.phase7-30f-evidence.*\.json$/i.test(path),
)
if (forbiddenTrackedEvidence.length === 0) {
  pass('no tracked Phase 7.30F private evidence')
} else {
  fail(`tracked private evidence: ${forbiddenTrackedEvidence.join(', ')}`)
}

const forbiddenTrackedEnvironment = tracked.filter(
  (path) => /(^|\/)\.env(?:$|\.)/i.test(path) && !/\.example$/i.test(path),
)
if (forbiddenTrackedEnvironment.length === 0) {
  pass('no tracked non-example .env file')
} else {
  fail(`tracked environment file: ${forbiddenTrackedEnvironment.join(', ')}`)
}

for (const path of tracked) {
  if (
    /^(?:dist|playwright-report|test-results|supabase\/.temp)(?:\/|$)/i.test(
      path,
    )
  ) {
    fail(`tracked generated/private runtime artifact: ${path}`)
  }
}
if (
  !tracked.some((path) =>
    /^(?:dist|playwright-report|test-results|supabase\/.temp)(?:\/|$)/i.test(
      path,
    ),
  )
) {
  pass('no tracked generated runtime artifact')
}

if (!contractOnly) {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch && !/^(?:main|master)$/i.test(branch)) {
    pass(`dedicated non-main branch ${branch}`)
  } else {
    fail('handoff requires a dedicated non-main branch')
  }

  const head = git(['rev-parse', 'HEAD'])
  if (/^[0-9a-f]{40}$/.test(head ?? '')) {
    pass(`exact HEAD ${head}`)
  } else {
    fail('exact 40-character HEAD is unavailable')
  }

  const upstream = git([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (upstream?.startsWith('origin/')) {
    pass(`remote upstream ${upstream}`)
  } else {
    fail('branch must have an origin/* upstream before disconnect')
  }

  const upstreamHead = git(['rev-parse', '@{upstream}'])
  if (head && upstreamHead === head) {
    pass('HEAD is pushed exactly to its upstream')
  } else {
    fail('local HEAD and upstream HEAD differ')
  }

  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (status === '') {
    pass('clean tracked and untracked worktree')
  } else {
    fail('worktree has uncommitted or untracked files')
  }

  const originMain = git(['rev-parse', 'origin/main'])
  if (
    /^[0-9a-f]{40}$/.test(originMain ?? '') &&
    gitSucceeds(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
  ) {
    pass(`origin/main ${originMain} is an ancestor of HEAD`)
  } else {
    fail('HEAD is not based on the fetched origin/main')
  }

  const diffCheck = spawnSync(
    'git',
    ['diff', '--check', 'origin/main...HEAD'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (diffCheck.status === 0) {
    pass('branch diff has no whitespace errors')
  } else {
    fail('git diff --check failed')
  }
}

if (failures.length > 0) {
  console.error(
    `[cloud-handoff] NOT READY: ${failures.length} contract check(s) failed.`,
  )
  process.exit(1)
}

if (contractOnly) {
  console.log(
    '[cloud-handoff] READY cloud handoff contract. Push/clean/upstream state was not evaluated.',
  )
} else {
  console.log(
    '[cloud-handoff] READY_FOR_DISCONNECTED_CLOUD_EXECUTION source/test work only. Hosted, paid, Human and Production actions remain separately approved.',
  )
}
