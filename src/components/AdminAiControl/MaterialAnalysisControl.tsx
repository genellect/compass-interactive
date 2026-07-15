import { useEffect, useMemo, useState } from 'react'
import { issuePdfAccessSession } from '../../pdf/pdfDelivery'
import { publisherClient } from '../../pdf/publisherClient'
import {
  type AdminMaterialResults,
  type AdminPdfDocument,
  type AdminPollProposal,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'

type MaterialAnalysisControlProps = {
  adminToken: string
  documents: AdminPdfDocument[]
  lectureSessionId: string
  lectureStatus: string
  onPollDraftCreated: () => void | Promise<void>
  publisherSessionToken: string
}

function idempotencyKey(
  action: 'material_analysis' | 'poll_suggestions',
  lectureSessionId: string,
) {
  return `phase5-${action}-${lectureSessionId}-${crypto.randomUUID()}`
}

function proposalTypeLabel(type: AdminPollProposal['proposalType']) {
  if (type === 'single_choice') return '単一選択'
  if (type === 'multiple_choice') return '複数選択'
  return 'ディスカッション'
}

export function MaterialAnalysisControl({
  adminToken,
  documents,
  lectureSessionId,
  lectureStatus,
  onPollDraftCreated,
  publisherSessionToken,
}: MaterialAnalysisControlProps) {
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [billingPin, setBillingPin] = useState('')
  const [results, setResults] = useState<AdminMaterialResults>({
    analysis: null,
    proposals: [],
  })
  const [pageStart, setPageStart] = useState('1')
  const [pageEnd, setPageEnd] = useState('1')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftQuestion, setDraftQuestion] = useState('')
  const [draftType, setDraftType] = useState<'single' | 'multiple'>('single')
  const [draftOptions, setDraftOptions] = useState('')

  const selectedDocument = useMemo(
    () =>
      documents.find(
        (document) => document.documentId === selectedDocumentId,
      ) ?? null,
    [documents, selectedDocumentId],
  )

  useEffect(() => {
    if (
      selectedDocumentId &&
      documents.some((document) => document.documentId === selectedDocumentId)
    ) {
      return
    }
    setSelectedDocumentId(documents[0]?.documentId ?? '')
  }, [documents, selectedDocumentId])

  useEffect(() => {
    if (!selectedDocument) return
    setPageEnd(String(selectedDocument.pageCount))
  }, [selectedDocument])

  useEffect(() => {
    let cancelled = false
    setResults({ analysis: null, proposals: [] })
    setMessage('')
    void supabaseAdminRepository
      .manageMaterialAnalysis({
        action: 'list',
        adminToken,
        lectureSessionId,
      })
      .then((response) => {
        if (!cancelled) setResults(response.results)
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? `既存のAI下書きを読み込めませんでした: ${error.message}`
              : '既存のAI下書きを読み込めませんでした。',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [adminToken, lectureSessionId])

  async function runAnalysis(action: 'material_analysis' | 'poll_suggestions') {
    if (!selectedDocument || !publisherSessionToken || !billingPin.trim()) {
      setMessage('PDF、ローカルPublisher接続、Billing PINを確認してください。')
      return
    }
    const start = Number(pageStart)
    const end = Number(pageEnd)
    if (
      action === 'poll_suggestions' &&
      (!Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end > selectedDocument.pageCount)
    ) {
      setMessage('追加提案のページ範囲を確認してください。')
      return
    }

    setBusy(true)
    setMessage(
      action === 'material_analysis'
        ? '資料を検証し、分析を開始しています…'
        : '指定ページを検証し、追加候補を作成しています…',
    )
    try {
      const access = await issuePdfAccessSession({
        adminToken,
        lectureSessionId,
      })
      const extraction = await publisherClient.getExtraction({
        accessToken: access.accessToken,
        documentId: selectedDocument.documentId,
        documentVersion: selectedDocument.documentVersion,
        lecturePublicId: access.lecturePublicId,
        publisherSessionToken,
      })
      const authorization = await supabaseAdminRepository.authorizeAiStart({
        actions: [action],
        adminToken,
        billingPin,
        lectureSessionId,
      })
      setBillingPin('')
      const nextResults = await supabaseAdminRepository.analyzeLectureMaterial({
        action,
        adminToken,
        analysisId:
          action === 'poll_suggestions' ? (results.analysis?.id ?? null) : null,
        billingGrant: authorization.billingGrant,
        documentId: selectedDocument.documentId,
        documentVersion: selectedDocument.documentVersion,
        extraction,
        idempotencyKey: idempotencyKey(action, lectureSessionId),
        lectureSessionId,
        pageEnd: action === 'poll_suggestions' ? end : null,
        pageStart: action === 'poll_suggestions' ? start : null,
      })
      setResults(nextResults)
      setMessage(
        action === 'material_analysis'
          ? '分析が完了しました。Poll候補は未検証のAdmin下書きです。'
          : '追加候補を作成しました。採用前に根拠と選択肢を確認してください。',
      )
    } catch (error) {
      setBillingPin('')
      setMessage(
        error instanceof Error
          ? `AI処理を完了できませんでした: ${error.message}`
          : 'AI処理を完了できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  function beginEditing(proposal: AdminPollProposal) {
    setEditingId(proposal.id)
    setDraftQuestion(proposal.stem)
    setDraftType(
      proposal.proposalType === 'multiple_choice' ? 'multiple' : 'single',
    )
    setDraftOptions(proposal.options.map((option) => option.text).join('\n'))
  }

  async function adoptProposal(proposalId: string) {
    const optionLabels = draftOptions
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean)
    if (draftQuestion.trim().length < 10 || optionLabels.length < 2) {
      setMessage('Poll下書きには10文字以上の質問と2個以上の選択肢が必要です。')
      return
    }
    setBusy(true)
    try {
      const response = await supabaseAdminRepository.manageMaterialAnalysis({
        action: 'adopt',
        adminToken,
        lectureSessionId,
        optionLabels,
        pollType: draftType,
        proposalId,
        question: draftQuestion.trim(),
      })
      setResults(response.results)
      setEditingId(null)
      await onPollDraftCreated()
      setMessage(
        '通常のPoll下書きへ追加しました。学生にはまだ配信されていません。',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Poll下書きへ追加できませんでした: ${error.message}`
          : 'Poll下書きへ追加できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function rejectProposal(proposalId: string) {
    setBusy(true)
    try {
      const response = await supabaseAdminRepository.manageMaterialAnalysis({
        action: 'reject',
        adminToken,
        lectureSessionId,
        proposalId,
      })
      setResults(response.results)
      setEditingId(null)
      setMessage('候補を非採用にしました。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `候補を非採用にできませんでした: ${error.message}`
          : '候補を非採用にできませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || lectureStatus === 'closed'
  return (
    <section className="material-analysis-control">
      <div className="material-analysis-heading">
        <div>
          <strong>資料分析とAI Poll候補</strong>
          <small>教員が明示的に実行したときだけ課金されます</small>
        </div>
        <span>Admin only · 既定OFF</span>
      </div>

      <p className="privacy-notice">
        PDFの公開だけではOpenAI
        APIを呼びません。ローカル抽出テキストは分析時だけ送信され、Supabaseには保存されません。初回の予約上限は概算$0.09、追加候補は概算$0.08です。
      </p>

      <div className="material-analysis-actions">
        <label className="field compact-field">
          <span>分析対象PDF</span>
          <select
            disabled={disabled || documents.length === 0}
            onChange={(event) => setSelectedDocumentId(event.target.value)}
            value={selectedDocumentId}
          >
            {documents.map((document) => (
              <option key={document.documentId} value={document.documentId}>
                {document.displayName}（{document.pageCount}ページ）
              </option>
            ))}
          </select>
        </label>
        <label className="field compact-field">
          <span>Billing PIN（毎回）</span>
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
          className="primary-button"
          disabled={
            disabled ||
            !selectedDocument ||
            !publisherSessionToken ||
            !billingPin.trim() ||
            Boolean(results.analysis)
          }
          onClick={() => void runAnalysis('material_analysis')}
          type="button"
        >
          {busy ? '処理中…' : results.analysis ? '分析済み' : '資料を分析する'}
        </button>
      </div>

      {message ? (
        <p className="note" role="status">
          {message}
        </p>
      ) : null}

      {results.analysis ? (
        <div className="material-analysis-result">
          <div>
            <p className="eyebrow">AI DRAFT · 要確認</p>
            <h3>資料の見取り図</h3>
            <p>{results.analysis.materialSummary}</p>
          </div>
          <div className="material-analysis-columns">
            <article>
              <strong>構成</strong>
              <ol>
                {results.analysis.materialOutline.map((item) => (
                  <li key={`${item.pageStart}-${item.pageEnd}-${item.title}`}>
                    {item.title}（p.{item.pageStart}–{item.pageEnd}）
                  </li>
                ))}
              </ol>
            </article>
            <article>
              <strong>重要語</strong>
              <dl>
                {results.analysis.keyTerms.map((item) => (
                  <div key={item.term}>
                    <dt>{item.term}</dt>
                    <dd>{item.definition}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </div>
          <small>
            重要ページ: {results.analysis.importantPages.join(', ')} · model:{' '}
            {results.analysis.modelId}
          </small>
        </div>
      ) : null}

      {results.analysis && selectedDocument ? (
        <div className="additional-poll-actions">
          <div>
            <strong>指定ページから追加候補</strong>
            <small>新しいBilling PIN認証とBatch枠を使用します</small>
          </div>
          <label className="field compact-field">
            <span>開始</span>
            <input
              disabled={disabled}
              max={selectedDocument.pageCount}
              min={1}
              onChange={(event) => setPageStart(event.target.value)}
              type="number"
              value={pageStart}
            />
          </label>
          <label className="field compact-field">
            <span>終了</span>
            <input
              disabled={disabled}
              max={selectedDocument.pageCount}
              min={1}
              onChange={(event) => setPageEnd(event.target.value)}
              type="number"
              value={pageEnd}
            />
          </label>
          <button
            className="secondary-button"
            disabled={disabled || !billingPin.trim()}
            onClick={() => void runAnalysis('poll_suggestions')}
            type="button"
          >
            追加候補を提案
          </button>
        </div>
      ) : null}

      {results.proposals.length > 0 ? (
        <div className="poll-proposal-list">
          {results.proposals.map((proposal) => (
            <article
              className={`poll-proposal-card ${proposal.status}`}
              key={proposal.id}
            >
              <header>
                <span>AI生成・未検証</span>
                <small>
                  {proposalTypeLabel(proposal.proposalType)} ·{' '}
                  {proposal.difficulty} · 根拠 p.
                  {proposal.evidencePages.join(', ')}
                </small>
              </header>
              <h4>{proposal.stem}</h4>
              {proposal.options.length ? (
                <ul>
                  {proposal.options.map((option) => (
                    <li key={option.id}>
                      {option.text}
                      {proposal.correctOptionIds.includes(option.id)
                        ? ' ✓'
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p>
                <strong>ねらい:</strong> {proposal.learningObjective}
              </p>
              <p>
                <strong>解説案:</strong> {proposal.explanation}
              </p>
              <p>
                <strong>教育価値:</strong> {proposal.educationalValue}
              </p>

              {editingId === proposal.id ? (
                <div className="proposal-edit-form">
                  <label className="field">
                    <span>質問（必ず教員が確認）</span>
                    <textarea
                      maxLength={300}
                      onChange={(event) => setDraftQuestion(event.target.value)}
                      rows={3}
                      value={draftQuestion}
                    />
                  </label>
                  <label className="field compact-field">
                    <span>形式</span>
                    <select
                      onChange={(event) =>
                        setDraftType(
                          event.target.value as 'single' | 'multiple',
                        )
                      }
                      value={draftType}
                    >
                      <option value="single">単一選択</option>
                      <option value="multiple">複数選択</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>選択肢（1行1件）</span>
                    <textarea
                      onChange={(event) => setDraftOptions(event.target.value)}
                      rows={5}
                      value={draftOptions}
                    />
                  </label>
                  <div className="proposal-card-actions">
                    <button
                      className="primary-button compact"
                      disabled={busy}
                      onClick={() => void adoptProposal(proposal.id)}
                      type="button"
                    >
                      通常Pollの下書きへ追加
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="proposal-card-actions">
                  <button
                    className="secondary-button"
                    disabled={disabled || proposal.status !== 'draft'}
                    onClick={() => beginEditing(proposal)}
                    type="button"
                  >
                    確認・編集して下書きへ
                  </button>
                  <button
                    className="secondary-button"
                    disabled={disabled || proposal.status !== 'draft'}
                    onClick={() => void rejectProposal(proposal.id)}
                    type="button"
                  >
                    非採用
                  </button>
                  <span className={`status-pill ${proposal.status}`}>
                    {proposal.status}
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
