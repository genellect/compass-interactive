import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findForbiddenTrackedEnvironment,
  findForbiddenTrackedEvidence,
  findForbiddenTrackedRuntimeArtifacts,
} from './cloud-handoff-policy.mjs'

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

function remoteRef(remote, ref, { withoutCredentials = false } = {}) {
  const args = withoutCredentials
    ? [
        '-c',
        'credential.helper=',
        '-c',
        'core.askPass=',
        'ls-remote',
        '--exit-code',
        remote,
        ref,
      ]
    : ['ls-remote', '--exit-code', remote, ref]
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const sha = result.stdout?.trim().split(/\s+/u)[0] ?? ''
  return {
    status: result.status,
    sha: /^[0-9a-f]{40}$/u.test(sha) ? sha : null,
    stderr: result.stderr ?? '',
  }
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
  'scripts/cloud-handoff-policy.mjs',
  'scripts/cloud-handoff-doctor.mjs',
]) {
  requireFile(file)
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)
if (packageJson.private === true) {
  pass('package.json disables npm package publication')
} else {
  fail('package.json must keep private=true to disable npm publication')
}

if (
  packageJson.scripts?.['cloud:handoff'] ===
  'npm run cloud:doctor && npm run security:secrets && node scripts/cloud-handoff-doctor.mjs'
) {
  pass('cloud:handoff package command')
} else {
  fail('cloud:handoff package command is missing or changed')
}

const origin = git(['remote', 'get-url', 'origin']) ?? ''
if (
  /(?:github\.com[/:])genellect\/compass-interactive(?:\.git)?$/i.test(origin)
) {
  pass('canonical repository origin')
} else {
  fail('origin is not genellect/compass-interactive')
}

const tracked = (git(['ls-files', '-z']) ?? '').split('\0').filter(Boolean)

const forbiddenTrackedEvidence = findForbiddenTrackedEvidence(tracked)
if (forbiddenTrackedEvidence.length === 0) {
  pass('no tracked Phase 7.30F private evidence')
} else {
  fail(`tracked private evidence: ${forbiddenTrackedEvidence.join(', ')}`)
}

const forbiddenTrackedEnvironment = findForbiddenTrackedEnvironment(tracked)
if (forbiddenTrackedEnvironment.length === 0) {
  pass('no tracked non-example .env or .dev.vars file')
} else {
  fail(`tracked environment file: ${forbiddenTrackedEnvironment.join(', ')}`)
}

const forbiddenTrackedRuntimeArtifacts =
  findForbiddenTrackedRuntimeArtifacts(tracked)
if (forbiddenTrackedRuntimeArtifacts.length === 0) {
  pass('no tracked generated runtime artifact')
} else {
  fail(
    `tracked generated/private runtime artifact: ${forbiddenTrackedRuntimeArtifacts.join(', ')}`,
  )
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
  const remoteMain = remoteRef(origin, 'refs/heads/main')
  if (remoteMain.sha && remoteMain.sha === originMain) {
    pass(`origin/main matches current remote main ${remoteMain.sha}`)
  } else {
    fail('origin/main is stale or the current remote main cannot be verified')
  }

  if (
    /^[0-9a-f]{40}$/.test(originMain ?? '') &&
    remoteMain.sha === originMain &&
    gitSucceeds(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
  ) {
    pass(`origin/main ${originMain} is an ancestor of HEAD`)
  } else {
    fail('HEAD is not based on the fetched origin/main')
  }

  const remoteBranch = branch
    ? remoteRef(origin, `refs/heads/${branch}`)
    : { sha: null }
  if (head && remoteBranch.sha === head) {
    pass('exact HEAD exists on the current remote branch')
  } else {
    fail('exact HEAD is not present on the current remote branch')
  }

  const anonymousProbe = remoteRef(
    'https://github.com/genellect/compass-interactive.git',
    'refs/heads/main',
    { withoutCredentials: true },
  )
  if (anonymousProbe.sha) {
    fail('GitHub repository is anonymously readable; private visibility failed')
  } else if (
    remoteMain.sha &&
    /(?:terminal prompts disabled|authentication failed|repository not found|could not read username)/iu.test(
      anonymousProbe.stderr,
    )
  ) {
    pass('GitHub repository is not anonymously readable')
  } else {
    fail('GitHub private visibility could not be verified fail-closed')
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
    '[cloud-handoff] READY cloud handoff contract. Visibility, remote freshness, push/clean, task and Actions state were not evaluated.',
  )
} else {
  console.log(
    '[cloud-handoff] BRANCH_HANDOFF_READY repository-side source/test handoff only. Observe a running exact-SHA Codex Cloud task or Actions run separately before disconnect. Hosted, paid, Human and Production actions remain separately approved.',
  )
}
