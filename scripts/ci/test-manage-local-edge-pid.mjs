import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const helperPath = fileURLToPath(
  new URL('./manage-local-edge.mjs', import.meta.url),
)
const runnerTemp = mkdtempSync(join(tmpdir(), 'compass-edge-pid-test-'))
const pidPath = join(runnerTemp, 'compass-edge.pid')
const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  windowsHide: true,
})

function decoyIsAlive() {
  try {
    process.kill(decoy.pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function readWindowsIdentity(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    '[pscustomobject]@{',
    '  pid = [int]$process.Id',
    '  executable = [string]$process.Path',
    "  startedAt = $process.StartTime.ToUniversalTime().ToString('o')",
    '} | ConvertTo-Json -Compress',
  ].join('\n')
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true },
    ),
  )
}

function runStop(expectedAlive) {
  const result = spawnSync(process.execPath, [helperPath, 'stop'], {
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: runnerTemp },
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(
      `PID safety check failed: ${result.stderr || result.stdout}`,
    )
  }
  if (existsSync(pidPath)) {
    throw new Error('The stale PID record was not removed.')
  }
  if (decoyIsAlive() !== expectedAlive) {
    throw new Error(
      expectedAlive
        ? 'The unrelated decoy process was signalled.'
        : 'The process with a matching PID record was not stopped.',
    )
  }
}

try {
  if (!decoy.pid) throw new Error('The decoy process did not return a PID.')

  writeFileSync(
    pidPath,
    `${JSON.stringify({
      version: 1,
      pid: decoy.pid,
      executable: 'C:\\definitely-not-the-decoy.exe',
      startedAt: '2000-01-01T00:00:00.0000000Z',
    })}\n`,
    'utf8',
  )
  runStop(true)

  writeFileSync(pidPath, `${decoy.pid}\n`, 'utf8')
  runStop(true)

  if (process.platform === 'win32') {
    writeFileSync(
      pidPath,
      `${JSON.stringify({
        version: 1,
        ...readWindowsIdentity(decoy.pid),
      })}\n`,
      'utf8',
    )
    runStop(false)
  }

  console.log('Local Edge stale PID reuse safety: PASS')
} finally {
  if (decoy.pid && decoyIsAlive()) process.kill(decoy.pid, 'SIGKILL')
  rmSync(runnerTemp, { recursive: true, force: true })
}
