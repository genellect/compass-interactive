import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260711111834_pdf_sync.sql')
const edgeCatalog = read('supabase/functions/_shared/pdfAssets.ts')
const frontendCatalog = read('src/pdf/lectureAssets.ts')
const pdfDelivery = read('src/pdf/pdfDelivery.ts')
const updateDisplay = read('supabase/functions/update-display-state/index.ts')
const viewer = read('src/components/DisplayView/SyncedPdfViewer.tsx')
const displayRealtimeE2e = read(
  'e2e/local/display-realtime-integration.spec.ts',
)
const adminPage = read('src/pages/AdminPage.tsx')
const lecturePage = read('src/pages/LecturePage.tsx')
const displayView = read('src/components/DisplayView/DisplayView.tsx')
const pdfPath = join(root, 'public/lecture-assets/m4-sample-v1.pdf')
const demoPdfPath = join(root, 'public/lecture-assets/why-learn-english-v1.pdf')

assert.match(migration, /add column pdf_document_id text null/)
assert.match(migration, /create function public\.admin_update_pdf_display/)
assert.match(migration, /display_version = live\.display_version \+ 1/)
assert.match(migration, /state_version = live\.state_version \+ 1/)
assert.match(migration, /set schema private/)
assert.match(migration, /pdf_document_id/)
assert.doesNotMatch(migration, /create table public\.lecture_materials/)

assert.match(updateDisplay, /verifyGoogleAdminOperationRequest/)
assert.match(updateDisplay, /manage_google_admin_display_state_v1/)
assert.match(
  updateDisplay,
  /target_pdf_document_id: body\.pdfDocumentId \?\? null/,
)
assert.match(
  updateDisplay,
  /target_current_pdf_page: body\.currentPdfPage \?\? null/,
)
assert.match(updateDisplay, /displayState: result\.displayState/)
assert.doesNotMatch(updateDisplay, /admin_update_pdf_display/)
assert.doesNotMatch(updateDisplay, /from\('lecture_live_state'\)/)
assert.doesNotMatch(updateDisplay, /from\('lecture_display_state'\)/)

