import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
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
      {adminToken && activeLectureSessionId ? (
        <Suspense
          fallback={<p className="note">AI利用許可を確認しています…</p>}
        >
          <AiMasterAuthorizationControl
            adminToken={adminToken}
            identityScope={identityScope}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={status}
            onAuthorizationChange={handleMasterAuthorizationChange}
            onReadinessChange={setMasterReadiness}
          />
        </Suspense>
      ) : null}
      {adminToken && activeLectureSessionId ? (
        <Suspense fallback={<p className="note">字幕機能を準備しています…</p>}>
          <RealtimeCaptionControl
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
      {adminToken && activeLectureSessionId ? (
        <LectureSummaryControl
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
      {adminToken && activeLectureSessionId ? (
        <Suspense fallback={<p className="note">参考回答を準備しています…</p>}>
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
      {adminToken && activeLectureSessionId ? (
        <MaterialAnalysisControl
          adminToken={adminToken}
          documents={documents}
          generationEnabled={materialEnabled}
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
          onPollDraftCreated={onPollDraftCreated}
          publisherSessionToken={publisherSessionToken}
          masterAuthorization={masterAuthorization}
        />
      ) : null}
      {!activeLectureSessionId ? (
        <p className="note">講義を選択すると操作できます。</p>
      ) : !anyEnabled ? (
        <p className="note">AI機能は停止中です。</p>
      ) : null}
    </section>
  )
}
