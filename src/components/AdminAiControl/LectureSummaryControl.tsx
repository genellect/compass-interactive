import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listCompletedCaptionSegments } from '../../caption/captionTranscriptStore'
import { issuePdfAccessSession } from '../../pdf/pdfDelivery'
import { publisherClient } from '../../pdf/publisherClient'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { isPhase71ClassroomExtensionsEnabled } from '../../lib/featureFlags'
import {
  type AdminLectureSummary,
  type AdminPdfDocument,
  type AdminSummaryResults,
  type SummaryLanguagePreference,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'
import {
  formatSummaryWindowLabel,
  getDueSummaryWindows,
  selectSummaryWindowSegments,
} from '../../summary/summaryWindow'
import type { LectureStatus } from '../../types'
import { AppIcon } from '../AppIcon'

type LectureSummaryControlProps = {
  adminToken: string
  displayState: DisplayState | null
  documents: AdminPdfDocument[]
  getServerNow: () => string | null
  hardStopAt: string | null
  lectureSessionId: string
  lectureStatus: LectureStatus
  publisherSessionToken: string
  startedAt: string | null
}

const emptyResults: AdminSummaryResults = {
  control: null,
  run: null,
  summaries: [],
  windows: [],
}

function currentRevision(summary: AdminLectureSummary) {
  const activeId = summary.publication?.activeRevisionId
  return (
    summary.revisions.find((revision) => revision.id === activeId) ??
    summary.revisions.at(-1)
  )
}

function reviewLabel(summary: AdminLectureSummary) {
  if (summary.publication?.reviewState === 'admin_revised')
    return '教員修正済み'
  if (summary.publication?.reviewState === 'admin_confirmed')
    return '教員確認済み'
  return 'AI生成・教員未確認'
}

export function LectureSummaryControl({
  adminToken,
  displayState,
  documents,
  getServerNow,
  hardStopAt,
  lectureSessionId,
  lectureStatus,
  publisherSessionToken,
  startedAt,
}: LectureSummaryControlProps) {
  const [billingPin, setBillingPin] = useState('')
  const [results, setResults] = useState<AdminSummaryResults>(emptyResults)
  const [runToken, setRunToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftRecap, setDraftRecap] = useState('')
  const [draftPulse, setDraftPulse] = useState('')
  const [summaryLanguage, setSummaryLanguage] =
    useState<SummaryLanguagePreference>('auto')
  const schedulerBusyRef = useRef(false)
  const runTokenRef = useRef<string | null>(null)

  useEffect(() => {
    runTokenRef.current = runToken
  }, [runToken])

  const processedIndexes = useMemo(
    () =>
      new Set(
        results.windows
          .filter((window) =>
            ['discarded', 'skipped', 'succeeded'].includes(window.status),
          )
          .map((window) => window.windowIndex),
      ),
    [results.windows],
  )

  useEffect(() => {
    let cancelled = false
    setSummaryLanguage('auto')
    void supabaseAdminRepository
      .manageLectureSummaries({
        action: 'status',
        adminToken,
        lectureSessionId,
      })
      .then(async (response) => {
        if (cancelled) return
        setResults(response.results)
        setSummaryLanguage(response.results.control?.summaryLanguage ?? 'auto')
        if (
          response.results.run?.status === 'running' &&
          lectureStatus === 'open'
        ) {
          const resumed = await supabaseAdminRepository.manageLectureSummaries({
            action: 'resume',
            adminToken,
            lectureSessionId,
          })
          if (!cancelled) {
            if (resumed.runToken) setResults(resumed.results)
            setRunToken(resumed.runToken)
            setMessage(
              resumed.runToken
                ? '要約セッションを安全に再開しました。'
                : '実行中の要約セッションはありません。',
            )
          }
        }
      })
      .catch(() => {
        if (!cancelled) setMessage('要約状態を取得できませんでした。')
      })
    return () => {
      cancelled = true
    }
  }, [adminToken, lectureSessionId, lectureStatus])

  const getPdfContext = useCallback(async () => {
    const documentId = displayState?.pdfDocumentId
    const documentVersion = displayState?.pdfDocumentVersion
    const currentPage = displayState?.currentPdfPage
    if (
      !publisherSessionToken ||
      !documentId ||
      !documentVersion ||
      !currentPage ||
      !documents.some(
        (document) =>
          document.documentId === documentId &&
          document.documentVersion === documentVersion,
      )
    ) {
      return null
    }
    const access = await issuePdfAccessSession({ adminToken, lectureSessionId })
    const extraction = await publisherClient.getExtraction({
      accessToken: access.accessToken,
      documentId,
      documentVersion,
      lecturePublicId: access.lecturePublicId,
      publisherSessionToken,
    })
    return {
      documentId,
      documentVersion,
      pages: extraction.pages.filter(
        (page) => Math.abs(page.pageNumber - currentPage) <= 1,
      ),
    }
  }, [
    adminToken,
    displayState,
    documents,
    lectureSessionId,
    publisherSessionToken,
  ])

  const processNextWindow = useCallback(async () => {
    const token = runTokenRef.current
    if (
      !token ||
      !startedAt ||
      !hardStopAt ||
      lectureStatus !== 'open' ||
      schedulerBusyRef.current
    ) {
      return
    }
    const serverNow = getServerNow()
    if (!serverNow) {
      setMessage('サーバー時刻を同期してから5分境界を判定します。')
      return
    }
    const due = getDueSummaryWindows({
      hardStopAt,
      processedWindowIndexes: processedIndexes,
      serverNow,
      startedAt,
    })
    const summaryWindow = due[0]
    if (!summaryWindow) return

    schedulerBusyRef.current = true
    try {
      const segments = selectSummaryWindowSegments(
        await listCompletedCaptionSegments(lectureSessionId),
        summaryWindow,
      )
      let pdfContext = null
      try {
        pdfContext = await getPdfContext()
      } catch {
        setMessage(
          '資料公開アプリに接続できないため、PDFの内容を含めずに要約判定を続けます。',
        )
      }
      const generated = await supabaseAdminRepository.generateLectureSummary({
        adminToken,
        lectureSessionId,
        pdfContext,
        runToken: token,
        transcriptSegments: segments.map((segment) => ({
          completedAt: segment.completedAt,
          itemId: segment.itemId,
          startedAt: segment.startedAt,
          text: segment.text,
        })),
        windowIndex: summaryWindow.index,
      })
      setResults(generated.results)
      const label = formatSummaryWindowLabel(
        summaryWindow.startAt,
        summaryWindow.endAt,
      )
      setMessage(
        generated.skipped
          ? `${label} は情報量不足のためAPIを呼ばずスキップしました。`
          : generated.published
            ? `${label} の要点を公開しました。`
            : `${label} は低価値判定のため学生へ表示していません。`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '5分要約の生成に失敗しました。前回の公開要約は維持されます。',
      )
    } finally {
      schedulerBusyRef.current = false
    }
  }, [
    adminToken,
    getPdfContext,
    getServerNow,
    hardStopAt,
    lectureSessionId,
    lectureStatus,
    processedIndexes,
    startedAt,
  ])

  useEffect(() => {
    if (!runToken || lectureStatus !== 'open') return
    void processNextWindow()
    const timer = window.setInterval(() => void processNextWindow(), 20_000)
    return () => window.clearInterval(timer)
  }, [lectureStatus, processNextWindow, runToken])

  useEffect(() => {
    if (lectureStatus !== 'open') setRunToken(null)
  }, [lectureStatus])

  async function startRun() {
    if (!billingPin.trim() || lectureStatus !== 'open') return
    setBusy(true)
    setMessage('API利用PINと講義状態を確認しています…')
    try {
      const authorization = await supabaseAdminRepository.authorizeAiStart({
        actions: ['summaries'],
        adminToken,
        billingPin,
        lectureSessionId,
      })
      const started = await supabaseAdminRepository.manageLectureSummaries({
        action: 'start',
        adminToken,
        billingGrant: authorization.billingGrant,
        lectureSessionId,
      })
      setResults(started.results)
      setRunToken(started.runToken)
      setMessage('5分要約を開始しました。各windowはサーバー時刻で判定します。')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '要約を開始できませんでした。',
      )
    } finally {
      setBillingPin('')
      setBusy(false)
    }
  }

  async function updateSummaryLanguage(next: SummaryLanguagePreference) {
    if (busy || lectureStatus === 'closed') return
    setBusy(true)
    setMessage('要約言語を更新しています…')
    try {
      await supabaseAdminRepository.manageAiControl({
        action: 'configure',
        adminToken,
        configuration: { summary_language: next },
        lectureSessionId,
      })
      setSummaryLanguage(next)
      setResults((current) => ({
        ...current,
        control: current.control
          ? { ...current.control, summaryLanguage: next }
          : current.control,
      }))
      setMessage(
        '要約言語を更新しました。処理中の要約には影響せず、次の5分枠から反映されます。',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '要約言語を更新できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function stopRun() {
    setBusy(true)
    try {
      const stopped = await supabaseAdminRepository.manageLectureSummaries({
        action: 'stop',
        adminToken,
        lectureSessionId,
        reason: 'admin_manual_stop',
      })
      setResults(stopped.results)
      setRunToken(null)
      setMessage('5分要約を停止しました。停止にAPI利用PINは不要です。')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '要約を停止できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function updateSummary(
    summary: AdminLectureSummary,
    action: 'hide' | 'pin' | 'publish' | 'unpin',
  ) {
    setBusy(true)
    try {
      const response = await supabaseAdminRepository.manageLectureSummaries(
        action === 'pin'
          ? {
              action,
              adminToken,
              lectureSessionId,
              pinnedOrder: 1,
              pinnedUntil: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1_000,
              ).toISOString(),
              summaryId: summary.id,
            }
          : { action, adminToken, lectureSessionId, summaryId: summary.id },
      )
      setResults(response.results)
      setMessage('表示状態を更新しました。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '表示状態を更新できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  function beginRevision(summary: AdminLectureSummary) {
    const revision = currentRevision(summary)
    setEditingId(summary.id)
    setDraftRecap(
      (revision?.body.lectureRecap ?? summary.aiOutput.lectureRecap).join('\n'),
    )
    setDraftPulse(
      (revision?.body.commentPulse ?? summary.aiOutput.commentPulse).join('\n'),
    )
  }

  async function publishRevision(summaryId: string) {
    const lectureRecap = draftRecap
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    const commentPulse = draftPulse
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    if (
      lectureRecap.length < 1 ||
      lectureRecap.length > 5 ||
      commentPulse.length > 3
    ) {
      setMessage('講義要点は1〜5行、コメント動向は0〜3行で入力してください。')
      return
    }
    setBusy(true)
    try {
      const response = await supabaseAdminRepository.manageLectureSummaries({
        action: 'revisePublish',
        adminToken,
        lectureSessionId,
        reason: 'teacher_correction',
        revisionBody: { commentPulse, lectureRecap },
        summaryId,
      })
      setResults(response.results)
      setEditingId(null)
      setMessage('教員revisionを履歴へ追加し、公開しました。')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '訂正を保存できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  const runActive =
    lectureStatus === 'open' &&
    results.run?.status === 'running' &&
    Boolean(runToken)
  return (
    <section className="lecture-summary-control">
      <div className="summary-control-heading">
        <div>
          <span className="support-icon violet">
            <AppIcon name="sparkles" size={18} />
          </span>
          <strong>5分要約・コメント動向</strong>
          <small>
            最大{results.control?.summaryCallLimit ?? 18}回 · 5分ごとに1回
          </small>
        </div>
        <span className={`support-state ${runActive ? 'is-ready' : ''}`}>
          {runActive ? '実行中' : '停止中'}
        </span>
      </div>

      <p className="note">
        講義発話・現在のPDF文脈・直近コメントを1回の低コスト呼び出しで整理します。情報量不足時はAPIを呼びません。
      </p>
      {isPhase71ClassroomExtensionsEnabled ? (
        <div className="summary-language-control">
          <label className="field compact-field">
            <span>要約言語</span>
            <select
              aria-describedby="summary-language-help"
              disabled={busy || lectureStatus === 'closed'}
              onChange={(event) =>
                void updateSummaryLanguage(
                  event.target.value as SummaryLanguagePreference,
                )
              }
              value={summaryLanguage}
            >
              <option value="auto">自動判定</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="note" id="summary-language-help">
            自動判定は直近の教員字幕を優先し、情報が少ない場合のみ講義資料を参照します。変更は次の5分枠から反映され、API呼び出し回数は増えません。
          </p>
        </div>
      ) : null}
      <div className="summary-control-actions">
        <label className="field compact-field">
          <span>API利用PIN（開始時のみ）</span>
          <input
            autoComplete="off"
            disabled={busy || runActive || lectureStatus !== 'open'}
            inputMode="numeric"
            onChange={(event) => setBillingPin(event.target.value)}
            type="password"
            value={billingPin}
          />
        </label>
        <button
          className="primary-button"
          disabled={
            busy || runActive || !billingPin.trim() || lectureStatus !== 'open'
          }
          onClick={() => void startRun()}
          type="button"
        >
          要約を開始
        </button>
        <button
          className="secondary-button"
          disabled={busy || !runActive}
          onClick={() => void stopRun()}
          type="button"
        >
          停止
        </button>
      </div>

      <div className="summary-usage-row">
        <span>
          生成 {results.control?.summaryCallsUsed ?? 0}/
          {results.control?.summaryCallLimit ?? 18}
        </span>
        <span>
          予約上限残り 約$
          {Math.max(
            0,
            ((results.control?.budgetLimitMicrousd ?? 0) -
              (results.control?.usedMicrousd ?? 0)) /
              1_000_000,
          ).toFixed(3)}
        </span>
        <span>次回: 5分境界をサーバー確認</span>
      </div>
      {message ? (
        <p className="note" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="admin-summary-list">
        {results.summaries.map((summary) => {
          const revision = currentRevision(summary)
          const visible = summary.publication?.visibility === 'public'
          const pinned = Boolean(summary.publication?.pinnedOrder)
          const recap =
            revision?.body.lectureRecap ?? summary.aiOutput.lectureRecap
          const pulse =
            revision?.body.commentPulse ?? summary.aiOutput.commentPulse
          return (
            <article className="admin-summary-card" key={summary.id}>
              <div className="admin-summary-card-heading">
                <div>
                  <strong>
                    {formatSummaryWindowLabel(
                      summary.windowStart,
                      summary.windowEnd,
                    )}
                  </strong>
                  <small>{reviewLabel(summary)}</small>
                </div>
                <span className={`status-pill ${visible ? 'open' : 'closed'}`}>
                  {visible ? '学生表示中' : '非表示'}
                </span>
              </div>
              <ul>
                {recap.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {pulse.length ? (
                <div className="admin-comment-pulse">
                  <strong>コメント動向</strong>
                  <ul>
                    {pulse.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.aiOutput.academicQuestionCandidate ? (
                <div className="academic-candidate-note">
                  <strong>学術質問候補（Adminのみ）</strong>
                  <p>{summary.aiOutput.academicQuestionCandidate.question}</p>
                  <small>
                    {
                      summary.aiOutput.academicQuestionCandidate
                        .educationalValue
                    }
                  </small>
                </div>
              ) : null}

              {editingId === summary.id ? (
                <div className="summary-revision-form">
                  <label className="field">
                    <span>講義要点（1行1項目）</span>
                    <textarea
                      onChange={(event) => setDraftRecap(event.target.value)}
                      value={draftRecap}
                    />
                  </label>
                  <label className="field">
                    <span>コメント動向（最大3行）</span>
                    <textarea
                      onChange={(event) => setDraftPulse(event.target.value)}
                      value={draftPulse}
                    />
                  </label>
                  <button
                    className="primary-button compact"
                    disabled={busy}
                    onClick={() => void publishRevision(summary.id)}
                    type="button"
                  >
                    訂正して公開
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setEditingId(null)}
                    type="button"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <div className="proposal-card-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void updateSummary(summary, visible ? 'hide' : 'publish')
                    }
                    type="button"
                  >
                    {visible ? '非表示' : '確認して公開'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => beginRevision(summary)}
                    type="button"
                  >
                    訂正
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void updateSummary(summary, pinned ? 'unpin' : 'pin')
                    }
                    type="button"
                  >
                    {pinned ? '固定解除' : '固定'}
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
