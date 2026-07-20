import { useEffect, useMemo, useState } from 'react'

import {
  type AdminAcademicAnswer,
  type AdminAcademicResults,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'

type AcademicAnswerControlProps = {
  adminToken: string
  lectureSessionId: string
  lectureStatus: string
}

const emptyResults: AdminAcademicResults = {
  activeRequests: [],
  answers: [],
  candidates: [],
  control: null,
}

function referenceLabel(answer: AdminAcademicAnswer, sourceId: string) {
  const index = answer.sources.findIndex((source) => source.sourceId === sourceId)
  return index >= 0 ? `[${index + 1}]` : '[?]'
}

export function AcademicAnswerControl({
  adminToken,
  lectureSessionId,
  lectureStatus,
}: AcademicAnswerControlProps) {
  const [results, setResults] = useState<AdminAcademicResults>(emptyResults)
  const [sourceMode, setSourceMode] = useState<
    'summary_candidate' | 'teacher_selected'
  >('summary_candidate')
  const [selectedSummaryId, setSelectedSummaryId] = useState('')
  const [question, setQuestion] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [billingPin, setBillingPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState('')

  const selectedCandidate = useMemo(
    () =>
      results.candidates.find(
        (candidate) => candidate.summaryId === selectedSummaryId,
      ) ?? null,
    [results.candidates, selectedSummaryId],
  )

  useEffect(() => {
    let cancelled = false
    setResults(emptyResults)
    setMessage('')
    void supabaseAdminRepository
      .manageAcademicAnswers({
        action: 'status',
        adminToken,
        lectureSessionId,
      })
      .then((nextResults) => {
        if (cancelled) return
        setResults(nextResults)
        const firstCandidate = nextResults.candidates[0]
        if (firstCandidate) {
          setSelectedSummaryId(firstCandidate.summaryId)
          setQuestion(firstCandidate.question)
          setSearchQuery(firstCandidate.question)
        } else {
          setSourceMode('teacher_selected')
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? `参考回答の状態を読み込めませんでした: ${error.message}`
              : '参考回答の状態を読み込めませんでした。',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [adminToken, lectureSessionId])

  useEffect(() => {
    if (!busy) return
    const interval = window.setInterval(() => {
      void supabaseAdminRepository
        .manageAcademicAnswers({
          action: 'status',
          adminToken,
          lectureSessionId,
        })
        .then(setResults)
        .catch(() => undefined)
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [adminToken, busy, lectureSessionId])

  function selectCandidate(summaryId: string) {
    setSelectedSummaryId(summaryId)
    const candidate = results.candidates.find(
      (item) => item.summaryId === summaryId,
    )
    if (candidate) {
      setQuestion(candidate.question)
      setSearchQuery(candidate.question)
    }
  }

  async function generateAnswer() {
    const normalizedQuestion = question.trim()
    const normalizedSearchQuery = searchQuery.trim()
    if (
      !billingPin.trim() ||
      normalizedQuestion.length < 10 ||
      normalizedQuestion.length > 500 ||
      normalizedSearchQuery.length < 3 ||
      normalizedSearchQuery.length > 240 ||
      (sourceMode === 'summary_candidate' && !selectedCandidate)
    ) {
      setMessage('質問・文献検索語・API PINを確認してください。')
      return
    }

    setBusy(true)
    setMessage('一次文献を検証してから、参考回答の下書きを作成します…')
    try {
      const authorization = await supabaseAdminRepository.authorizeAiStart({
        actions: ['academic_answers'],
        adminToken,
        billingPin,
        lectureSessionId,
      })
      setBillingPin('')
      const nextResults = await supabaseAdminRepository.manageAcademicAnswers({
        action: 'generate',
        adminToken,
        billingGrant: authorization.billingGrant,
        idempotencyKey: `phase7-2-${lectureSessionId}-${crypto.randomUUID()}`,
        lectureSessionId,
        question: normalizedQuestion,
        searchQuery: normalizedSearchQuery,
        sourceKind: sourceMode,
        sourceSummaryId:
          sourceMode === 'summary_candidate' ? selectedSummaryId : null,
      })
      setResults(nextResults)
      setMessage(
        '非公開の下書きを作成しました。文献と表現を確認してから公開してください。',
      )
    } catch (error) {
      setBillingPin('')
      setMessage(
        error instanceof Error
          ? `参考回答を作成できませんでした: ${error.message}`
          : '参考回答を作成できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function reviewAnswer(
    action: 'approve' | 'hide' | 'reject',
    answerId: string,
  ) {
    setBusy(true)
    try {
      const nextResults = await supabaseAdminRepository.manageAcademicAnswers({
        action,
        adminToken,
        answerId,
        lectureSessionId,
      })
      setResults(nextResults)
      setMessage(
        action === 'approve'
          ? '確認済みの参考回答を学生画面に公開しました。'
          : action === 'hide'
            ? '参考回答を学生画面から非表示にしました。'
            : '参考回答の下書きを非採用にしました。',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `参考回答の状態を更新できませんでした: ${error.message}`
          : '参考回答の状態を更新できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancelRequest(requestId: string) {
    setCancelling(true)
    try {
      const nextResults = await supabaseAdminRepository.manageAcademicAnswers({
        action: 'cancel',
        adminToken,
        lectureSessionId,
        requestId,
      })
      setResults(nextResults)
      setMessage('参考回答の処理を停止しました。停止にAPI PINは不要です。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `参考回答を停止できませんでした: ${error.message}`
          : '参考回答を停止できませんでした。',
      )
    } finally {
      setCancelling(false)
    }
  }

  const disabled = busy || lectureStatus !== 'open'
  const callsUsed = results.control?.academicAnswerCallsUsed ?? 0
  const callLimit = results.control?.academicAnswerLimit ?? 3

  return (
    <section className="academic-answer-control">
      <div className="academic-answer-heading">
        <div>
          <strong>一次文献に基づく参考回答</strong>
          <small>最大3回／講義・教員確認後のみ学生へ公開</small>
        </div>
        <span>{callsUsed} / {callLimit} 回</span>
      </div>

      <div className="academic-answer-form">
        <label className="field">
          <span>質問の選び方</span>
          <select
            disabled={disabled}
            onChange={(event) => {
              const mode = event.target.value as typeof sourceMode
              setSourceMode(mode)
              if (mode === 'summary_candidate' && results.candidates[0]) {
                selectCandidate(results.candidates[0].summaryId)
              } else {
                setSelectedSummaryId('')
                setQuestion('')
                setSearchQuery('')
              }
            }}
            value={sourceMode}
          >
            <option value="summary_candidate">AI要約の質問候補</option>
            <option value="teacher_selected">教員が質問を入力</option>
          </select>
        </label>

        {sourceMode === 'summary_candidate' ? (
          <label className="field academic-answer-question-field">
            <span>質問候補</span>
            <select
              disabled={disabled || results.candidates.length === 0}
              onChange={(event) => selectCandidate(event.target.value)}
              value={selectedSummaryId}
            >
              {results.candidates.length === 0 ? (
                <option value="">候補はまだありません</option>
              ) : null}
              {results.candidates.map((candidate) => (
                <option key={candidate.summaryId} value={candidate.summaryId}>
                  {candidate.question}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field academic-answer-question-field">
            <span>学生へ補足したい質問</span>
            <textarea
              disabled={disabled}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="講義中に扱う学術的な質問を入力"
              value={question}
            />
          </label>
        )}

        <label className="field academic-answer-question-field">
          <span>PubMed検索語</span>
          <input
            disabled={disabled}
            maxLength={240}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="疾患名、介入、主要アウトカムなど"
            value={searchQuery}
          />
        </label>
        <label className="field">
          <span>API PIN</span>
          <input
            autoComplete="off"
            disabled={disabled}
            inputMode="numeric"
            onChange={(event) => setBillingPin(event.target.value)}
            type="password"
            value={billingPin}
          />
        </label>
        <button
          className="secondary-button"
          disabled={disabled || callsUsed >= callLimit}
          onClick={() => void generateAnswer()}
          type="button"
        >
          {busy ? '処理中…' : '一次文献を確認して下書きを作る'}
        </button>
      </div>
      <p className="note">
        1回あたり最大約$0.04。文献が不足する場合はAIを呼び出さず、費用も発生しません。
      </p>
      {message ? <p aria-live="polite" className="note">{message}</p> : null}

      {results.activeRequests.map((request) => (
        <div className="academic-active-request" key={request.id} role="status">
          <span>
            <strong>処理中</strong>
            {request.status === 'evidence_checking'
              ? '一次文献を確認しています'
              : '参考回答の下書きを作成しています'}
          </span>
          <button
            className="secondary-button compact"
            disabled={cancelling}
            onClick={() => void cancelRequest(request.id)}
            type="button"
          >
            停止する
          </button>
        </div>
      ))}

      <div className="admin-academic-answer-list">
        {results.answers.map((answer) => (
          <article className="admin-academic-answer-card" key={answer.id}>
            <header>
              <div>
                <strong>{answer.question}</strong>
                <small>
                  {answer.publication?.visibility === 'public'
                    ? '学生に公開中'
                    : answer.status === 'rejected'
                      ? '非採用'
                      : '非公開の下書き'}
                </small>
              </div>
              <span>{answer.sources.length} 文献</span>
            </header>
            <ol>
              {answer.body.answerPoints.map((point, index) => (
                <li key={`${answer.id}-point-${index}`}>
                  {point.text}{' '}
                  <small>
                    {point.sourceIds.map((sourceId) =>
                      referenceLabel(answer, sourceId),
                    ).join(' ')}
                  </small>
                </li>
              ))}
            </ol>
            {answer.body.limitations.length > 0 ? (
              <p className="note">
                限界: {answer.body.limitations.join('／')}
              </p>
            ) : null}
            <details>
              <summary>根拠文献を確認</summary>
              <ol className="academic-reference-list">
                {answer.sources.map((source) => (
                  <li key={source.sourceId}>
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.title}
                    </a>
                    <small>
                      {source.authors.slice(0, 3).join(', ')} · {source.journal}{' '}
                      ({source.publicationYear}) · PMID {source.pmid}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
            <div className="proposal-card-actions">
              <button
                className="primary-button"
                disabled={disabled || answer.status === 'rejected'}
                onClick={() => void reviewAnswer('approve', answer.id)}
                type="button"
              >
                確認して学生に公開
              </button>
              {answer.publication?.visibility === 'public' ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void reviewAnswer('hide', answer.id)}
                  type="button"
                >
                  非表示にする
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={disabled || answer.status === 'rejected'}
                  onClick={() => void reviewAnswer('reject', answer.id)}
                  type="button"
                >
                  非採用
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
