import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const mode = process.argv[2]
const defaultSpecs = {
  'demo-admin-identity': ['e2e/demo/phase7-30-admin-identity.spec.ts'],
  'demo-admin-identity-off': [
    'e2e/demo/phase7-30-admin-identity-flag-off.spec.ts',
  ],
  'demo-presenter': ['e2e/demo/phase7-29-presenter.spec.ts'],
  'demo-presenter-off': ['e2e/demo/phase7-29-presenter-flag-off.spec.ts'],
}
const playwrightArguments = [
  ...(mode === 'local' ? ['e2e/local/live-lecture.spec.ts'] : []),
  ...(defaultSpecs[mode] ?? []),
  ...process.argv.slice(3),
]
const demoMode =
  mode === 'demo' ||
  mode === 'demo-pdf' ||
  mode === 'demo-pdf-off' ||
  mode === 'demo-jc' ||
  mode === 'demo-jc-off' ||
  mode === 'demo-presenter' ||
  mode === 'demo-presenter-off' ||
  mode === 'demo-admin-identity' ||
  mode === 'demo-admin-identity-off'
const presenterFixtureMode = mode === 'demo-presenter'
const localMode = mode === 'local' || mode === 'local-jc' || mode === 'local-ai'

async function allocateLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Could not allocate a loopback port for browser E2E.'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

const configuredPort = process.env.PLAYWRIGHT_APP_PORT
  ? Number.parseInt(process.env.PLAYWRIGHT_APP_PORT, 10)
  : null
if (
  configuredPort !== null &&
  (!Number.isSafeInteger(configuredPort) ||
    configuredPort < 1_024 ||
    configuredPort > 65_535)
) {
  throw new Error('PLAYWRIGHT_APP_PORT must be an integer from 1024 to 65535.')
}
let port = configuredPort ?? (demoMode ? null : 4_173)
let baseURL = port === null ? null : `http://127.0.0.1:${port}`

if (
  ![
    'demo',
    'demo-pdf',
    'demo-pdf-off',
    'demo-jc',
    'demo-jc-off',
    'demo-presenter',
    'demo-presenter-off',
    'demo-admin-identity',
    'demo-admin-identity-off',
    'local',
    'local-jc',
    'local-ai',
  ].includes(mode)
) {
  throw new Error(
    'Usage: node scripts/ci/run-browser-e2e.mjs <demo|demo-pdf|demo-pdf-off|demo-jc|demo-jc-off|demo-presenter|demo-presenter-off|demo-admin-identity|demo-admin-identity-off|local|local-jc|local-ai>',
  )
}

function parseEnvOutput(output) {
  const values = new Map()
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, name, rawValue] = match
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? JSON.parse(rawValue)
        : rawValue
    values.set(name, value)
  }
  return values
}

function readLocalSupabaseEnvironment() {
  const injected = {
    TEST_SUPABASE_SERVICE_ROLE_KEY:
      process.env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
    TEST_SUPABASE_URL: process.env.TEST_SUPABASE_URL?.trim() ?? '',
    VITE_SUPABASE_PUBLISHABLE_KEY:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL?.trim() ?? '',
  }
  if (Object.values(injected).every(Boolean)) {
    const parsedUrl = new URL(injected.VITE_SUPABASE_URL)
    if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
      throw new Error('Browser E2E refuses non-local Supabase URLs.')
    }
    if (injected.TEST_SUPABASE_URL !== injected.VITE_SUPABASE_URL) {
      throw new Error('Browser and service E2E must use the same local URL.')
    }
    return injected
  }

  const result = spawnSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  const values = parseEnvOutput(result.stdout)
  const supabaseUrl = values.get('API_URL') ?? ''
  const publishableKey =
    values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY') ?? ''
  const serviceRoleKey =
    values.get('SERVICE_ROLE_KEY') ?? values.get('SECRET_KEY') ?? ''
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error(
      'Local Supabase URL, publishable key or service-role key was not found.',
    )
  }
  const parsedUrl = new URL(supabaseUrl)
  if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
    throw new Error('Browser E2E refuses non-local Supabase URLs.')
  }
  if (!process.env.TEST_ADMIN_PIN?.trim()) {
    throw new Error(
      'TEST_ADMIN_PIN is required and must match the local Edge Functions env.',
    )
  }

  return {
    TEST_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    TEST_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    VITE_SUPABASE_URL: supabaseUrl,
  }
}

