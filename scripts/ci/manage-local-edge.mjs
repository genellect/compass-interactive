import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const action = process.argv[2]
const runnerTemp = process.env.RUNNER_TEMP?.trim() ?? ''

if (!['start', 'restart', 'stop'].includes(action)) {
  throw new Error(
    'Usage: node scripts/ci/manage-local-edge.mjs <start|restart|stop>',
  )
}

if (!runnerTemp) {
  throw new Error('RUNNER_TEMP is required for local Edge process management.')
}
if (!isAbsolute(runnerTemp)) {
  throw new Error('RUNNER_TEMP must be an absolute path.')
}

const pidPath = join(runnerTemp, 'compass-edge.pid')
const envPath = join(runnerTemp, 'compass-edge.env')
const logPath = join(runnerTemp, 'compass-edge.log')
const require = createRequire(import.meta.url)

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function discardPidFile(reason) {
  if (existsSync(pidPath)) unlinkSync(pidPath)
  process.stderr.write(
    `[manage-local-edge] ${reason}; removed the PID record without signalling a process.\n`,
  )
}

function readPidRecord() {
  if (!existsSync(pidPath)) return null

  const raw = readFileSync(pidPath, 'utf8').trim()
  let record
  try {
    record = JSON.parse(raw)
  } catch {
    return { invalidReason: 'The local Edge PID record is not valid JSON' }
  }

  if (
    record?.version !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.executable !== 'string' ||
    record.executable.length === 0 ||
    typeof record.startedAt !== 'string' ||
    record.startedAt.length === 0
  ) {
    return { invalidReason: 'The local Edge PID record has an invalid shape' }
  }

  return { record }
}

function groupIsAlive(pid) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function normalizeWindowsExecutable(executable) {
  return resolve(executable).replaceAll('/', '\\').toLowerCase()
}

function readWindowsProcessIdentity(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    '[pscustomobject]@{',
    '  pid = [int]$process.Id',
    '  executable = [string]$process.Path',
    "  startedAt = $process.StartTime.ToUniversalTime().ToString('o')",
    '} | ConvertTo-Json -Compress',
  ].join('\n')
  const output = execFileSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  ).trim()
  const identity = JSON.parse(output)

  if (
    identity?.pid !== pid ||
    typeof identity.executable !== 'string' ||
    identity.executable.length === 0 ||
    typeof identity.startedAt !== 'string' ||
    identity.startedAt.length === 0
  ) {
    throw new Error('PowerShell returned an invalid process identity.')
  }

  return identity
}

function windowsIdentityMatches(record) {
  if (!groupIsAlive(record.pid)) {
    return { matches: false, reason: 'The recorded process no longer exists' }
  }

  const identity = readWindowsProcessIdentity(record.pid)
  const executableMatches =
    normalizeWindowsExecutable(identity.executable) ===
    normalizeWindowsExecutable(record.executable)
  const startTimeMatches = identity.startedAt === record.startedAt

  if (!executableMatches || !startTimeMatches) {
    return {
      matches: false,
      reason: 'The PID now belongs to a different Windows process identity',
    }
  }

  return { matches: true }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!groupIsAlive(pid)) return true
    await delay(200)
  }
  return !groupIsAlive(pid)
}

async function stop() {
  const pidState = readPidRecord()
  if (pidState === null) return
  if (pidState.invalidReason) {
    discardPidFile(pidState.invalidReason)
    return
  }

  const { record } = pidState
  const pid = record.pid

  if (process.platform === 'win32') {
    const identity = windowsIdentityMatches(record)
    if (!identity.matches) {
      discardPidFile(identity.reason)
      return
    }
  }

  if (groupIsAlive(pid)) {
    if (process.platform === 'win32') {
      const identity = windowsIdentityMatches(record)
      if (!identity.matches) {
        discardPidFile(identity.reason)
        return
      }
    }
    signalGroup(pid, 'SIGTERM')
    if (!(await waitForExit(pid, 10_000))) {
      if (process.platform === 'win32') {
        const identity = windowsIdentityMatches(record)
        if (!identity.matches) {
          discardPidFile(identity.reason)
          return
        }
      }
      signalGroup(pid, 'SIGKILL')
      if (!(await waitForExit(pid, 5_000))) {
        throw new Error('The local Edge process group did not stop.')
      }
    }
  }

  if (existsSync(pidPath)) unlinkSync(pidPath)
}

function start() {
  if (!existsSync(envPath)) {
    throw new Error('The synthetic local Edge environment file is missing.')
  }

  const existingState = readPidRecord()
  if (existingState?.invalidReason) {
    discardPidFile(existingState.invalidReason)
  } else if (existingState?.record) {
    const { record } = existingState
    if (process.platform === 'win32') {
      const identity = windowsIdentityMatches(record)
      if (identity.matches) {
        throw new Error('The local Edge process group is already running.')
      }
      discardPidFile(identity.reason)
    } else if (groupIsAlive(record.pid)) {
      throw new Error('The local Edge process group is already running.')
    } else {
      discardPidFile('The recorded process group no longer exists')
    }
  }

  appendFileSync(
    logPath,
    `\n=== local Edge runtime start ${new Date().toISOString()} ===\n`,
    'utf8',
  )
  const logDescriptor = openSync(logPath, 'a')
  const windowsCli =
    process.platform === 'win32'
      ? join(
          dirname(
            require.resolve(
              `@supabase/cli-windows-${process.arch}/package.json`,
            ),
          ),
          'bin',
          'supabase.exe',
        )
      : null
  const executable = windowsCli ?? 'npx'
  const args = windowsCli
    ? ['functions', 'serve', '--env-file', envPath]
    : ['supabase', 'functions', 'serve', '--env-file', envPath]
  const child = spawn(executable, args, {
    detached: true,
    env: process.env,
    stdio: ['ignore', logDescriptor, logDescriptor],
    windowsHide: true,
  })
  closeSync(logDescriptor)

  if (!child.pid) {
    throw new Error('The local Edge process did not return a PID.')
  }

  const identity =
    process.platform === 'win32'
      ? readWindowsProcessIdentity(child.pid)
      : {
          pid: child.pid,
          executable,
          startedAt: new Date().toISOString(),
        }
  writeFileSync(
    pidPath,
    `${JSON.stringify({ version: 1, ...identity })}\n`,
    'utf8',
  )
  child.unref()
}

if (action === 'stop') {
  await stop()
} else if (action === 'restart') {
  await stop()
  start()
} else {
  start()
}
