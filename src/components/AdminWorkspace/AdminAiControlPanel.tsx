import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  runAiQuickStart,
  type AiMasterControlHandle,
  type AiQuickStartHandle,
  type AiQuickStartResult,
} from '../AdminAiControl/aiQuickStart'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import type { RememberedBrowserIdentityScope } from '../../lib/adminAuth/rememberedBrowserCredential'

import { AppIcon } from '../AppIcon'
import type { AiMasterReadiness } from '../AdminAiControl/AiMasterAuthorizationControl'
import { LectureSummaryControl } from '../AdminAiControl/LectureSummaryControl'
import { MaterialAnalysisControl } from '../AdminAiControl/MaterialAnalysisControl'
import type {
  AiMasterAuthorization,
  AdminLecture,
  AdminPdfDocument,
} from '../../repositories/supabaseAdminRepository'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { resolveSummaryScheduleTiming } from '../../summary/summarySchedule'

const AcademicAnswerControl = lazy(() =>
  import('../AdminAiControl/AcademicAnswerControl').then((module) => ({
    default: module.AcademicAnswerControl,
  })),
)

const AiMasterAuthorizationControl = lazy(() =>
  import('../AdminAiControl/AiMasterAuthorizationControl').then((module) => ({
    default: module.AiMasterAuthorizationControl,
  })),
)

const RealtimeCaptionControl = lazy(() =>
  import('../AdminAiControl/RealtimeCaptionControl').then((module) => ({
    default: module.RealtimeCaptionControl,
  })),
)

type Props = {
  activeLecture: AdminLecture | undefined
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  academicEnabled: boolean
  documents: AdminPdfDocument[]
  displayState: DisplayState | null
  fallbackHardStopAt: string | null | undefined
  fallbackStartedAt: string | null | undefined
  getServerNow: () => string | null
  identityScope: RememberedBrowserIdentityScope
  lectureStatus: AdminLecture['status']
  materialEnabled: boolean
  onMasterAuthorizationChange?: (active: boolean) => void
  onPollDraftCreated: () => Promise<void>
  publisherSessionToken: string
  realtimeEnabled: boolean
  summariesEnabled: boolean
}

