import { useEffect, useMemo, useRef, useState } from 'react'
import {
  limitCommentNicknameInput,
  MAX_COMMENT_NICKNAME_LENGTH,
  normalizeCommentNickname,
} from '../../lib/commentNickname'
import { AppIcon } from '../AppIcon'

const MAX_COMMENT_LENGTH = 120
const DRAFT_STORAGE_PREFIX = 'compass-comment-draft:'

type CommentInputProps = {
  disabled?: boolean
  draftKey?: string
  isSubmitting?: boolean
  nicknameMode?: 'demo' | 'disabled' | 'live'
  onSubmit: (
    body: string,
    nickname: string | null,
  ) => boolean | Promise<boolean>
}

function readDraft(storageKey: string) {
  try {
    return window.sessionStorage.getItem(storageKey) ?? ''
  } catch {
    return ''
  }
}

export function CommentInput({
  disabled = false,
  draftKey = 'default',
  isSubmitting = false,
  nicknameMode = 'disabled',
  onSubmit,
}: CommentInputProps) {
  const storageKey = useMemo(
    () => `${DRAFT_STORAGE_PREFIX}${draftKey}`,
    [draftKey],
  )
  const [body, setBody] = useState(() => readDraft(storageKey))
  const [nickname, setNickname] = useState('')
  const [nicknameLimitWarning, setNicknameLimitWarning] = useState(false)
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(
    null,
  )
  const [usesNickname, setUsesNickname] = useState(false)
  const previousStorageKeyRef = useRef(storageKey)
  const remainingLength = MAX_COMMENT_LENGTH - body.length
  const normalizedNickname = usesNickname
    ? normalizeCommentNickname(nickname)
    : null

  useEffect(() => {
    if (previousStorageKeyRef.current === storageKey) return
    previousStorageKeyRef.current = storageKey
    setBody(readDraft(storageKey))
  }, [storageKey])

  useEffect(() => {
    try {
      if (body) {
        window.sessionStorage.setItem(storageKey, body)
      } else {
        window.sessionStorage.removeItem(storageKey)
      }
    } catch {
      // A draft is a progressive enhancement. Posting remains available when
      // storage is unavailable or blocked.
    }
  }, [body, storageKey])

  useEffect(() => {
    if (!submissionMessage) return
    const timer = window.setTimeout(() => setSubmissionMessage(null), 3_000)
    return () => window.clearTimeout(timer)
  }, [submissionMessage])

  async function handleSubmit() {
    const trimmedBody = body.trim()
    if (!trimmedBody || disabled || isSubmitting) return

    const didSubmit = await onSubmit(trimmedBody, normalizedNickname)
    if (didSubmit) {
      setBody('')
      setSubmissionMessage('みんなの声に届きました')
    }
  }

  function handleNicknameChange(value: string) {
    const isOverLimit =
      Array.from(value).length > MAX_COMMENT_NICKNAME_LENGTH
    setNicknameLimitWarning(isOverLimit)
    setNickname(limitCommentNicknameInput(value))
  }

  return (
    <section className="panel comment-composer" id="lecture-question">
      <div className="panel-heading">
        <div className="section-intro">
          <span className="section-icon">
            <AppIcon name="message" size={18} />
          </span>
          <div>
            <p className="eyebrow">SHARE YOUR THOUGHT</p>
            <h2>気づき・質問を共有する</h2>
          </div>
        </div>
      </div>

      {nicknameMode !== 'disabled' ? (
        <div className="nickname-control">
          <label className="nickname-toggle">
            <input
              checked={usesNickname}
              disabled={disabled || isSubmitting}
              onChange={(event) => {
                setUsesNickname(event.target.checked)
                if (!event.target.checked) {
                  setNicknameLimitWarning(false)
                }
              }}
              type="checkbox"
            />
            <span>
              <strong>ニックネームを表示する</strong>
              <small>使わない場合は匿名で投稿されます</small>
            </span>
          </label>
          {usesNickname ? (
            <label className="nickname-field">
              <span>ニックネーム（任意・10文字まで）</span>
              <input
                aria-describedby={
                  nicknameLimitWarning
                    ? 'nickname-help nickname-limit-warning'
                    : 'nickname-help'
                }
                aria-invalid={nicknameLimitWarning}
                autoComplete="off"
                disabled={disabled || isSubmitting}
                onChange={(event) => handleNicknameChange(event.target.value)}
                placeholder="例：薬理好き"
                value={nickname}
              />
              <span className="nickname-counter" aria-live="polite">
                {Array.from(nickname).length}/{MAX_COMMENT_NICKNAME_LENGTH}
              </span>
              {nicknameLimitWarning ? (
                <small
                  className="nickname-limit-warning"
                  id="nickname-limit-warning"
                  role="alert"
                >
                  10文字以内で入力してください
                </small>
              ) : null}
              <small id="nickname-help">
                {nicknameMode === 'demo'
                  ? 'このデモ画面の中だけで使われます。'
                  : 'このコメントにだけ表示されます。個人情報は入力しないでください。'}
              </small>
            </label>
          ) : null}
        </div>
      ) : null}

      <label className="field">
        <span className="sr-only">質問や気づき</span>
        <textarea
          disabled={disabled}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            disabled
              ? '講義に参加すると投稿できます。'
              : '感じたことや質問を、そのまま書いてみてください。'
          }
          value={body}
        />
      </label>

      <div className="composer-footer">
        <span className={remainingLength < 20 ? 'is-low' : ''}>
          あと {remainingLength}字
        </span>
        <button
          className="primary-button compact"
          disabled={disabled || isSubmitting || body.trim().length === 0}
          onClick={handleSubmit}
          type="button"
        >
          {isSubmitting ? '送信中…' : 'みんなに共有'}
          {!isSubmitting ? <AppIcon name="arrow-right" size={17} /> : null}
        </button>
      </div>
      <span className="comment-submit-status" role="status">
        {submissionMessage}
      </span>
    </section>
  )
}
