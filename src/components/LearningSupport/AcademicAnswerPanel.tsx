import type { PublicAcademicAnswer } from '../../repositories/supabaseLiveStateRepository'
import { buildDoiUrl } from '../../lib/academicSourceLinks'
import { AppIcon } from '../AppIcon'

type AcademicAnswerPanelProps = {
  answers?: PublicAcademicAnswer[] | null
  isDemo?: boolean
  viewMode?: 'archive' | 'closed' | 'live'
}

const demoAcademicAnswer: PublicAcademicAnswer = {
  body: {
    answerPoints: [
      {
        sourceIds: [
          'doi:10.1080/09588221.2026.2631658',
          'doi:10.22373/ej.v12i2.29157',
        ],
        text: '関連は考えられますが、単純に「英語力が高いほどAIリテラシーも高い」とは言い切れません。AIを学習に生かす力には、言語力に加えて、出力を吟味する姿勢や倫理的な判断も関わります。',
      },
      {
        sourceIds: ['doi:10.1080/09588221.2026.2631658'],
        text: 'EFL学習者の翻訳改訂研究では、高熟達群はAIフィードバックをより選択的に扱う一方、低熟達群にも大きな改善が見られました。英語力とAIから得られる効果は、同じ尺度では測れないことを示します。',
      },
    ],
    limitations: [],
  },
  id: 'demo-english-ai-literacy-answer',
  publishedAt: '2026-07-20T00:00:00.000Z',
  question: '英語能力とAIリテラシーは相関しますか？',
  reviewState: 'ai_unreviewed',
  revisionId: 'demo-english-ai-literacy-revision',
  sources: [
    {
      authors: ['Li', 'Wang', 'Daems'],
      doi: '10.1080/09588221.2026.2631658',
      journal: 'Computer Assisted Language Learning',
      pmid: null,
      publicationTypes: ['Journal Article'],
      publicationYear: 2026,
      sourceId: 'doi:10.1080/09588221.2026.2631658',
      sourceProvider: 'crossref_openalex',
      sourceRole: 'primary',
      studyType: 'original_journal_article',
      title:
        'Impact of proficiency on Chinese EFL learners’ interaction with AI-generated feedback for translation revision',
    },
    {
      authors: ['Hasanah', 'Degeng'],
      doi: '10.22373/ej.v12i2.29157',
      journal: 'Englisia: Journal of Language, Education, and Humanities',
      pmid: null,
      publicationTypes: ['Journal Article'],
      publicationYear: 2025,
      sourceId: 'doi:10.22373/ej.v12i2.29157',
      sourceProvider: 'crossref_openalex',
      sourceRole: 'primary',
      studyType: 'mixed_methods',
      title:
        'Rethinking AI literacy: How high school students navigate ChatGPT in English language learning',
    },
  ],
}

function sourceNumber(answer: PublicAcademicAnswer, sourceId: string) {
  const index = answer.sources.findIndex((source) => source.sourceId === sourceId)
  return index >= 0 ? index + 1 : null
}

function reviewStatus(reviewState: PublicAcademicAnswer['reviewState']) {
  if (reviewState === 'ai_unreviewed') {
    return { className: 'is-preview', label: '教員未確認' }
  }
  if (reviewState === 'admin_revised') {
    return { className: 'is-ready', label: '教員修正済み' }
  }
  return { className: 'is-ready', label: '教員確認済み' }
}

function sourceHref(source: PublicAcademicAnswer['sources'][number]) {
  if (source.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`
  if (source.doi) return buildDoiUrl(source.doi)
  return null
}

export function AcademicAnswerPanel({
  answers,
  isDemo = false,
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
          <h2 id="academic-answer-title">AIによる参考回答</h2>
        </div>
      </div>

      <div className="academic-answer-list">
        {visibleAnswers.map((answer) => {
          const status = reviewStatus(answer.reviewState)
          return (
            <article className="academic-answer-card" key={answer.id}>
              <div className="academic-answer-card-heading">
                <h3>{answer.question}</h3>
                <span className={`support-state ${status.className}`}>
                  {status.label}
                </span>
              </div>
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

              <details className="academic-answer-sources">
                <summary>参照文献（{answer.sources.length}件）</summary>
                <ol>
                  {answer.sources.map((source, index) => {
                    const href = sourceHref(source)
                    const title = href ? (
                      <a href={href} rel="noreferrer" target="_blank">
                        {source.title}
                      </a>
                    ) : (
                      <span>{source.title}</span>
                    )
                    return (
                      <li
                        id={`academic-source-${answer.id}-${index + 1}`}
                        key={source.sourceId}
                      >
                        {title}
                        <small>
                          {source.authors.slice(0, 3).join(', ')} ·{' '}
                          {source.journal} ({source.publicationYear})
                          {source.pmid ? ` · PMID ${source.pmid}` : ''}
                          {source.doi ? ` · DOI ${source.doi}` : ''}
                        </small>
                        {source.sourceRole === 'context' ? (
                          <span className="academic-source-context">背景文献</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              </details>
            </article>
          )
        })}
      </div>
    </section>
  )
}
