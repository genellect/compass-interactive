import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const mode = process.argv[2]
const playwrightArguments = process.argv.slice(3)
const demoMode = mode === 'demo' || mode === 'demo-pdf'
const port = demoMode ? 43_000 + (process.pid % 1_000) : 4_173
const baseURL = `http://127.0.0.1:${port}`

if (!['demo', 'demo-pdf', 'local'].includes(mode)) {
  throw new Error(
    'Usage: node scripts/ci/run-browser-e2e.mjs <demo|demo-pdf|local>',
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
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Local Supabase URL or publishable key was not found.')
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
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    VITE_SUPABASE_URL: supabaseUrl,
  }
}

const appEnvironment = {
  ...process.env,
  ...(mode === 'local'
    ? readLocalSupabaseEnvironment()
    : {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_playwright_demo_only',
      }),
  VITE_PHASE1_SYNC_PROTOCOL: 'true',
  VITE_PHASE2_LECTURE_LIFECYCLE: 'true',
  VITE_PHASE3_PRIVATE_PDF: mode === 'demo-pdf' ? 'true' : 'false',
  VITE_PHASE4_REALTIME_CAPTIONS: 'false',
  VITE_PHASE5_MATERIAL_ANALYSIS: 'false',
  VITE_PHASE6_SUMMARIES: mode === 'local' ? 'true' : 'false',
  VITE_PHASE6_5_COMMENT_NICKNAMES: 'true',
  VITE_PHASE6_6_UX_INTEGRATION: 'true',
  VITE_PHASE6_8_SECURITY: mode === 'local' ? 'true' : 'false',
  VITE_PHASE7_1_CLASSROOM_EXTENSIONS: 'true',
  VITE_PHASE7_2_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS: 'true',
  VITE_PHASE7_26_BROWSER_PDF_PUBLISHING:
    mode === 'demo-pdf' ? 'true' : 'false',
  VITE_PDF_WORKER_BASE_URL: 'https://pdf.example',
  PLAYWRIGHT_BASE_URL: baseURL,
  VITE_CACHE_DIR: fileURLToPath(
    new URL(`../../test-results/vite-cache-${mode}`, import.meta.url),
  ),
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
    stdio: 'inherit',
    windowsHide: true,
  },
)

let viteExited = false
viteProcess.once('exit', () => {
  viteExited = true
})

async function waitForServer() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (viteExited) throw new Error('Vite exited before E2E could start.')
    try {
      const response = await fetch(baseURL)
      if (response.ok) return
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
  const config =
    mode === 'local' ? 'playwright.local.config.ts' : 'playwright.config.ts'
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
