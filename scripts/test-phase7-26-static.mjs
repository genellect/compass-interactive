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

const worker = read('cloudflare', 'asset-worker', 'src', 'pdfPublication.ts')
const crypto = read('cloudflare', 'asset-worker', 'src', 'crypto.ts')
const manage = read(
  'supabase',
  'functions',
  'manage-pdf-publications',
  'index.ts',
)
const manageDocuments = read(
  'supabase',
  'functions',
  'manage-pdf-documents',
  'index.ts',
)
const coordinator = read(
  'supabase',
  'functions',
  'coordinate-pdf-upload-worker',
  'index.ts',
)
const migration = read(
  'supabase',
  'migrations',
  '20260721075029_phase7_26_browser_pdf_publication.sql',
)
const terminalCleanupMigration = read(
  'supabase',
  'migrations',
  '20260721190000_phase7_26_terminal_activation_cleanup.sql',
)
const concurrencyRegression = read('scripts', 'test-phase7-26-concurrency.mjs')
const envExample = read('.env.local.example')
const workerDevVars = read('cloudflare', 'asset-worker', '.dev.vars.example')
const localWrangler = read('cloudflare', 'asset-worker', 'wrangler.jsonc')
const productionWrangler = read(
  'cloudflare',
  'asset-worker',
  'wrangler.production.jsonc',
)

