import { useState, type FormEventHandler } from 'react'
import type { AdminPoll } from '../../repositories/supabaseAdminRepository'

function getStatusLabel(status: string) {
  if (status === 'open') return '受付中'
  if (status === 'closed') return '締切'
  return '準備中'
}

const pollPresets = [
  {
    label: '講義の理解度',
    question: '今日の講義の理解度は？',
    options: [
      'よく理解できた',
      'だいたい理解できた',
      'あまり理解できなかった',
      'ほとんど理解できなかった',
    ],
  },
  {
    label: '今後の導入',
    question: 'COMPASS Interactiveを、今後の授業でも導入してほしいと思いますか？',
    options: ['導入してほしい', 'どちらでもよい', '導入してほしくない'],
  },
  {
    label: '講義内容の理解への効果',
    question: 'COMPASS Interactiveを使うことで、今後の講義内容をより理解しやすくなると思いますか？',
    options: ['そう思う', 'どちらともいえない', 'そう思わない'],
  },
] as const

type Props = {
  activeLectureSessionId: string | null
  canShowHistory: boolean
  error: string | null
  isLoading: boolean
  lectureStatus: string
  newOptionCount: number
  newOptions: string[]
  newQuestion: string
  newType: AdminPoll['type']
  onCreate: FormEventHandler<HTMLFormElement>
  onOptionCountChange: (value: number) => void
  onOptionsChange: (value: string[]) => void
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
    newOptionCount,
    newOptions,
    newQuestion,
    newType,
    onCreate,
    onOptionCountChange,
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
  const [presetIndex, setPresetIndex] = useState(0)
  const closed = lectureStatus === 'closed'
  const visibleOptions = newOptions.slice(0, newOptionCount)
  const hasDraft = Boolean(
    newQuestion.trim() || newOptions.some((option) => option.trim()),
  )
  return (
    <section className="panel admin-poll-control">
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
      <div className="admin-poll-presets">
        <label className="field">
          <span>定型文</span>
          <select
            disabled={isLoading || closed}
            onChange={(event) => setPresetIndex(Number(event.target.value))}
            value={presetIndex}
          >
            {pollPresets.map((preset, index) => (
              <option key={preset.label} value={index}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={isLoading || closed}
          onClick={() => {
            const preset = pollPresets[presetIndex]
            onQuestionChange(preset.question)
            onOptionsChange(
              Array.from({ length: 8 }, (_, index) => preset.options[index] ?? ''),
            )
            onOptionCountChange(preset.options.length)
          }}
          type="button"
        >
          {hasDraft ? '定型文に置き換える' : '定型文を入力'}
        </button>
      </div>
      <form
        className="lecture-create-form poll-create-form"
        onSubmit={onCreate}
      >
        <label className="field admin-poll-question">
          <span>質問</span>
          <input
            disabled={isLoading || closed}
            maxLength={300}
            onChange={(event) => onQuestionChange(event.target.value)}
            required
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
        <label className="field compact-field">
          <span>選択肢数</span>
          <select
            disabled={isLoading || closed}
            onChange={(event) => onOptionCountChange(Number(event.target.value))}
            value={newOptionCount}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((count) => (
              <option key={count} value={count}>
                {count}件
              </option>
            ))}
          </select>
        </label>
        <div className="admin-poll-options">
          {visibleOptions.map((option, index) => (
            <label className="field" key={index}>
              <span>選択肢 {index + 1}</span>
              <input
                disabled={isLoading || closed}
                onChange={(event) =>
                  onOptionsChange(
                    newOptions.map((value, optionIndex) =>
                      optionIndex === index ? event.target.value : value,
                    ),
                  )
                }
                required
                type="text"
                value={option}
              />
            </label>
          ))}
        </div>
        <button
          className="primary-button compact"
          disabled={
            isLoading ||
            closed ||
            !activeLectureSessionId ||
            newQuestion.trim().length === 0 ||
            visibleOptions.some((option) => option.trim().length === 0)
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
