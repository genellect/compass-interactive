import { useEffect, useMemo, useState } from 'react'
import type { Poll, PollResponse } from '../../types'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'
import { PollResults } from './PollResults'
import { AppIcon } from '../AppIcon'

type PollCardProps = {
  currentParticipantId?: string | null
  displayMode?: boolean
  onSubmitResponse?: (pollId: string, optionIds: string[]) => void | Promise<void>
  poll: Poll
  results?: PollResultSummary[]
  responses: PollResponse[]
}

function getDiscussionCue(question: string) {
  if (question.startsWith('1.')) {
    return '議論の入口: 技術ではなく、この治療の中心アイデアはどこにあるかを考えます。'
  }

  if (question.startsWith('2.')) {
    return '正解のない問い: 研究責任者の視点で、次に投資すべき実験を選びます。'
  }

  if (question.startsWith('3.')) {
    return 'Discussion接続: 実用化までに残る最大のボトルネックを考えます。'
  }

  if (question.startsWith('4.')) {
    return '理解度確認: CasRxとCas9の違いを確認する知識問題です。'
  }

  if (question.startsWith('5.')) {
    return '倫理・臨床視点: 患者応用へ進むタイミングを考えます。'
  }

  if (question.includes('翻訳AI')) {
    return '正解のない問いです。いまの自分に一番近い考えを選んでください。'
  }

  return '回答後、結果を見ながら短く議論します。'
}

export function PollCard({
  currentParticipantId,
  displayMode = false,
  onSubmitResponse,
  poll,
  results = [],
  responses,
}: PollCardProps) {
  const existingResponse = useMemo(
    () =>
      responses.find(
        (response) =>
          response.pollId === poll.id &&
          response.participantId === currentParticipantId,
      ),
    [currentParticipantId, poll.id, responses],
  )
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(
    existingResponse?.optionIds ?? [],
  )
  const discussionCue = getDiscussionCue(poll.question)

  const canAnswer =
    !displayMode &&
    poll.status === 'open' &&
    Boolean(currentParticipantId) &&
    !existingResponse
  const showResults =
    displayMode || Boolean(existingResponse) || poll.status === 'closed'

  function toggleOption(optionId: string) {
    if (!canAnswer) {
      return
    }

    if (poll.type === 'single') {
      setSelectedOptionIds([optionId])
      return
    }

    setSelectedOptionIds((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    )
  }

  function submitResponse() {
    if (!onSubmitResponse || selectedOptionIds.length === 0) {
      return
    }

    void onSubmitResponse(poll.id, selectedOptionIds)
  }

  useEffect(() => {
    if (existingResponse) {
      setSelectedOptionIds(existingResponse.optionIds)
    }
  }, [existingResponse])

  return (
    <section className={`panel poll-card ${displayMode ? 'display-panel' : ''}`}>
      <div className="panel-heading">
        <div className="poll-heading-copy">
          <div className="poll-label">
            <span className="section-icon"><AppIcon name="poll" size={18} /></span>
            <p className="eyebrow">LIVE POLL</p>
          </div>
          <h2>{poll.question}</h2>
          <p className="poll-cue">{discussionCue}</p>
        </div>
        <span className={`status-pill ${poll.status}`}>
          {poll.status === 'open' ? (
            <><i /> 回答受付中</>
          ) : '受付終了'}
        </span>
      </div>

      {canAnswer ? (
        <div className="answer-options">
          {poll.options.map((option) => (
            <label className="choice-row" key={option.id}>
              <input
                checked={selectedOptionIds.includes(option.id)}
                disabled={!canAnswer}
                name={poll.id}
                onChange={() => toggleOption(option.id)}
                type={poll.type === 'single' ? 'radio' : 'checkbox'}
              />
              <span className="choice-marker" aria-hidden="true" />
              <span>{option.label}</span>
            </label>
          ))}
          <button
            className="primary-button compact"
            disabled={selectedOptionIds.length === 0}
            onClick={submitResponse}
            type="button"
          >
            この回答を送る
            <AppIcon name="arrow-right" size={17} />
          </button>
        </div>
      ) : null}

      {existingResponse && !displayMode ? (
        <p className="success-note">
          <AppIcon name="check" size={17} />
          回答しました。みんなの考えを見てみましょう。
        </p>
      ) : null}

      {showResults ? (
        <PollResults poll={poll} results={results} responses={responses} />
      ) : (
        <div className="poll-result-locked">
          <span aria-hidden="true" />
          <p>回答すると、みんなの考えが見られます。</p>
        </div>
      )}

      {showResults ? <p className="note privacy-note">回答はすべて匿名です。</p> : null}
    </section>
  )
}
