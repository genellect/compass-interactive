import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) =>
  readFileSync(new URL(parts.join('/'), `${new URL(`file:///${root.replaceAll('\\', '/')}/`)}`), 'utf8')

const featureFlags = read('src', 'lib', 'featureFlags.ts')
const envExample = read('.env.local.example')
const packageJson = JSON.parse(read('package.json'))
const workflow = read('.github', 'workflows', 'ci.yml')
const browserRunner = read('scripts', 'ci', 'run-browser-e2e.mjs')
const localPlaywrightConfig = read('playwright.local.config.ts')
const preflight = read('src', 'pdf', 'browserPdfPreflight.ts')
const preflightWorker = read('src', 'pdf', 'browserPdfPreflight.worker.ts')
const publicationClient = read(
  'src',
  'pdf',
  'browserPdfPublicationClient.ts',
)
const localPublisherClient = read('src', 'pdf', 'publisherClient.ts')
const adminPdfExtraction = read('src', 'pdf', 'adminPdfExtraction.ts')
const adminPage = read('src', 'pages', 'AdminPage.tsx')
const browserPublicationHook = read(
  'src',
  'hooks',
  'useBrowserPdfPublication.ts',
)
const adminPdfControl = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminPdfControl.tsx',
)

assert.match(
  featureFlags,
  /isPhase726BrowserPdfPublishingEnabled\s*=\s*\n\s*isPhase3PrivatePdfEnabled/,
)
assert.match(envExample, /VITE_PHASE7_26_BROWSER_PDF_PUBLISHING=false/)
assert.doesNotMatch(envExample, /VITE_PHASE7_26_BROWSER_PDF_PUBLISHING=true/)

assert.match(preflight, /new Worker\(/)
assert.match(preflight, /\[bytes\]/)
assert.match(preflightWorker, /15 \* 1024 \* 1024/)
assert.match(preflightWorker, /MAX_PDF_PAGES = 75/)
assert.match(preflightWorker, /MAX_PDF_TEXT_CHARACTERS = 20_000/)
assert.match(preflightWorker, /crypto\.subtle\.digest\('SHA-256'/)
assert.match(preflightWorker, /getTextContent/)
assert.match(preflightWorker, /isOffscreenCanvasSupported: false/)
assert.match(preflightWorker, /useWasm: false/)
assert.doesNotMatch(
  preflightWorker,
  /getImageData|createElement\(['"]canvas|Tesseract|page\.render\(/,
)

for (const action of ['discover', 'initiate', 'status', 'finalize', 'abort']) {
  assert.match(publicationClient, new RegExp(`action: '${action}'`))
}
assert.match(publicationClient, /method: 'PUT'/)
assert.match(publicationClient, /Authorization: `Bearer \$\{handle\.uploadTicket\}`/)
assert.match(publicationClient, /credentials: 'omit'/)
assert.match(publicationClient, /redirect: 'error'/)
assert.match(publicationClient, /referrerPolicy: 'no-referrer'/)
assert.match(publicationClient, /parsed\.origin !== configuredWorker\.origin/)
assert.match(publicationClient, /\/v2\/pdf-publications\/\$\{publicationId\}/)
assert.match(publicationClient, /response\.body\?\.getReader\(\)/)
assert.match(publicationClient, /const FINALIZE_TIMEOUT_MS = 60 \* 1000/)
assert.match(
  publicationClient,
  /action: 'finalize'[\s\S]*?FINALIZE_TIMEOUT_MS,\s*\)/,
)
const uploadRequest =
  publicationClient.match(/fetch\(handle\.uploadUrl, \{[\s\S]*?\n\s*\}\)/)?.[0] ?? ''
assert.ok(uploadRequest)
assert.doesNotMatch(uploadRequest, /['"]Content-Length['"]\s*:/)
assert.doesNotMatch(publicationClient, /uploadReceipt/)
assert.doesNotMatch(
  publicationClient.match(
    /export type BrowserPdfPublicationRecovery = \{[\s\S]*?\n\}/,
  )?.[0] ?? '',
  /ticket|text|file|sha/i,
)

assert.match(adminPage, /publishPdfDocumentInBrowser/)
assert.match(adminPage, /publishPdfDocumentWithLocalPublisher/)
assert.match(adminPage, /expectedAccessVersion: published\.accessVersion/)
assert.match(adminPage, /manifestEtag: published\.manifestEtag/)
assert.match(localPublisherClient, /manifestEtag: string/)
assert.match(localPublisherClient, /accessVersion: number/)
assert.match(adminPdfExtraction, /clearAdminPdfExtractionCache/)
assert.match(adminPdfExtraction, /AbortSignal\.timeout\(PDF_DOWNLOAD_TIMEOUT_MS\)/)
assert.match(adminPdfExtraction, /response\.body\?\.getReader\(\)/)
assert.match(adminPdfExtraction, /await issuePdfAccessSession\(\{[\s\S]*?return cached/)
assert.doesNotMatch(adminPdfExtraction, /response\.arrayBuffer\(\)/)
assert.match(browserPublicationHook, /restoreBrowserPdfPublication/)
assert.match(browserPublicationHook, /browserPdfPublicationClient\.discover/)
assert.match(browserPublicationHook, /abortInterruptedPdfPublication/)
assert.match(browserPublicationHook, /browserPublishingEnabled/)
assert.match(adminPdfControl, /中断した公開を破棄してやり直す/)
assert.doesNotMatch(adminPdfControl, /復旧・互換オプション/)
assert.doesNotMatch(adminPdfControl, /Local Publisherで公開する/)
assert.match(
  adminPdfControl,
  /!browserPublishingEnabled && publisherStatus !== 'paired'/,
)

assert.match(packageJson.scripts['test:e2e:phase7-26'], /demo-pdf/)
assert.match(packageJson.scripts['test:e2e:phase7-26:flag-off'], /demo-pdf-off/)
assert.match(workflow, /npm run test:e2e:phase7-26\b/)
assert.match(workflow, /npm run test:e2e:phase7-26:flag-off\b/)
assert.match(browserRunner, /assertPortAvailable/)
assert.match(browserRunner, /viteReady && response\.ok/)
assert.match(
  browserRunner,
  /VITE_PDF_WORKER_BASE_URL:[\s\S]*?mode === 'demo-pdf'[\s\S]*?mode === 'demo-pdf-off'[\s\S]*?'https:\/\/pdf\.example'[\s\S]*?: ''/,
)
assert.match(localPlaywrightConfig, /process\.env\.PLAYWRIGHT_BASE_URL/)

console.log('Phase 7.26 browser PDF static checks passed.')
