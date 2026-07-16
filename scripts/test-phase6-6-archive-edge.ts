import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJsonStringify,
  normalizeArchiveWorkerIngestUrl,
  runArchiveExportBatch,
  sanitizeArchiveExportClaim,
  sha256CanonicalJson,
  type FinishArchiveExportInput,
} from '../supabase/functions/_shared/archiveExport.ts'

const lectureSessionId = '10000000-0000-4000-8000-000000000066'
const archiveExpiresAt = '2026-08-15T01:30:00.000Z'
const ingestSecret = 'archive-ingest-secret-with-at-least-32-bytes'

function validPayload() {
  return {
    title: 'Archive test',
    summaries: [],
    started_at: '2026-07-16T00:00:00+00:00',
    schema_version: 1,
    polls: [],
    pdf: null,
    participant_count_approximate: 12,
    comments_has_more: false,
    material_summary: null,
    comments: [
      {
        nickname: null,
        like_count: 2,
        is_pinned: false,
        id: '20000000-0000-4000-8000-000000000066',
        created_at: '2026-07-16T00:05:00.000Z',
        body: 'Test comment',
      },
    ],
    closed_at: '2026-07-16T01:30:00+00:00',
    archive_expires_at: '2026-08-15T01:30:00+00:00',
  }
}

function validClaim(overrides: Record<string, unknown> = {}) {
  return {
    archive_expires_at: '2026-08-15T01:30:00+00:00',
    attempt_count: 1,
    lecture_code: ' 285463 ',
    lecture_session_id: lectureSessionId,
    payload: validPayload(),
    source_version: 3,
    ...overrides,
  }
}

test('canonical JSON and hashes are stable across object key order', async () => {
  const left = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } }
  const right = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 }
  assert.equal(canonicalJsonStringify(left), canonicalJsonStringify(right))
  assert.deepEqual(
    await sha256CanonicalJson(left),
    await sha256CanonicalJson(right),
  )
})

test('sanitizes claim envelope and normalizes timestamps and code', () => {
  const claim = sanitizeArchiveExportClaim(validClaim())
  assert.equal(claim.lectureCode, '285463')
  assert.equal(claim.archiveExpiresAt, archiveExpiresAt)
  assert.equal(claim.payload.archive_expires_at, archiveExpiresAt)
  assert.equal(claim.payload.closed_at, '2026-07-16T01:30:00.000Z')
  assert.equal(claim.payload.started_at, '2026-07-16T00:00:00.000Z')
  assert.equal(claim.payload.title, 'Archive test')
})

test('rejects private payload keys before contacting the Worker', async () => {
  const claim = validClaim()
  ;(claim.payload as Record<string, unknown>).auth_user_id =
    '30000000-0000-4000-8000-000000000066'
  let fetchCalls = 0
  const finalized: FinishArchiveExportInput[] = []
  const result = await runArchiveExportBatch({
    claim: async () => [claim],
    fetchImpl: async () => {
      fetchCalls += 1
      return new Response(null, { status: 500 })
    },
    finish: async (input) => {
      finalized.push(input)
      return true
    },
    ingestSecret,
    workerIngestUrl: 'https://archive.example.test/internal/v1/archives',
  })

  assert.equal(fetchCalls, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.succeeded, 0)
  assert.equal(finalized.length, 1)
  assert.equal(finalized[0]?.succeeded, false)
  assert.equal(finalized[0]?.error, 'invalid_claim')
})

test('posts canonical payload hash and finalizes a successful export', async () => {
  const finalized: FinishArchiveExportInput[] = []
  const observedBodies: Record<string, unknown>[] = []
  const result = await runArchiveExportBatch({
    claim: async (limit) => {
      assert.equal(limit, 5)
      return [validClaim()]
    },
    fetchImpl: async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${ingestSecret}`,
      )
      observedBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      )
      return Response.json({
        accepted: true,
        ok: true,
        sourceVersion: 3,
      })
    },
    finish: async (input) => {
      finalized.push(input)
      return true
    },
    ingestSecret,
    workerIngestUrl: 'https://archive.example.test/internal/v1/archives',
  })

  assert.equal(result.succeeded, 1)
  assert.equal(result.failed, 0)
  assert.equal(result.finalizeFailed, 0)
  assert.equal(observedBodies.length, 1)
  const observedBody = observedBodies[0]!
  assert.equal(observedBody.archiveExpiresAt, archiveExpiresAt)
  const payload = observedBody.payload
  assert.equal(
    observedBody.payloadSha256,
    (await sha256CanonicalJson(payload)).payloadSha256,
  )
  assert.deepEqual(finalized, [
    {
      error: null,
      lectureSessionId,
      payloadSha256: observedBody.payloadSha256,
      sourceVersion: 3,
      succeeded: true,
    },
  ])
})

test('isolates Worker failures and continues exporting the remaining claim', async () => {
  const secondLectureId = '10000000-0000-4000-8000-000000000067'
  const finalized: FinishArchiveExportInput[] = []
  let calls = 0
  const result = await runArchiveExportBatch({
    claim: async () => [
      validClaim(),
      validClaim({
        lecture_code: '285464',
        lecture_session_id: secondLectureId,
        source_version: 4,
      }),
    ],
    fetchImpl: async (_url, init) => {
      calls += 1
      const body = JSON.parse(String(init?.body)) as {
        sourceVersion: number
      }
      return body.sourceVersion === 3
        ? new Response(null, { status: 503 })
        : Response.json({
            accepted: true,
            ok: true,
            sourceVersion: body.sourceVersion,
          })
    },
    finish: async (input) => {
      finalized.push(input)
      return true
    },
    ingestSecret,
    workerIngestUrl: 'https://archive.example.test/internal/v1/archives',
  })

  assert.equal(calls, 2)
  assert.equal(result.failed, 1)
  assert.equal(result.succeeded, 1)
  assert.equal(finalized.length, 2)
  assert.equal(
    finalized.find((item) => item.sourceVersion === 3)?.error,
    'worker_http_503',
  )
  assert.equal(
    finalized.find((item) => item.sourceVersion === 4)?.succeeded,
    true,
  )
})

test('reports an ACK failure without failing or repeating another item', async () => {
  const result = await runArchiveExportBatch({
    claim: async () => [validClaim()],
    fetchImpl: async () =>
      Response.json({ accepted: true, ok: true, sourceVersion: 3 }),
    finish: async () => false,
    ingestSecret,
    workerIngestUrl: 'https://archive.example.test/internal/v1/archives',
  })
  assert.equal(result.succeeded, 0)
  assert.equal(result.finalizeFailed, 1)
  assert.equal(result.items[0]?.status, 'finalize_failed')
  assert.equal(result.items[0]?.errorCode, 'archive_finalize_failed')
})

test('caps claims at five and accepts HTTP only for local development', async () => {
  let observedLimit = 0
  const result = await runArchiveExportBatch({
    claim: async (limit) => {
      observedLimit = limit
      return []
    },
    finish: async () => true,
    ingestSecret,
    limit: 999,
    workerIngestUrl: 'http://127.0.0.1:8787/internal/v1/archives',
  })
  assert.equal(observedLimit, 5)
  assert.equal(result.claimed, 0)
  assert.equal(
    normalizeArchiveWorkerIngestUrl(
      'http://localhost:8787/internal/v1/archives',
    ),
    'http://localhost:8787/internal/v1/archives',
  )
  assert.throws(() =>
    normalizeArchiveWorkerIngestUrl(
      'http://archive.example.test/internal/v1/archives',
    ),
  )
})