const appEnvironment = {
  ...process.env,
  ...(localMode
    ? readLocalSupabaseEnvironment()
    : {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_playwright_demo_only',
      }),
  VITE_PHASE1_SYNC_PROTOCOL: 'true',
  VITE_PHASE2_LECTURE_LIFECYCLE: 'true',
  VITE_PHASE3_PRIVATE_PDF: [
    'demo-pdf',
    'demo-pdf-off',
    'demo-jc',
    'demo-jc-off',
    'demo-presenter',
    'demo-presenter-off',
    'local-jc',
    'local-ai',
  ].includes(mode)
    ? 'true'
    : 'false',
  VITE_PHASE4_REALTIME_CAPTIONS: mode === 'local-ai' ? 'true' : 'false',
  VITE_PHASE5_MATERIAL_ANALYSIS: mode === 'local-ai' ? 'true' : 'false',
  VITE_PHASE6_SUMMARIES: localMode ? 'true' : 'false',
  VITE_PHASE6_5_COMMENT_NICKNAMES: 'true',
  VITE_PHASE6_6_UX_INTEGRATION: 'true',
  VITE_PHASE6_8_SECURITY:
    localMode ||
    mode === 'demo-jc' ||
    mode === 'demo-jc-off' ||
    mode === 'demo-presenter' ||
    mode === 'demo-presenter-off'
      ? 'true'
      : 'false',
  VITE_PHASE7_1_CLASSROOM_EXTENSIONS: 'true',
  VITE_PHASE7_2_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_26_BROWSER_PDF_PUBLISHING:
    mode === 'demo-pdf' ||
    mode === 'demo-jc' ||
    mode === 'demo-jc-off' ||
    mode === 'local-jc' ||
    mode === 'local-ai'
      ? 'true'
      : 'false',
  VITE_PHASE7_27_JOURNAL_CLUB:
    mode === 'demo-jc' || mode === 'demo-jc-off' || mode === 'local-jc'
      ? 'true'
      : 'false',
  VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION:
    mode === 'demo-jc' || mode === 'local-jc' ? 'true' : 'false',
  VITE_PHASE7_28_DISPLAY_REALTIME:
    mode === 'local-jc' ||
    mode === 'demo-presenter' ||
    mode === 'demo-presenter-off'
      ? 'true'
      : 'false',
  VITE_PHASE7_28_AI_MASTER_AUTH: mode === 'local-ai' ? 'true' : 'false',
  VITE_PHASE7_29_POWERPOINT_SYNC: mode === 'demo-presenter' ? 'true' : 'false',
  VITE_PHASE7_30_ADMIN_IDENTITY:
    mode === 'demo-admin-identity' ? 'true' : 'false',
  VITE_PHASE7_30_LEGACY_ADMIN_PIN: 'true',
  VITE_PDF_WORKER_BASE_URL:
    mode === 'local-jc'
      ? 'http://127.0.0.1:8787'
      : ['demo-pdf', 'demo-pdf-off', 'demo-jc', 'demo-jc-off'].includes(mode)
        ? 'https://pdf.example'
        : mode === 'demo-presenter' || mode === 'demo-presenter-off'
          ? 'https://pdf.example'
          : '',
  VITE_TURNSTILE_SITE_KEY: '',
  VITE_CACHE_DIR: fileURLToPath(
    new URL(`../../test-results/vite-cache-${mode}`, import.meta.url),
  ),
}

async function assertPortAvailable(targetPort, description) {
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => {
      const recovery =
        description === 'Vite'
          ? ' Set PLAYWRIGHT_APP_PORT to an unused local port.'
          : ' Stop the existing local Bridge before running this fixture; it will not be reused.'
      reject(
        new Error(
          `E2E refused to reuse occupied ${description} port ${targetPort}.${recovery}`,
        ),
      )
    })
    probe.listen({ host: '127.0.0.1', port: targetPort }, () => {
      probe.close((error) => (error ? reject(error) : resolve()))
    })
  })
}

