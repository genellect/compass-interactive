import { useState } from 'react'
import {
  limitCommentNicknameInput,
  MAX_COMMENT_NICKNAME_LENGTH,
  normalizeCommentNickname,
} from '../../lib/commentNickname'
import { AppIcon } from '../AppIcon'

const MAX_COMMENT_LENGTH = 120
const promptSuggestions = [
  'ここがまだ分からない',
  'もう一度説明してほしい',
  'この視点がおもしろい',
]

type CommentInputProps = {
  disabled?: boolean
  isSubmitting?: boolean
  nicknameMode?: 'demo' | 'disabled' | 'live'
  onSubmit: (
    body: string,
    nickname: string | null,
  ) => boolean | Promise<boolean>
}

export function CommentInput({
  disabled = false,
  isSubmitting = false,
  nicknameMode = 'disabled',
  onSubmit,
}: CommentInputProps) {
  const [body, setBody] = useState('')
  const [nickname, setNickname] = useState('')
  const [usesNickname, setUsesNickname] = useState(false)
  const remainingLength = MAX_COMMENT_LENGTH - body.length
  const normalizedNickname = usesNickname
    ? normalizeCommentNickname(nickname)
    : null

  async function handleSubmit() {
    const trimmedBody = body.trim()
    if (!trimmedBody || disabled || isSubmitting) {
      return
    }

    const didSubmit = await onSubmit(trimmedBody, normalizedNickname)
    if (didSubmit) {
      setBody('')
    }
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
        <span className="privacy-badge">デフォルト：匿名の参加者</span>
      </div>

      <div className="prompt-suggestions" aria-label="入力例">
        {promptSuggestions.map((suggestion) => (
          <button
            disabled={disabled || isSubmitting}
            key={suggestion}
            onClick={() => setBody(suggestion)}
            type="button"
          >
            + {suggestion}
          </button>
        ))}
      </div>

      {nicknameMode !== 'disabled' ? (
        <div className="nickname-control">
          <label className="nickname-toggle">
            <input
              checked={usesNickname}
              disabled={disabled || isSubmitting}
              onChange={(event) => setUsesNickname(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>ニックネームをつける</strong>
              <small>空欄なら「匿名の参加者」として投稿されます</small>
            </span>
          </label>
          {usesNickname ? (
            <label className="nickname-field">
              <span>表示名（任意・10文字まで）</span>
              <input
                autoComplete="off"
                disabled={disabled || isSubmitting}
                onChange={(event) =>
                  setNickname(limitCommentNicknameInput(event.target.value))
                }
                placeholder="例：薬理好き、質問係"
                value={nickname}
              />
              <span className="nickname-counter" aria-live="polite">
                {Array.from(nickname).length}/{MAX_COMMENT_NICKNAME_LENGTH}
              </span>
              <small>
                {nicknameMode === 'demo'
                  ? 'デモではこの端末内だけに保存され、Supabaseへは送信されません。'
                  : 'プロフィールは作らず、このコメントと一緒にだけ保存します。個人情報は入力しないでください。'}
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
              : '感じたことを、そのまま言葉にしてみてください。'
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
    </section>
  )
}