assert.match(worker, /const buffer = await request\.arrayBuffer\(\)/)
assert.match(worker, /bytes\[0\] !== 0x25/)
assert.match(worker, /bytes\.byteLength !== expectedBytes/)
assert.match(
  worker,
  /readVerifiedPdfBody\(request, claims\.bytes, claims\.sha\)[\s\S]*?PDF_BUCKET\.put\(objectKey, verifiedPdf/,
)
assert.match(worker, /sha256: claims\.sha/)
assert.match(worker, /onlyIf: \{ etagDoesNotMatch: '\*' \}/)
assert.match(
  worker,
  /callCoordinator\(env, fetcher, \{\s*action: 'claimNonce'/s,
)
assert.match(worker, /status: 'committed'/)
assert.match(worker, /status: 'active'/)
assert.match(worker, /status: 'activating'/)
assert.match(worker, /status: 'cleanup_complete'/)
assert.match(worker, /COMPASS-PDF-CLEANUP-TOMBSTONE/)
assert.match(worker, /assertManifestMutationLedgerFence/)
assert.match(worker, /etagMatches: current\.etag/)
assert.match(worker, /manifest_version:[\s\S]*\+ 1/)
assert.doesNotMatch(worker, /pdfjs|getDocument\(|page\.render\(/i)

assert.match(crypto, /compass-pdf-publication-worker/)
assert.match(crypto, /payload\.origin/)
assert.match(crypto, /payload\.sid/)
assert.match(crypto, /payload\.purpose === 'upload'/)

assert.match(manage, /hasLegacyAdminFields\(body\)/)
assert.match(manage, /verifyGoogleAdminOperationRequest/)
assert.match(manage, /getAllowedCorsOrigin\(request\)/)
assert.match(manage, /readJsonBody<RequestBody>\(request, 32 \* 1024\)/)
assert.match(manage, /prepare_google_admin_pdf_publication_finalize_v1/)
assert.match(manage, /advance_google_admin_pdf_publication_v1/)
assert.match(manage, /get_google_admin_pdf_publication_v1/)
assert.match(manage, /response\.body\?\.getReader\(\)/)
assert.doesNotMatch(manage, /response\.arrayBuffer\(\)/)
assert.match(manage, /typeof body\.downloadEnabled !== 'boolean'/)
assert.doesNotMatch(
  manage,
  /VITE_.*SERVICE_ROLE|import\.meta\.env.*SERVICE_ROLE/i,
)

assert.match(manageDocuments, /manage_google_admin_pdf_documents_v1/)
assert.match(manageDocuments, /target_expected_access_version/)
assert.match(manageDocuments, /target_manifest_etag/)
assert.match(
  manageDocuments,
  /body\.action === 'register'[\s\S]*?PHASE726_BROWSER_PDF_PUBLICATION_ENABLED'[\s\S]*?=== 'true'[\s\S]*?409/,
)
assert.doesNotMatch(
  manageDocuments,
  /PHASE726_BROWSER_PDF_PUBLICATION_ENABLED'[\s\S]*?!hasLocalPublicationReceipt/,
)
assert.match(manageDocuments, /hasLegacyAdminFields\(body\)/)
assert.match(manageDocuments, /verifyGoogleAdminOperationRequest/)
const abortRpcIndex = manage.indexOf("'abort_google_admin_pdf_publication_v1'")
const abortRollbackIndex = manage.indexOf(
  '`/v2/pdf-publications/${before.publication_id}/rollback`',
  abortRpcIndex,
)
assert.ok(abortRpcIndex >= 0 && abortRollbackIndex > abortRpcIndex)

assert.match(coordinator, /request\.headers\.has\('Origin'\)/)
assert.match(coordinator, /PDF_PUBLICATION_COORDINATOR_SECRET/)
assert.match(coordinator, /worker_claim_pdf_publication_nonce_v1/)
assert.match(coordinator, /worker_record_pdf_publication_uploaded_v1/)

assert.match(migration, /enable row level security/)
assert.match(
  migration,
  /revoke all on public\.lecture_pdf_publications[\s\S]*anon, authenticated/,
)
assert.match(migration, /security invoker/g)
assert.match(migration, /set search_path = ''/g)
assert.match(migration, /nonce_used_at is null/)
assert.match(migration, /admin_find_inflight_pdf_publication_v1/)
assert.match(migration, /pdf_access_version \+ 1/)
assert.match(migration, /after update of status on public\.lecture_sessions/)
assert.match(concurrencyRegression, /function startSqlUntilReady/)
assert.match(
  concurrencyRegression,
  /`\$\{stdout\}\\n\$\{stderr\}`\.includes\(readyMarker\)/,
)
assert.match(concurrencyRegression, /child\.on\('close'/)
assert.match(concurrencyRegression, /void done\.catch\(\(\) => undefined\)/)
assert.match(
  concurrencyRegression,
  /waitForApplicationLock[\s\S]*?pg_catalog\.pg_stat_activity[\s\S]*?wait_event_type = 'Lock'/,
)
assert.match(
  concurrencyRegression,
  /PHASE726_ABORT_WINNER_READY[\s\S]*?phase726-abort-wins-activation-waiter/,
)
assert.match(
  concurrencyRegression,
  /PHASE726_ACTIVATION_WINNER_READY[\s\S]*?phase726-activation-wins-abort-waiter/,
)
assert.doesNotMatch(
  concurrencyRegression,
  /select (?:pg_catalog\.)?pg_sleep\(0\.(?:1|5)0*\);/,
)
assert.match(terminalCleanupMigration, /cleanup_worker_generation/)
assert.match(terminalCleanupMigration, /cleanup_exhausted_at/)
assert.match(terminalCleanupMigration, /cleanup_attempt_count < 1000/g)
assert.match(
  terminalCleanupMigration,
  /lecture_pdf_publications_cleanup_retryable_due_idx/,
)
assert.match(terminalCleanupMigration, /cleanup_attempt_limit', 1000/)

assert.match(envExample, /^PHASE726_BROWSER_PDF_PUBLICATION_ENABLED=false$/m)
assert.match(envExample, /^PDF_PUBLICATION_WORKER_BASE_URL=$/m)
assert.match(envExample, /^PDF_PUBLICATION_COORDINATOR_SECRET=$/m)
assert.match(envExample, /^PDF_PUBLICATION_PRIVATE_JWK=$/m)
assert.match(workerDevVars, /^PDF_PUBLICATION_COORDINATOR_SECRET=.+$/m)
assert.match(
  workerDevVars,
  /^PDF_PUBLICATION_COORDINATOR_URL=http:\/\/127\.0\.0\.1:/m,
)
assert.match(workerDevVars, /^PDF_PUBLICATION_PUBLIC_JWK=\{"kty":"EC"/m)

for (const config of [localWrangler, productionWrangler]) {
  assert.match(config, /"PHASE726_BROWSER_PDF_UPLOAD_ENABLED": "false"/)
  assert.match(config, /PDF_PUBLICATION_PUBLIC_JWK/)
  assert.match(config, /PDF_PUBLICATION_COORDINATOR_SECRET/)
}

console.log('Phase 7.26 cross-boundary static checks passed.')
