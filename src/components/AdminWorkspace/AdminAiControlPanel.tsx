import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { AppIcon } from '../AppIcon'
import {
  LectureSummaryControl,
  MaterialAnalysisControl,
  RealtimeCaptionControl,
  AiMasterAuthorizationControl,
} from '../AdminAiControl'
import type {
  AiMasterAuthorization,
  AdminLecture,
  AdminPdfDocument,
} from '../../repositories/supabaseAdminRepository'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { resolveSummaryScheduleTiming } from '../../summary/summarySchedule'
import { isPhase728AiMasterAuthorizationEnabled } from '../../lib/featureFlags'

const AcademicAnswerControl = lazy(() =>
  import('../AdminAiControl/AcademicAnswerControl').then((module) => ({
    default: module.AcademicAnswerControl,
  })),
)

type Props = {
  activeLecture: AdminLecture | undefined
  activeLectureSessionId: string | null
  adminToken: string
  academicEnabled: boolean
  documents: AdminPdfDocument[]
  displayState: DisplayState | null
  fallbackHardStopAt: string | null | undefined
  fallbackStartedAt: string | null | undefined
  getServerNow: () => string | null
  lectureStatus: AdminLecture['status']
  materialEnabled: boolean
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
  lectureStatus,
  materialEnabled,
  onPollDraftCreated,
  publisherSessionToken,
  realtimeEnabled,
  summariesEnabled,
}: Props) {
  const [academicRefreshVersion, setAcademicRefreshVersion] = useState(0)
  const [masterAuthorization, setMasterAuthorization] =
    useState<AiMasterAuthorization | null>(null)
  const handleAcademicAnswerChanged = useCallback(() => {
    setAcademicRefreshVersion((version) => version + 1)
  }, [])
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
  }, [activeLectureSessionId])
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
        <span className={`support-state ${anyEnabled ? 'is-ready' : ''}`}>
          {anyEnabled ? '利用可能' : '停止中'}
        </span>
      </div>
      {isPhase728AiMasterAuthorizationEnabled &&
      adminToken &&
      activeLectureSessionId ? (
        <AiMasterAuthorizationControl
          adminToken={adminToken}
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
          onAuthorizationChange={setMasterAuthorization}
        />
      ) : null}
      {realtimeEnabled && adminToken && activeLectureSessionId ? (
        <RealtimeCaptionControl
          adminToken={adminToken}
          hardStopAt={
            activeLecture?.hardStopAt ?? fallbackHardStopAt ?? undefined
          }
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
          masterAuthorization={masterAuthorization}
        />
      ) : null}
      {summariesEnabled && adminToken && activeLectureSessionId ? (
        <LectureSummaryControl
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
      {academicEnabled && adminToken && activeLectureSessionId ? (
        <Suspense fallback={<p className="note">参考回答を準備しています…</p>}>
          <AcademicAnswerControl
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
