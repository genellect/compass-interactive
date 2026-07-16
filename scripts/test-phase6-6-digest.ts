import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildDailyDigestContent,
  DailyDigestError,
  escapeHtml,
  getJstDayBounds,
  sendDailyDigestWithResend,
  stableRecipientHash,
} from '../supabase/functions/_shared/dailyDigest.ts'

const lectures = [
  {
    closedAt: '2026-07-16T08:00:00.000Z',
    id: '10000000-0000-4000-8000-000000000001',
    startedAt: '2026-07-16T00:00:00.000Z',
    status: 'closed',
    title: '<img src=x onerror=alert(1)> 文献発表',
  },
]

const usages = [
  {
    actualMicrousd: 500,
    feature: 'summaries',
    id: '20000000-0000-4000-8000-000000000001',
    requestedAt: '2026-07-16T00:05:00.000Z',
    reservedMicrousd: 1_000,
    status: 'succeeded',
  },
  {
    actualMicrousd: null,
    feature: 'captions',
    id: '20000000-0000-4000-8000-000000000002',
    requestedAt: '2026-07-16T00:10:00.000Z',
    reservedMicrousd: 2_000,
    status: 'running',
  },
]

test('computes exact JST day boundaries without client-local time', () => {
  assert.deepEqual(getJstDayBounds('2026-07-16'), {
    endExclusive: '2026-07-16T15:00:00.000Z',
    startInclusive: '2026-07-15T15:00:00.000Z',
  })
  assert.throws(
    () => getJstDayBounds('2026-02-30'),
    (error: unknown) =>
      error instanceof DailyDigestError && error.code === 'invalid_digest_date',
  )
})

test('escapes dynamic HTML and uses actual cost before reserved estimate', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;')
  const content = buildDailyDigestContent({
    digestDate: '2026-07-16',
    lectures,
    usages,
  })
  assert.ok(content)
  assert.equal(content.apiCallCount, 2)
  assert.equal(content.estimatedApiCallCount, 1)
  assert.equal(content.totalCostMicrousd, 2_500)
  assert.match(content.text, /APIコスト（実績＋未確定分の予約額）/)
  assert.match(content.text, /US\$0\.002500/)
  assert.match(content.text, /終了済/)
  assert.doesNotMatch(content.html, /<img src=/)
  assert.match(content.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('suppresses email content when the JST day has no activity', () => {
  assert.equal(
    buildDailyDigestContent({
      digestDate: '2026-07-16',
      lectures: [],
      usages: [],
    }),
    null,
  )
})

test('builds a stable privacy-preserving recipient idempotency key', async () => {
  const first = await stableRecipientHash(' Owner@Example.com ')
  const repeated = await stableRecipientHash('owner@example.com')
  const other = await stableRecipientHash('other@example.com')
  assert.match(first, /^[0-9a-f]{32}$/)
  assert.equal(first, repeated)
  assert.notEqual(first, other)
})

test('sends one mocked Resend request with deterministic idempotency', async () => {
  const content = buildDailyDigestContent({
    digestDate: '2026-07-16',
    lectures,
    usages,
  })
  assert.ok(content)
  let requests = 0
  const recipient = 'owner@example.com'
  const hash = await stableRecipientHash(recipient)
  const result = await sendDailyDigestWithResend({
    apiKey: 'test-resend-key',
    content,
    digestDate: '2026-07-16',
    fetchImpl: async (input, init) => {
      requests += 1
      assert.equal(input, 'https://api.resend.com/emails')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Authorization'), 'Bearer test-resend-key')
      assert.equal(
        headers.get('Idempotency-Key'),
        `compass-daily/2026-07-16/${hash}`,
      )
      const body = JSON.parse(String(init?.body)) as {
        from: string
        html: string
        reply_to?: string
        subject: string
        text: string
        to: string[]
      }
      assert.equal(body.from, 'COMPASS <digest@example.com>')
      assert.equal(body.reply_to, 'owner@example.com')
      assert.deepEqual(body.to, [recipient])
      assert.match(body.subject, /2026-07-16/)
      assert.match(body.text, /API呼び出しが2件/)
      assert.doesNotMatch(body.html, /<img src=/)
      return Response.json({ id: 'resend-message-1' })
    },
    from: 'COMPASS <digest@example.com>',
    recipient,
    replyTo: 'owner@example.com',
  })
  assert.deepEqual(result, { id: 'resend-message-1' })
  assert.equal(requests, 1)
})

test('classifies provider failure without leaking its response body', async () => {
  const content = buildDailyDigestContent({
    digestDate: '2026-07-16',
    lectures,
    usages,
  })
  assert.ok(content)
  await assert.rejects(
    sendDailyDigestWithResend({
      apiKey: 'test-resend-key',
      content,
      digestDate: '2026-07-16',
      fetchImpl: async () =>
        new Response('provider secret diagnostic', { status: 429 }),
      from: 'COMPASS <digest@example.com>',
      recipient: 'owner@example.com',
    }),
    (error: unknown) =>
      error instanceof DailyDigestError &&
      error.code === 'resend_http_429' &&
      !error.message.includes('provider secret'),
  )
})

test('Edge function remains machine-only and never calls an AI provider', async () => {
  const source = await readFile(
    new URL(
      '../supabase/functions/send-daily-operations-digest/index.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(source, /DAILY_DIGEST_ENABLED/)
  assert.match(source, /DAILY_DIGEST_TRIGGER_SECRET/)
  assert.match(source, /claim_daily_operations_digest_jobs/)
  assert.match(source, /finish_daily_operations_digest_job/)
  assert.match(source, /job_limit: 1/)
  assert.doesNotMatch(source, /OPENAI_API_KEY|api\.openai\.com|\/v1\/responses/)
})
