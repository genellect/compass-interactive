import { useEffect, useState, type FormEvent } from 'react'
import { LiveBoard } from '../components/LiveBoard'
import { AppIcon } from '../components/AppIcon'
import { useCompassState } from '../hooks/useCompassState'
import {
  type AdminLecture,
  type AdminPoll,
  supabaseAdminRepository,
} from '../repositories/supabaseAdminRepository'
import {
  type DisplayMode,
  type DisplayState,
} from '../repositories/supabaseDisplayStateRepository'
import {
  getLecturePdfAsset,
  lecturePdfAssets,
} from '../pdf/lectureAssets'

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
    displayState: liveDisplayState,
    displayStateError: liveDisplayStateError,
    hiddenCommentCount,
    lecture,
    participants,
    selectLectureSession,
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
  const [displayStateError, setDisplayStateError] = useState<string | null>(
    null,
  )
  const [displayStateLoading, setDisplayStateLoading] = useState(false)
  const [displayPageInput, setDisplayPageInput] = useState('1')
  const [pdfDocumentInput, setPdfDocumentInput] = useState('')
  const [displayModeInput, setDisplayModeInput] =
    useState<DisplayMode>('normal')
  const [lectures, setLectures] = useState<AdminLecture[]>([])
  const [lecturesError, setLecturesError] = useState<string | null>(null)
  const [lecturesLoading, setLecturesLoading] = useState(false)
  const [newLectureTitle, setNewLectureTitle] = useState('Journal Club')
  const [newLectureStartsAt, setNewLectureStartsAt] = useState('')
  const [newLectureEndsAt, setNewLectureEndsAt] = useState('')
  const [adminPolls, setAdminPolls] = useState<AdminPoll[]>([])
  const [adminPollsError, setAdminPollsError] = useState<string | null>(null)
  const [adminPollsLoading, setAdminPollsLoading] = useState(false)
  const [newPollQuestion, setNewPollQuestion] = useState('')
  const [newPollType, setNewPollType] = useState<AdminPoll['type']>('single')
  const [newPollOptions, setNewPollOptions] = useState('賛成\n反対')
  const selectedPdfAsset = getLecturePdfAsset(displayState?.pdfDocumentId)

  function toDatetimeLocalValue(value: string | null) {
    if (!value) {
      return ''
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    const offsetDate = new Date(
      date.getTime() - date.getTimezoneOffset() * 60000,
    )
    return offsetDate.toISOString().slice(0, 16)
  }

  function fromDatetimeLocalValue(value: string) {
    return value ? new Date(value).toISOString() : null
  }

  function makeJoinedLecture(lectureRow: AdminLecture) {
    return {
      id: lectureRow.id,
      runtimeMode: 'live' as const,
      status: lectureRow.status,
      title: lectureRow.title,
      ...(lectureRow.startsAt ? { startsAt: lectureRow.startsAt } : {}),
      ...(lectureRow.endsAt ? { endsAt: lectureRow.endsAt } : {}),
    }
  }

  async function refreshLectures(token = adminToken) {
    if (!token) {
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'list',
        adminToken: token,
      })
      setLectures(nextLectures)
    } catch (error) {
      setLecturesError(
        error instanceof Error
          ? `講義一覧の取得に失敗しました: ${error.message}`
          : '講義一覧の取得に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function refreshAdminPolls(
    lectureSessionId = activeLectureSessionId,
    token = adminToken,
  ) {
    if (!lectureSessionId || !token) {
      setAdminPolls([])
      setAdminPollsError(null)
      return
    }

    setAdminPollsLoading(true)
    setAdminPollsError(null)

    try {
      setAdminPolls(
        await supabaseAdminRepository.managePolls({
          action: 'list',
          adminToken: token,
          lectureSessionId,
        }),
      )
    } catch (error) {
      setAdminPollsError(
        error instanceof Error
          ? `投票一覧の取得に失敗しました: ${error.message}`
          : '投票一覧の取得に失敗しました。',
      )
    } finally {
      setAdminPollsLoading(false)
    }
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
      await refreshLectures(verifiedAdminToken)
    } catch {
      setAuthError('PINを確認できませんでした。入力内容を確認してください。')
    } finally {
      setIsVerifying(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !adminToken) {
      setLectures([])
      setLecturesError(null)
      return
    }

    void refreshLectures(adminToken)
  }, [adminToken, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !adminToken || !activeLectureSessionId) {
      setAdminPolls([])
      setAdminPollsError(null)
      return
    }

    void refreshAdminPolls(activeLectureSessionId, adminToken)
  }, [activeLectureSessionId, adminToken, isAuthenticated])

  function handleLogout() {
    window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
    setIsAuthenticated(false)
    setAdminToken('')
    setPin('')
    setAdminPolls([])
    setAdminPollsError(null)
  }

  useEffect(() => {
    if (!isAuthenticated || !activeLectureSessionId) {
      setDisplayState(null)
      setDisplayStateError(null)
      return
    }

    setDisplayState(liveDisplayState)
    setDisplayStateError(liveDisplayStateError)
    if (liveDisplayState) {
      setDisplayPageInput(String(liveDisplayState.currentPdfPage))
      setDisplayModeInput(liveDisplayState.displayMode)
      setPdfDocumentInput(liveDisplayState.pdfDocumentId ?? '')
    }
  }, [
    activeLectureSessionId,
    isAuthenticated,
    liveDisplayState,
    liveDisplayStateError,
  ])

  async function updateDisplayState(
    action:
      | 'next'
      | 'previous'
      | 'goToPage'
      | 'setDisplayMode'
      | 'setDocument',
    options: {
      currentPdfPage?: number
      displayMode?: DisplayMode
      pdfDocumentId?: string | null
    } = {},
  ) {
    if (!activeLectureSessionId) {
      setDisplayStateError('先に講義へ参加してください。')
      return
    }

    if (!adminToken) {
      setDisplayStateError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setDisplayStateLoading(true)
    setDisplayStateError(null)

    try {
      let nextDisplayState: Awaited<
        ReturnType<typeof supabaseAdminRepository.updateDisplayState>
      >
      if (action === 'goToPage') {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          currentPdfPage: options.currentPdfPage ?? 1,
          lectureSessionId: activeLectureSessionId,
        })
      } else if (action === 'setDisplayMode') {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          displayMode: options.displayMode ?? 'normal',
          lectureSessionId: activeLectureSessionId,
        })
      } else if (action === 'setDocument') {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          lectureSessionId: activeLectureSessionId,
          pdfDocumentId: options.pdfDocumentId ?? null,
        })
      } else {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          lectureSessionId: activeLectureSessionId,
        })
      }

      setDisplayState(nextDisplayState)
      setDisplayPageInput(String(nextDisplayState.currentPdfPage))
      setDisplayModeInput(nextDisplayState.displayMode)
      setPdfDocumentInput(nextDisplayState.pdfDocumentId ?? '')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '表示画面の更新に失敗しました。'

      if (message === 'Invalid Admin session.') {
        window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
        setAdminToken('')
        setIsAuthenticated(false)
        setAuthError(
          '管理者認証の有効期限が切れました。再度ログインしてください。',
        )
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

  async function handleCreateLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!adminToken) {
      setLecturesError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'create',
        adminToken,
        endsAt: fromDatetimeLocalValue(newLectureEndsAt),
        startsAt: fromDatetimeLocalValue(newLectureStartsAt),
        title: newLectureTitle,
      })
      setLectures(nextLectures)
      const createdLecture = nextLectures[0]
      if (createdLecture) {
        selectLectureSession(makeJoinedLecture(createdLecture))
      }
      setNewLectureTitle('Journal Club')
      setNewLectureStartsAt('')
      setNewLectureEndsAt('')
    } catch (error) {
      setLecturesError(
        error instanceof Error
          ? `講義作成に失敗しました: ${error.message}`
          : '講義作成に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function updateLectureStatus(
    action: 'start' | 'close',
    lectureSessionId: string,
  ) {
    if (
      action === 'close' &&
      !window.confirm(
        '講義を終了します。学生の同期と書き込みが停止します。よろしいですか？',
      )
    ) {
      return
    }

    if (!adminToken) {
      setLecturesError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action,
        adminToken,
        lectureSessionId,
      })
      setLectures(nextLectures)
      const updatedLecture = nextLectures.find(
        (item) => item.id === lectureSessionId,
      )
      if (updatedLecture && activeLectureSessionId === lectureSessionId) {
        selectLectureSession(makeJoinedLecture(updatedLecture))
        await refreshAdminPolls(lectureSessionId, adminToken)
      }
    } catch (error) {
      setLecturesError(
        error instanceof Error
          ? `講義状態の更新に失敗しました: ${error.message}`
          : '講義状態の更新に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function handleCreatePoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!adminToken || !activeLectureSessionId) {
      setAdminPollsError('先に管理対象の講義を選択してください。')
      return
    }

    const optionLabels = newPollOptions
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean)

    if (!newPollQuestion.trim() || optionLabels.length < 2) {
      setAdminPollsError('質問と2件以上の選択肢を入力してください。')
      return
    }

    setAdminPollsLoading(true)
    setAdminPollsError(null)
    try {
      setAdminPolls(
        await supabaseAdminRepository.managePolls({
          action: 'create',
          adminToken,
          lectureSessionId: activeLectureSessionId,
          optionLabels,
          question: newPollQuestion.trim(),
          type: newPollType,
        }),
      )
      setNewPollQuestion('')
      setNewPollOptions('賛成\n反対')
    } catch (error) {
      setAdminPollsError(
        error instanceof Error
          ? `投票の作成に失敗しました: ${error.message}`
          : '投票の作成に失敗しました。',
      )
    } finally {
      setAdminPollsLoading(false)
    }
  }

  async function updatePollStatus(poll: AdminPoll) {
    if (!adminToken || !activeLectureSessionId) {
      return
    }

    const action = poll.status === 'open' ? 'close' : 'open'
    setAdminPollsLoading(true)
    setAdminPollsError(null)
    try {
      setAdminPolls(
        await supabaseAdminRepository.managePolls({
          action,
          adminToken,
          lectureSessionId: activeLectureSessionId,
          pollId: poll.id,
        }),
      )
    } catch (error) {
      setAdminPollsError(
        error instanceof Error
          ? `投票状態の更新に失敗しました: ${error.message}`
          : '投票状態の更新に失敗しました。',
      )
    } finally {
      setAdminPollsLoading(false)
    }
  }

  async function copyLectureCode(lectureCode: string) {
    if (!lectureCode) {
      return
    }

    try {
      await navigator.clipboard.writeText(lectureCode)
      setLecturesError(null)
    } catch {
      setLecturesError('講義コードをコピーできませんでした。')
    }
  }

  function handleGoToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextPage = Number(displayPageInput)

    if (
      !Number.isInteger(nextPage) ||
      nextPage < 1 ||
      !selectedPdfAsset ||
      nextPage > selectedPdfAsset.pageCount
    ) {
      setDisplayStateError(
        selectedPdfAsset
          ? `ページ番号は1〜${selectedPdfAsset.pageCount}で入力してください。`
          : '先にPDF資料を選択してください。',
      )
      return
    }

    void updateDisplayState('goToPage', { currentPdfPage: nextPage })
  }

  if (!isAuthenticated) {
    return (
      <main className="page-shell join-page">
        <form className="join-card" onSubmit={handleLogin}>
          <span className="admin-login-icon"><AppIcon name="compass" size={25} /></span>
          <p className="eyebrow">FOR EDUCATORS</p>
          <h1>講義を運営する</h1>
          <p>管理PINを入力して、講義コントロールを開きます。</p>

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
            {isVerifying ? '確認中…' : '講義コントロールを開く'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="page-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">LECTURE CONTROL</p>
          <h1>{lecture.title}</h1>
          <p>講義の流れと、教室の反応をひとつの画面で。</p>
        </div>
        <div className="admin-actions">
          <a className="secondary-link" href="/display" target="_blank">
            共有画面を開く
          </a>
          <button
            className="secondary-button"
            onClick={handleLogout}
            type="button"
          >
            ログアウト
          </button>
        </div>
      </section>

      <nav className="admin-workflow" aria-label="講義運営の流れ">
        <a href="#admin-prepare"><span>1</span><strong>準備</strong><small>講義と資料</small></a>
        <a href="#admin-live"><span>2</span><strong>講義中</strong><small>投票と共有</small></a>
        <a href="#admin-voices"><span>3</span><strong>振り返り</strong><small>みんなの声</small></a>
      </nav>

      <section className="panel" id="admin-prepare">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PREPARE</p>
            <h2>講義を準備する</h2>
          </div>
          <button
            className="secondary-button"
            disabled={lecturesLoading}
            onClick={() => void refreshLectures()}
            type="button"
          >
            再読み込み
          </button>
        </div>

        <form className="lecture-create-form" onSubmit={handleCreateLecture}>
          <label className="field compact-field">
            <span>講義タイトル</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureTitle(event.target.value)}
              type="text"
              value={newLectureTitle}
            />
          </label>
          <label className="field compact-field">
            <span>開始予定</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureStartsAt(event.target.value)}
              type="datetime-local"
              value={newLectureStartsAt}
            />
          </label>
          <label className="field compact-field">
            <span>終了予定</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureEndsAt(event.target.value)}
              type="datetime-local"
              value={newLectureEndsAt}
            />
          </label>
          <button
            className="primary-button compact"
            disabled={lecturesLoading || newLectureTitle.trim().length === 0}
            type="submit"
          >
            新しい講義を作成
          </button>
        </form>

        {lecturesError ? <p className="error-note">{lecturesError}</p> : null}
        {lecturesLoading ? (
          <p className="note">講義情報を更新しています。</p>
        ) : null}

        <div className="table-like lecture-table">
          {lectures.length > 0 ? (
            lectures.map((lectureRow) => {
              const isActive = activeLectureSessionId === lectureRow.id

              return (
                <div
                  className={`table-row lecture-admin-row ${isActive ? 'is-active' : ''}`}
                  key={lectureRow.id}
                >
                  <span>
                    <strong>{lectureRow.title}</strong>
                    <small>
                      {lectureRow.startsAt
                        ? `開始 ${toDatetimeLocalValue(lectureRow.startsAt).replace('T', ' ')}`
                        : '開始未設定'}
                      {' / '}
                      {lectureRow.endsAt
                        ? `終了 ${toDatetimeLocalValue(lectureRow.endsAt).replace('T', ' ')}`
                        : '終了未設定'}
                    </small>
                  </span>
                  <span className="lecture-code-cell">
                    <code>{lectureRow.lectureCode || '未発行'}</code>
                    <button
                      className="secondary-button compact"
                      disabled={!lectureRow.lectureCode}
                      onClick={() =>
                        void copyLectureCode(lectureRow.lectureCode)
                      }
                      type="button"
                    >
                      コピー
                    </button>
                  </span>
                  <span className={`status-pill ${lectureRow.status}`}>
                    {getStatusLabel(lectureRow.status)}
                  </span>
                  <div className="lecture-row-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        selectLectureSession(makeJoinedLecture(lectureRow))
                      }
                      type="button"
                    >
                      {isActive ? '操作対象' : '選択'}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        lecturesLoading || lectureRow.status !== 'draft'
                      }
                      onClick={() =>
                        void updateLectureStatus('start', lectureRow.id)
                      }
                      type="button"
                    >
                      開始
                    </button>
                    <button
                      className="secondary-button danger-button"
                      disabled={lecturesLoading || lectureRow.status !== 'open'}
                      onClick={() =>
                        void updateLectureStatus('close', lectureRow.id)
                      }
                      type="button"
                    >
                      終了
                    </button>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="note">
              まだ講義がありません。最初の講義を作成しましょう。
            </p>
          )}
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

      <section className="panel" id="admin-live">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIVE MATERIAL</p>
            <h2>講義資料を操作する</h2>
          </div>
          <span className="metric">
            現在のページ: {displayState?.currentPdfPage ?? 1}
          </span>
        </div>

        {!activeLectureSessionId ? (
          <p className="note">講義へ参加後、共有画面を操作できます。</p>
        ) : (
          <div className="display-control-grid">
            <div className="display-control-form pdf-document-control">
              <label className="field compact-field">
                <span>PDF資料</span>
                <select
                  disabled={displayStateLoading || lecture.status === 'closed'}
                  onChange={(event) =>
                    setPdfDocumentInput(event.target.value)
                  }
                  value={pdfDocumentInput}
                >
                  <option value="">資料を表示しない</option>
                  {lecturePdfAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.title}（{asset.pageCount}ページ）
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={displayStateLoading || lecture.status === 'closed'}
                onClick={() =>
                  void updateDisplayState('setDocument', {
                    pdfDocumentId: pdfDocumentInput || null,
                  })
                }
                type="button"
              >
                この資料を表示
              </button>
            </div>

            <div className="display-control-actions">
              <button
                className="secondary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset ||
                  (displayState?.currentPdfPage ?? 1) <= 1
                }
                onClick={() => void updateDisplayState('previous')}
                type="button"
              >
                前へ
              </button>
              <button
                className="primary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset ||
                  (displayState?.currentPdfPage ?? 1) >=
                    selectedPdfAsset.pageCount
                }
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
                  disabled={displayStateLoading || lecture.status === 'closed'}
                  max={selectedPdfAsset?.pageCount ?? 1}
                  min={1}
                  onChange={(event) => setDisplayPageInput(event.target.value)}
                  type="number"
                  value={displayPageInput}
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset
                }
                type="submit"
              >
                移動
              </button>
            </form>

            <div className="display-control-form">
              <label className="field compact-field">
                <span>表示モード</span>
                <select
                  disabled={displayStateLoading || lecture.status === 'closed'}
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
                disabled={displayStateLoading || lecture.status === 'closed'}
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
          学生画面と教室表示は、教員が選んだ資料とページに自動で追従します。
        </p>
      </section>

      <section className="panel ai-readiness-panel">
        <div className="panel-heading">
          <div className="section-intro">
            <span className="section-icon violet"><AppIcon name="sparkles" size={18} /></span>
            <div>
              <p className="eyebrow">LEARNING SUPPORT</p>
              <h2>講義の理解サポート</h2>
            </div>
          </div>
          <span className="support-state is-ready">講義中</span>
        </div>
        <p className="panel-description">
          字幕、直近5分のハイライト、講義資料の要点が、学生の理解を途切れさせずに支えます。
        </p>
        <div className="api-readiness-grid">
          <article>
            <span className="support-icon"><AppIcon name="message" size={18} /></span>
            <div><strong>リアルタイム字幕</strong><small>学生・教室へ配信中</small></div>
            <span className="readiness-dot is-active" />
          </article>
          <article>
            <span className="support-icon violet"><AppIcon name="sparkles" size={18} /></span>
            <div><strong>5分ハイライト</strong><small>話の要点とみんなの反応</small></div>
            <span className="readiness-dot is-active" />
          </article>
          <article>
            <span className="support-icon violet"><AppIcon name="book" size={18} /></span>
            <div><strong>講義資料の要点</strong><small>ページと一緒に整理して表示</small></div>
            <span className="readiness-dot is-active" />
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIVE POLL</p>
            <h2>ライブ投票をつくる</h2>
          </div>
          <button
            className="secondary-button"
            disabled={adminPollsLoading || !activeLectureSessionId}
            onClick={() => void refreshAdminPolls()}
            type="button"
          >
            再読み込み
          </button>
        </div>

        <form
          className="lecture-create-form poll-create-form"
          onSubmit={handleCreatePoll}
        >
          <label className="field">
            <span>質問</span>
            <input
              disabled={adminPollsLoading || lecture.status === 'closed'}
              maxLength={300}
              onChange={(event) => setNewPollQuestion(event.target.value)}
              type="text"
              value={newPollQuestion}
            />
          </label>
          <label className="field compact-field">
            <span>回答形式</span>
            <select
              disabled={adminPollsLoading || lecture.status === 'closed'}
              onChange={(event) =>
                setNewPollType(event.target.value as AdminPoll['type'])
              }
              value={newPollType}
            >
              <option value="single">単一選択</option>
              <option value="multiple">複数選択</option>
            </select>
          </label>
          <label className="field poll-options-field">
            <span>選択肢（1行に1件、2～8件）</span>
            <textarea
              disabled={adminPollsLoading || lecture.status === 'closed'}
              onChange={(event) => setNewPollOptions(event.target.value)}
              rows={4}
              value={newPollOptions}
            />
          </label>
          <button
            className="primary-button compact"
            disabled={
              adminPollsLoading ||
              lecture.status === 'closed' ||
              !activeLectureSessionId ||
              newPollQuestion.trim().length === 0
            }
            type="submit"
          >
            投票を作成
          </button>
        </form>

        {adminPollsError ? (
          <p className="error-note">{adminPollsError}</p>
        ) : null}
        {adminPollsLoading ? (
          <p className="note">投票情報を更新しています。</p>
        ) : null}

        <div className="table-like">
          {adminPolls.map((poll) => (
            <div className="table-row poll-admin-row" key={poll.id}>
              <span>
                <strong>{poll.question}</strong>
                <small>
                  {poll.options
                    .map(
                      (option) => `${option.label}: ${option.responseCount}件`,
                    )
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
                  adminPollsLoading ||
                  (poll.status !== 'open' && lecture.status !== 'open')
                }
                onClick={() => void updatePollStatus(poll)}
                type="button"
              >
                {poll.status === 'open' ? '締め切る' : '開始する'}
              </button>
            </div>
          ))}
          {!adminPollsLoading && adminPolls.length === 0 ? (
            <p className="note">まだ投票はありません。講義の問いを作ってみましょう。</p>
          ) : null}
        </div>
      </section>

      <div id="admin-voices">
        <LiveBoard
          comments={comments}
          mode="admin"
          onTogglePinned={toggleCommentPinned}
          onToggleVisibility={toggleCommentVisibility}
        />
      </div>
    </main>
  )
}
