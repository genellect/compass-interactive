import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) =>
  readFileSync(new URL(parts.join('/'), `${new URL(`file:///${root.replaceAll('\\', '/')}/`)}`), 'utf8')

const featureFlags = read('src', 'lib', 'featureFlags.ts')
const envExample = read('.env.local.example')
const preflight = read('src', 'pdf', 'browserPdfPreflight.ts')
const preflightWorker = read('src', 'pdf', 'browserPdfPreflight.worker.ts')
const publicationClient = read(
  'src',
  'pdf',
  'browserPdfPublicationClient.ts',
)
const adminPage = read('src', 'pages', 'AdminPage.tsx')
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

for (const action of ['initiate', 'status', 'finalize', 'abort']) {
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
const uploadRequest =
  publicationClient.match(/fetch\(handle\.uploadUrl, \{[\s\S]*?\n\s*\}\)/)?.[0] ?? ''
assert.ok(uploadRequest)
assert.doesNotMatch(uploadRequest, /['"]Content-Length['"]\s*:/)
assert.doesNotMatch(publicationClient, /uploadReceipt/)
assert.doesNotMatch(
  publicationClient.match(/type StoredPublication = \{[\s\S]*?\n\}/)?.[0] ?? '',
  /ticket|text|file|sha/i,
)

assert.match(adminPage, /publishPdfDocumentInBrowser/)
assert.match(adminPage, /publishPdfDocumentWithLocalPublisher/)
assert.match(adminPage, /restoreBrowserPdfPublication/)
assert.match(adminPdfControl, /復旧・互換オプション/)
assert.match(adminPdfControl, /Local Publisherで公開する/)
assert.match(
  adminPdfControl,
  /!browserPublishingEnabled && publisherStatus !== 'paired'/,
)

console.log('Phase 7.26 browser PDF static checks passed.')
