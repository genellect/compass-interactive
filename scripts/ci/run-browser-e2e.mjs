import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const mode = process.argv[2]
const playwrightArguments = [
  ...(mode === 'local' ? ['e2e/local/live-lecture.spec.ts'] : []),
  ...process.argv.slice(3),
]
const demoMode =
  mode === 'demo' ||
  mode === 'demo-pdf' ||
  mode === 'demo-pdf-off' ||
  mode === 'demo-jc' ||
  mode === 'demo-jc-off'
const localMode = mode === 'local' || mode === 'local-jc'
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
const port =
  configuredPort ?? (demoMode ? 43_000 + (process.pid % 1_000) : 4_173)
const baseURL = `http://127.0.0.1:${port}`

if (
  ![
    'demo',
    'demo-pdf',
    'demo-pdf-off',
    'demo-jc',
    'demo-jc-off',
    'local',
    'local-jc',
  ].includes(mode)
) {
  throw new Error(
    'Usage: node scripts/ci/run-browser-e2e.mjs <demo|demo-pdf|demo-pdf-off|demo-jc|demo-jc-off|local|local-jc>',
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
    'local-jc',
  ].includes(mode)
    ? 'true'
    : 'false',
  VITE_PHASE4_REALTIME_CAPTIONS: 'false',
  VITE_PHASE5_MATERIAL_ANALYSIS: 'false',
  VITE_PHASE6_SUMMARIES: localMode ? 'true' : 'false',
  VITE_PHASE6_5_COMMENT_NICKNAMES: 'true',
  VITE_PHASE6_6_UX_INTEGRATION: 'true',
  VITE_PHASE6_8_SECURITY:
    localMode || mode === 'demo-jc' || mode === 'demo-jc-off'
      ? 'true'
      : 'false',
  VITE_PHASE7_1_CLASSROOM_EXTENSIONS: 'true',
  VITE_PHASE7_2_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_26_BROWSER_PDF_PUBLISHING:
    mode === 'demo-pdf' ||
    mode === 'demo-jc' ||
    mode === 'demo-jc-off' ||
    mode === 'local-jc'
      ? 'true'
      : 'false',
  VITE_PHASE7_27_JOURNAL_CLUB:
    mode === 'demo-jc' || mode === 'local-jc' ? 'true' : 'false',
  VITE_PDF_WORKER_BASE_URL:
    mode === 'local-jc'
      ? 'http://127.0.0.1:8787'
      : ['demo-pdf', 'demo-pdf-off', 'demo-jc', 'demo-jc-off'].includes(mode)
        ? 'https://pdf.example'
        : '',
  VITE_TURNSTILE_SITE_KEY: '',
  PLAYWRIGHT_BASE_URL: baseURL,
  VITE_CACHE_DIR: fileURLToPath(
    new URL(`../../test-results/vite-cache-${mode}`, import.meta.url),
  ),
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => {
      reject(
        new Error(
          `E2E refused to reuse occupied port ${port}; set PLAYWRIGHT_APP_PORT to an unused local port.`,
        ),
      )
    })
    probe.listen({ host: '127.0.0.1', port }, () => {
      probe.close((error) => (error ? reject(error) : resolve()))
    })
  })
}

await assertPortAvailable()

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
      const response = await fetch(baseURL)
      if (viteReady && response.ok) return
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
      env: appEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  const [code] = await once(playwrightProcess, 'exit')
  exitCode = typeof code === 'number' ? code : 1
} finally {
  await stopVite()
}

process.exit(exitCode)
