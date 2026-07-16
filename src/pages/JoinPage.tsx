import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppIcon } from '../components/AppIcon'
import { useCompassState } from '../hooks/useCompassState'

const STANDARD_LECTURE_CODE_PATTERN = /^[0-9]{6}$/
const LEGACY_LECTURE_CODE_PATTERN = /^[A-Z0-9-]{4,32}$/

function normalizeLectureCode(value: string) {
  return value.trim().toUpperCase()
}

function getLectureCodeValidationError(value: string, legacyMode: boolean) {
  const normalizedCode = normalizeLectureCode(value)
  const isValid = legacyMode
    ? LEGACY_LECTURE_CODE_PATTERN.test(normalizedCode)
    : STANDARD_LECTURE_CODE_PATTERN.test(normalizedCode)

  if (isValid) {
    return null
  }

  return legacyMode
    ? '旧形式の講義コードを4〜32文字の英数字・ハイフンで入力してください。'
    : '講義コードを6桁の数字で入力してください。'
}

export function JoinPage() {
  const { hasJoinedLectureSession, joinLecture, lecture } = useCompassState()
  const [lectureCode, setLectureCode] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [legacyCodeMode, setLegacyCodeMode] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const didAutoJoin = useRef(false)

  useEffect(() => {
    const directCode = normalizeLectureCode(searchParams.get('code') ?? '')
    if (!directCode || didAutoJoin.current) {
      return
    }

    didAutoJoin.current = true
    const isLegacyCode = !STANDARD_LECTURE_CODE_PATTERN.test(directCode)
    setLectureCode(directCode)
    setLegacyCodeMode(isLegacyCode)
    const validationError = getLectureCodeValidationError(
      directCode,
      isLegacyCode,
    )
    if (validationError) {
      setErrorMessage(validationError)
      return
    }
    setIsJoining(true)

    void joinLecture(directCode).then((result) => {
      setIsJoining(false)
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }

      setErrorMessage('')
      navigate(
        result.destination === 'archive' ? '/lecture/archive' : '/lecture',
        { replace: true },
      )
    })
  }, [joinLecture, navigate, searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedCode = normalizeLectureCode(lectureCode)
    const validationError = getLectureCodeValidationError(
      normalizedCode,
      legacyCodeMode,
    )
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsJoining(true)
    const result = await joinLecture(normalizedCode)
    setIsJoining(false)

    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }

    setErrorMessage('')
    navigate(
      result.destination === 'archive' ? '/lecture/archive' : '/lecture',
    )
  }

  return (
    <main className="join-experience">
      <div className="hero-aurora" aria-hidden="true">
        <span className="hero-orbit orbit-one" />
        <span className="hero-orbit orbit-two" />
        <span className="hero-stars" />
      </div>

      <section className="join-hero-copy">
        <div className="hero-kicker">
          <span className="live-dot" />
          COMPASS Interactive
        </div>
        <h1>
          <span className="hero-line hero-primary-line">わからないが、</span>
          <br className="mobile-hero-break" />
          <span className="hero-line hero-accent-line">動き出す。</span>
        </h1>

        <div className="hero-feature-row" aria-label="講義でできること">
          <span>
            <AppIcon name="message" size={17} /> 匿名で質問
          </span>
          <span>
            <AppIcon name="poll" size={17} /> ライブ投票
          </span>
          <span>
            <AppIcon name="book" size={17} /> 資料と同期
          </span>
        </div>

        <form className="join-card" onSubmit={handleSubmit}>
          <div className="join-card-heading">
            <div>
              <p className="eyebrow">JOIN LECTURE</p>
              <h2>講義に参加する</h2>
            </div>
            <span className="privacy-badge">匿名で参加</span>
          </div>

          <label className="field join-code-field">
            <span>講義コード</span>
            <div className="input-with-action">
              <input
                aria-label="講義コード"
                autoComplete="off"
                disabled={isJoining}
                inputMode={legacyCodeMode ? 'text' : 'numeric'}
                maxLength={legacyCodeMode ? 32 : 6}
                onChange={(event) => {
                  setErrorMessage('')
                  setLectureCode(
                    legacyCodeMode
                      ? event.target.value.toUpperCase()
                      : event.target.value.replace(/\D/g, '').slice(0, 6),
                  )
                }}
                placeholder={legacyCodeMode ? '旧形式の講義コード' : '例：285463'}
                type="text"
                value={lectureCode}
              />
              <button
                className="primary-button join-submit"
                disabled={isJoining || lectureCode.trim().length === 0}
                type="submit"
              >
                {isJoining ? '確認中…' : '参加する'}
                {!isJoining ? <AppIcon name="arrow-right" size={18} /> : null}
              </button>
            </div>
            <button
              className="join-code-mode-toggle"
              disabled={isJoining}
              onClick={() => {
                setLectureCode('')
                setErrorMessage('')
                setLegacyCodeMode((current) => !current)
              }}
              type="button"
            >
              {legacyCodeMode
                ? '6桁の講義コードを入力する'
                : '以前発行された英数字コードを入力する'}
            </button>
          </label>

          {errorMessage ? (
            <p className="error-note" role="alert">
              {errorMessage}
            </p>
          ) : null}

          {hasJoinedLectureSession ? (
            <div className="joined-summary">
              <span className="joined-summary-icon">
                <AppIcon name="book" size={18} />
              </span>
              <span>
                <small>前回の講義</small>
                <strong>{lecture.title}</strong>
              </span>
              <button
                className="secondary-button compact"
                onClick={() => navigate('/lecture')}
                type="button"
              >
                戻る
              </button>
            </div>
          ) : null}
        </form>

        <div className="demo-entry">
          <div>
            <span className="demo-entry-icon">
              <AppIcon name="sparkles" size={20} />
            </span>
            <p>
              <strong>講義コードをお持ちでない方へ</strong>
              <span>PDF・質問・投票を3分で体験できます。</span>
            </p>
          </div>
          <button
            className="text-link-button"
            onClick={() => navigate('/demo')}
            type="button"
          >
            デモ講義を体験
            <AppIcon name="arrow-right" size={17} />
          </button>
        </div>
      </section>

      <section className="hero-lecture-preview" aria-label="講義画面プレビュー">
        <div className="preview-window">
          <div className="preview-window-bar">
            <span className="preview-brand">
              <span className="brand-mark mini" />
              COMPASS
            </span>
            <span className="preview-live">
              <i /> LIVE
            </span>
            <span className="preview-count">
              <AppIcon name="users" size={15} /> 218
            </span>
          </div>

          <div className="preview-lecture-title">
            <span>今日のテーマ</span>
            <strong>翻訳できる時代に、なぜ英語を学ぶのか。</strong>
          </div>

          <div className="preview-slide">
            <div className="preview-slide-art" aria-hidden="true">
              <span className="preview-globe" />
              <span className="preview-compass-line" />
            </div>
            <div>
              <small>SLIDE 06</small>
              <strong>英語は、情報だけでなく<br />人とつながるための言葉。</strong>
            </div>
          </div>

          <div className="preview-grid">
            <article className="preview-question">
              <p className="eyebrow">LIVE QUESTION</p>
              <strong>英語を学ぶ価値は、どこに残ると思いますか？</strong>
              <div className="preview-poll-bars" aria-hidden="true">
                <span style={{ '--poll-width': '74%' } as CSSProperties} />
                <span style={{ '--poll-width': '51%' } as CSSProperties} />
                <span style={{ '--poll-width': '32%' } as CSSProperties} />
              </div>
            </article>
            <article className="preview-comment">
              <span className="preview-avatar">?</span>
              <p>
                翻訳結果が正しいか判断する力も、自分に必要だと思いました。
              </p>
              <small>
                <AppIcon name="heart" size={14} /> 27
              </small>
            </article>
          </div>

          <div className="preview-ai">
            <span className="support-icon violet">
              <AppIcon name="sparkles" size={17} />
            </span>
            <p>
              <small>LEARNING REVIEW</small>
              <strong>今日の学びが、次の問いにつながります。</strong>
            </p>
            <span className="preview-ai-arrow">→</span>
          </div>
        </div>
      </section>

      <footer className="educator-entry">
        <div>
          <span>教員・講義運営者の方へ</span>
          <Link to="/admin">
            教員用コントロールを開く
            <AppIcon name="arrow-right" size={15} />
          </Link>
        </div>
        <small className="copyright-note">
          © COMPASS. All rights reserved. Developer: Yuto Matsui
        </small>
      </footer>
    </main>
  )
}
