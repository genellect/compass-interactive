import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const migration = read(
  'supabase',
  'migrations',
  '20260714104032_phase3_private_pdf_delivery.sql',
)
const publisher = read('publisher', 'src', 'server', 'publisherServer.ts')
const validator = read('publisher', 'src', 'pdf', 'validatePdf.ts')
const worker = read('cloudflare', 'asset-worker', 'src', 'worker.ts')
const wrangler = read('cloudflare', 'asset-worker', 'wrangler.jsonc')
const delivery = read('src', 'pdf', 'pdfDelivery.ts')
const publisherClient = read('src', 'pdf', 'publisherClient.ts')
const retentionFeed = read(
  'supabase',
  'functions',
  'get-pdf-retention-feed',
  'index.ts',
)
const config = read('supabase', 'config.toml')
const envExample = read('.env.local.example')

assert.match(envExample, /VITE_PHASE3_PRIVATE_PDF=false/)
assert.doesNotMatch(envExample, /VITE_PHASE3_PRIVATE_PDF=true/)
assert.match(migration, /create table public\.lecture_pdf_documents/)
assert.match(
  migration,
  /alter table public\.lecture_pdf_documents enable row level security/,
)
assert.match(
  migration,
  /revoke all on public\.lecture_pdf_documents from public, anon, authenticated/,
)
assert.doesNotMatch(
  migration,
  /grant (?:select|insert|update|delete)[^;]*lecture_pdf_documents[^;]*authenticated/i,
)
assert.match(migration, /security invoker/g)
assert.match(migration, /security definer[\s\S]*?set search_path = ''/)
assert.match(migration, /15728640/)
assert.match(migration, /between 1 and 75/)
assert.match(migration, /between 1 and 20000/)
assert.doesNotMatch(migration, /bytea|large object|storage\.objects/i)

assert.match(publisher, /host: typeof PUBLISHER_HOST/)
assert.match(publisher, /getRequestContext\(request, configuration\)/)
assert.ok(
  publisher.indexOf('getRequestContext(request, configuration)') <
    publisher.indexOf('await readBody(request'),
  'Publisher must validate Host and Origin before reading request bodies.',
)
assert.match(
  publisher,
  /decodeURIComponent\(getHeader\(request, 'x-file-name'\)/,
)
assert.match(publisherClient, /encodeURIComponent\(input\.file\.name\)/)
assert.doesNotMatch(publisherClient, /AWS_|R2_|SECRET_ACCESS_KEY|service_role/i)
assert.match(validator, /getTextContent/)
assert.doesNotMatch(validator, /\.render\(|createCanvas|OffscreenCanvas/)

assert.match(worker, /PDF_BUCKET/)
assert.match(worker, /verifyLectureToken/)
assert.match(worker, /signAssetTicket/)
assert.match(worker, /Range/)
assert.match(worker, /If-None-Match/)
assert.match(worker, /syncRetentionMetadata/)
assert.match(worker, /cleanup-pending/)
assert.doesNotMatch(worker, /supabase|service_role|SUPABASE_URL/i)
assert.match(wrangler, /"binding": "PDF_BUCKET"/)
assert.doesNotMatch(wrangler, /"routes?"|"crons?"/)
assert.match(delivery, /cache: 'no-store'/)

for (const functionName of ['issue-pdf-access-token', 'manage-pdf-documents']) {
  assert.match(
    config,
    new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`),
  )
}
assert.match(
  config,
  /\[functions\.get-pdf-retention-feed\][\s\S]*?verify_jwt = false/,
)
assert.match(retentionFeed, /PDF_RETENTION_SYNC_SECRET/)
assert.match(retentionFeed, /timingSafeEqual/)
assert.match(retentionFeed, /SUPABASE_SERVICE_ROLE_KEY/)
assert.doesNotMatch(retentionFeed, /handleCors|Access-Control-Allow-Origin/)

console.log(
  'Phase 3 static security and responsibility-boundary checks passed.',
)