assert.match(
  pdfDelivery,
  /const pendingAdminSessions = new Map<string, Promise<PdfAccessSession>>\(\)/,
)
assert.match(
  pdfDelivery,
  /const key = `\$\{adminToken\.appSessionToken\}:\$\{lectureSessionId\}`[\s\S]*pendingAdminSessions\.get\(key\)[\s\S]*pendingAdminSessions\.set\(key, request\)[\s\S]*pendingAdminSessions\.get\(key\) === request[\s\S]*pendingAdminSessions\.delete\(key\)/,
  'concurrent Admin PDF authorization shares one in-flight request without extending its lifetime',
)
assert.match(pdfDelivery, /status === 401 \|\| status === 403/)
assert.match(pdfDelivery, /const PDF_WORKER_REQUEST_TIMEOUT_MS = 10_000/)
assert.match(pdfDelivery, /const PDF_WORKER_REQUEST_ATTEMPTS = 3/)
assert.match(pdfDelivery, /new AbortController\(\)/)
assert.match(pdfDelivery, /upstreamSignal\?\.addEventListener\('abort'/)
assert.match(
  pdfDelivery,
  /manifestVersion: number[\s\S]*signal\?: AbortSignal[\s\S]*requestWorkerJson<PublicManifestResponse>[\s\S]*input\.signal/,
)
assert.match(
  pdfDelivery,
  /status === 408[\s\S]*status === 429[\s\S]*status >= 500/,
)
assert.match(pdfDelivery, /PDF_WORKER_RETRY_MAX_MS[\s\S]*Math\.random\(\)/)
assert.match(
  pdfDelivery,
  /options\.forceRefresh[\s\S]*session = await getSession\(true\)/,
  'the viewer can explicitly replace an expired delivery session and ticket',
)
assert.match(
  displayRealtimeE2e,
  /const pendingAdminPdfRequests = new Set<Request>\(\)[\s\S]*maxConcurrentAdminPdfRequests = Math\.max[\s\S]*await expect\.poll\(\(\) => maxConcurrentAdminPdfRequests\)\.toBe\(1\)[\s\S]*await expect\.poll\(\(\) => pendingAdminPdfRequests\.size\)\.toBe\(0\)[\s\S]*expect\(maxConcurrentAdminPdfRequests\)\.toBe\(1\)/,
  'the real-Edge Display flow observes Admin PDF authorization before proving it never overlaps',
)
assert.match(
  displayRealtimeE2e,
  /const startedAt = performance\.now\(\)[\s\S]*event\.detail\?\.page !== 2[\s\S]*displayPageProbeElapsedMs = String\([\s\S]*performance\.now\(\) - startedAt[\s\S]*addEventListener\(\s*'compass:display-pdf-rendered',[\s\S]*expect\(pageAccelerationMs\)\.toBeLessThan\(2_000\)/,
  'Display acceleration records the completed canvas render event without Playwright polling delay',
)

for (const catalog of [edgeCatalog, frontendCatalog]) {
  assert.match(catalog, /id: 'm4-sample-v1'/)
  assert.match(catalog, /pageCount: 3/)
  assert.match(catalog, /id: 'why-learn-english-v1'/)
  assert.match(catalog, /pageCount: 15/)
}
assert.match(frontendCatalog, /url: '\/lecture-assets\/m4-sample-v1\.pdf'/)
assert.match(
  frontendCatalog,
  /url: '\/lecture-assets\/why-learn-english-v1\.pdf\?v=phase7-25-public'/,
)

assert.equal(existsSync(pdfPath), true, 'static PDF asset must exist')
assert.ok(statSync(pdfPath).size > 1_000, 'static PDF asset must not be empty')
assert.equal(
  readFileSync(pdfPath).subarray(0, 5).toString('ascii'),
  '%PDF-',
  'static asset must be a PDF',
)

assert.equal(existsSync(demoPdfPath), true, 'demo PDF asset must exist')
assert.ok(
  statSync(demoPdfPath).size > 1_000,
  'demo PDF asset must not be empty',
)
assert.equal(
  readFileSync(demoPdfPath).subarray(0, 5).toString('ascii'),
  '%PDF-',
  'demo asset must be a PDF',
)

assert.match(viewer, /getDocument\(\{/)
assert.match(viewer, /url: assetUrl/)
assert.match(viewer, /rangeChunkSize: 1024 \* 1024/)
assert.match(viewer, /const renderRequestRef = useRef\(0\)/)
assert.match(
  viewer,
  /const requestId = renderRequestRef\.current \+ 1[\s\S]*renderRequestRef\.current = requestId/,
)
assert.match(
  viewer,
  /const isCurrentRequest = \(\) =>[\s\S]*requestId === renderRequestRef\.current[\s\S]*canvasRef\.current === canvas[\s\S]*stageRef\.current === stage[\s\S]*await cancelAndSettleRenderTask\(previousRenderTask\)[\s\S]*if \(!isCurrentRequest\(\)\) return[\s\S]*page = await pdfDocument\.getPage\(pageNumber\)[\s\S]*if \(!isCurrentRequest\(\)\) return/,
)
assert.match(
  viewer,
  /isRenderingCancelledError\(error\) \|\| !isCurrentRequest\(\)/,
)
assert.match(
  viewer,
  /if \(renderTaskRef\.current === renderTask\) \{[\s\S]*renderTaskRef\.current = null/,
)
assert.match(
  viewer,
  /active = false[\s\S]*renderRequestRef\.current \+= 1[\s\S]*renderTaskRef\.current\?\.cancel\(\)/,
)
assert.match(viewer, /loadingTask\.destroy\(\)\.catch\(\(\) => undefined\)/)
assert.doesNotMatch(
  viewer,
  /setErrorMessage\([\s\S]{0,180}(?:error|refreshError)\.message/,
  'PDF errors shown in the DOM must never include raw delivery URLs or credentials',
)
assert.doesNotMatch(
  viewer,
  /`[^`]*\$\{(?:error|refreshError)\.message\}[^`]*`/,
  'PDF viewer user-facing messages must be fixed and sanitized',
)
assert.match(
  viewer,
  /RETRYABLE_DELIVERY_STATUSES = new Set\(\[401, 403, 408, 416, 429\]\)/,
)
assert.match(
  viewer,
  /getAccessUrl\('inline', \{[\s\S]*forceRefresh: true/,
  'an authorization or Range failure obtains a fresh ticket before one reload',
)
assert.match(
  viewer,
  /new ResizeObserver\([\s\S]*observer\.observe\(stage\)[\s\S]*observer\.disconnect\(\)/,
  'the cached PDF rerenders when its real CSS container changes size',
)
assert.match(viewer, /const MAX_CANVAS_BYTES = 32 \* 1024 \* 1024/)
assert.match(viewer, /const PDF_DOCUMENT_LOAD_TIMEOUT_MS = 15_000/)
assert.match(viewer, /MAX_CANVAS_PIXELS/)
assert.match(viewer, /MAX_ADJACENT_PAGE_CACHE_ENTRIES = 2/)
assert.match(viewer, /preRenderAdjacentPages/)
assert.match(
  viewer,
  /const adjacentRenderTaskRef = useRef<PdfRenderTask \| null>/,
)
assert.match(viewer, /adjacentRenderTaskRef\.current\?\.cancel\(\)/)
assert.match(
  displayView,
  /<SyncedPdfViewer[\s\S]*?key=\{`\$\{activeLectureSessionId[\s\S]*?pdfDocumentId[\s\S]*?pdfDocumentVersion[\s\S]*?pdfManifestVersion/,
  'Display remounts the viewer at an authoritative document identity boundary',
)
assert.match(viewer, /window\.devicePixelRatio/)
assert.match(viewer, /window\.matchMedia/)
assert.match(viewer, /window\.visualViewport\?\.addEventListener/)
assert.match(
  viewer,
  /const resolverController = new AbortController\(\)[\s\S]*signal: resolverController\.signal[\s\S]*resolverController\.abort\(\)/,
  'lecture or document cleanup aborts stale manifest and ticket requests',
)
assert.match(
  viewer,
  /const timer = window\.setTimeout\(\(\) => \{[\s\S]*renderPage\(currentPage, pdfDocument\)\.catch[\s\S]*if \(!active\) return[\s\S]*PDFページの描画に失敗しました/,
)
assert.match(viewer, /教員のページに戻る/)
assert.doesNotMatch(viewer, /type="file"|arrayBuffer\(\)/)
assert.match(adminPage, /availablePdfAssets/)
assert.match(adminPage, /activeJournalClubRun \? \[\] : lecturePdfAssets/)
assert.match(adminPage, /updateDisplayState\('setDocument'/)
assert.match(lecturePage, /<SyncedPdfViewer/)
assert.match(displayView, /<SyncedPdfViewer/)

console.log('Milestone 4 PDF sync unit and static checks passed.')
