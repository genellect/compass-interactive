import type { FormEventHandler } from 'react'
import type { AdminPoll } from '../../repositories/supabaseAdminRepository'

function getStatusLabel(status: string) {
  if (status === 'open') return '受付中'
  if (status === 'closed') return '締切'
  return '準備中'
}

type Props = {
  activeLectureSessionId: string | null
  canShowHistory: boolean
  error: string | null
  isLoading: boolean
  lectureStatus: string
  newOptions: string
  newQuestion: string
  newType: AdminPoll['type']
  onCreate: FormEventHandler<HTMLFormElement>
  onOptionsChange: (value: string) => void
  onQuestionChange: (value: string) => void
  onRefresh: () => void
  onToggleHistory: () => void
  onTogglePoll: (poll: AdminPoll) => void
  onTypeChange: (value: AdminPoll['type']) => void
  polls: AdminPoll[]
  showHistory: boolean
  visiblePolls: AdminPoll[]
}

export function AdminPollControl(props: Props) {
  const {
    activeLectureSessionId,
    canShowHistory,
    error,
    isLoading,
    lectureStatus,
    newOptions,
    newQuestion,
    newType,
    onCreate,
    onOptionsChange,
    onQuestionChange,
    onRefresh,
    onToggleHistory,
    onTogglePoll,
    onTypeChange,
    polls,
    showHistory,
    visiblePolls,
  } = props
  const closed = lectureStatus === 'closed'
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">LIVE POLL</p>
          <h2>ライブ投票をつくる</h2>
        </div>
        <button
          className="secondary-button"
          disabled={isLoading || !activeLectureSessionId}
          onClick={onRefresh}
          type="button"
        >
          再読み込み
        </button>
      </div>
      <form
        className="lecture-create-form poll-create-form"
        onSubmit={onCreate}
      >
        <label className="field">
          <span>質問</span>
          <input
            disabled={isLoading || closed}
            maxLength={300}
            onChange={(event) => onQuestionChange(event.target.value)}
            type="text"
            value={newQuestion}
          />
        </label>
        <label className="field compact-field">
          <span>回答形式</span>
          <select
            disabled={isLoading || closed}
            onChange={(event) =>
              onTypeChange(event.target.value as AdminPoll['type'])
            }
            value={newType}
          >
            <option value="single">単一選択</option>
            <option value="multiple">複数選択</option>
          </select>
        </label>
        <label className="field poll-options-field">
          <span>選択肢（1行に1件、2～8件）</span>
          <textarea
            disabled={isLoading || closed}
            onChange={(event) => onOptionsChange(event.target.value)}
            rows={4}
            value={newOptions}
          />
        </label>
        <button
          className="primary-button compact"
          disabled={
            isLoading ||
            closed ||
            !activeLectureSessionId ||
            newQuestion.trim().length === 0
          }
          type="submit"
        >
          投票を作成
        </button>
      </form>
      {error ? <p className="error-note">{error}</p> : null}
      {isLoading ? <p className="note">投票情報を更新しています。</p> : null}
      <p className="note">
        新しい投票を開始すると、配信中の投票は自動で締め切られます。
      </p>
      <div className="table-like">
        {visiblePolls.map((poll) => (
          <div className="table-row poll-admin-row" key={poll.id}>
            <span>
              <strong>{poll.question}</strong>
              <small>
                {poll.options
                  .map((option) => `${option.label}: ${option.responseCount}件`)
                  .join(' / ')}
              </small>
            </span>
            <span>{poll.type === 'single' ? '単一選択' : '複数選択'}</span>
            <span className={`status-pill ${poll.status}`}>
              {getStatusLabel(poll.status)}
            </span>
            <button
              className="secondary-button"
              disabled={
                isLoading ||
                (poll.status !== 'open' && lectureStatus !== 'open')
              }
              onClick={() => onTogglePoll(poll)}
              type="button"
            >
              {poll.status === 'open' ? '締め切る' : '開始する'}
            </button>
          </div>
        ))}
        {!isLoading && polls.length === 0 ? (
          <p className="note">
            まだ投票はありません。講義の問いを作ってみましょう。
          </p>
        ) : null}
      </div>
      {canShowHistory ? (
        <button
          className="secondary-button admin-history-toggle"
          onClick={onToggleHistory}
          type="button"
        >
          {showHistory ? '投票履歴を閉じる' : '投票履歴を見る'}
        </button>
      ) : null}
    </section>
  )
}
