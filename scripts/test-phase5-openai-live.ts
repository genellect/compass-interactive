import assert from 'node:assert/strict'
import { sha256Hex } from '../supabase/functions/_shared/aiBilling.ts'
import {
  applyMaterialQualityGates,
  buildMaterialOpenAiRequest,
  calculateCostMicrousd,
  type MaterialExtraction,
  parseMaterialOpenAiResponse,
  PHASE5_MODEL,
} from '../supabase/functions/_shared/materialAnalysis.ts'

if (process.env.PHASE5_LIVE_PROVIDER_TEST !== 'true') {
  throw new Error(
    'Set PHASE5_LIVE_PROVIDER_TEST=true for the explicit live test.',
  )
}
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

const documentVersion = 'a'.repeat(64)
const texts = [
  '背景: 無作為化比較試験では、介入群と対照群への割付を無作為に行い、既知・未知の交絡因子を平均的に均衡させる。研究目的は教育介入が批判的吟味能力を改善するか評価することである。',
  '方法と結果: 120名を1対1に割り付け、主要評価項目は事前に登録した知識スコアとした。平均差は5.2点、95%信頼区間は2.1から8.3点であった。追跡率は介入群92%、対照群90%であった。',
  '限界と解釈: 単施設研究で追跡期間が8週間と短く、長期的な一般化可能性は限定される。統計学的有意差だけでなく効果量、信頼区間、脱落、外的妥当性を合わせて解釈する必要がある。',
]
const pages = await Promise.all(
  texts.map(async (text, index) => ({
    characterCount: text.length,
    excerptId: await sha256Hex(`${documentVersion}:${index + 1}:${text}`),
    pageNumber: index + 1,
    text,
  })),
)
const extraction: MaterialExtraction = {
  documentId: 'live-contract-test',
  documentVersion,
  lecturePublicId: 'lecture_livecontract1234',
  pageCount: 3,
  pages,
  textCharCount: texts.reduce((sum, text) => sum + text.length, 0),
  textSha256: await sha256Hex(
    pages
      .map((page) => `--- page:${page.pageNumber} ---\n${page.text}`)
      .join('\n'),
  ),
}
const request = buildMaterialOpenAiRequest({
  action: 'material_analysis',
  existingQuestions: ['統計学的有意差だけで十分ですか？'],
  extraction,
  safetyIdentifier: `compass_${(await sha256Hex('phase5-live-contract')).slice(0, 48)}`,
})
request.max_output_tokens = 2_000

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
const parsed = parseMaterialOpenAiResponse(await response.json())
const gated = applyMaterialQualityGates({
  action: 'material_analysis',
  existingQuestions: ['統計学的有意差だけで十分ですか？'],
  extraction,
  result: parsed.result,
})
assert.ok(gated.analysis)
assert.ok(gated.proposals.length >= 3)

console.log(
  JSON.stringify({
    costMicrousd: calculateCostMicrousd(
      parsed.inputTokens,
      parsed.outputTokens,
    ),
    inputTokens: parsed.inputTokens,
    model: PHASE5_MODEL,
    ok: true,
    outputTokens: parsed.outputTokens,
    proposalCount: gated.proposals.length,
    providerRequestIdPresent: Boolean(parsed.providerRequestId),
  }),
)
