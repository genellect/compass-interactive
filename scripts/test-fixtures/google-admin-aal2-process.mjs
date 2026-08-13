import { spawn } from 'node:child_process'
import { once } from 'node:events'

const FIXTURE_PREFIX = 'GOOGLE_ADMIN_AAL2_FIXTURE='

export async function startGoogleAdminAal2Fixture({
  cwd,
  env = process.env,
  retainEnvironment = false,
}) {
  const child = spawn(
    process.execPath,
    ['scripts/test-phase7-30b1-local-edge.mjs', '--browser-fixture'],
    {
      cwd,
      env: {
        ...env,
        TEST_GOOGLE_ADMIN_FIXTURE_RETAIN_ENVIRONMENT: retainEnvironment
          ? 'true'
          : 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let settled = false
  let stdoutBuffer = ''
  let stderrTail = ''

  const fixture = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      fail(new Error('Google Admin AAL2 fixture did not become ready.'))
    }, 120_000)

    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (child.exitCode === null) child.kill()
      reject(error)
    }

    child.once('error', fail)
    child.once('exit', (code) => {
      fail(
        new Error(
          `Google Admin AAL2 fixture exited before readiness (${code ?? 'signal'}).${
            stderrTail ? `\n${stderrTail}` : ''
          }`,
        ),
      )
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_096)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith(FIXTURE_PREFIX) || settled) continue
        try {
          const encoded = line.slice(FIXTURE_PREFIX.length)
          const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
          settled = true
          clearTimeout(timeout)
          resolve(JSON.parse(decoded))
        } catch (error) {
          fail(error)
        }
      }
    })
  })

  return { child, fixture }
}

export async function stopGoogleAdminAal2Fixture(handle) {
  if (!handle?.child) return
  if (handle.child.exitCode !== null) {
    if (handle.child.exitCode !== 0) {
      throw new Error(
        `Google Admin AAL2 fixture exited unexpectedly (${handle.child.exitCode}).`,
      )
    }
    return
  }
  const exited = once(handle.child, 'exit')
  handle.child.stdin.end()
  const completed = await Promise.race([
    exited.then(([code]) => ({ code, timedOut: false })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ code: null, timedOut: true }), 20_000),
    ),
  ])
  if (completed.timedOut) {
    handle.child.kill()
    throw new Error('Google Admin AAL2 fixture cleanup timed out.')
  }
  if (completed.code !== 0) {
    throw new Error(
      `Google Admin AAL2 fixture cleanup failed (${completed.code ?? 'signal'}).`,
    )
  }
}
