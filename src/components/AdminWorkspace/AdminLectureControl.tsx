import type { FormEventHandler, ReactNode } from 'react'
import type { AdminLecture } from '../../repositories/supabaseAdminRepository'
import { isPhase71ClassroomExtensionsEnabled } from '../../lib/featureFlags'
import { LectureJoinQr } from '../LectureJoinQr'

function getStatusLabel(status: string | null) {
  if (!status) return '未選択'
  if (status === 'open') return '受付中'
  if (status === 'closed') return '締切'
  return '準備中'
}

function toDatetimeLocalValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offsetDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  )
  return offsetDate.toISOString().slice(0, 16)
}

type AdminLectureControlProps = {
  activeLectureSessionId: string | null
  error: string | null
  hiddenCommentCount: number
  isLoading: boolean
  journalClubPreset?: ReactNode
  lectures: AdminLecture[]
  newEndsAt: string
  newStartsAt: string
  newTitle: string
  onClose: (lectureSessionId: string) => void
  onCopyCode: (lectureCode: string) => void
  onCreate: FormEventHandler<HTMLFormElement>
  onDuplicate: (lectureSessionId: string) => void
  onEndsAtChange: (value: string) => void
  onRefresh: () => void
  onSelect: (lecture: AdminLecture) => void
  onStart: (lectureSessionId: string) => void
  onStartsAtChange: (value: string) => void
  onTitleChange: (value: string) => void
  onToggleHistory: () => void
  participantCount: number
  selectedLectureStatus: string | null
  showHistory: boolean
  visibleCommentCount: number
  visibleLectures: AdminLecture[]
}

export function AdminLectureControl(props: AdminLectureControlProps) {
  const {
    activeLectureSessionId,
    error,
    hiddenCommentCount,
    isLoading,
    journalClubPreset,
    lectures,
    newEndsAt,
    newStartsAt,
    newTitle,
    onClose,
    onCopyCode,
    onCreate,
    onDuplicate,
    onEndsAtChange,
    onRefresh,
    onSelect,
    onStart,
    onStartsAtChange,
    onTitleChange,
    onToggleHistory,
    participantCount,
    selectedLectureStatus,
    showHistory,
    visibleCommentCount,
    visibleLectures,
  } = props
  const qrLecture =
    lectures.find(
      (lecture) =>
        lecture.id === activeLectureSessionId && lecture.status === 'open',
    ) ?? null
  return (
    <>
      <section className="panel" id="admin-prepare">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PREPARE</p>
            <h2>講義を準備する</h2>
          </div>
          <button
            className="secondary-button"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            再読み込み
          </button>
        </div>
        <form className="lecture-create-form" onSubmit={onCreate}>
          <label className="field compact-field">
            <span>講義タイトル</span>
            <input
              disabled={isLoading}
              onChange={(event) => onTitleChange(event.target.value)}
              type="text"
              value={newTitle}
            />
          </label>
          <label className="field compact-field">
            <span>開始予定</span>
            <input
              disabled={isLoading}
              onChange={(event) => onStartsAtChange(event.target.value)}
              type="datetime-local"
              value={newStartsAt}
            />
          </label>
          <label className="field compact-field">
            <span>終了予定</span>
            <input
              disabled={isLoading}
              onChange={(event) => onEndsAtChange(event.target.value)}
              type="datetime-local"
              value={newEndsAt}
            />
          </label>
          <button
            className="primary-button compact"
            disabled={isLoading || newTitle.trim().length === 0}
            type="submit"
          >
            新しい講義を作成
          </button>
        </form>
        {journalClubPreset}
        {error ? <p className="error-note">{error}</p> : null}
        {isLoading ? <p className="note">講義情報を更新しています。</p> : null}
        <div className="table-like lecture-table">
          {lectures.length > 0 ? (
            visibleLectures.map((lecture) => {
              const isActive = activeLectureSessionId === lecture.id
              return (
                <div
                  className={`table-row lecture-admin-row ${isActive ? 'is-active' : ''}`}
                  key={lecture.id}
                >
                  <span>
                    <strong>
                      {lecture.title}
                      {lecture.journalClub ? (
                        <span
                          className={`journal-club-run-badge ${lecture.journalClub.runKind}`}
                        >
                          {lecture.journalClub.runKind === 'production'
                            ? '本番'
                            : 'リハーサル'}
                        </span>
                      ) : null}
                    </strong>
                    <small>
                      {lecture.startsAt
                        ? `開始 ${toDatetimeLocalValue(lecture.startsAt).replace('T', ' ')}`
                        : '開始未設定'}
                      {' / '}
                      {lecture.endsAt
                        ? `終了 ${toDatetimeLocalValue(lecture.endsAt).replace('T', ' ')}`
                        : '終了未設定'}
                    </small>
                  </span>
                  <span className="lecture-code-cell">
                    <code>{lecture.lectureCode || '未発行'}</code>
                    <button
                      className="secondary-button compact"
                      disabled={!lecture.lectureCode}
                      onClick={() => onCopyCode(lecture.lectureCode)}
                      type="button"
                    >
                      コピー
                    </button>
                  </span>
                  <span className={`status-pill ${lecture.status}`}>
                    {getStatusLabel(lecture.status)}
                  </span>
                  <div className="lecture-row-actions">
                    <button
                      className="secondary-button"
                      onClick={() => onSelect(lecture)}
                      type="button"
                    >
                      {isActive ? '操作対象' : '選択'}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || lecture.status !== 'draft'}
                      onClick={() => onStart(lecture.id)}
                      type="button"
                    >
                      開始
                    </button>
                    <button
                      className="secondary-button danger-button"
                      disabled={isLoading || lecture.status !== 'open'}
                      onClick={() => onClose(lecture.id)}
                      type="button"
                    >
                      終了
                    </button>
                    {lecture.status === 'closed' && !lecture.journalClub ? (
                      <button
                        className="secondary-button"
                        disabled={isLoading}
                        onClick={() => {
                          const confirmed = window.confirm(
                            '同じタイトルで新しい講義コードを発行し、講義を開始します。過去の記録は変更されず、資料と投票は引き継がれません。続けますか？',
                          )
                          if (confirmed) onDuplicate(lecture.id)
                        }}
                        type="button"
                      >
                        もう一度開催する
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })
          ) : (
            <p className="note">
              まだ講義がありません。最初の講義を作成しましょう。
            </p>
          )}
        </div>
        {lectures.length > 2 ? (
          <button
            className="secondary-button admin-history-toggle"
            onClick={onToggleHistory}
            type="button"
          >
            {showHistory ? '講義履歴を閉じる' : '講義履歴を表示する'}
          </button>
        ) : null}
        {isPhase71ClassroomExtensionsEnabled && qrLecture ? (
          <LectureJoinQr
            code={qrLecture.lectureCode}
            title={`${qrLecture.title}に参加`}
          />
        ) : null}
      </section>
      <section className="dashboard-grid">
        <article className="stat-card">
          <span>講義状態</span>
          <strong>{getStatusLabel(selectedLectureStatus)}</strong>
        </article>
        <article className="stat-card">
          <span>参加者数</span>
          <strong>約{participantCount}</strong>
        </article>
        <article className="stat-card">
          <span>表示コメント</span>
          <strong>{visibleCommentCount}</strong>
        </article>
        <article className="stat-card">
          <span>非表示コメント</span>
          <strong>{hiddenCommentCount}</strong>
        </article>
      </section>
    </>
  )
}
