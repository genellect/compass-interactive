import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCompassState } from '../hooks/useCompassState'

export function JoinPage() {
  const { hasJoinedLectureSession, joinLecture, lecture } = useCompassState()
  const [lectureCode, setLectureCode] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const didAutoJoin = useRef(false)

  useEffect(() => {
    const directCode = searchParams.get('code')?.trim()
    if (!directCode || didAutoJoin.current) {
      return
    }

    didAutoJoin.current = true
    setLectureCode(directCode)
    setIsJoining(true)

    void joinLecture(directCode).then((result) => {
      setIsJoining(false)
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }

      setErrorMessage('')
      navigate('/lecture', { replace: true })
    })
  }, [joinLecture, navigate, searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsJoining(true)
    const result = await joinLecture(lectureCode)
    setIsJoining(false)

    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }

    setErrorMessage('')
    navigate('/lecture')
  }

  return (
    <main className="page-shell join-page">
      <form className="join-card" onSubmit={handleSubmit}>
        <p className="eyebrow">COMPASS Interactive</p>
        <h1>講義に参加する</h1>
        <p>教員から案内された講義コードを入力してください。</p>
        <p className="note">
          <code>DEMO</code>{' '}
          と入力すると、Supabaseへ接続しない端末内デモを開始できます。
        </p>

        {hasJoinedLectureSession ? (
          <div className="joined-summary">
            <span>参加中</span>
            <strong>{lecture.title}</strong>
            <button
              className="secondary-button"
              onClick={() => navigate('/lecture')}
              type="button"
            >
              参加画面へ
            </button>
          </div>
        ) : null}

        <label className="field">
          <span>講義コード</span>
          <input
            aria-label="講義コード"
            autoComplete="off"
            disabled={isJoining}
            onChange={(event) => setLectureCode(event.target.value)}
            placeholder="講義コードを入力"
            type="text"
            value={lectureCode}
          />
        </label>

        {errorMessage ? <p className="error-note">{errorMessage}</p> : null}

        <button
          className="primary-button"
          disabled={isJoining || lectureCode.trim().length === 0}
          type="submit"
        >
          {isJoining ? '確認しています...' : '参加する'}
        </button>
      </form>
    </main>
  )
}
