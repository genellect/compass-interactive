import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'

import { buildDoiUrl } from '../../lib/academicSourceLinks'
import {
  type AdminAcademicAnswer,
  type AdminAcademicResults,
  type AiMasterAuthorization,
  shouldRetainAdminProviderAttempt,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'
import {
  masterAuthorizationHeldByOther,
  masterAuthorizesFeature,
} from './aiMasterAuthorization'

type AcademicAnswerControlProps = {
  admissionEnabled: boolean
  adminToken: AdminOperationCredentialInput
  lectureSessionId: string
  lectureStatus: string
  masterAuthorization: AiMasterAuthorization | null
  refreshVersion?: number
}

const emptyResults: AdminAcademicResults = {
  activeRequests: [],
  answers: [],
  automation: null,
  candidates: [],
  control: null,
}

function academicSourceHref(answer: AdminAcademicAnswer, sourceId: string) {
  const source = answer.sources.find((item) => item.sourceId === sourceId)
  if (source?.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`
  if (source?.doi) return buildDoiUrl(source.doi)
  return null
}

function referenceLabel(answer: AdminAcademicAnswer, sourceId: string) {
  const index = answer.sources.findIndex(
    (source) => source.sourceId === sourceId,
  )
  return index >= 0 ? `[${index + 1}]` : '[?]'
}

export function AcademicAnswerControl({
  admissionEnabled,
  adminToken,
  lectureSessionId,
  lectureStatus,
  masterAuthorization,
  refreshVersion = 0,
}: AcademicAnswerControlProps) {
  const [results, setResults] = useState<AdminAcademicResults>(emptyResults)
  const [sourceMode, setSourceMode] = useState<
    'summary_candidate' | 'teacher_selected'
  >('summary_candidate')
  const [selectedSummaryId, setSelectedSummaryId] = useState('')
  const [question, setQuestion] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sourcePolicy, setSourcePolicy] = useState<
    'auto' | 'biomedical_pubmed' | 'multidisciplinary_doi'
  >('auto')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState('')
  const [editingAnswerId, setEditingAnswerId] = useState('')
  const [revisionPoints, setRevisionPoints] = useState<string[]>([])
  const googleProviderAttemptsRef = useRef(
    new Map<
      string,
      {
        grantRequestId: string
        knownActiveRequestIds: string[]
        knownAnswerIds: string[]
        preflightRequestId: string
        startRequestId: string
      }
    >(),
  )
  const masterAuthorized = masterAuthorizesFeature(
    masterAuthorization,
    'academic_answers',
  )
  const masterHeldByOther = masterAuthorizationHeldByOther(masterAuthorization)

  useEffect(() => {
    googleProviderAttemptsRef.current.clear()
  }, [lectureSessionId])

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
    setSourceMode('teacher_selected')
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
  }, [adminToken, lectureSessionId, refreshVersion])

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
    let googleAttemptKey: string | null = null
    const normalizedQuestion = question.trim()
    const normalizedSearchQuery = searchQuery.trim()
    if (
      !admissionEnabled ||
      !masterAuthorized ||
      masterHeldByOther ||
      normalizedQuestion.length < 10 ||
      normalizedQuestion.length > 500 ||
      normalizedSearchQuery.length < 3 ||
      normalizedSearchQuery.length > 240 ||
      (sourceMode === 'summary_candidate' && !selectedCandidate)
    ) {
      setMessage(
        masterHeldByOther
          ? '別の教員画面がAI許可を保持しています。'
          : masterAuthorized
            ? '質問と文献検索語を確認してください。'
            : '質問・文献検索語・講義中のAI許可を確認してください。',
      )
      return
    }

    setBusy(true)
    setMessage('一次文献を検証してから、参考回答の下書きを作成します…')
    try {
      const sourceSummaryId =
        sourceMode === 'summary_candidate' ? selectedSummaryId : null
      googleAttemptKey = JSON.stringify({
        lectureSessionId,
        question: normalizedQuestion,
        searchQuery: normalizedSearchQuery,
        sourceKind: sourceMode,
        sourcePolicy,
        sourceSummaryId,
      })
      let googleAttempt = googleAttemptKey
        ? googleProviderAttemptsRef.current.get(googleAttemptKey)
        : undefined
      if (googleAttemptKey && !googleAttempt) {
        googleAttempt = {
          grantRequestId: crypto.randomUUID(),
          knownActiveRequestIds: results.activeRequests.map(
            (request) => request.id,
          ),
          knownAnswerIds: results.answers.map((answer) => answer.id),
          preflightRequestId: crypto.randomUUID(),
          startRequestId: crypto.randomUUID(),
        }
        googleProviderAttemptsRef.current.set(googleAttemptKey, googleAttempt)
      }
      const nextResults = await supabaseAdminRepository.manageAcademicAnswers({
        action: 'generate',
        adminToken,
        ...googleAttempt!,
        lectureSessionId,
        question: normalizedQuestion,
        searchQuery: normalizedSearchQuery,
        sourceKind: sourceMode,
        sourceSummaryId,
        sourcePolicy,
      })
      if (googleAttemptKey) {
        googleProviderAttemptsRef.current.delete(googleAttemptKey)
      }
      setResults(nextResults)
      setMessage(
        '非公開の下書きを作成しました。文献と表現を確認してから公開してください。',
      )
    } catch (error) {
      if (googleAttemptKey && !shouldRetainAdminProviderAttempt(error)) {
        googleProviderAttemptsRef.current.delete(googleAttemptKey)
      }
      setMessage(
        error instanceof Error
          ? `参考回答を作成できませんでした: ${error.message}`
          : '参考回答を作成できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  function beginRevision(answer: AdminAcademicAnswer) {
    setEditingAnswerId(answer.id)
    setRevisionPoints(answer.body.answerPoints.map((point) => point.text))
  }

  async function reviseAnswer(answer: AdminAcademicAnswer) {
    const normalized = revisionPoints.map((point) => point.trim())
    if (
      normalized.length !== answer.body.answerPoints.length ||
      normalized.some((point) => point.length < 1 || point.length > 500)
    ) {
      setMessage('修正文は各項目1〜500文字で入力してください。')
      return
    }
    setBusy(true)
    try {
      const nextResults = await supabaseAdminRepository.manageAcademicAnswers({
        action: 'revise',
        adminToken,
        answerId: answer.id,
        lectureSessionId,
        reason: 'teacher_correction',
        revisionBody: {
          answerPoints: answer.body.answerPoints.map((point, index) => ({
            sourceIds: point.sourceIds,
            text: normalized[index],
          })),
          limitations: answer.body.limitations,
        },
      })
      setResults(nextResults)
      setEditingAnswerId('')
      setRevisionPoints([])
      setMessage('修正版を学生画面に公開しました。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `参考回答を修正できませんでした: ${error.message}`
          : '参考回答を修正できませんでした。',
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
      setMessage('参考回答の処理を停止しました。停止に個人AI PINは不要です。')
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
  const generationDisabled = disabled || !admissionEnabled
  const callsUsed = results.control?.academicAnswerCallsUsed ?? 0
  const callLimit = results.control?.academicAnswerLimit ?? 3

  return (
    <section className="academic-answer-control">
      <div className="academic-answer-heading">
        <div>
          <strong>AIによる参考回答</strong>
          <small>最大3回／講義・自動回答は「教員未確認」で公開</small>
        </div>
        <span>
          {callsUsed} / {callLimit} 回
        </span>
      </div>

      <div className="academic-answer-form">
        <label className="field">
          <span>質問の選び方</span>
          <select
            disabled={generationDisabled}
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
              disabled={generationDisabled || results.candidates.length === 0}
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
              disabled={generationDisabled}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="講義中に扱う学術的な質問を入力"
              value={question}
            />
          </label>
        )}

        <label className="field academic-answer-question-field">
          <span>文献検索語</span>
          <input
            disabled={generationDisabled}
            maxLength={240}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="問いに関係する概念、対象、主要な結果など"
            value={searchQuery}
          />
        </label>
        <label className="field">
          <span>参照する分野</span>
          <select
            disabled={generationDisabled}
            onChange={(event) =>
              setSourcePolicy(event.target.value as typeof sourcePolicy)
            }
            value={sourcePolicy}
          >
            <option value="auto">自動</option>
            <option value="biomedical_pubmed">医学・生命科学（PubMed）</option>
            <option value="multidisciplinary_doi">
              その他の分野（DOI論文）
            </option>
          </select>
        </label>
        {masterHeldByOther ? (
          <p className="note">別の教員画面がAI許可を保持しています。</p>
        ) : masterAuthorized ? (
          <p className="note">講義中のAI許可を使用します。</p>
        ) : (
          <p className="note">
            上の「講義中のAI機能」で利用を許可してください。
          </p>
        )}
        <button
          className="secondary-button"
          disabled={
            disabled ||
            !admissionEnabled ||
            masterHeldByOther ||
            callsUsed >= callLimit ||
            !masterAuthorized
          }
          onClick={() => void generateAnswer()}
          type="button"
        >
          {busy ? '処理中…' : '一次文献を確認して下書きを作る'}
        </button>
      </div>
      <p className="note">1回 最大約$0.04</p>
      {!admissionEnabled ? (
        <p className="note">
          新しい参考回答の生成は停止中です。状態確認・非表示・非採用・停止は引き続き利用できます。
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="note">
          {message}
        </p>
      ) : null}

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
                    ? answer.publication.reviewState === 'ai_unreviewed'
                      ? '学生に公開中・教員未確認'
                      : answer.publication.reviewState === 'admin_revised'
                        ? '学生に公開中・教員修正済み'
                        : '学生に公開中・教員確認済み'
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
                    {point.sourceIds
                      .map((sourceId) => referenceLabel(answer, sourceId))
                      .join(' ')}
                  </small>
                </li>
              ))}
            </ol>
            {editingAnswerId === answer.id ? (
              <div className="academic-answer-revision-form">
                {revisionPoints.map((point, index) => (
                  <label
                    className="field"
                    key={`${answer.id}-revision-${index}`}
                  >
                    <span>回答 {index + 1}</span>
                    <textarea
                      maxLength={500}
                      onChange={(event) =>
                        setRevisionPoints((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        )
                      }
                      value={point}
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {answer.body.limitations.length > 0 ? (
              <p className="note">限界: {answer.body.limitations.join('／')}</p>
            ) : null}
            <details>
              <summary>根拠文献を確認</summary>
              <ol className="academic-reference-list">
                {answer.sources.map((source) => (
                  <li key={source.sourceId}>
                    {academicSourceHref(answer, source.sourceId) ? (
                      <a
                        href={
                          academicSourceHref(answer, source.sourceId) ??
                          undefined
                        }
                        rel="noreferrer"
                        target="_blank"
                      >
                        {source.title}
                      </a>
                    ) : (
                      <span>{source.title}</span>
                    )}
                    <small>
                      {source.authors.slice(0, 3).join(', ')} · {source.journal}{' '}
                      ({source.publicationYear})
                      {source.pmid ? ` · PMID ${source.pmid}` : ''}
                      {source.doi ? ` · DOI ${source.doi}` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
            <div className="proposal-card-actions">
              {editingAnswerId === answer.id ? (
                <>
                  <button
                    className="primary-button"
                    disabled={busy || !admissionEnabled}
                    onClick={() => void reviseAnswer(answer)}
                    type="button"
                  >
                    修正版を公開
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setEditingAnswerId('')
                      setRevisionPoints([])
                    }}
                    type="button"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    disabled ||
                    !admissionEnabled ||
                    answer.status === 'rejected'
                  }
                  onClick={() => void reviewAnswer('approve', answer.id)}
                  type="button"
                >
                  承認する
                </button>
              )}
              {editingAnswerId !== answer.id && answer.status !== 'rejected' ? (
                <button
                  className="secondary-button"
                  disabled={disabled || !admissionEnabled}
                  onClick={() => beginRevision(answer)}
                  type="button"
                >
                  修正する
                </button>
              ) : null}
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
