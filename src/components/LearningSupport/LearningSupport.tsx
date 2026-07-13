import { useEffect, useState } from 'react'
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

export type MaterialSummaryPoint = {
  detail: string
  pageLabel: string
  title: string
}

export type MaterialSummaryContent = {
  lead: string
  points: MaterialSummaryPoint[]
  reflectionQuestion: string
}

export type FiveMinuteRecap = {
  classPulse: string[]
  emergingQuestion: string
  id: string
  presenterPoints: string[]
  responseLabel: string
  windowLabel: string
}

type MaterialSummaryPanelProps = {
  isDemo?: boolean
  summary?: MaterialSummaryContent | null
}

type FiveMinuteRecapPanelProps = {
  isDemo?: boolean
  recaps?: FiveMinuteRecap[]
}

const demoMaterialSummary: MaterialSummaryContent = {
  lead: 'この資料で押さえたい3つのポイント',
  points: [
    {
      pageLabel: 'P.3',
      title: '情報の壁は、小さくなっている',
      detail:
        'AI翻訳によって、海外の情報へアクセスするための言語障壁は大きく下がっています。',
    },
    {
      pageLabel: 'P.6',
      title: '英語の価値は、人とのつながりへ',
      detail:
        '知識を得るだけでなく、直接話し、笑い、信頼を築くための言葉として価値が残ります。',
    },
    {
      pageLabel: 'P.11',
      title: '自分の言葉で届ける力',
      detail:
        '相手の文化や気持ちを理解し、自分の考えを伝える力は、AI時代ほど重要になります。',
    },
  ],
  reflectionQuestion:
    'あなたが世界の誰かに、自分の言葉で伝えてみたいことは何ですか？',
}

const demoFiveMinuteRecaps: FiveMinuteRecap[] = [
  {
    id: 'recap-1005',
    windowLabel: '10:00–10:05',
    responseLabel: '字幕と3件の声から',
    presenterPoints: [
      '英語は、海外の情報を得るための入口として学ばれてきた。',
      'AIによって「情報を受け取る壁」は急速に小さくなっている。',
    ],
    classPulse: [
      '翻訳結果を確かめるためにも基礎は必要、という気づきが生まれています。',
      '英語を学ぶ目的を、点数以外で考え始めた人がいます。',
    ],
    emergingQuestion:
      'AIに任せる部分と、自分で理解する部分をどう分ければよいだろう？',
  },
  {
    id: 'recap-1010',
    windowLabel: '10:05–10:10',
    responseLabel: '投票209票と3件の声から',
    presenterPoints: [
      '直接話し、笑い、信頼を築けるのは、自分自身の言葉だからこそ。',
      '英語の役割は「情報取得」から「人とつながる力」へ広がっている。',
    ],
    classPulse: [
      '「世界中の仲間と一緒に挑戦できる」が最も多く選ばれています。',
      '海外の研究者と直接話す力に価値を感じる声が集まっています。',
    ],
    emergingQuestion:
      '翻訳がある時代に、直接話せることはどんな信頼につながるだろう？',
  },
  {
    id: 'recap-1015',
    windowLabel: '10:10–10:15',
    responseLabel: '字幕・投票・みんなの声から',
    presenterPoints: [
      '英語は単なる知識ではなく、人と人の間に橋をかける力になる。',
      '世界に届けたい考えがあるとき、最後に声を持つのは自分自身。',
    ],
    classPulse: [
      '正しさだけでなく、相手と関係を築くために英語を使いたいという流れです。',
      '自分なら何を伝えたいか、次の行動に結びつく問いが生まれています。',
    ],
    emergingQuestion:
      'あなたの言葉を待っている相手に、最初の一言をどう届けますか？',
  },
]

const demoCaptionSequence: CaptionContent[] = [
  {
    text: 'かつて英語は、「海外の情報を得るため」のものでした。',
    translation:
      'English used to be a way to access information from around the world.',
  },
  {
    text: '今は、AIがその壁を大きく取り払ってくれます。',
    translation: 'Today, AI has removed much of that barrier.',
  },
  {
    text: 'それでも、世界中の人と直接話し、笑い、信頼を築けるのは、あなた自身です。',
    translation:
      'Even so, only you can speak, laugh, and build trust with people around the world.',
  },
  {
    text: 'だから英語は、単なる知識ではなく、人と人をつなぐ力になります。',
    translation:
      "That is why English is more than knowledge—it's a bridge between people.",
  },
  {
    text: '世界は、あなたの言葉を待っています。',
    translation: 'The world is waiting to hear your voice.',
  },
]