export function AdminAiControlPanel({
  activeLecture,
  activeLectureSessionId,
  adminToken,
  academicEnabled,
  documents,
  displayState,
  fallbackHardStopAt,
  fallbackStartedAt,
  getServerNow,
  identityScope,
  lectureStatus,
  materialEnabled,
  onMasterAuthorizationChange,
  onPollDraftCreated,
  publisherSessionToken,
  realtimeEnabled,
  summariesEnabled,
}: Props) {
  const [academicRefreshVersion, setAcademicRefreshVersion] = useState(0)
  const masterControlRef = useRef<AiMasterControlHandle>(null)
  const summaryControlRef = useRef<AiQuickStartHandle>(null)
  const materialControlRef = useRef<AiQuickStartHandle>(null)
  const captionControlRef = useRef<AiQuickStartHandle>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const quickStartGenerationRef = useRef(0)
  const quickStartInFlightRef = useRef(false)
  const [quickStartBusy, setQuickStartBusy] = useState(false)
  const [quickStartResults, setQuickStartResults] = useState<
    AiQuickStartResult[]
  >([])
  const [masterAuthorization, setMasterAuthorization] =
    useState<AiMasterAuthorization | null>(null)
  const [masterReadiness, setMasterReadiness] =
    useState<AiMasterReadiness>('checking')
  const handleAcademicAnswerChanged = useCallback(() => {
    setAcademicRefreshVersion((version) => version + 1)
  }, [])
  const handleMasterAuthorizationChange = useCallback(
    (authorization: AiMasterAuthorization | null) => {
      setMasterAuthorization(authorization)
      onMasterAuthorizationChange?.(Boolean(authorization))
    },
    [onMasterAuthorizationChange],
  )
  const anyEnabled =
    realtimeEnabled || materialEnabled || summariesEnabled || academicEnabled
  const status = activeLecture?.status ?? lectureStatus
  const cancelQuickStart = useCallback(() => {
    quickStartGenerationRef.current += 1
    quickStartInFlightRef.current = false
    setQuickStartBusy(false)
    setQuickStartResults([])
  }, [])
  useLayoutEffect(() => {
    cancelQuickStart()
    return () => {
      quickStartGenerationRef.current += 1
    }
  }, [
    activeLectureSessionId,
    adminToken.appSessionToken,
    status,
    cancelQuickStart,
  ])

  async function quickStart(kind: 'support' | 'captions') {
    if (
      status !== 'open' ||
      quickStartInFlightRef.current ||
      !masterControlRef.current
    )
      return
    const generation = ++quickStartGenerationRef.current
    const isCurrent = () => generation === quickStartGenerationRef.current
    quickStartInFlightRef.current = true
    setQuickStartBusy(true)
    setQuickStartResults([])
    const unavailable = async (): Promise<AiQuickStartResult> => ({
      status: 'skipped',
      message: '準備中です。もう一度お試しください。',
    })
    const steps =
      kind === 'captions'
        ? [
            {
              name: '字幕',
              start: (request: Parameters<AiQuickStartHandle['start']>[0]) =>
                (captionControlRef.current?.start ?? unavailable)(request),
            },
          ]
        : [
            ...(summariesEnabled
              ? [
                  {
                    name: '要約',
                    start: (
                      request: Parameters<AiQuickStartHandle['start']>[0],
                    ) =>
                      (summaryControlRef.current?.start ?? unavailable)({
                        ...request,
                        includeAcademicAnswers: academicEnabled,
                      }),
                  },
                ]
              : []),
            ...(materialEnabled
              ? [
                  {
                    name: '資料',
                    start: (
                      request: Parameters<AiQuickStartHandle['start']>[0],
                    ) =>
                      (materialControlRef.current?.start ?? unavailable)(
                        request,
                      ),
                  },
                ]
              : []),
            ...(!summariesEnabled && academicEnabled
              ? [
                  {
                    name: '参考回答',
                    start: async (): Promise<AiQuickStartResult> => ({
                      status: 'skipped',
                      message: 'AIの詳細で質問を指定してください。',
                    }),
                  },
                ]
              : []),
          ]
    try {
      const results = await runAiQuickStart({
        authorize: masterControlRef.current.authorize,
        isCurrent,
        scope:
          kind === 'captions'
            ? 'all_including_captions'
            : 'all_except_captions',
        steps,
      })
      if (isCurrent()) setQuickStartResults(results)
    } catch {
      if (isCurrent())
        setQuickStartResults([
          {
            status: 'failed',
            message: '開始できませんでした。AIの詳細で確認してください。',
          },
        ])
    } finally {
      if (isCurrent()) {
        quickStartInFlightRef.current = false
        setQuickStartBusy(false)
      }
    }
  }
  const summaryTiming = resolveSummaryScheduleTiming({
    fallbackHardStopAt,
    fallbackStartedAt,
    hardStopAt: activeLecture?.hardStopAt,
    startedAt: activeLecture?.startsAt,
  })
  useEffect(() => {
    setMasterAuthorization(null)
    setMasterReadiness(activeLectureSessionId ? 'checking' : 'blocked')
    onMasterAuthorizationChange?.(false)
  }, [activeLectureSessionId, onMasterAuthorizationChange])
  const supportReady = anyEnabled && masterReadiness === 'ready'
  const supportLabel = supportReady
    ? '利用可能'
    : anyEnabled && masterReadiness === 'checking'
      ? '確認中'
      : '停止中'
  return (
    <section className="panel ai-readiness-panel">
      <div className="panel-heading">
        <div className="section-intro">
          <span className="section-icon violet">
            <AppIcon name="sparkles" size={18} />
          </span>
          <div>
            <p className="eyebrow">LEARNING SUPPORT</p>
            <h2>講義の理解サポート</h2>
          </div>
        </div>
        <span className={`support-state ${supportReady ? 'is-ready' : ''}`}>
          {supportLabel}
        </span>
      </div>
      {status === 'open' ? (
        <div className="summary-control-actions" aria-label="AIの一括操作">
          <button
            className="primary-button compact"
            type="button"
            disabled={
              quickStartBusy ||
              masterReadiness !== 'ready' ||
              !(summariesEnabled || materialEnabled)
            }
            onClick={() => void quickStart('support')}
          >
            字幕以外を一括有効化
          </button>
          <button
            className="primary-button compact"
            type="button"
            disabled={
              quickStartBusy || masterReadiness !== 'ready' || !realtimeEnabled
            }
            onClick={() => void quickStart('captions')}
          >
            字幕ON
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!masterAuthorization && !quickStartBusy}
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = true
              void masterControlRef.current?.stop()
            }}
          >
            すべて停止
          </button>
        </div>
      ) : null}
      {status === 'open' && realtimeEnabled ? (
        <p className="note">
          字幕ONでマイクを使用し、音声をOpenAIへ送信します。利用時間は初期10分です。AIの詳細で変更できます。
        </p>
      ) : null}
      {quickStartBusy ? (
        <p className="note" role="status">
          AI機能を開始しています…
        </p>
      ) : null}
      {quickStartResults.length ? (
        <ul aria-live="polite">
          {quickStartResults.map((result, index) => (
            <li
              className={result.status === 'failed' ? 'error-note' : 'note'}
              key={index}
            >
              {result.message}
            </li>
          ))}
        </ul>
      ) : null}
      <details ref={detailsRef} open={status === 'draft' ? true : undefined}>
        <summary>AIの詳細</summary>
        {adminToken && activeLectureSessionId ? (
          <Suspense
            fallback={<p className="note">AI利用許可を確認しています…</p>}
          >
            <AiMasterAuthorizationControl
              controlRef={masterControlRef}
              quickStartBusy={quickStartBusy}
              onStopRequested={cancelQuickStart}
              adminToken={adminToken}
              identityScope={identityScope}
              lectureSessionId={activeLectureSessionId}
              lectureStatus={status}
              onAuthorizationChange={handleMasterAuthorizationChange}
              onReadinessChange={setMasterReadiness}
            />
          </Suspense>
        ) : null}
        {status === 'open' && adminToken && activeLectureSessionId ? (
          <Suspense
            fallback={<p className="note">字幕機能を準備しています…</p>}
          >
            <RealtimeCaptionControl
              controlRef={captionControlRef}
              admissionEnabled={realtimeEnabled}
              adminToken={adminToken}
              hardStopAt={
                activeLecture?.hardStopAt ?? fallbackHardStopAt ?? undefined
              }
              lectureSessionId={activeLectureSessionId}
              lectureStatus={status}
              masterAuthorization={masterAuthorization}
            />
          </Suspense>
        ) : null}
        {status === 'open' && adminToken && activeLectureSessionId ? (
          <LectureSummaryControl
            controlRef={summaryControlRef}
            admissionEnabled={summariesEnabled}
            adminToken={adminToken}
            displayState={displayState}
            documents={documents}
            getServerNow={getServerNow}
            hardStopAt={summaryTiming.hardStopAt}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={status}
            onAcademicAnswerChanged={handleAcademicAnswerChanged}
            publisherSessionToken={publisherSessionToken}
            startedAt={summaryTiming.startedAt}
            masterAuthorization={masterAuthorization}
          />
        ) : null}
        {status === 'open' && adminToken && activeLectureSessionId ? (
          <Suspense
            fallback={<p className="note">参考回答を準備しています…</p>}
          >
            <AcademicAnswerControl
              admissionEnabled={academicEnabled}
              adminToken={adminToken}
              lectureSessionId={activeLectureSessionId}
              lectureStatus={status}
              masterAuthorization={masterAuthorization}
              refreshVersion={academicRefreshVersion}
            />
          </Suspense>
        ) : null}
        {status === 'open' && adminToken && activeLectureSessionId ? (
          <MaterialAnalysisControl
            controlRef={materialControlRef}
            adminToken={adminToken}
            documents={documents}
            generationEnabled={materialEnabled}
            key={`${activeLectureSessionId}:${documents
              .map(
                (document) =>
                  `${document.documentId}@${document.documentVersion}`,
              )
              .join(',')}`}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={status}
            onPollDraftCreated={onPollDraftCreated}
            publisherSessionToken={publisherSessionToken}
            masterAuthorization={masterAuthorization}
          />
        ) : null}
      </details>
      {!activeLectureSessionId ? (
        <p className="note">講義を選択すると操作できます。</p>
      ) : !anyEnabled ? (
        <p className="note">AI機能は停止中です。</p>
      ) : null}
    </section>
  )
}
