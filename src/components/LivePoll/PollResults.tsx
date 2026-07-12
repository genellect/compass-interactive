import type { Poll, PollResponse } from '../../types'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'

type PollResultsProps = {
  poll: Poll
  results?: PollResultSummary[]
  responses: PollResponse[]
}

export function PollResults({ poll, results = [], responses }: PollResultsProps) {
  const pollResponses = responses.filter((response) => response.pollId === poll.id)
  const resultCountByOption = new Map(
    results
      .filter((result) => result.pollId === poll.id)
      .map((result) => [result.optionId, result.responseCount]),
  )
  const totalSelections = pollResponses.reduce(
    (count, response) => count + response.optionIds.length,
    0,
  )
  const totalResultSelections = poll.options.reduce(
    (count, option) => count + (resultCountByOption.get(option.id) ?? 0),
    0,
  )
  const hasRpcResults = results.some((result) => result.pollId === poll.id)
  const denominator = hasRpcResults ? totalResultSelections : totalSelections

  return (
    <div className="poll-options">
      <div className="poll-result-header">
        <p className="note">
          {hasRpcResults
            ? 'みんなの回答'
            : '最初の回答を待っています'}
        </p>
        <span className="metric">{denominator}票</span>
      </div>

      {poll.options.map((option) => {
        const localCount = pollResponses.filter((response) =>
          response.optionIds.includes(option.id),
        ).length
        const count = hasRpcResults
          ? (resultCountByOption.get(option.id) ?? 0)
          : localCount
        const percent =
          denominator > 0 ? Math.round((count / denominator) * 100) : 0

        return (
          <div className="poll-option" key={option.id}>
            <div className="poll-row">
              <span>{option.label}</span>
              <strong>
                {percent}%
              </strong>
            </div>
            <div
              aria-label={`${option.label}: ${count}件、${percent}%`}
              className="poll-bar"
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