if (port !== null) {
  await assertPortAvailable(port, 'Vite')
}
if (presenterFixtureMode) {
  await assertPortAvailable(43_124, 'Presenter loopback fixture')
}

let presenterFixtureProcess = null
let presenterFixtureExited = true

async function startPresenterFixture() {
  if (!baseURL) {
    throw new Error('Vite origin is unavailable for the Presenter fixture.')
  }
  presenterFixtureExited = false
  presenterFixtureProcess = spawn(
    process.execPath,
    ['scripts/test-fixtures/presenter-loopback.mjs'],
    {
      cwd: root,
      env: {
        ...process.env,
        PRESENTER_TEST_ALLOWED_ORIGIN: baseURL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  let outputTail = ''
  let ready = false
  presenterFixtureProcess.stdout.on('data', (chunk) => {
    const output = chunk.toString()
    process.stdout.write(output)
    outputTail = `${outputTail}${output}`.slice(-2_048)
    if (outputTail.includes('PRESENTER_LOOPBACK_READY')) ready = true
  })
  presenterFixtureProcess.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
  presenterFixtureProcess.once('exit', () => {
    presenterFixtureExited = true
  })

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (presenterFixtureExited) {
      throw new Error(
        'Presenter loopback fixture exited before E2E could start.',
      )
    }
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await stopPresenterFixture()
  throw new Error('Presenter loopback fixture did not become ready.')
}

async function stopPresenterFixture() {
  if (!presenterFixtureProcess || presenterFixtureExited) return
  presenterFixtureProcess.kill()
  await Promise.race([
    once(presenterFixtureProcess, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (
    !presenterFixtureExited &&
    process.platform === 'win32' &&
    presenterFixtureProcess.pid
  ) {
    spawnSync(
      'taskkill.exe',
      ['/PID', String(presenterFixtureProcess.pid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    )
  }
}

if (port === null) {
  port = await allocateLoopbackPort()
  baseURL = `http://127.0.0.1:${port}`
}

const viteProcess = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
    '--configLoader',
    'runner',
  ],
  {
    cwd: root,
    env: appEnvironment,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  },
)

let viteExited = false
let viteReady = false
let viteOutputTail = ''
const ansiEscapePattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  'g',
)
viteProcess.stdout.on('data', (chunk) => {
  const output = chunk.toString()
  process.stdout.write(output)
  viteOutputTail = `${viteOutputTail}${output}`.slice(-2_048)
  const plainOutput = viteOutputTail.replace(ansiEscapePattern, '')
  if (
    new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${port}/`).test(plainOutput)
  ) {
    viteReady = true
  }
})
viteProcess.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
})
viteProcess.once('exit', () => {
  viteExited = true
})

async function waitForServer() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (viteExited) throw new Error('Vite exited before E2E could start.')
    try {
      if (baseURL) {
        const response = await fetch(baseURL)
        if (viteReady && response.ok) return
      }
    } catch {
      // Startup races are expected until Vite begins listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not become ready within 60 seconds.')
}

async function stopVite() {
  if (viteExited) return
  viteProcess.kill()
  await Promise.race([
    once(viteProcess, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (!viteExited && process.platform === 'win32' && viteProcess.pid) {
    spawnSync('taskkill.exe', ['/PID', String(viteProcess.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  }
}

let exitCode = 1
try {
  await waitForServer()
  if (!baseURL) {
    throw new Error('Vite did not report its loopback origin.')
  }
  if (presenterFixtureMode) {
    await startPresenterFixture()
  }
  const playwrightEnvironment = {
    ...appEnvironment,
    PLAYWRIGHT_BASE_URL: baseURL,
  }
  const config = localMode
    ? 'playwright.local.config.ts'
    : 'playwright.config.ts'
  const playwrightProcess = spawn(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      config,
      ...playwrightArguments,
    ],
    {
      cwd: root,
      env: playwrightEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  const [code] = await once(playwrightProcess, 'exit')
  exitCode = typeof code === 'number' ? code : 1
} finally {
  await stopVite()
  await stopPresenterFixture()
}

process.exit(exitCode)
