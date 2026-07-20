import { AppIcon } from '../AppIcon'
import type { PublicAcademicAnswer } from '../../repositories/supabaseLiveStateRepository'

type AcademicAnswerPanelProps = {
  answers?: PublicAcademicAnswer[] | null
  isDemo?: boolean
  viewMode?: 'archive' | 'closed' | 'live'
}

const demoAcademicAnswer: PublicAcademicAnswer = {
  body: {
    answerPoints: [
      {
        sourceIds: ['pmid:26551272'],
        text: '心血管リスクが高く糖尿病のない成人を対象とした無作為化試験では、収縮期血圧120 mmHg未満を目標とする群で、140 mmHg未満を目標とする群より主要な心血管イベントと全死亡が少なくなりました。',
      },
      {
        sourceIds: ['pmid:26551272'],
        text: '一方で、低血圧、失神、電解質異常、急性腎障害など一部の有害事象は集中的な治療群で多く、利益とリスクの両方を読む必要があります。',
      },
    ],
    limitations: [
      '糖尿病や脳卒中既往のある人は対象外であり、結果をそのまま全員へ当てはめることはできません。',
      'これは講義理解のための参考情報で、個別の診療判断を示すものではありません。',
    ],
  },
  id: 'demo-sprint-answer',
  publishedAt: '2026-07-20T00:00:00.000Z',
  question: 'より厳格な血圧管理は、どのような利益と注意点をもつのでしょうか？',
  reviewState: 'admin_confirmed',
  revisionId: 'demo-sprint-revision',
  sources: [
    {
      authors: ['SPRINT Research Group'],
      doi: '10.1056/NEJMoa1511939',
      journal: 'New England Journal of Medicine',
      pmid: '26551272',
      publicationTypes: ['Randomized Controlled Trial'],
      publicationYear: 2015,
      sourceId: 'pmid:26551272',
      sourceRole: 'primary',
      studyType: 'randomized_controlled_trial',
      title:
        'A Randomized Trial of Intensive versus Standard Blood-Pressure Control',
    },
  ],
}

function sourceNumber(answer: PublicAcademicAnswer, sourceId: string) {
  const index = answer.sources.findIndex((source) => source.sourceId === sourceId)
  return index >= 0 ? index + 1 : null
}

export function AcademicAnswerPanel({
  answers,
  isDemo = false,
  viewMode = 'live',
}: AcademicAnswerPanelProps) {
  const visibleAnswers =
    answers && answers.length > 0
      ? answers
      : isDemo
        ? [demoAcademicAnswer]
        : []
  if (visibleAnswers.length === 0) return null

  return (
    <section
      aria-labelledby="academic-answer-title"
      className="learning-support academic-answer-panel"
    >
      <div className="learning-support-heading">
        <span className="support-icon violet">
          <AppIcon name="book" size={18} />
        </span>
        <div>
          <p className="eyebrow">EVIDENCE NOTE</p>
          <h2 id="academic-answer-title">文献から考える参考回答</h2>
        </div>
        <span className="support-state is-ready">
          {viewMode === 'archive' ? '講義記録' : '教員確認済み'}
        </span>
      </div>

      <p className="academic-answer-intro">
        一次文献を手がかりに、講義で生まれた問いを短く整理しています。
      </p>
      <div className="academic-answer-list">
        {visibleAnswers.map((answer) => (
          <article className="academic-answer-card" key={answer.id}>
            <h3>{answer.question}</h3>
            <ol className="academic-answer-points">
              {answer.body.answerPoints.map((point, index) => (
                <li key={`${answer.id}-point-${index}`}>
                  <p>{point.text}</p>
                  <span aria-label="根拠文献番号">
                    {point.sourceIds.map((sourceId) => {
                      const number = sourceNumber(answer, sourceId)
                      return number ? (
                        <a
                          href={`#academic-source-${answer.id}-${number}`}
                          key={sourceId}
                        >
                          [{number}]
                        </a>
                      ) : null
                    })}
                  </span>
                </li>
              ))}
            </ol>

            {answer.body.limitations.length > 0 ? (
              <div className="academic-answer-limitations">
                <strong>読み取るときの注意</strong>
                <ul>
                  {answer.body.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details className="academic-answer-sources">
              <summary>根拠文献を見る（{answer.sources.length}件）</summary>
              <ol>
                {answer.sources.map((source, index) => (
                  <li
                    id={`academic-source-${answer.id}-${index + 1}`}
                    key={source.sourceId}
                  >
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.title}
                    </a>
                    <small>
                      {source.authors.slice(0, 3).join(', ')} · {source.journal}{' '}
                      ({source.publicationYear}) · PMID {source.pmid}
                      {source.doi ? ` · DOI ${source.doi}` : ''}
                    </small>
                    {source.sourceRole === 'context' ? (
                      <span className="academic-source-context">背景文献</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          </article>
        ))}
      </div>
      <p className="note academic-answer-disclaimer">
        参考回答は講義理解の補助です。個別の診断・治療を示すものではありません。
      </p>
    </section>
  )
}
