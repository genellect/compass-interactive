import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isGoogleAdminOperationCredential,
  type AdminOperationCredentialInput,
} from '../../lib/adminAuth/adminOperationCredential'
import { listCompletedCaptionSegments } from '../../caption/captionTranscriptStore'
import { getAdminPdfExtraction } from '../../pdf/adminPdfExtraction'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import {
  isPhase71ClassroomExtensionsEnabled,
  isPhase725AutoAcademicAnswersEnabled,
  isPhase726BrowserPdfPublishingEnabled,
} from '../../lib/featureFlags'
import {
  type AdminLectureSummary,
  type AiMasterAuthorization,
  type AdminPdfDocument,
  type AdminSummaryResults,
  type SummaryLanguagePreference,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'
import {
  formatSummaryWindowLabel,
  getDueSummaryWindows,
  getSummaryScheduleStatus,
  selectSummaryWindowSegments,
} from '../../summary/summaryWindow'
import type { LectureStatus } from '../../types'
import { AppIcon } from '../AppIcon'
import {
  masterAuthorizationHeldByOther,
  masterAuthorizesFeature,
} from './aiMasterAuthorization'

type LectureSummaryControlProps = {
  admissionEnabled: boolean
  adminToken: AdminOperationCredentialInput
  displayState: DisplayState | null
  documents: AdminPdfDocument[]
  getServerNow: () => string | null
  hardStopAt: string | null
  lectureSessionId: string
  lectureStatus: LectureStatus
  masterAuthorization: AiMasterAuthorization | null
  onAcademicAnswerChanged?: () => void
  publisherSessionToken: string
  startedAt: string | null
}

const emptyResults: AdminSummaryResults = {
  control: null,
  run: null,
  summaries: [],
  windows: [],
}

const MAX_AUTO_ACADEMIC_DISPATCH_ATTEMPTS = 3
const AUTO_ACADEMIC_RETRY_DELAYS_MS = [10_000, 20_000] as const

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
  admissionEnabled,
  adminToken,
  displayState,
  documents,
  getServerNow,
  hardStopAt,
  lectureSessionId,
  lectureStatus,
  masterAuthorization,
  onAcademicAnswerChanged,
  publisherSessionToken,
  startedAt,
}: LectureSummaryControlProps) {
  const googleCredential = isGoogleAdminOperationCredential(adminToken)
  const [results, setResults] = useState<AdminSummaryResults>(emptyResults)
  const [runToken, setRunToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [schedulerRevision, setSchedulerRevision] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftRecap, setDraftRecap] = useState('')
  const [draftPulse, setDraftPulse] = useState('')
  const [summaryLanguage, setSummaryLanguage] =
    useState<SummaryLanguagePreference>('auto')
  const [autoAcademicAnswers, setAutoAcademicAnswers] = useState(false)
  const [academicSourcePolicy, setAcademicSourcePolicy] = useState<
    'auto' | 'biomedical_pubmed' | 'multidisciplinary_doi'
  >('auto')
  const schedulerBusyRef = useRef(false)
  const runTokenRef = useRef<string | null>(null)
  const academicDispatchBusyRef = useRef(false)
  const academicRetryTimerRef = useRef<number | null>(null)
  const previousSummaryMasterAuthorizedRef = useRef(false)
  const academicRequestIdsRef = useRef(
    new Map<
      string,
      {
        grantRequestId: string
        preflightRequestId: string
        startRequestId: string
      }
    >(),
  )
  const summaryWindowRequestIdsRef = useRef(
    new Map<
      number,
      {
        grantRequestId: string
        preflightRequestId: string
        startRequestId: string
      }
    >(),
  )
  const summaryMasterAuthorized = masterAuthorizesFeature(
    masterAuthorization,
    'summaries',
  )
  const academicMasterAuthorized = masterAuthorizesFeature(
    masterAuthorization,
    'academic_answers',
  )
  const masterAuthorizedForStart =
    summaryMasterAuthorized &&
    (!autoAcademicAnswers || academicMasterAuthorized)
  const masterHeldByOther = masterAuthorizationHeldByOther(masterAuthorization)

  useEffect(() => {
    runTokenRef.current = runToken
  }, [runToken])

  useEffect(() => {
    const previouslyAuthorized = previousSummaryMasterAuthorizedRef.current
    previousSummaryMasterAuthorizedRef.current = summaryMasterAuthorized
    if (
      previouslyAuthorized &&
      !summaryMasterAuthorized &&
      runTokenRef.current
    ) {
      runTokenRef.current = null
      setRunToken(null)
      setMessage('要約を停止しました。')
    }
  }, [summaryMasterAuthorized])

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
        setAutoAcademicAnswers(
          response.results.run?.autoAcademicAnswersEnabled ?? false,
        )
        setAcademicSourcePolicy(
          response.results.run?.academicSourcePolicy ?? 'auto',
        )
        setSummaryLanguage(response.results.control?.summaryLanguage ?? 'auto')
        if (
          admissionEnabled &&
          response.results.run?.status === 'running' &&
          lectureStatus === 'open'
        ) {
          const resumed = await supabaseAdminRepository.manageLectureSummaries({
            action: 'resume',
            adminToken,
            lectureSessionId,
          })
          if (!cancelled) {
            setResults(resumed.results)
            setAutoAcademicAnswers(
              resumed.results.run?.autoAcademicAnswersEnabled ?? false,
            )
            setAcademicSourcePolicy(
              resumed.results.run?.academicSourcePolicy ?? 'auto',
            )
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
      if (academicRetryTimerRef.current !== null) {
        window.clearTimeout(academicRetryTimerRef.current)
      }
    }
  }, [admissionEnabled, adminToken, lectureSessionId, lectureStatus])

  const dispatchAutomaticAcademicAnswers = useCallback(
    async (token: string, attempt = 0) => {
      if (
        !admissionEnabled ||
        !isPhase725AutoAcademicAnswersEnabled ||
        runTokenRef.current !== token ||
        lectureStatus !== 'open' ||
        academicDispatchBusyRef.current
      ) {
        return
      }
      academicDispatchBusyRef.current = true
      try {
        for (
          let dispatched = 0;
          dispatched < MAX_AUTO_ACADEMIC_DISPATCH_ATTEMPTS;
          dispatched += 1
        ) {
          if (runTokenRef.current !== token || lectureStatus !== 'open') return
          const academic = await supabaseAdminRepository.manageAcademicAnswers({
            action: 'status',
            adminToken,
            lectureSessionId,
          })
          const automation = academic.automation
          const candidate = academic.candidates.find(
            (item) =>
              item.needsAutoDispatch &&
              item.runId === automation?.runId &&
              item.qualityScore >= 0.85,
          )
          const pendingLease = academic.candidates.find(
            (item) =>
              item.autoRequestStatus === 'evidence_checking' &&
              item.runId === automation?.runId &&
              item.retryAfterMs > 0 &&
              item.qualityScore >= 0.85,
          )
          if (
            !candidate ||
            !automation?.enabled ||
            automation.status !== 'running'
          ) {
            if (
              pendingLease &&
              automation?.enabled &&
              automation.status === 'running' &&
              attempt < MAX_AUTO_ACADEMIC_DISPATCH_ATTEMPTS
            ) {
              academicRetryTimerRef.current = window.setTimeout(
                () => void dispatchAutomaticAcademicAnswers(token, attempt),
                Math.min(
                  Math.max(pendingLease.retryAfterMs + 500, 1_000),
                  60_000,
                ),
              )
            }
            return
          }
          const googleRequestIds = academicRequestIdsRef.current.get(
            candidate.summaryId,
          ) ?? {
            grantRequestId: crypto.randomUUID(),
            preflightRequestId: crypto.randomUUID(),
            startRequestId: crypto.randomUUID(),
          }
          academicRequestIdsRef.current.set(
            candidate.summaryId,
            googleRequestIds,
          )
          await supabaseAdminRepository.manageAcademicAnswers({
            action: 'generateAuto',
            adminToken,
            ...googleRequestIds,
            lectureSessionId,
            question: candidate.question,
            runToken: token,
            searchQuery: candidate.question,
            sourcePolicy: automation.sourcePolicy,
            sourceSummaryId: candidate.summaryId,
          })
          academicRequestIdsRef.current.delete(candidate.summaryId)
          onAcademicAnswerChanged?.()
        }
      } catch (error) {
        const retryDelay = AUTO_ACADEMIC_RETRY_DELAYS_MS[attempt]
        if (retryDelay !== undefined && runTokenRef.current === token) {
          academicRetryTimerRef.current = window.setTimeout(
            () => void dispatchAutomaticAcademicAnswers(token, attempt + 1),
            retryDelay,
          )
          return
        }
        setMessage(
          error instanceof Error
            ? `要約は保存しましたが、参考回答を作成できませんでした: ${error.message}`
            : '要約は保存しましたが、参考回答を作成できませんでした。',
        )
      } finally {
        academicDispatchBusyRef.current = false
      }
    },
    [
      admissionEnabled,
      adminToken,
      googleCredential,
      lectureSessionId,
      lectureStatus,
      onAcademicAnswerChanged,
    ],
  )

  useEffect(() => {
    if (
      admissionEnabled &&
      runToken &&
      results.run?.status === 'running' &&
      results.run.autoAcademicAnswersEnabled
    ) {
      void dispatchAutomaticAcademicAnswers(runToken)
    }
  }, [
    admissionEnabled,
    dispatchAutomaticAcademicAnswers,
    results.run?.autoAcademicAnswersEnabled,
    results.run?.status,
    runToken,
  ])

  const getPdfContext = useCallback(async () => {
    if (!publisherSessionToken && !isPhase726BrowserPdfPublishingEnabled) {
      return null
    }
    const documentId = displayState?.pdfDocumentId
    const documentVersion = displayState?.pdfDocumentVersion
    const currentPage = displayState?.currentPdfPage
    if (
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
    const document = documents.find(
      (candidate) =>
        candidate.documentId === documentId &&
        candidate.documentVersion === documentVersion,
    )
    if (!document) return null
    const extraction = await getAdminPdfExtraction({
      adminToken,
      document,
      lectureSessionId,
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
      !admissionEnabled ||
      !token ||
      lectureStatus !== 'open' ||
      schedulerBusyRef.current
    ) {
      return
    }
    if (!startedAt || !hardStopAt) {
      setMessage('講義時刻を同期してから5分境界を判定します。')
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
      const googleRequestIds = googleCredential
        ? (summaryWindowRequestIdsRef.current.get(summaryWindow.index) ?? {
            grantRequestId: crypto.randomUUID(),
            preflightRequestId: crypto.randomUUID(),
            startRequestId: crypto.randomUUID(),
          })
        : null
      if (googleRequestIds) {
        summaryWindowRequestIdsRef.current.set(
          summaryWindow.index,
          googleRequestIds,
        )
      }
      const generated = await supabaseAdminRepository.generateLectureSummary({
        adminToken,
        ...(googleRequestIds ?? {}),
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
      if (googleRequestIds) {
        summaryWindowRequestIdsRef.current.delete(summaryWindow.index)
      }
      setResults(generated.results)
      if (generated.results.run?.autoAcademicAnswersEnabled) {
        void dispatchAutomaticAcademicAnswers(token)
      }
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
    admissionEnabled,
    adminToken,
    dispatchAutomaticAcademicAnswers,
    getPdfContext,
    getServerNow,
    hardStopAt,
    googleCredential,
    lectureSessionId,
    lectureStatus,
    processedIndexes,
    startedAt,
  ])

  useEffect(() => {
    if (!runToken || lectureStatus !== 'open') return
    void processNextWindow()
    const timer = window.setInterval(() => {
      setSchedulerRevision((revision) => revision + 1)
      void processNextWindow()
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [lectureStatus, processNextWindow, runToken])

  useEffect(() => {
    if (!runToken || lectureStatus !== 'open') return
    const catchUp = () => void processNextWindow()
    const catchUpWhenVisible = () => {
      if (document.visibilityState === 'visible') catchUp()
    }
    window.addEventListener('focus', catchUp)
    window.addEventListener('online', catchUp)
    window.addEventListener('pageshow', catchUp)
    document.addEventListener('visibilitychange', catchUpWhenVisible)
    return () => {
      window.removeEventListener('focus', catchUp)
      window.removeEventListener('online', catchUp)
      window.removeEventListener('pageshow', catchUp)
      document.removeEventListener('visibilitychange', catchUpWhenVisible)
    }
  }, [lectureStatus, processNextWindow, runToken])

  useEffect(() => {
    if (lectureStatus !== 'open') setRunToken(null)
  }, [lectureStatus])

  async function startRun() {
    if (
      !admissionEnabled ||
      !masterAuthorizedForStart ||
      masterHeldByOther ||
      lectureStatus !== 'open'
    )
      return
    setBusy(true)
    setMessage('講義中のAI許可と講義状態を確認しています…')
    try {
      const started = await supabaseAdminRepository.manageLectureSummaries({
        action: 'start',
        academicSourcePolicy,
        adminToken,
        autoAcademicAnswers:
          isPhase725AutoAcademicAnswersEnabled && autoAcademicAnswers,
        lectureSessionId,
      })
      setResults(started.results)
      setRunToken(started.runToken)
      setMessage(
        autoAcademicAnswers
          ? '5分要約と参考回答の自動生成を開始しました。各windowはサーバー時刻で判定します。'
          : '5分要約を開始しました。各windowはサーバー時刻で判定します。',
      )
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '要約を開始できませんでした。',
      )
    } finally {
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
      if (academicRetryTimerRef.current !== null) {
        window.clearTimeout(academicRetryTimerRef.current)
        academicRetryTimerRef.current = null
      }
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
    if (!admissionEnabled && action !== 'hide') return
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
  const scheduleStatus = useMemo(() => {
    void schedulerRevision
    const serverNow = getServerNow()
    if (!runActive || !startedAt || !hardStopAt || !serverNow) return null
    return getSummaryScheduleStatus({
      hardStopAt,
      processedWindowIndexes: processedIndexes,
      serverNow,
      startedAt,
    })
  }, [
    getServerNow,
    hardStopAt,
    processedIndexes,
    runActive,
    schedulerRevision,
    startedAt,
  ])
  const schedulerLabel = !runActive
    ? masterHeldByOther
      ? '別の教員画面でAI利用を許可済み／この画面では開始不可'
      : summaryMasterAuthorized
        ? 'AI利用を許可済み／5分要約は未開始'
        : '要約は未開始'
    : scheduleStatus?.due
      ? '未処理の5分枠を再開処理中'
      : scheduleStatus?.nextWindow
        ? `次回 ${new Intl.DateTimeFormat('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(scheduleStatus.nextWindow.endAt))}`
        : '全5分枠を処理済み'
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
          {runActive
            ? '実行中'
            : masterHeldByOther
              ? '別画面で許可中'
              : summaryMasterAuthorized
                ? '要約は未開始'
                : '停止中'}
        </span>
      </div>

      {isPhase71ClassroomExtensionsEnabled ? (
        <div className="summary-language-control">
          <label className="field compact-field">
            <span>要約言語</span>
            <select
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
            <small>次の5分枠から反映</small>
          </label>
        </div>
      ) : null}
      {isPhase725AutoAcademicAnswersEnabled ? (
        <div className="summary-academic-answer-control">
          <label className="field checkbox-field">
            <input
              checked={autoAcademicAnswers}
              disabled={
                busy ||
                runActive ||
                !admissionEnabled ||
                lectureStatus !== 'open'
              }
              onChange={(event) => setAutoAcademicAnswers(event.target.checked)}
              type="checkbox"
            />
            <span>学術的な質問に参考回答を自動生成</span>
          </label>
          {autoAcademicAnswers ? (
            <label className="field compact-field">
              <span>参照する分野</span>
              <select
                disabled={
                  busy ||
                  runActive ||
                  !admissionEnabled ||
                  lectureStatus !== 'open'
                }
                onChange={(event) =>
                  setAcademicSourcePolicy(
                    event.target.value as typeof academicSourcePolicy,
                  )
                }
                value={academicSourcePolicy}
              >
                <option value="auto">自動</option>
                <option value="biomedical_pubmed">
                  医学・生命科学（PubMed）
                </option>
                <option value="multidisciplinary_doi">
                  その他の分野（DOI論文）
                </option>
              </select>
            </label>
          ) : null}
          <p className="note">
            条件を満たす回答だけ「教員未確認」で表示します。
          </p>
        </div>
      ) : null}
      <div className="summary-control-actions">
        {masterHeldByOther ? (
          <p className="note">別の教員画面がAI許可を保持しています。</p>
        ) : masterAuthorizedForStart ? (
          <p className="note">講義中のAPI許可を使用します。</p>
        ) : (
          <p className="note">
            上の「講義中のAI機能」で利用を許可してください。
          </p>
        )}
        <button
          className="primary-button"
          disabled={
            busy ||
            runActive ||
            !admissionEnabled ||
            masterHeldByOther ||
            !masterAuthorizedForStart ||
            lectureStatus !== 'open'
          }
          onClick={() => void startRun()}
          type="button"
        >
          要約を開始
        </button>
        <button
          className="secondary-button"
          disabled={busy || results.run?.status !== 'running'}
          onClick={() => void stopRun()}
          type="button"
        >
          停止
        </button>
      </div>

      {!admissionEnabled ? (
        <p className="note">
          新しい要約生成は停止中です。状態確認・公開済み要約の非表示・停止は引き続き利用できます。
        </p>
      ) : null}

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
        <span>{schedulerLabel}</span>
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
                    disabled={busy || !admissionEnabled}
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
                    disabled={busy || (!visible && !admissionEnabled)}
                    onClick={() =>
                      void updateSummary(summary, visible ? 'hide' : 'publish')
                    }
                    type="button"
                  >
                    {visible ? '非表示' : '確認して公開'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || !admissionEnabled}
                    onClick={() => beginRevision(summary)}
                    type="button"
                  >
                    訂正
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || !admissionEnabled}
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
