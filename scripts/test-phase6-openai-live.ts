import assert from 'node:assert/strict'
import { sha256Hex } from '../supabase/functions/_shared/aiBilling.ts'
import {
  applySummaryQualityGates,
  buildSummaryOpenAiRequest,
  calculateSummaryCostMicrousd,
  normalizePdfContext,
  normalizeTranscriptSegments,
  parseSummaryOpenAiResponse,
  PHASE6_MODEL,
} from '../supabase/functions/_shared/lectureSummaries.ts'

if (process.env.PHASE6_LIVE_PROVIDER_TEST !== 'true') {
  throw new Error('Set PHASE6_LIVE_PROVIDER_TEST=true for the explicit live test.')
}
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

const lectureId = '60000000-0000-4000-8000-000000000006'
const transcript = await normalizeTranscriptSegments(lectureId, [
  {
    completedAt: '2026-07-16T00:04:30.000Z',
    itemId: 'synthetic-live-contract',
    startedAt: '2026-07-16T00:00:30.000Z',
    text: '無作為化比較試験では介入群と対照群を比較し、平均差だけでなく95%信頼区間、脱落、一般化可能性を合わせて解釈します。今回の合成例では単施設・短期追跡が限界です。',
  },
])
const documentVersion = 'a'.repeat(64)
const pageText = '主要評価項目は事前登録され、効果量と信頼区間を用いて教育介入の結果を評価する。'
const pdf = await normalizePdfContext({
  documentId: 'phase6-live-contract',
  documentVersion,
  pages: [
    {
      excerptId: await sha256Hex(`${documentVersion}:1:${pageText}`),
      pageNumber: 1,
      text: pageText,
    },
  ],
})
const request = buildSummaryOpenAiRequest({
  commentContext: { comment_count: 0, comments: [], previous_comment_count: 0 },
  materialContext: null,
  pdfContext: pdf.context,
  previousSummary: [],
  safetyIdentifier: `compass_${(await sha256Hex('phase6-live-contract')).slice(0, 48)}`,
  transcript: transcript.segments,
  windowEnd: '2026-07-16T00:05:00.000Z',
  windowStart: '2026-07-16T00:00:00.000Z',
})
request.max_output_tokens = 700

const response = await fetch('https://api.openai.com/v1/responses', {
  body: JSON.stringify(request),
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  method: 'POST',
  signal: AbortSignal.timeout(55_000),
})
if (!response.ok) {
  throw new Error(`OpenAI contract test failed with HTTP ${response.status}.`)
}
const parsed = parseSummaryOpenAiResponse(await response.json())
const gated = applySummaryQualityGates({
  commentContext: { comment_count: 0, comments: [] },
  pdfContext: pdf.context,
  previousSummary: [],
  result: parsed.result,
  transcript: transcript.segments,
})
assert.ok(gated.output.lecture_recap.length >= 1)
assert.equal(gated.output.comment_pulse.length, 0)

console.log(
  JSON.stringify({
    costMicrousd: calculateSummaryCostMicrousd(parsed.inputTokens, parsed.outputTokens),
    inputTokens: parsed.inputTokens,
    model: PHASE6_MODEL,
    ok: true,
    outputTokens: parsed.outputTokens,
    providerRequestIdPresent: Boolean(parsed.providerRequestId),
    publishRecommended: gated.publishRecommended,
  }),
)
