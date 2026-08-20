import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) =>
  readFileSync(
    new URL(
      parts.join('/'),
      `${new URL(`file:///${root.replaceAll('\\', '/')}/`)}`,
    ),
    'utf8',
  )

const featureFlags = read('src', 'lib', 'featureFlags.ts')
const envExample = read('.env.local.example')
const packageJson = JSON.parse(read('package.json'))
const workflow = read('.github', 'workflows', 'ci.yml')
const browserRunner = read('scripts', 'ci', 'run-browser-e2e.mjs')
const localPlaywrightConfig = read('playwright.local.config.ts')
const preflight = read('src', 'pdf', 'browserPdfPreflight.ts')
const preflightWorker = read('src', 'pdf', 'browserPdfPreflight.worker.ts')
const publicationClient = read('src', 'pdf', 'browserPdfPublicationClient.ts')
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
assert.match(
  publicationClient,
  /Authorization: `Bearer \$\{handle\.uploadTicket\}`/,
)
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
assert.match(
  publicationClient,
  /const reserved = reserveAdminOperationRequestId\([\s\S]*PUBLICATION_FUNCTION[\s\S]*requestBody[\s\S]*requestId: reserved\.requestId[\s\S]*status === 'active'[\s\S]*completeAdminOperationRequestId\(reserved\.key, reserved\.requestId\)/,
  'committed finalize retries must retain one logical operation ID until active',
)
assert.match(
  publicationClient,
  /finalizeRequestId\?: string[\s\S]*prepareBrowserPdfPublicationFinalization\([\s\S]*recovery\.finalizeRequestId[\s\S]*rememberBrowserPdfPublication\(prepared\)/,
  'the finalize operation ID must survive a same-tab reload in recovery storage',
)
const uploadRequest =
  publicationClient.match(
    /fetch\(handle\.uploadUrl, \{[\s\S]*?\n\s*\}\)/,
  )?.[0] ?? ''
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
assert.match(
  adminPage,
  /const switchedLecture = Boolean\([\s\S]*activeLectureSessionId !== lectureRow\.id[\s\S]*if \(switchedLecture\) \{\s*setPdfFile\(null\)/,
)
assert.match(
  adminPage,
  /const createdLecture = await createDraftLecture\(\)[\s\S]*publishPdfDocumentInBrowser\(targetLectureSessionId\)/,
)
assert.match(adminPage, /expectedAccessVersion: published\.accessVersion/)
assert.match(adminPage, /manifestEtag: published\.manifestEtag/)
assert.match(localPublisherClient, /manifestEtag: string/)
assert.match(localPublisherClient, /accessVersion: number/)
assert.match(adminPdfExtraction, /clearAdminPdfExtractionCache/)
assert.match(
  adminPdfExtraction,
  /AbortSignal\.timeout\(PDF_DOWNLOAD_TIMEOUT_MS\)/,
)
assert.match(adminPdfExtraction, /response\.body\?\.getReader\(\)/)
assert.match(
  adminPdfExtraction,
  /await issuePdfAccessSession\(\{[\s\S]*?return cached/,
)
assert.doesNotMatch(adminPdfExtraction, /response\.arrayBuffer\(\)/)
assert.match(browserPublicationHook, /restoreBrowserPdfPublication/)
assert.match(
  browserPublicationHook,
  /prepareBrowserPdfPublicationFinalization\(stored\)[\s\S]*finalizeRequestId: finalization\.finalizeRequestId/,
  'reload recovery must reuse the stored finalize operation ID',
)
assert.match(browserPublicationHook, /browserPdfPublicationClient\.discover/)
assert.match(browserPublicationHook, /abortInterruptedPdfPublication/)
assert.match(browserPublicationHook, /browserPublishingEnabled/)
assert.match(
  browserPublicationHook,
  /refreshAdminPdfDocuments\(targetLectureSessionId, adminToken\)[\s\S]*onPublicationActivatedRef\.current\(targetLectureSessionId, \{[\s\S]*documentId:[\s\S]*documentVersion:[\s\S]*manifestVersion:/,
)
assert.match(adminPdfControl, /中断した公開を破棄してやり直す/)
assert.match(adminPdfControl, /講義を作成して資料を公開する/)
for (const removedCopy of [
  '大きい資料は公開やAI分析に時間と費用がかかります',
  '資料はこのブラウザで選択した状態を保ちます',
  '公開した資料は、学生画面と教室表示へ同じページ状態で配信されます',
]) {
  assert.doesNotMatch(adminPdfControl, new RegExp(removedCopy))
}
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
assert.match(browserRunner, /allocateLoopbackPort/)
assert.match(browserRunner, /port:\s*0/)
assert.match(browserRunner, /String\(port\)/)
assert.match(browserRunner, /PLAYWRIGHT_BASE_URL:\s*baseURL/)
assert.doesNotMatch(browserRunner, /43_000\s*\+\s*\(process\.pid/)
assert.match(
  browserRunner,
  /await waitForServer\(\)[\s\S]*await startPresenterFixture\(\)/,
)
assert.match(browserRunner, /viteReady && response\.ok/)
assert.match(
  browserRunner,
  /VITE_PDF_WORKER_BASE_URL:[\s\S]*?\['demo-pdf', 'demo-pdf-off',[\s\S]*?\.includes\(mode\)[\s\S]*?'https:\/\/pdf\.example'[\s\S]*?: ''/,
)
assert.match(localPlaywrightConfig, /process\.env\.PLAYWRIGHT_BASE_URL/)

console.log('Phase 7.26 browser PDF static checks passed.')
