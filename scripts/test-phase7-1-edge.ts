import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSummaryOpenAiRequest,
  PHASE6_PROMPT_VERSION,
  PHASE71_PROMPT_VERSION,
  resolveSummaryLanguage,
  type SummaryPdfContext,
} from '../supabase/functions/_shared/lectureSummaries.ts'

const japanese = '講義では研究計画と交絡要因を丁寧に検討し、結果の解釈を議論します。'.repeat(3)
const english = 'The lecture compares study designs, confounders, and careful interpretation of results. '.repeat(3)

function pdf(text: string): SummaryPdfContext {
  return {
    documentId: 'document-1',
    documentVersion: 'a'.repeat(64),
    pages: [{ excerptId: 'b'.repeat(64), pageNumber: 1, text }],
  }
}

test('auto resolves Japanese and English from teacher transcript first', () => {
  assert.deepEqual(
    resolveSummaryLanguage({ pdfContext: pdf(english), preference: 'auto', transcript: [{ text: japanese }] }),
    { language: 'ja', reason: 'auto_transcript_ja' },
  )
  assert.deepEqual(
    resolveSummaryLanguage({ pdfContext: pdf(japanese), preference: 'auto', transcript: [{ text: english }] }),
    { language: 'en', reason: 'auto_transcript_en' },
  )
})

test('auto records a deterministic mixed-language decision', () => {
  const resolution = resolveSummaryLanguage({
    pdfContext: null,
    preference: 'auto',
    transcript: [{ text: `${'あ'.repeat(80)}${'a'.repeat(100)}` }],
  })
  assert.deepEqual(resolution, {
    language: 'en',
    reason: 'auto_transcript_mixed_en',
  })
})

test('auto falls back to PDF, then Japanese, without using comments', () => {
  assert.deepEqual(
    resolveSummaryLanguage({
      pdfContext: pdf(english),
      preference: 'auto',
      transcript: [{ text: 'short' }],
    }),
    { language: 'en', reason: 'auto_pdf_en' },
  )
  assert.deepEqual(
    resolveSummaryLanguage({ pdfContext: null, preference: 'auto', transcript: [] }),
    { language: 'ja', reason: 'auto_default_ja' },
  )
})

test('manual language is authoritative and creates one language-bound request', () => {
  const resolution = resolveSummaryLanguage({
    pdfContext: pdf(japanese),
    preference: 'en',
    transcript: [{ text: japanese }],
  })
  assert.deepEqual(resolution, { language: 'en', reason: 'manual_en' })

  const request = buildSummaryOpenAiRequest({
    commentContext: { comments: [{ body: japanese }] },
    materialContext: null,
    pdfContext: null,
    previousSummary: [],
    resolvedLanguage: resolution.language,
    safetyIdentifier: 'phase71-test',
    transcript: [],
    windowEnd: '2026-07-19T00:05:00.000Z',
    windowStart: '2026-07-19T00:00:00.000Z',
  })
  assert.match(request.input[0]!.content[0]!.text, /every user-visible sentence in English/)
  assert.equal(Array.isArray(request.input), true)
  assert.equal('tools' in request, false)
})

test('Phase 7.1 preserves the Phase 6 per-window idempotency key', () => {
  assert.equal(PHASE71_PROMPT_VERSION, PHASE6_PROMPT_VERSION)
})
