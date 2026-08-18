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
assert.match(
  displayRealtimeE2e,
  /const pendingAdminPdfRequests = new Set<Request>\(\)[\s\S]*maxConcurrentAdminPdfRequests = Math\.max[\s\S]*await expect\.poll\(\(\) => pendingAdminPdfRequests\.size\)\.toBe\(0\)[\s\S]*expect\(maxConcurrentAdminPdfRequests\)\.toBe\(1\)/,
  'the real-Edge Display flow proves Admin PDF authorization never overlaps',
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
  /const isCurrentRequest = \(\) =>[\s\S]*requestId === renderRequestRef\.current[\s\S]*canvasRef\.current === canvas[\s\S]*stageRef\.current === stage[\s\S]*await cancelAndSettleRenderTask\(previousRenderTask\)[\s\S]*if \(!isCurrentRequest\(\)\) return[\s\S]*page = await document\.getPage\(pageNumber\)[\s\S]*if \(!isCurrentRequest\(\)\) return/,
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
