import { useEffect, useState, type FormEvent } from 'react'
import { LiveBoard } from '../components/LiveBoard'
import { useCompassState } from '../hooks/useCompassState'
import { supabaseAdminRepository } from '../repositories/supabaseAdminRepository'
import {
  type DisplayMode,
  type DisplayState,
  supabaseDisplayStateRepository,
} from '../repositories/supabaseDisplayStateRepository'
import type { PollStatus } from '../types'

const ADMIN_SESSION_STORAGE_KEY = 'compass-interactive-admin-authenticated'
const ADMIN_TOKEN_SESSION_STORAGE_KEY = 'compass-interactive-admin-token'

function restoreAdminSession() {
  return window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true'
}

function restoreAdminToken() {
  return window.sessionStorage.getItem(ADMIN_TOKEN_SESSION_STORAGE_KEY) ?? ''
}

function getStatusLabel(status: string) {
  if (status === 'open') {
    return '受付中'
  }

  if (status === 'closed') {
    return '締切'
  }

  return '準備中'
}

export function AdminPage() {
  const {
    activeLectureSessionId,
    comments,
    hiddenCommentCount,
    lecture,
    participants,
    polls,
    pollResponses,
    setPollStatus,
    toggleCommentPinned,
    toggleCommentVisibility,
    visibleComments,
  } = useCompassState()
  const [isAuthenticated, setIsAuthenticated] = useState(restoreAdminSession)
  const [adminToken, setAdminToken] = useState(restoreAdminToken)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(null)
  const [displayStateLoading, setDisplayStateLoading] = useState(false)
  const [displayPageInput, setDisplayPageInput] = useState('1')
  const [displayModeInput, setDisplayModeInput] =
    useState<DisplayMode>('normal')

  function nextPollStatus(currentStatus: PollStatus): PollStatus {
    return currentStatus === 'open' ? 'closed' : 'open'
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsVerifying(true)
    setAuthError('')

    try {
      const verifiedAdminToken =
        await supabaseAdminRepository.verifyAdminPin(pin)
      window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true')
      window.sessionStorage.setItem(
        ADMIN_TOKEN_SESSION_STORAGE_KEY,
        verifiedAdminToken,
      )
      setAdminToken(verifiedAdminToken)
      setIsAuthenticated(true)
      setPin('')
    } catch {
      setAuthError('PINを確認できませんでした。入力内容を確認してください。')
    } finally {
      setIsVerifying(false)
    }
  }

  function handleLogout() {
    window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
    setIsAuthenticated(false)
    setAdminToken('')
    setPin('')
  }

  useEffect(() => {
    if (!isAuthenticated || !activeLectureSessionId) {
      setDisplayState(null)
      setDisplayStateError(null)
      return
    }

    async function loadDisplayState() {
      if (!activeLectureSessionId) {
        return
      }

      try {
        const remoteDisplayState =
          await supabaseDisplayStateRepository.getDisplayState(
            activeLectureSessionId,
          )
        setDisplayState(remoteDisplayState)
        setDisplayPageInput(String(remoteDisplayState.currentPdfPage))
        setDisplayModeInput(remoteDisplayState.displayMode)
        setDisplayStateError(null)
      } catch (error) {
        setDisplayStateError(
          error instanceof Error
            ? `表示画面の状態取得に失敗しました: ${error.message}`
            : '表示画面の状態取得に失敗しました。',
        )
      }
    }

    void loadDisplayState()

    return supabaseDisplayStateRepository.subscribeDisplayState({
      lectureSessionId: activeLectureSessionId,
      onStateChange: (nextDisplayState) => {
        setDisplayState(nextDisplayState)
        setDisplayPageInput(String(nextDisplayState.currentPdfPage))
        setDisplayModeInput(nextDisplayState.displayMode)
        setDisplayStateError(null)
      },
    })
  }, [activeLectureSessionId, isAuthenticated])

  async function updateDisplayState(
    action: 'next' | 'previous' | 'goToPage' | 'setDisplayMode',
    options: {
      currentPdfPage?: number
      displayMode?: DisplayMode
    } = {},
  ) {
    if (!activeLectureSessionId) {
      setDisplayStateError('先に講義へ参加してください。')
      return
    }

    if (!adminToken) {
      setDisplayStateError('管理者認証の有効期限が切れました。再度ログインしてください。')
      return
    }

    setDisplayStateLoading(true)
    setDisplayStateError(null)

    try {
      const nextDisplayState =
        action === 'goToPage'
          ? await supabaseAdminRepository.updateDisplayState({
              action,
              adminToken,
              currentPdfPage: options.currentPdfPage ?? 1,
              lectureSessionId: activeLectureSessionId,
            })
          : action === 'setDisplayMode'
            ? await supabaseAdminRepository.updateDisplayState({
                action,
                adminToken,
                displayMode: options.displayMode ?? 'normal',
                lectureSessionId: activeLectureSessionId,
              })
            : await supabaseAdminRepository.updateDisplayState({
                action,
                adminToken,
                lectureSessionId: activeLectureSessionId,
              })

      setDisplayState(nextDisplayState)
      setDisplayPageInput(String(nextDisplayState.currentPdfPage))
      setDisplayModeInput(nextDisplayState.displayMode)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '表示画面の更新に失敗しました。'

      if (message === 'Invalid Admin session.') {
        window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
        setAdminToken('')
        setIsAuthenticated(false)
        setAuthError('管理者認証の有効期限が切れました。再度ログインしてください。')
      }

      setDisplayStateError(
        message === 'Invalid Admin session.'
          ? '管理者認証の有効期限が切れました。再度ログインしてください。'
          : '表示画面の更新に失敗しました。少し時間をおいて再度お試しください。',
      )
    } finally {
      setDisplayStateLoading(false)
    }
  }

  function handleGoToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextPage = Number(displayPageInput)

    if (!Number.isInteger(nextPage) || nextPage < 1) {
      setDisplayStateError('ページ番号は1以上の整数で入力してください。')
      return
    }

    void updateDisplayState('goToPage', { currentPdfPage: nextPage })
  }

  if (!isAuthenticated) {
    return (
      <main className="page-shell join-page">
        <form className="join-card" onSubmit={handleLogin}>
          <p className="eyebrow">管理者</p>
          <h1>管理PINを入力</h1>
          <p>管理者用の操作画面を開きます。</p>

          <label className="field">
            <span>PIN</span>
            <input
            aria-label="管理PIN"
              autoComplete="off"
              disabled={isVerifying}
              inputMode="numeric"
              onChange={(event) => setPin(event.target.value)}
              type="password"
              value={pin}
            />
          </label>

          {authError ? <p className="error-note">{authError}</p> : null}

          <button
            className="primary-button"
            disabled={isVerifying || pin.trim().length === 0}
            type="submit"
          >
            {isVerifying ? '確認中...' : '管理画面を開く'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="page-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">管理画面</p>
          <h1>{lecture.title}</h1>
          <p>コメント、投票、共有画面を確認・操作します。</p>
        </div>
        <div className="admin-actions">
          <a className="secondary-link" href="/display" target="_blank">
            共有画面を開く
          </a>
          <button className="secondary-button" onClick={handleLogout} type="button">
            ログアウト
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="stat-card">
          <span>講義状態</span>
          <strong>{getStatusLabel(lecture.status)}</strong>
        </article>
        <article className="stat-card">
          <span>参加者数</span>
          <strong>{participants.length}</strong>
        </article>
        <article className="stat-card">
          <span>表示コメント</span>
          <strong>{visibleComments.length}</strong>
        </article>
        <article className="stat-card">
          <span>非表示コメント</span>
          <strong>{hiddenCommentCount}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">共有画面</p>
            <h2>スライド操作</h2>
          </div>
          <span className="metric">
            現在のページ: {displayState?.currentPdfPage ?? 1}
          </span>
        </div>

        {!activeLectureSessionId ? (
          <p className="note">
            講義へ参加後、共有画面を操作できます。
          </p>
        ) : (
          <div className="display-control-grid">
            <div className="display-control-actions">
              <button
                className="secondary-button"
                disabled={displayStateLoading}
                onClick={() => void updateDisplayState('previous')}
                type="button"
              >
                前へ
              </button>
              <button
                className="primary-button"
                disabled={displayStateLoading}
                onClick={() => void updateDisplayState('next')}
                type="button"
              >
                次へ
              </button>
            </div>

            <form className="display-control-form" onSubmit={handleGoToPage}>
              <label className="field compact-field">
                <span>ページ番号</span>
                <input
                  disabled={displayStateLoading}
                  min={1}
                  onChange={(event) => setDisplayPageInput(event.target.value)}
                  type="number"
                  value={displayPageInput}
                />
              </label>
              <button
                className="secondary-button"
                disabled={displayStateLoading}
                type="submit"
              >
                移動
              </button>
            </form>

            <div className="display-control-form">
              <label className="field compact-field">
                <span>表示モード</span>
                <select
                  disabled={displayStateLoading}
                  onChange={(event) =>
                    setDisplayModeInput(event.target.value as DisplayMode)
                  }
                  value={displayModeInput}
                >
                  <option value="normal">通常表示</option>
                  <option value="presentation">発表表示</option>
                  <option value="slideOnly">スライドのみ</option>
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={displayStateLoading}
                onClick={() =>
                  void updateDisplayState('setDisplayMode', {
                    displayMode: displayModeInput,
                  })
                }
                type="button"
              >
                適用
              </button>
            </div>
          </div>
        )}

        {displayStateError ? (
          <p className="error-note">{displayStateError}</p>
        ) : null}
        <p className="note">
          共有画面にはページ番号と表示モードのみを同期します。PDFファイル本体はブラウザ内で扱います。
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">投票</p>
            <h2>Poll管理</h2>
          </div>
          <span className="metric">回答 {pollResponses.length}件</span>
        </div>
        <div className="table-like">
          {polls.map((poll) => (
            <div className="table-row poll-admin-row" key={poll.id}>
              <span>{poll.question}</span>
              <span>{poll.type === 'single' ? '単一選択' : '複数選択'}</span>
              <span className={`status-pill ${poll.status}`}>
                {getStatusLabel(poll.status)}
              </span>
              <button
                className="secondary-button"
                onClick={() => setPollStatus(poll.id, nextPollStatus(poll.status))}
                type="button"
              >
                {poll.status === 'open' ? '締め切る' : '開始する'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <LiveBoard
        comments={comments}
        mode="admin"
        onTogglePinned={toggleCommentPinned}
        onToggleVisibility={toggleCommentVisibility}
      />
    </main>
  )
}
