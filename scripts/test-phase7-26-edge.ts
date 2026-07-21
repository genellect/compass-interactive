import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { verifyPdfPublicationToken } from '../cloudflare/asset-worker/src/crypto.ts'

const values = new Map<string, string>()
Object.assign(globalThis, {
  Deno: {
    env: {
      get(name: string) {
        return values.get(name)
      },
    },
  },
})

const {
  createPdfPublicationNonce,
  sha256Hex,
  signPdfPublicationTicket,
} = await import('../supabase/functions/_shared/pdfPublicationToken.ts')

test('browser publication mode rejects every Local Publisher registration', () => {
  const source = readFileSync(
    new URL(
      '../supabase/functions/manage-pdf-documents/index.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(
    source,
    /body\.action === 'register'[\s\S]*?PHASE726_BROWSER_PDF_PUBLICATION_ENABLED'[\s\S]*?=== 'true'[\s\S]*?409/,
  )
  assert.doesNotMatch(
    source,
    /PHASE726_BROWSER_PDF_PUBLICATION_ENABLED'[\s\S]*?!hasLocalPublicationReceipt/,
  )
})

test('Edge upload ticket and Worker verification share an exact signed contract', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  values.set(
    'PDF_PUBLICATION_PRIVATE_JWK',
    JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)),
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const now = Math.floor(Date.now() / 1000)
  const nonce = createPdfPublicationNonce()
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/)
  assert.match(await sha256Hex(nonce), /^[0-9a-f]{64}$/)

  const token = await signPdfPublicationTicket({
    adminSessionId: '79000000-0000-4000-8000-000000000726',
    bytes: 1024,
    doc: 'browser-material',
    expiresAt: now + 300,
    generation: 1,
    issuedAt: now,
    jti: '71000000-0000-4000-8000-000000000726',
    lecturePublicId: 'lecture_1234567890abcdef1234567890abcdef',
    nonce,
    origin: 'https://compass.example',
    publicationId: '70000000-0000-4000-8000-000000000726',
    purpose: 'upload',
    sha256: 'a'.repeat(64),
  })
  const claims = await verifyPdfPublicationToken({
    nowSeconds: now,
    publicJwk,
    token,
  })
  assert.equal(claims.purpose, 'upload')
  assert.equal(claims.nonce, nonce)
  assert.equal(claims.origin, 'https://compass.example')
  assert.equal(claims.sid, '79000000-0000-4000-8000-000000000726')
})

test('commit and activation tickets cannot be substituted for upload', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  values.set(
    'PDF_PUBLICATION_PRIVATE_JWK',
    JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)),
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const now = Math.floor(Date.now() / 1000)
  const common = {
    adminSessionId: '79000000-0000-4000-8000-000000000726',
    bytes: 1024,
    doc: 'browser-material',
    expiresAt: now + 60,
    generation: 1,
    issuedAt: now,
    lecturePublicId: 'lecture_1234567890abcdef1234567890abcdef',
    origin: 'https://compass.example',
    publicationId: '70000000-0000-4000-8000-000000000726',
    sha256: 'a'.repeat(64),
  } as const
  const commit = await signPdfPublicationTicket({
    ...common,
    download: true,
    jti: '72000000-0000-4000-8000-000000000726',
    name: 'Browser material',
    pages: 3,
    previousAccessVersion: 4,
    purpose: 'commit',
    textCharacters: 100,
    textSha256: 'b'.repeat(64),
  })
  const commitClaims = await verifyPdfPublicationToken({
    nowSeconds: now,
    publicJwk,
    token: commit,
  })
  assert.equal(commitClaims.purpose, 'commit')
  assert.equal(commitClaims.target_av, undefined)

  const activation = await signPdfPublicationTicket({
    ...common,
    jti: '73000000-0000-4000-8000-000000000726',
    previousAccessVersion: 4,
    purpose: 'activate',
    targetAccessVersion: 5,
  })
  const activationClaims = await verifyPdfPublicationToken({
    nowSeconds: now,
    publicJwk,
    token: activation,
  })
  assert.equal(activationClaims.purpose, 'activate')
  assert.equal(activationClaims.target_av, 5)
})
