import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

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

const pidPath = join(runnerTemp, 'compass-edge.pid')
const envPath = join(runnerTemp, 'compass-edge.env')
const logPath = join(runnerTemp, 'compass-edge.log')

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function readPid() {
  if (!existsSync(pidPath)) return null

  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error('The local Edge PID file is invalid.')
  }

  return pid
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

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!groupIsAlive(pid)) return true
    await delay(200)
  }
  return !groupIsAlive(pid)
}

async function stop() {
  const pid = readPid()
  if (pid === null) return

  if (groupIsAlive(pid)) {
    signalGroup(pid, 'SIGTERM')
    if (!(await waitForExit(pid, 10_000))) {
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

  const existingPid = readPid()
  if (existingPid !== null && groupIsAlive(existingPid)) {
    throw new Error('The local Edge process group is already running.')
  }
  if (existingPid !== null) unlinkSync(pidPath)

  appendFileSync(
    logPath,
    `\n=== local Edge runtime start ${new Date().toISOString()} ===\n`,
    'utf8',
  )
  const logDescriptor = openSync(logPath, 'a')
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(
    executable,
    ['supabase', 'functions', 'serve', '--env-file', envPath],
    {
      detached: true,
      env: process.env,
      stdio: ['ignore', logDescriptor, logDescriptor],
      windowsHide: true,
    },
  )
  closeSync(logDescriptor)

  if (!child.pid) {
    throw new Error('The local Edge process did not return a PID.')
  }

  writeFileSync(pidPath, `${child.pid}\n`, 'utf8')
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