export function LiveCaptionPanel({
  caption,
  compact = false,
  isDemo = false,
  mode = 'student',
}: CaptionPanelProps) {
  const [demoCaptionIndex, setDemoCaptionIndex] = useState(0)

  useEffect(() => {
    if (!isDemo || caption) {
      setDemoCaptionIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setDemoCaptionIndex(
        (current) => (current + 1) % demoCaptionSequence.length,
      )
    }, 4600)

    return () => window.clearInterval(timer)
  }, [caption, isDemo])

  const visibleCaption =
    caption ??
    (isDemo ? demoCaptionSequence[demoCaptionIndex] : null)

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
          {isDemo ? 'ライブ再生' : visibleCaption ? '字幕中' : '待機中'}
        </span>
      </div>

      {visibleCaption ? (
        <div
          className="caption-copy is-live"
          key={isDemo ? demoCaptionIndex : visibleCaption.text}
          aria-live="polite"
        >
          <small>講義字幕</small>
          <p>{visibleCaption.text}</p>
          {visibleCaption.translation ? (
            <div className="caption-translation">
              <small>English Translation</small>
              <span>{visibleCaption.translation}</span>
            </div>
          ) : null}
          {isDemo ? (
            <div className="caption-sequence" aria-label={`${demoCaptionIndex + 1} / ${demoCaptionSequence.length}`}>
              {demoCaptionSequence.map((item, index) => (
                <i
                  className={index === demoCaptionIndex ? 'is-active' : ''}
                  key={item.text}
                />
              ))}
            </div>
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

export function FiveMinuteRecapPanel({
  isDemo = false,
  recaps = [],
}: FiveMinuteRecapPanelProps) {
  const visibleRecaps = recaps.length > 0 ? recaps : isDemo ? demoFiveMinuteRecaps : []
  const [availableCount, setAvailableCount] = useState(
    isDemo && recaps.length === 0 ? 1 : visibleRecaps.length,
  )
  const [activeIndex, setActiveIndex] = useState(
    isDemo && recaps.length === 0 ? 0 : Math.max(visibleRecaps.length - 1, 0),
  )

  useEffect(() => {
    if (!isDemo || recaps.length > 0) {
      setAvailableCount(visibleRecaps.length)
      setActiveIndex(Math.max(visibleRecaps.length - 1, 0))
      return
    }

    setAvailableCount(1)
    setActiveIndex(0)
    const timer = window.setInterval(() => {
      setAvailableCount((current) => {
        if (current >= demoFiveMinuteRecaps.length) {
          return current
        }
        const next = current + 1
        setActiveIndex(next - 1)
        return next
      })
    }, 14000)

    return () => window.clearInterval(timer)
  }, [isDemo, recaps.length, visibleRecaps.length])

  const availableRecaps = visibleRecaps.slice(0, availableCount)
  const activeRecap = availableRecaps[activeIndex] ?? availableRecaps.at(-1)

  return (
    <section className="learning-support recap-panel" id="lecture-recap">
      <div className="recap-heading-row">
        <div className="learning-support-heading">
          <span className="support-icon recap-live-icon">
            <AppIcon name="sparkles" size={18} />
          </span>
          <div>
            <p className="eyebrow">5 MINUTE RECAP</p>
            <h2>直近5分のハイライト</h2>
          </div>
        </div>
        <div className="recap-update-state">
          <span><i /> LIVE</span>
          <small>5分ごとに更新</small>
        </div>
      </div>

      {activeRecap ? (
        <div className="recap-content" key={activeRecap.id} aria-live="polite">
          <div className="recap-meta">
            <strong>{activeRecap.windowLabel}</strong>
            <span>{activeRecap.responseLabel}</span>
          </div>
          <div className="recap-grid">
            <article className="recap-stream presenter-stream">
              <div className="recap-stream-heading">
                <span><AppIcon name="compass" size={17} /></span>
                <div>
                  <small>SPEAKER</small>
                  <strong>講演者のポイント</strong>
                </div>
              </div>
              <ul>
                {activeRecap.presenterPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
            <article className="recap-stream class-stream">
              <div className="recap-stream-heading">
                <span><AppIcon name="users" size={17} /></span>
                <div>
                  <small>CLASS PULSE</small>
                  <strong>みんなの反応</strong>
                </div>
              </div>
              <ul>
                {activeRecap.classPulse.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          </div>
          <div className="recap-question">
            <span>いま生まれている問い</span>
            <strong>{activeRecap.emergingQuestion}</strong>
            <a href="#lecture-question">自分の考えを残す</a>
          </div>
        </div>
      ) : (
        <div className="recap-awaiting">
          <span className="caption-wave" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <div>
            <strong>講義の流れを聴いています</strong>
            <p>話の要点と、みんなの反応がひとつのハイライトになります。</p>
          </div>
        </div>
      )}

      {availableRecaps.length > 1 ? (
        <div className="recap-timeline" aria-label="これまでのハイライト">
          <span>これまで</span>
          {availableRecaps.map((recap, index) => (
            <button
              className={index === activeIndex ? 'is-active' : ''}
              key={recap.id}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              {recap.windowLabel.split('–')[1]}
              {index === availableRecaps.length - 1 ? <i /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {isDemo && availableCount < demoFiveMinuteRecaps.length ? (
        <div className="recap-progress" aria-hidden="true"><span /></div>
      ) : null}
    </section>
  )
}

export function MaterialSummaryPanel({
  isDemo = false,
  summary,
}: MaterialSummaryPanelProps) {
  const visibleSummary = summary ?? (isDemo ? demoMaterialSummary : null)

  return (
    <section className="learning-support summary-panel material-summary-panel">
      <div className="learning-support-heading">
        <span className="support-icon violet material-summary-icon">
          <AppIcon name="book" size={18} />
        </span>
        <div>
          <p className="eyebrow">MATERIAL SUMMARY</p>
          <h2>講義資料の要点</h2>
        </div>
        <span className={`support-state ${visibleSummary ? 'is-ready' : ''}`}>
          {visibleSummary ? '資料から整理' : '講義中'}
        </span>
      </div>

      {visibleSummary ? (
        <>
          <p className="summary-lead">{visibleSummary.lead}</p>
          <ol className="summary-points">
            {visibleSummary.points.map((point) => (
              <li key={`${point.pageLabel}-${point.title}`}>
                <span className="summary-page">{point.pageLabel}</span>
                <div>
                  <strong>{point.title}</strong>
                  <p>{point.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="reflection-prompt">
            <span>資料を読むための問い</span>
            <strong>{visibleSummary.reflectionQuestion}</strong>
          </div>
        </>
      ) : (
        <div className="support-empty summary-empty">
          <span className="support-orbit" aria-hidden="true" />
          <div>
            <strong>資料の大切なポイントを、ひと目で。</strong>
            <p>講義が進むと、参照ページと一緒に要点がまとまります。</p>
          </div>
        </div>
      )}
    </section>
  )
}
