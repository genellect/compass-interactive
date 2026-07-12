import { AppIcon } from '../AppIcon'

export type CaptionContent = {
  text: string
  translation?: string
}

type CaptionPanelProps = {
  caption?: CaptionContent | null
  compact?: boolean
  isDemo?: boolean
  mode?: 'student' | 'display'
}

type SummaryPanelProps = {
  isDemo?: boolean
  reflectionQuestion?: string | null
  summaryPoints?: string[]
}

const demoSummaryPoints = [
  '翻訳は「意味を受け取る」助けになる一方、問いを立てる力は自分の中に残る。',
  '英語は情報への入口だけでなく、異なる文化や考え方と直接つながる手段になる。',
  'AI時代には、英語力とともに翻訳結果を確かめる判断力がより重要になる。',
]

export function LiveCaptionPanel({
  caption,
  compact = false,
  isDemo = false,
  mode = 'student',
}: CaptionPanelProps) {
  const visibleCaption =
    caption ??
    (isDemo
      ? {
          text: '翻訳できるからこそ、私たちは「何を伝えるか」を、もっと深く考えられます。',
          translation:
            'Because translation is available, we can think more deeply about what we want to communicate.',
        }
      : null)

  return (
    <section
      className={`learning-support caption-panel ${compact ? 'is-compact' : ''} ${mode === 'display' ? 'is-display transcript-placeholder' : ''}`}
    >
      <div className="learning-support-heading">
        <span className="support-icon">
          <AppIcon name="message" size={18} />
        </span>
        <div>
          <p className="eyebrow">LIVE CAPTION</p>
          <h2>講義字幕</h2>
        </div>
        <span className={`support-state ${isDemo ? 'preview' : ''}`}>
          {isDemo ? 'デモ' : visibleCaption ? '字幕中' : '待機中'}
        </span>
      </div>

      {visibleCaption ? (
        <div className="caption-copy" aria-live="polite">
          <p>{visibleCaption.text}</p>
          {visibleCaption.translation ? (
            <span>{visibleCaption.translation}</span>
          ) : null}
        </div>
      ) : (
        <div className="support-empty">
          <span className="caption-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <p>字幕が始まると、ここに講義の言葉が届きます。</p>
        </div>
      )}
    </section>
  )
}

export function LectureSummaryPanel({
  isDemo = false,
  reflectionQuestion,
  summaryPoints,
}: SummaryPanelProps) {
  const visiblePoints = summaryPoints ?? (isDemo ? demoSummaryPoints : [])
  const visibleQuestion =
    reflectionQuestion ??
    (isDemo ? 'あなたが英語で直接伝えてみたいことは何ですか？' : null)

  return (
    <section className="learning-support summary-panel">
      <div className="learning-support-heading">
        <span className="support-icon violet">
          <AppIcon name="sparkles" size={18} />
        </span>
        <div>
          <p className="eyebrow">LEARNING REVIEW</p>
          <h2>講義後レビュー</h2>
        </div>
        <span className={`support-state ${isDemo ? 'preview' : ''}`}>
          {isDemo ? 'サンプル' : visiblePoints.length > 0 ? '準備完了' : '講義後'}
        </span>
      </div>

      {visiblePoints.length > 0 ? (
        <>
          <p className="summary-lead">今日の講義で持ち帰りたい3つの視点</p>
          <ol className="summary-points">
            {visiblePoints.map((point) => (
              <li key={point}>
                <span>
                  <AppIcon name="check" size={16} />
                </span>
                <p>{point}</p>
              </li>
            ))}
          </ol>
          {visibleQuestion ? (
            <div className="reflection-prompt">
              <span>次に考える問い</span>
              <strong>{visibleQuestion}</strong>
            </div>
          ) : null}
        </>
      ) : (
        <div className="support-empty summary-empty">
          <span className="support-orbit" aria-hidden="true" />
          <div>
            <strong>講義の学びを、あとから振り返れる形に。</strong>
            <p>講義終了後、重要なポイントと次の問いをここに整理します。</p>
          </div>
        </div>
      )}
    </section>
  )
}
