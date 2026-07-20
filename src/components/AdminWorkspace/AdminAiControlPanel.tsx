import { lazy, Suspense } from 'react'

import { AppIcon } from '../AppIcon'
import {
  LectureSummaryControl,
  MaterialAnalysisControl,
  RealtimeCaptionControl,
} from '../AdminAiControl'
import type {
  AdminLecture,
  AdminPdfDocument,
} from '../../repositories/supabaseAdminRepository'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'

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
  getServerNow,
  lectureStatus,
  materialEnabled,
  onPollDraftCreated,
  publisherSessionToken,
  realtimeEnabled,
  summariesEnabled,
}: Props) {
  const anyEnabled =
    realtimeEnabled || materialEnabled || summariesEnabled || academicEnabled
  const status = activeLecture?.status ?? lectureStatus
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
      <p className="panel-description">
        字幕、直近5分のハイライト、講義資料の要点が、学生の理解を途切れさせずに支えます。
      </p>
      {realtimeEnabled && adminToken && activeLectureSessionId ? (
        <RealtimeCaptionControl
          adminToken={adminToken}
          hardStopAt={
            activeLecture?.hardStopAt ?? fallbackHardStopAt ?? undefined
          }
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
        />
      ) : (
        <p className="note">
          リアルタイム字幕は現在停止しています。利用設定が完了すると、ここから開始できます。
        </p>
      )}
      {summariesEnabled && adminToken && activeLectureSessionId ? (
        <LectureSummaryControl
          adminToken={adminToken}
          displayState={displayState}
          documents={documents}
          getServerNow={getServerNow}
          hardStopAt={activeLecture?.hardStopAt ?? null}
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
          publisherSessionToken={publisherSessionToken}
          startedAt={activeLecture?.startsAt ?? null}
        />
      ) : (
        <p className="note">
          5分ハイライトは現在停止しています。利用時は開始にAPI利用PINが必要です。
        </p>
      )}
      {academicEnabled && adminToken && activeLectureSessionId ? (
        <Suspense fallback={<p className="note">参考回答を準備しています…</p>}>
          <AcademicAnswerControl
            adminToken={adminToken}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={status}
          />
        </Suspense>
      ) : null}
      {materialEnabled && adminToken && activeLectureSessionId ? (
        <MaterialAnalysisControl
          adminToken={adminToken}
          documents={documents}
          lectureSessionId={activeLectureSessionId}
          lectureStatus={status}
          onPollDraftCreated={onPollDraftCreated}
          publisherSessionToken={publisherSessionToken}
        />
      ) : (
        <p className="note">
          資料分析と投票案の提案は現在停止しています。PDFを公開するだけではAPI利用は発生しません。
        </p>
      )}
      <div className="api-readiness-grid">
        <article>
          <span className="support-icon">
            <AppIcon name="message" size={18} />
          </span>
          <div>
            <strong>リアルタイム字幕</strong>
            <small>{realtimeEnabled ? '開始待ち' : '停止中'}</small>
          </div>
          <span
            className={`readiness-dot ${realtimeEnabled ? 'is-active' : ''}`}
          />
        </article>
        <article>
          <span className="support-icon violet">
            <AppIcon name="sparkles" size={18} />
          </span>
          <div>
            <strong>5分ハイライト</strong>
            <small>
              {summariesEnabled ? '話の要点とみんなの反応' : '停止中'}
            </small>
          </div>
          <span
            className={`readiness-dot ${summariesEnabled ? 'is-active' : ''}`}
          />
        </article>
        <article>
          <span className="support-icon violet">
            <AppIcon name="book" size={18} />
          </span>
          <div>
            <strong>講義資料の要点</strong>
            <small>
              {materialEnabled ? 'ページと一緒に整理して表示' : '停止中'}
            </small>
          </div>
          <span
            className={`readiness-dot ${materialEnabled ? 'is-active' : ''}`}
          />
        </article>
        <article>
          <span className="support-icon violet">
            <AppIcon name="book" size={18} />
          </span>
          <div>
            <strong>文献に基づく参考回答</strong>
            <small>{academicEnabled ? '教員確認後に公開' : '停止中'}</small>
          </div>
          <span
            className={`readiness-dot ${academicEnabled ? 'is-active' : ''}`}
          />
        </article>
      </div>
    </section>
  )
}
