import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) =>
  readFileSync(
    new URL(parts.join('/'), `${new URL(`file:///${root.replaceAll('\\', '/')}/`)}`),
    'utf8',
  )

const worker = read('cloudflare', 'asset-worker', 'src', 'pdfPublication.ts')
const crypto = read('cloudflare', 'asset-worker', 'src', 'crypto.ts')
const manage = read('supabase', 'functions', 'manage-pdf-publications', 'index.ts')
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
const localWrangler = read('cloudflare', 'asset-worker', 'wrangler.jsonc')
const productionWrangler = read(
  'cloudflare',
  'asset-worker',
  'wrangler.production.jsonc',
)

assert.match(worker, /TransformStream<Uint8Array, Uint8Array>/)
assert.match(worker, /prefix\[0\] === 0x25/)
assert.match(worker, /actualBytes !== expectedBytes/)
assert.match(worker, /sha256: claims\.sha/)
assert.match(worker, /onlyIf: \{ etagDoesNotMatch: '\*' \}/)
assert.match(worker, /callCoordinator\(env, fetcher, \{\s*action: 'claimNonce'/s)
assert.match(worker, /status: 'committed'/)
assert.match(worker, /status: 'active'/)
assert.doesNotMatch(worker, /request\.arrayBuffer\(/)
assert.doesNotMatch(worker, /pdfjs|getDocument\(|page\.render\(/i)

assert.match(crypto, /compass-pdf-publication-worker/)
assert.match(crypto, /payload\.origin/)
assert.match(crypto, /payload\.sid/)
assert.match(crypto, /payload\.purpose === 'upload'/)

assert.match(manage, /trackedAdminSessionsEnabled\(\)/)
assert.match(manage, /getAllowedCorsOrigin\(request\)/)
assert.match(manage, /readJsonBody<RequestBody>\(request, 32 \* 1024\)/)
assert.match(manage, /admin_prepare_pdf_publication_commit_v1/)
assert.match(manage, /admin_complete_pdf_publication_activation_v1/)
assert.doesNotMatch(manage, /VITE_.*SERVICE_ROLE|import\.meta\.env.*SERVICE_ROLE/i)

assert.match(coordinator, /request\.headers\.has\('Origin'\)/)
assert.match(coordinator, /PDF_PUBLICATION_COORDINATOR_SECRET/)
assert.match(coordinator, /worker_claim_pdf_publication_nonce_v1/)
assert.match(coordinator, /worker_record_pdf_publication_uploaded_v1/)

assert.match(migration, /enable row level security/)
assert.match(migration, /revoke all on public\.lecture_pdf_publications[\s\S]*anon, authenticated/)
assert.match(migration, /security invoker/g)
assert.match(migration, /set search_path = ''/g)
assert.match(migration, /nonce_used_at is null/)
assert.match(migration, /pdf_access_version \+ 1/)
assert.match(migration, /after update of status on public\.lecture_sessions/)

for (const config of [localWrangler, productionWrangler]) {
  assert.match(config, /"PHASE726_BROWSER_PDF_UPLOAD_ENABLED": "false"/)
  assert.match(config, /PDF_PUBLICATION_PUBLIC_JWK/)
  assert.match(config, /PDF_PUBLICATION_COORDINATOR_SECRET/)
}

console.log('Phase 7.26 cross-boundary static checks passed.')
